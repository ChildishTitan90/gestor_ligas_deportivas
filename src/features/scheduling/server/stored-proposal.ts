import "server-only";
import { z } from "zod";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { storedProposalSchema } from "../stored-proposal";

export async function readStoredProposal(input: unknown) {
  const actor = await requireOperationalUser();
  return readStoredProposalForActor(actor.id, input);
}

export async function readStoredProposalForActor(actorId: string, input: unknown) {
  const { proposalId } = z.strictObject({ proposalId: z.uuid() }).parse(input);
  return getPrisma().$transaction(async tx => {
    const row = await tx.schedule_proposals.findUnique({
      where: { id: proposalId },
      select: {
        id: true, created_by: true, created_at: true, season_id: true,
        competition_rule_id: true, status: true, version: true, parameters: true,
      },
    });
    if (!row) throw new AuthorizationError();
    const grants = await assertPermission(tx, actorId, {
      module: "scheduling", action: "READ", context: { seasonId: row.season_id },
    });
    if (!grants.some(grant => !grant.clubId)) throw new AuthorizationError();
    const parsed = storedProposalSchema.safeParse(row.parameters);
    if (!parsed.success) return { code: "UNSUPPORTED_PROPOSAL_FORMAT" as const };
    const proposal = parsed.data;
    const group = await tx.groups.findFirst({
      where: { id: proposal.groupId, season_id: row.season_id, season_category_id: proposal.categoryId },
      select: { id: true },
    });
    if (!group || proposal.ruleId !== row.competition_rule_id) throw new AuthorizationError();
    const days = new Set([...proposal.matches, ...proposal.byes].map(item => item.matchdayId));
    const count = await tx.matchdays.count({ where: { id: { in: [...days] }, season_id: row.season_id } });
    if (count !== days.size) throw new AuthorizationError();
    // Se enumeran los campos seguros. requestHash permanece exclusivamente en servidor.
    return {
      code: "PROPOSAL_DETAIL" as const,
      id: row.id, authorId: row.created_by, createdAt: row.created_at.toISOString(),
      seasonId: row.season_id, version: row.version, status: row.status,
      proposal: {
        formatVersion: proposal.formatVersion, groupId: proposal.groupId, categoryId: proposal.categoryId,
        seasonVersion: proposal.seasonVersion, ruleId: proposal.ruleId, ruleVersion: proposal.ruleVersion,
        timezone: proposal.timezone,
        matches: proposal.matches.map((match, encounterIndex) => ({
          encounterIndex, matchdayId: match.matchdayId, round: match.round, home: match.home, away: match.away,
          venueId: match.venueId, start: match.start, end: match.end, reservedUntil: match.reservedUntil,
        })),
        byes: proposal.byes.map(bye => ({ matchdayId: bye.matchdayId, round: bye.round, teamId: bye.teamId })),
      },
    };
  }, { isolationLevel: "RepeatableRead" });
}
