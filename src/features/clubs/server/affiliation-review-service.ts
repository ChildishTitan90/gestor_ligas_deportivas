import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { affiliationListSchema, affiliationReviewPhase, affiliationReviewSchema } from "../affiliation-review";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError, lockAuthorization } from "@/server/auth/authorization";

export class AffiliationReviewError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
const summarySelect = {
  id: true, reference_number: true, club_id: true, league_id: true, season_id: true,
  club_name: true, status: true, review_reason: true, reviewed_at: true, review_version: true,
  seasons: { select: { name: true, status: true } }, clubs: { select: { name: true } },
} satisfies Prisma.club_affiliationsSelect;
type Summary = Prisma.club_affiliationsGetPayload<{ select: typeof summarySelect }>;
function summary(row: Summary) {
  return { id: row.id, referenceNumber: row.reference_number, clubId: row.club_id,
    leagueId: row.league_id, seasonId: row.season_id, clubName: row.club_name ?? row.clubs.name,
    seasonName: row.seasons.name,
    status: row.status, reviewPhase: row.status === "PENDING" ? affiliationReviewPhase(row.status, row.review_reason) : null,
    observations: row.review_reason, reviewedAt: row.reviewed_at, version: row.review_version };
}
function validId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new AffiliationReviewError("VALIDATION_ERROR");
}

async function assertReviewer(tx: Prisma.TransactionClient, actorId: string,
  row: { league_id: string; club_id: string; season_id: string; requested_by: string }) {
  const grants = await assertPermission(tx, actorId, { module: "clubs", action: "APPROVE",
    context: { leagueId: row.league_id, clubId: row.club_id, seasonId: row.season_id } });
  const secretary = await tx.roles.findUniqueOrThrow({ where: { code: "SECRETARY" }, select: { id: true } });
  if (!grants.some((g) => g.roleId === secretary.id) || row.requested_by === actorId)
    throw new AuthorizationError();
  const delegates = await tx.$queryRaw<{ id: string }[]>`
    SELECT ur.id FROM sports_management.user_roles ur
    JOIN sports_management.roles r ON r.id = ur.role_id
    WHERE ur.user_id = ${actorId}::uuid AND ur.club_id = ${row.club_id}::uuid
      AND r.code = 'CLUB_DELEGATE' AND ur.starts_at <= clock_timestamp()
      AND (ur.ends_at IS NULL OR ur.ends_at > clock_timestamp()) FOR SHARE OF ur, r
  `;
  if (delegates.length) throw new AuthorizationError();
}

export async function listAffiliations(input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = affiliationListSchema.safeParse(input);
  if (!parsed.success) throw new AffiliationReviewError("VALIDATION_ERROR");
  const { leagueId, clubId, seasonId, status, page, pageSize } = parsed.data;
  return getPrisma().$transaction(async (tx) => {
    // La consulta queda acotada al mismo contexto que se autoriza.
    await assertPermission(tx, actor.id, { module: "clubs", action: "READ", context: { leagueId, clubId, seasonId } });
    const rows = await tx.club_affiliations.findMany({
      where: { league_id: leagueId, club_id: clubId, season_id: seasonId, status },
      select: summarySelect, orderBy: { id: "asc" }, skip: (page - 1) * pageSize, take: pageSize + 1,
    });
    return { items: rows.slice(0, pageSize).map(summary), page, pageSize, hasMore: rows.length > pageSize };
  });
}

