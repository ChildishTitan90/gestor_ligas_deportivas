import "server-only";
import { chargeScheduledMatchesInTransaction } from "@/features/billing/server/automation-service";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertPermission, AuthorizationError, lockAuthorization } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { loadHomeVenueOptions } from "@/features/venues/server/scheduling-options";
import { venueLocalTime, venueTimeToIso } from "@/features/venues/time";
import { adjustmentInput, proposalReviewInput, saveAdjustmentInput, type AdjustmentInput } from "../adjustment";
import { storedProposalSchema } from "../stored-proposal";
import { participationBlocked } from "../constraints";
import { validateScheduleProposalInTransaction, SchedulingError } from "./service";

const calendarPolicy = z.object({ complexOnlyFinalRounds: z.number().int().nonnegative() });
type ApprovedMatch = {round:number;matchdayId:string;home:string;away:string;venueId:string|null;start:string|null;end:string|null;reservedUntil:string|null};
type ApprovedBye = {round:number;teamId:string;matchdayId:string};

async function createOperationalMatches(tx:Prisma.TransactionClient,proposalId:string,seasonId:string,groupId:string,matches:ApprovedMatch[],byes:ApprovedBye[]) {
  if(await tx.matches.count({where:{schedule_proposal_id:proposalId}})) throw new SchedulingError("PROPOSAL_ALREADY_MATERIALIZED");
  if(matches.some(match=>!match.venueId || !match.start || !match.end || !match.reservedUntil)) throw new SchedulingError("INCOMPLETE_PROPOSAL_MATCH");
  const scheduled=await tx.match_statuses.findUniqueOrThrow({where:{code:"SCHEDULED"},select:{id:true}});
  const rows=matches.map((match,index)=>Prisma.sql`(${seasonId}::uuid,${groupId}::uuid,${match.matchdayId}::uuid,
    ${`${proposalId}-${index+1}`},${match.home}::uuid,${match.away}::uuid,${match.venueId!}::uuid,
    ${new Date(match.start!)}::timestamptz,${new Date(match.end!)}::timestamptz,${new Date(match.reservedUntil!)}::timestamptz,
    ${scheduled.id}::uuid,${proposalId}::uuid)`);
  await tx.$executeRaw`INSERT INTO sports_management.matches
    (season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until,status_id,schedule_proposal_id)
    VALUES ${Prisma.join(rows)}`;
  if(byes.length) {
    const values=byes.map(bye=>Prisma.sql`(${seasonId}::uuid,${bye.matchdayId}::uuid,${bye.teamId}::uuid)`);
    await tx.$executeRaw`INSERT INTO sports_management.team_byes (season_id,matchday_id,season_team_id)
      VALUES ${Prisma.join(values)} ON CONFLICT (matchday_id,season_team_id) DO NOTHING`;
  }
  await chargeScheduledMatchesInTransaction(tx, seasonId, proposalId);
}

export async function validateAdjustment(
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
  const sanctions = await tx.sanctions.findMany({
    where: {
      season_team_id: { in: teams }, blocks_participation: true,
      OR: [{ ends_at: null }, { ends_at: { gt: startsAt } }],
    },
    select: { season_team_id: true, starts_at: true, ends_at: true },
  });

  const venues = await loadHomeVenueOptions(tx, actorId, {
    seasonId: match.season_id, matchdayId: match.matchday_id,
    homeSeasonTeamId: match.home_team_id, awaySeasonTeamId: match.away_team_id,
    startsAt, complexOnlyFinalRounds: result.data.complexOnlyFinalRounds,
  });
  if (!venues.length) return { code: "NO_ELIGIBLE_VENUES" as const };
  const eligible = venues.filter(venue => !participationBlocked(sanctions, teams, +startsAt, +venue.endsAt));
  if (!eligible.length) return { code: "TEAM_SANCTION" as const };

  const intervals = eligible.map(venue =>
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
  const available = eligible.filter(venue => !occupied.has(venue.venueId));
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

/** Recupera propuestas aprobadas antes de que la aprobación creara partidos. */
export async function activatePreviouslyApprovedProposalForActor(actorId:string,input:unknown) {
  const data=z.strictObject({proposalId:z.uuid(),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(8).max(500)}).parse(input);
  try {
    return await getPrisma().$transaction(async tx=>{
      await lockAuthorization(tx);
      const lookup=await tx.schedule_proposals.findUnique({where:{id:data.proposalId},select:{season_id:true}});
      if(!lookup)throw new AuthorizationError();
      await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${lookup.season_id}::uuid FOR UPDATE`;
      await lockProposal(tx,data.proposalId);
      const row=await tx.schedule_proposals.findUniqueOrThrow({where:{id:data.proposalId},select:{season_id:true,status:true,version:true,parameters:true,seasons:{select:{status:true}}}});
      const grants=await assertPermission(tx,actorId,{module:"scheduling",action:"APPROVE",context:{seasonId:row.season_id}});
      if(!grants.some(g=>!g.clubId))throw new AuthorizationError();
      if(row.version!==data.expectedVersion)return {code:"STALE_PROPOSAL" as const};
      if(row.status!=="APPROVED" || row.seasons.status==="CLOSED")return {code:"INVALID_PROPOSAL_TRANSITION" as const};
      const stored=storedProposalSchema.safeParse(row.parameters);
      if(!stored.success)return {code:"INVALID_PROPOSAL" as const};
      if(await tx.matches.count({where:{schedule_proposal_id:data.proposalId}}))return {code:"PROPOSAL_ALREADY_MATERIALIZED" as const};
      const checked=await validateScheduleProposalInTransaction(tx,actorId,{proposalId:data.proposalId,expectedSeasonVersion:stored.data.seasonVersion,
        matches:stored.data.matches.map(({round,matchdayId,home,away,venueId,start})=>({round,matchdayId,home,away,venueId,start}))},"APPROVE");
      if(!checked.ok)return {code:checked.code,conflicts:checked.conflicts};
      await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${data.reason},true)`;
      await createOperationalMatches(tx,data.proposalId,row.season_id,stored.data.groupId,checked.matches,checked.byes);
      await tx.audit_logs.create({data:{user_id:actorId,table_name:"schedule_proposals",entity_id:data.proposalId,action:"ACTIVATE_APPROVED_SCHEDULE",reason:data.reason}});
      return {code:"SCHEDULE_ACTIVATED" as const};
    },{isolationLevel:"Serializable",maxWait:10000,timeout:30000});
  } catch(error) {
    if(error instanceof SchedulingError)return {code:error.code};
    if(isConcurrentAdjustment(error))return {code:"PROPOSAL_CONFLICT" as const};
    throw error;
  }
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
      let approvedMatches: ApprovedMatch[] | undefined;
      let approvedByes: ApprovedBye[] = [];
      if (generated.success && data.operation !== "return") {
        const result = await validateScheduleProposalInTransaction(tx, actorId, {
          proposalId: data.proposalId, expectedSeasonVersion: generated.data.seasonVersion,
          matches: generated.data.matches.map(({ round, matchdayId, home, away, venueId, start }) =>
            ({ round, matchdayId, home, away, venueId, start })),
        }, action);
        if (!result.ok) return { code: result.code, conflicts: result.conflicts };
        if (data.operation === "approve") { approvedMatches=result.matches; approvedByes=result.byes; }
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
      if (approvedMatches && generated.success) await createOperationalMatches(tx,data.proposalId,proposal.season_id,generated.data.groupId,approvedMatches,approvedByes);
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
