import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { affiliationOfficeCodes } from "../schemas";
import { affiliationSubmissionSchema, canonicalAffiliationSubmission } from "../affiliation-submission";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { affiliationResubmissionSchema } from "../affiliation-review";
import { AffiliationReviewError } from "./affiliation-review-service";

export class AffiliationInputError extends Error {
  constructor(public readonly code:
    "VALIDATION_ERROR" | "INVALID_CONTEXT" | "INVALID_SIGNATURE" | "SEASON_CLOSED" |
    "AFFILIATION_EXISTS" | "IDEMPOTENCY_CONFLICT",
    public readonly status = 400,
  ) { super(code); }
}

export async function submitAffiliation(input: unknown, correctionId?: string) {
  const actor = await requireOperationalUser();
  if (correctionId !== undefined && !z.uuid().safeParse(correctionId).success)
    throw new AffiliationInputError("VALIDATION_ERROR");
  const correction = correctionId ? affiliationResubmissionSchema.safeParse(input) : null;
  if (correction && !correction.success) throw new AffiliationInputError("VALIDATION_ERROR");
  const parsed = affiliationSubmissionSchema.safeParse(correction?.success
    ? Object.fromEntries(Object.entries(correction.data).filter(([key]) => key !== "expectedVersion")) : input);
  if (!parsed.success) throw new AffiliationInputError("VALIDATION_ERROR");
  const data = parsed.data;
  const fingerprint = createHash("sha256").update(canonicalAffiliationSubmission(data)).digest("hex");

  return getPrisma().$transaction(async (tx) => {
    // No pasar club+temporada a assertPermission: ese contexto presupone una
    // afiliación existente. Para el alta, autorizar el club y verificar la
    // temporada en la misma liga, con bloqueo, dentro de esta transacción.
    const grants = await assertPermission(tx, actor.id, {
      module: "clubs", action: correctionId ? "UPDATE" : "CREATE", context: { clubId: data.clubId },
    });
    const delegateRole = await tx.roles.findUniqueOrThrow({ where: { code: "CLUB_DELEGATE" }, select: { id: true } });
    if (!grants.some((grant) => grant.roleId === delegateRole.id && grant.clubId === data.clubId))
      throw new AuthorizationError();

    // Serializa los reintentos de un usuario incluso con distinto club/temporada.
    // Bloqueo transaccional: no se conserva estado en memoria ni entre peticiones.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`PDGLD-57:${actor.id}:${data.submissionKey}`}, 0))::text`;
    const club = await tx.clubs.findUniqueOrThrow({ where: { id: data.clubId }, select: { league_id: true } });
    const seasons = await tx.$queryRaw<{ id: string; status: string; startsAt: Date }[]>`
      SELECT id, status, start_date AS "startsAt" FROM sports_management.seasons
      WHERE id = ${data.seasonId}::uuid AND league_id = ${club.league_id}::uuid FOR SHARE
    `;
    if (!seasons.length) throw new AffiliationInputError("INVALID_CONTEXT");

    const corrected = correctionId ? await (async () => {
      // UUID validado por el contrato de ruta antes de interpolar como uuid.
      await tx.$queryRaw`SELECT id FROM sports_management.club_affiliations WHERE id = ${correctionId}::uuid FOR UPDATE`;
      const row = await tx.club_affiliations.findUnique({ where: { id: correctionId } });
      if (!row) throw new AffiliationReviewError("NOT_FOUND", 404);
      if (row.requested_by !== actor.id || row.club_id !== data.clubId || row.season_id !== data.seasonId)
        throw new AuthorizationError();
      if (row.status !== "PENDING") throw new AffiliationReviewError("AFFILIATION_ALREADY_REVIEWED", 409);
      if (!correction?.success || row.review_version !== correction.data.expectedVersion)
        throw new AffiliationReviewError("STALE_AFFILIATION", 409);
      if (!row.review_reason) throw new AffiliationReviewError("CORRECTIONS_NOT_REQUESTED", 409);
      if (row.submission_key !== data.submissionKey) throw new AffiliationInputError("IDEMPOTENCY_CONFLICT", 409);
      return row;
    })() : null;
    const prior = !corrected ? await tx.club_affiliations.findUnique({
      where: { requested_by_submission_key: { requested_by: actor.id, submission_key: data.submissionKey } },
      select: { id: true, reference_number: true, status: true, submission_hash: true },
    }) : null;
    if (prior) {
      if (prior.submission_hash !== fingerprint) throw new AffiliationInputError("IDEMPOTENCY_CONFLICT", 409);
      return { id: prior.id, referenceNumber: prior.reference_number, status: prior.status, replayed: true };
    }
    if (seasons[0].status === "CLOSED") throw new AffiliationInputError("SEASON_CLOSED", 409);

    // Distintas claves para el mismo club/temporada tampoco crean dos solicitudes.
    // El advisory lock no convierte el bloqueo SHARE del autorizador en UPDATE.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`PDGLD-57:club:${data.clubId}:${data.seasonId}`}, 0))::text`;
    if (!corrected && await tx.club_affiliations.findUnique({
      where: { club_id_season_id: { club_id: data.clubId, season_id: data.seasonId } }, select: { id: true },
    })) throw new AffiliationInputError("AFFILIATION_EXISTS", 409);

    const categories = await tx.$queryRaw<{ category_id: string }[]>`
      SELECT sc.category_id FROM sports_management.season_categories sc
      JOIN sports_management.categories c ON c.id = sc.category_id
      JOIN sports_management.seasons s ON s.id = sc.season_id
      WHERE sc.season_id = ${data.seasonId}::uuid
        AND sc.category_id IN (${Prisma.join(data.categoryIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND c.league_id = s.league_id AND c.sport_id = s.sport_id
      FOR SHARE OF sc, c
    `;
    if (categories.length !== data.categoryIds.length) throw new AffiliationInputError("INVALID_CONTEXT");

    const signatures = [...new Set(affiliationOfficeCodes.map((office) => data.officers[office].signatureFileId))];
    const files = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sports_management.files
      WHERE id IN (${Prisma.join(signatures.map((id) => Prisma.sql`${id}::uuid`))})
        AND uploaded_by = ${actor.id}::uuid AND size_bytes > 0 AND size_bytes <= 10485760
        AND mime_type IN ('image/png', 'image/jpeg', 'application/pdf')
        AND sha256 ~ '^[a-fA-F0-9]{64}$'
      FOR SHARE
    `;
    if (files.length !== signatures.length) throw new AffiliationInputError("INVALID_SIGNATURE");

    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true),
      set_config('app.reason', 'PDGLD-57: solicitud de afiliación', true)`;
    const affiliation = corrected ? await tx.club_affiliations.update({ where: { id: corrected.id },
      data: { club_name: data.clubName, uniform_colors: data.uniformColors,
        reviewed_by: null, reviewed_at: null, review_reason: null, review_version: { increment: 1 } },
      select: { id: true, reference_number: true, status: true },
    }) : await tx.club_affiliations.create({
      data: { season_id: data.seasonId, club_id: data.clubId, league_id: club.league_id,
        reference_number: `AFL-${randomUUID()}`, status: "PENDING", requested_by: actor.id,
        club_name: data.clubName, uniform_colors: data.uniformColors,
        submission_key: data.submissionKey, submission_hash: fingerprint },
      select: { id: true, reference_number: true, status: true },
    });
    if (corrected) await tx.club_affiliation_categories.deleteMany({ where: { affiliation_id: corrected.id } });
    await tx.club_affiliation_categories.createMany({ data: data.categoryIds.map((categoryId) => ({
      affiliation_id: affiliation.id, season_id: data.seasonId, category_id: categoryId,
    })) });
    const officerIds: string[] = [];
    for (const office of affiliationOfficeCodes) {
      const person = data.officers[office];
      const identity = await tx.people.create({ data: {
        first_name: person.firstName, paternal_surname: person.paternalSurname,
        maternal_surname: person.maternalSurname || null,
      }, select: { id: true } });
      const previousOfficer = corrected ? await tx.club_officers.findFirst({ where: {
        affiliation_id: corrected.id, office, ends_at: null }, select: { id: true } }) : null;
      const officer = previousOfficer ? await tx.club_officers.update({ where: { id: previousOfficer.id },
        data: { person_id: identity.id, signature_file_id: person.signatureFileId }, select: { id: true },
      }) : await tx.club_officers.create({ data: {
        affiliation_id: affiliation.id, person_id: identity.id, office,
        starts_at: seasons[0].startsAt, signature_file_id: person.signatureFileId,
      }, select: { id: true } });
      officerIds.push(officer.id);
    }
    // El baseline no audita club_affiliations/club_officers automáticamente.
    // Un solo evento del agregado; no copiar nombres, firmas ni hashes.
    await tx.audit_logs.create({ data: {
      user_id: actor.id, action: corrected ? "AFFILIATION_RESUBMIT" : "INSERT", table_name: "club_affiliations", entity_id: affiliation.id,
      ...(corrected ? { previous_data: { status: "PENDING", version: corrected.review_version } } : {}),
      new_data: { status: "PENDING", club_id: data.clubId, season_id: data.seasonId,
        category_ids: data.categoryIds, officer_ids: officerIds,
        ...(corrected ? { version: corrected.review_version + 1 } : {}) },
      reason: corrected ? "PDGLD-60: reenvío de correcciones" : "PDGLD-57: solicitud de afiliación",
    } });
    return { id: affiliation.id, referenceNumber: affiliation.reference_number, status: affiliation.status, replayed: false,
      ...(corrected ? { version: corrected.review_version + 1, reviewPhase: "AWAITING_REVIEW" } : {}) };
  }, { timeout: 15_000 });
}