export async function getAffiliation(id: string) {
  const actor = await requireOperationalUser();
  validId(id);
  return getPrisma().$transaction(async (tx) => {
    await lockAuthorization(tx);
    const row = await tx.club_affiliations.findUnique({ where: { id }, select: {
      ...summarySelect, uniform_colors: true, signed_affiliation_file_id: true, submission_key: true, requested_by: true,
      club_affiliation_categories: { select: { category_id: true,
        season_categories: { select: { categories: { select: { name: true } } } } }, orderBy: { category_id: "asc" } },
      club_officers: { select: { office: true, signature_file_id: true, support_file_id: true,
        people: { select: { first_name: true, paternal_surname: true, maternal_surname: true } } }, orderBy: { office: "asc" } },
    } });
    if (!row) throw new AffiliationReviewError("NOT_FOUND", 404);
    await assertPermission(tx, actor.id, { module: "clubs", action: "READ",
      context: { leagueId: row.league_id, clubId: row.club_id, seasonId: row.season_id } });
    const allowedActions: ("APPROVE" | "REQUEST_CORRECTIONS")[] = [];
    if (row.status === "PENDING" && !row.review_reason && row.seasons.status !== "CLOSED") {
      try { await assertReviewer(tx, actor.id, row); allowedActions.push("APPROVE", "REQUEST_CORRECTIONS"); }
      catch (error) { if (!(error instanceof AuthorizationError)) throw error; }
    }
    const history = await tx.audit_logs.findMany({ where: { table_name: "club_affiliations", entity_id: id,
      action: { in: ["AFFILIATION_APPROVE", "AFFILIATION_REQUEST_CORRECTIONS", "AFFILIATION_RESUBMIT"] } },
      select: { id: true, action: true, occurred_at: true, user_id: true, new_data: true },
      orderBy: [{ occurred_at: "asc" }, { id: "asc" }] });
    return { ...summary(row), uniformColors: row.uniform_colors, allowedActions,
      ...(row.requested_by === actor.id ? { submissionKey: row.submission_key } : {}),
      signedAffiliationFileId: row.signed_affiliation_file_id,
      categoryIds: row.club_affiliation_categories.map((c) => c.category_id),
      categories: row.club_affiliation_categories.map((c) => c.season_categories.categories.name),
      officers: row.club_officers.map((o) => ({ office: o.office, firstName: o.people.first_name,
        paternalSurname: o.people.paternal_surname, maternalSurname: o.people.maternal_surname ?? "",
        signatureFileId: o.signature_file_id, supportFileId: o.support_file_id })),
      history: history.map((h) => ({ id: h.id, action: h.action, occurredAt: h.occurred_at,
        actorId: h.user_id, observations: h.action === "AFFILIATION_REQUEST_CORRECTIONS"
          ? z.object({ observations: z.string() }).safeParse(h.new_data).data?.observations ?? null : null })) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function reviewAffiliation(id: string, input: unknown) {
  const actor = await requireOperationalUser();
  validId(id);
  const parsed = affiliationReviewSchema.safeParse(input);
  if (!parsed.success) throw new AffiliationReviewError("VALIDATION_ERROR");
  const data = parsed.data;
  return getPrisma().$transaction(async (tx) => {
    await lockAuthorization(tx);
    // UPDATE antes del autorizador: este toma SHARE al resolver club+temporada.
    await tx.$queryRaw`SELECT id FROM sports_management.club_affiliations WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.club_affiliations.findUnique({ where: { id } });
    if (!row) throw new AffiliationReviewError("NOT_FOUND", 404);
    await assertReviewer(tx, actor.id, row);
    if (row.status !== "PENDING") throw new AffiliationReviewError("AFFILIATION_ALREADY_REVIEWED", 409);
    if (row.review_version !== data.expectedVersion) throw new AffiliationReviewError("STALE_AFFILIATION", 409);
    if (row.review_reason) throw new AffiliationReviewError("CORRECTIONS_PENDING", 409);
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: row.season_id }, select: { status: true } });
    if (season.status === "CLOSED") throw new AffiliationReviewError("SEASON_CLOSED", 409);
    const updated = await tx.club_affiliations.update({ where: { id }, data: {
      status: data.decision === "APPROVE" ? "APPROVED" : "PENDING", reviewed_by: actor.id,
      reviewed_at: new Date(), review_reason: data.decision === "REQUEST_CORRECTIONS" ? data.observations : null,
      review_version: { increment: 1 },
    }, select: summarySelect });
    await tx.audit_logs.create({ data: { user_id: actor.id, table_name: "club_affiliations", entity_id: id,
      action: `AFFILIATION_${data.decision}`, previous_data: { status: row.status, version: row.review_version },
      new_data: { status: updated.status, version: updated.review_version,
        ...(data.decision === "REQUEST_CORRECTIONS" ? { observations: data.observations } : {}) },
      reason: "PDGLD-60: revisión de afiliación" } });
    return summary(updated);
  }, { timeout: 15_000 });
}
