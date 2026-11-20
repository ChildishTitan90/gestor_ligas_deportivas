import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertPermission, AuthorizationError, lockAuthorization } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { loadHomeVenueOptions } from "@/features/venues/server/scheduling-options";
import { venueLocalTime, venueTimeToIso } from "@/features/venues/time";
import { adjustmentInput, proposalReviewInput, saveAdjustmentInput, type AdjustmentInput } from "../adjustment";
import { storedProposalSchema } from "../stored-proposal";
import { validateScheduleProposalInTransaction, SchedulingError } from "./service";

const calendarPolicy = z.object({ complexOnlyFinalRounds: z.number().int().nonnegative() });

async function validateAdjustment(
  tx: Prisma.TransactionClient, actorId: string, data: AdjustmentInput,
  action: "UPDATE" | "APPROVE" = "UPDATE", proposalStatus: "DRAFT" | "IN_REVIEW" = "DRAFT",
  savedStart?: Date,
) {
  const match = await tx.matches.findFirst({
    where: { id: data.matchId, schedule_proposal_id: data.proposalId, deleted_at: null },
    select: {
      version: true, season_id: true, matchday_id: true,
      home_team_id: true, away_team_id: true,
      match_statuses: { select: { code: true } },
      matchdays: { select: { start_date: true, end_date: true } },
      schedule_proposals: {
        select: {
          season_id: true, matchday_id: true, status: true,
          seasons: { select: { status: true, leagues: { select: { timezone: true } } } },
          competition_rules: {
            select: {
              status: true,
              competition_rule_parameters: {
                where: { parameter_key: "calendar", requires_validation: false },
                select: { parameter_value: true },
              },
            },
          },
        },
      },
    },
  });
  const proposal = match?.schedule_proposals;
  if (!match || !proposal || match.season_id !== proposal.season_id || match.matchday_id !== proposal.matchday_id) {
    throw new AuthorizationError();
  }
  await assertPermission(tx, actorId, {
    module: "scheduling", action, context: { seasonId: match.season_id, matchId: data.matchId },
  });
  if (proposal.status !== proposalStatus) return { code: "INVALID_PROPOSAL_TRANSITION" as const };
  if (match.version !== data.expectedVersion) return { code: "STALE_MATCH" as const };
  if (match.match_statuses.code !== "DRAFT" || proposal.seasons.status === "CLOSED") {
    return { code: "MATCH_NOT_EDITABLE" as const };
  }
  const rule = proposal.competition_rules;
  const result = calendarPolicy.safeParse(rule.competition_rule_parameters[0]?.parameter_value);
  if (rule.status !== "APPROVED" || !result.success) return { code: "MISSING_VENUE_POLICY" as const };

  const day = data.startsAt.slice(0, 10);
  if (day < match.matchdays.start_date.toISOString().slice(0, 10) ||
      day > match.matchdays.end_date.toISOString().slice(0, 10)) {
    return { code: "OUTSIDE_MATCHDAY" as const };
  }
  let startsAt: Date;
  try {
    startsAt = savedStart ?? new Date(venueTimeToIso(data.startsAt, proposal.seasons.leagues.timezone));
  } catch {
    return { code: "INVALID_LOCAL_TIME" as const };
  }

  const teams = [match.home_team_id, match.away_team_id];
  const localDay = new Date(day);
  const seasonBreak = await tx.season_breaks.findFirst({
    where: { season_id: match.season_id, starts_at: { lte: localDay }, ends_at: { gte: localDay } },
    select: { id: true },
  });
  const bye = await tx.team_byes.findFirst({
    where: { matchday_id: match.matchday_id, season_team_id: { in: teams } }, select: { id: true },
  });
  if (seasonBreak || bye) return { code: "SCHEDULE_BREAK" as const };
  const sanction = await tx.sanctions.findFirst({
    where: {
      season_team_id: { in: teams }, blocks_participation: true, starts_at: { lte: startsAt },
      OR: [{ ends_at: null }, { ends_at: { gt: startsAt } }],
    },
    select: { id: true },
  });
  if (sanction) return { code: "TEAM_SANCTION" as const };

  const venues = await loadHomeVenueOptions(tx, actorId, {
    seasonId: match.season_id, matchdayId: match.matchday_id,
    homeSeasonTeamId: match.home_team_id, awaySeasonTeamId: match.away_team_id,
    startsAt, complexOnlyFinalRounds: result.data.complexOnlyFinalRounds,
  });
  if (!venues.length) return { code: "NO_ELIGIBLE_VENUES" as const };

  const intervals = venues.map(venue =>
    Prisma.sql`(${venue.venueId}::uuid, ${venue.endsAt}::timestamptz, ${venue.reservedUntil}::timestamptz)`);
  const reservations = await tx.$queryRaw<{ venue_id: string }[]>`
    WITH candidate(venue_id, ends_at, reserved_until) AS (VALUES ${Prisma.join(intervals)})
    SELECT candidate.venue_id
    FROM candidate
    WHERE EXISTS (
      SELECT 1 FROM sports_management.venue_reservations r
      WHERE r.match_id <> ${data.matchId}::uuid AND r.venue_id = candidate.venue_id
        AND r.time_range && tstzrange(${startsAt}::timestamptz, candidate.reserved_until, '[)')
    ) OR EXISTS (
      SELECT 1 FROM sports_management.team_reservations r
      WHERE r.match_id <> ${data.matchId}::uuid
        AND r.season_team_id IN (${Prisma.join(teams.map(id => Prisma.sql`${id}::uuid`))})
        AND r.time_range && tstzrange(${startsAt}::timestamptz, candidate.ends_at, '[)')
    ) OR EXISTS (
      SELECT 1 FROM sports_management.matches m
      WHERE m.id <> ${data.matchId}::uuid AND m.schedule_proposal_id = ${data.proposalId}::uuid
        AND m.season_id = ${match.season_id}::uuid AND m.matchday_id = ${match.matchday_id}::uuid
        AND m.deleted_at IS NULL AND m.starts_at IS NOT NULL
        AND (
          (m.venue_id = candidate.venue_id AND m.starts_at < candidate.reserved_until AND m.reserved_until > ${startsAt})
          OR ((m.home_team_id IN (${Prisma.join(teams.map(id => Prisma.sql`${id}::uuid`))})
            OR m.away_team_id IN (${Prisma.join(teams.map(id => Prisma.sql`${id}::uuid`))}))
            AND m.starts_at < candidate.ends_at AND m.ends_at > ${startsAt})
        )
    )
  `;
  const occupied = new Set(reservations.map(reservation => reservation.venue_id));
  const available = venues.filter(venue => !occupied.has(venue.venueId));
  if (!available.length) return { code: "NO_ELIGIBLE_VENUES" as const };

  return { code: "VENUE_OPTIONS" as const, venues: available, startsAt };
}

