import "server-only";
import { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError, lockAuthorization } from "@/server/auth/authorization";
import { editStoredEncounterSchema, storedProposalSchema } from "../stored-proposal";
import { validateScheduleProposalInTransaction, SchedulingError } from "./service";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";

/** Guarda exclusivamente con el validador compartido y una transacción SERIALIZABLE. */
export async function editStoredProposalInTransaction(
  tx: Prisma.TransactionClient, actorId: string, value: unknown,
) {
  const input = editStoredEncounterSchema.parse(value);
  await lockAuthorization(tx);
  const lookup = await tx.schedule_proposals.findUnique({ where: { id: input.proposalId }, select: { season_id: true } });
  if (!lookup) throw new AuthorizationError();
  await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id = ${lookup.season_id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM sports_management.schedule_proposals WHERE id = ${input.proposalId}::uuid FOR UPDATE`;
  const row = await tx.schedule_proposals.findUnique({
    where: { id: input.proposalId },
    select: {
      id: true, season_id: true, competition_rule_id: true, status: true, version: true, parameters: true,
      seasons: { select: { status: true, version: true } },
    },
  });
  if (!row) throw new AuthorizationError();
  const grants = await assertPermission(tx, actorId, {
    module: "scheduling", action: "UPDATE", context: { seasonId: row.season_id },
  });
  if (!grants.some(grant => !grant.clubId)) throw new AuthorizationError();
  if (row.version !== input.expectedVersion) return { code: "STALE_PROPOSAL" as const };
  if (row.status !== "DRAFT" || row.seasons.status === "CLOSED") {
    return { code: "INVALID_PROPOSAL_TRANSITION" as const };
  }
  const proposal = storedProposalSchema.parse(row.parameters);
  if (proposal.seasonVersion !== row.seasons.version) return { code: "STALE_CONFIGURATION" as const };
  if (proposal.ruleId !== row.competition_rule_id) throw new AuthorizationError();
  const group = await tx.groups.findFirst({
    where: { id: proposal.groupId, season_id: row.season_id, season_category_id: proposal.categoryId },
    select: { id: true },
  });
  if (!group) throw new AuthorizationError();
  const days = [...new Set([...proposal.matches, ...proposal.byes].map(item => item.matchdayId))];
  const count = await tx.matchdays.count({ where: { id: { in: days }, season_id: row.season_id } });
  if (count !== days.length) throw new AuthorizationError();
  if (!proposal.matches[input.encounterIndex]) return { code: "ENCOUNTER_NOT_FOUND" as const };

  // El validador recibe la edición propuesta. Resuelve duración y holgura desde
  // datos autorizados y rechaza si el calendario resultante incumple restricciones.
  const matches = proposal.matches.map((match, index) => ({
    round: match.round, matchdayId: match.matchdayId,
    home: index === input.encounterIndex && input.swapHomeAway ? match.away : match.home,
    away: index === input.encounterIndex && input.swapHomeAway ? match.home : match.away,
    venueId: index === input.encounterIndex ? input.venueId : match.venueId,
    start: index === input.encounterIndex ? input.startsAt : match.start,
  }));
  const result = await validateScheduleProposalInTransaction(tx, actorId, {
    proposalId: row.id, expectedSeasonVersion: proposal.seasonVersion, matches,
  });
  if (!result.ok) return { code: result.code, conflicts: result.conflicts };
  const venues = await tx.venues.findMany({ where: { id: { in: result.matches.flatMap(match => match.venueId ? [match.venueId] : []) } }, select: { id: true, name: true } });
  const parameters = storedProposalSchema.parse({ ...proposal,
    matches: result.matches.map((match, index) => ({ ...proposal.matches[index], ...match })),
    byes: result.byes, preferenceOptimal: false, venueNames: Object.fromEntries(venues.map(venue => [venue.id, venue.name])),
  });
  await tx.$queryRaw`SELECT set_config('app.user_id', ${actorId}, true), set_config('app.reason', ${input.reason}, true)`;
  const changed = await tx.schedule_proposals.updateMany({
    where: { id: row.id, version: input.expectedVersion, status: "DRAFT" },
    data: { parameters: parameters as Prisma.InputJsonValue, version: { increment: 1 } },
  });
  if (changed.count !== 1) return { code: "STALE_PROPOSAL" as const };
  await tx.audit_logs.create({
    data: {
      user_id: actorId, action: "UPDATE", table_name: "schedule_proposals", entity_id: row.id,
      reason: input.reason,
      previous_data: { version: row.version, parameters: proposal } as Prisma.InputJsonValue,
      new_data: { version: row.version + 1, parameters } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return { code: "ADJUSTMENT_SAVED" as const, version: row.version + 1 };
}

export async function editStoredProposal(value: unknown) {
  const actor = await requireOperationalUser();
  return editStoredProposalForActor(actor.id, value);
}

export async function editStoredProposalForActor(actorId: string, value: unknown) {
  try {
    return await getPrisma().$transaction(tx => editStoredProposalInTransaction(tx, actorId, value),
      { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
  } catch (error) {
    if (error instanceof SchedulingError) return { code: error.code };
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
      if (error.code === "P2034" || (error.code === "P2010" &&
        ["40001", "40P01"].includes(String(adapter?.cause?.originalCode ?? error.meta?.code)))) {
        return { code: "ADJUSTMENT_CONFLICT" as const };
      }
    }
    throw error;
  }
}