export async function previewScheduleAdjustment(input: unknown) {
  const actor = await requireOperationalUser();
  const data = adjustmentInput.parse(input);
  return getPrisma().$transaction(async tx => {
    const result = await validateAdjustment(tx, actor.id, data);
    if (result.code !== "VENUE_OPTIONS") return result;
    const labels = await tx.venues.findMany({
      where: { id: { in: result.venues.map(venue => venue.venueId) } },
      select: { id: true, name: true },
    });
    const names = new Map(labels.map(venue => [venue.id, venue.name]));
    return {
      code: result.code,
      venues: result.venues.map(venue => ({ ...venue, name: names.get(venue.venueId) ?? "" })),
    };
  }, { isolationLevel: "RepeatableRead" });
}

export async function saveScheduleAdjustment(input: unknown) {
  const actor = await requireOperationalUser();
  return saveScheduleAdjustmentForActor(actor.id, input);
}

export async function saveScheduleAdjustmentForActor(actorId: string, input: unknown) {
  const data = saveAdjustmentInput.parse(input);
  try {
    return await getPrisma().$transaction(async tx => {
      await lockAuthorization(tx);
      await lockProposal(tx, data.proposalId);
      const result = await validateAdjustment(tx, actorId, data);
      if (result.code !== "VENUE_OPTIONS") return result;
      const venue = result.venues.find(option => option.venueId === data.venueId);
      if (!venue) return { code: "VENUE_NOT_AVAILABLE" as const };

      await tx.$queryRaw`SELECT set_config('app.user_id', ${actorId}, true), set_config('app.reason', ${data.reason}, true)`;
      const changed = await tx.matches.updateMany({
        where: {
          id: data.matchId, schedule_proposal_id: data.proposalId, version: data.expectedVersion,
          deleted_at: null, match_statuses: { code: "DRAFT" },
        },
        data: {
          venue_id: venue.venueId, starts_at: result.startsAt, ends_at: venue.endsAt,
          reserved_until: venue.reservedUntil, version: { increment: 1 },
        },
      });
      if (changed.count !== 1) return { code: "STALE_MATCH" as const };
      const proposal = await tx.schedule_proposals.update({
        where: { id: data.proposalId }, data: { version: { increment: 1 } },
        select: { version: true },
      });
      return { code: "ADJUSTMENT_SAVED" as const, version: data.expectedVersion + 1, proposalVersion: proposal.version };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (isConcurrentAdjustment(error)) {
      return { code: "ADJUSTMENT_CONFLICT" as const };
    }
    throw error;
  }
}

function isConcurrentAdjustment(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010") return false;
  const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
  const sqlState = adapter?.cause?.originalCode ?? error.meta?.code;
  return sqlState === "40001" || sqlState === "40P01";
}

async function lockProposal(tx: Prisma.TransactionClient, proposalId: string) {
  await tx.$queryRaw`SELECT id FROM sports_management.schedule_proposals WHERE id = ${proposalId}::uuid FOR UPDATE`;
}

export async function changeProposalReview(input: unknown) {
  const actor = await requireOperationalUser();
  return changeProposalReviewForActor(actor.id, input);
}

export async function changeProposalReviewForActor(actorId: string, input: unknown) {
  const data = proposalReviewInput.parse(input);
  const submitting = data.operation === "submit";
  const action = submitting ? "UPDATE" : "APPROVE";
  const currentStatus = submitting ? "DRAFT" : "IN_REVIEW";
  const nextStatus = submitting ? "IN_REVIEW" : data.operation === "approve" ? "APPROVED" : "DRAFT";

  try {
    return await getPrisma().$transaction(async tx => {
      await lockAuthorization(tx);
      const lookup = await tx.schedule_proposals.findUnique({ where: { id: data.proposalId }, select: { season_id: true } });
      if (!lookup) throw new AuthorizationError();
      await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id = ${lookup.season_id}::uuid FOR UPDATE`;
      await lockProposal(tx, data.proposalId);
      const proposal = await tx.schedule_proposals.findUnique({
        where: { id: data.proposalId },
        select: {
          status: true, version: true, season_id: true, matchday_id: true, parameters: true,
          seasons: { select: { status: true, leagues: { select: { timezone: true } } } },
        },
      });
      if (!proposal) throw new AuthorizationError();
      const grants = await assertPermission(tx, actorId, {
        module: "scheduling", action, context: { seasonId: proposal.season_id },
      });
      if (!grants.some(grant => !grant.clubId)) throw new AuthorizationError();
      if (proposal.version !== data.expectedVersion) return { code: "STALE_PROPOSAL" as const };
      if (proposal.status !== currentStatus || proposal.seasons.status === "CLOSED") {
        return { code: "INVALID_PROPOSAL_TRANSITION" as const };
      }

      const generated = storedProposalSchema.safeParse(proposal.parameters);
      if (generated.success && data.operation === "approve" && generated.data.matches.some(match => !match.venueId))
        return { code: "INCOMPLETE_PROPOSAL_MATCH" as const };
      let normalized: Prisma.InputJsonValue | undefined;
      if (generated.success && data.operation !== "return") {
        const result = await validateScheduleProposalInTransaction(tx, actorId, {
          proposalId: data.proposalId, expectedSeasonVersion: generated.data.seasonVersion,
          matches: generated.data.matches.map(({ round, matchdayId, home, away, venueId, start }) =>
            ({ round, matchdayId, home, away, venueId, start })),
        }, action);
        if (!result.ok) return { code: result.code, conflicts: result.conflicts };
        normalized = { ...generated.data,
          matches: result.matches.map((match, index) => ({ ...generated.data.matches[index], ...match })),
          byes: result.byes,
        } as Prisma.InputJsonValue;
      }
      if (!generated.success && data.operation !== "return") {
        const matches = await tx.matches.findMany({
          where: { schedule_proposal_id: data.proposalId, deleted_at: null },
          orderBy: { id: "asc" },
          select: { id: true, season_id: true, matchday_id: true, version: true,
            venue_id: true, starts_at: true, ends_at: true, reserved_until: true },
        });
        if (!matches.length) return { code: "EMPTY_PROPOSAL" as const };
        for (const match of matches) {
          if (match.season_id !== proposal.season_id || match.matchday_id !== proposal.matchday_id) {
            return { code: "INVALID_PROPOSAL_MATCH" as const };
          }
          if (!match.venue_id || !match.starts_at || !match.ends_at || !match.reserved_until) {
            return { code: "INCOMPLETE_PROPOSAL_MATCH" as const, matchId: match.id };
          }
          const result = await validateAdjustment(tx, actorId, {
            proposalId: data.proposalId, matchId: match.id, expectedVersion: match.version,
            startsAt: venueLocalTime(match.starts_at, proposal.seasons.leagues.timezone),
          }, action, currentStatus, match.starts_at);
          if (result.code !== "VENUE_OPTIONS") return { code: result.code, matchId: match.id };
          const venue = result.venues.find(option => option.venueId === match.venue_id);
          if (!venue || venue.endsAt.getTime() !== match.ends_at.getTime() ||
              venue.reservedUntil.getTime() !== match.reserved_until.getTime()) {
            return { code: "VENUE_NOT_AVAILABLE" as const, matchId: match.id };
          }
        }
      }

      await tx.$queryRaw`SELECT set_config('app.user_id', ${actorId}, true), set_config('app.reason', ${data.reason}, true)`;
      const updated = await tx.schedule_proposals.update({
        where: { id: data.proposalId }, data: { status: nextStatus, version: { increment: 1 }, ...(normalized ? { parameters: normalized } : {}) },
        select: { version: true },
      });
      return { code: "PROPOSAL_UPDATED" as const, status: nextStatus, version: updated.version };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
  } catch (error) {
    if (error instanceof SchedulingError) return { code: error.code };
    if (isConcurrentAdjustment(error)) {
      return { code: "PROPOSAL_CONFLICT" as const };
    }
    throw error;
  }
}
