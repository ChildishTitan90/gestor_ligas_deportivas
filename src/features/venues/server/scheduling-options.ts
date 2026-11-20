import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { homeVenueOptions, type HomeVenueCandidate } from "../home-venue";
import { windowSchema } from "./loans";
import { venueLocalTime } from "../time";

const approvedWindows = z.array(windowSchema).min(1).max(50);

type SchedulingContext = {
  seasonId: string;
  matchdayId: string;
  homeSeasonTeamId: string;
  awaySeasonTeamId: string;
  startsAt: Date;
  /** Must come from the season rule version resolved by the caller. */
  complexOnlyFinalRounds: number;
  /** Set only after verifying the RF04 prior assignment server-side. */
  priorHomeVenueId?: string;
};

/**
 * PDGLD-24 (Sergio): llamar desde el generador y volver a consultar dentro de la
 * transacción que guarda la reserva. Leer N del reglamento aprobado y resolver
 * el antecedente RF04 antes de ofrecer la cancha rival.
 */
export async function loadHomeVenueOptions(tx: Prisma.TransactionClient, actorId: string, ctx: SchedulingContext) {
  await assertPermission(tx, actorId, {
    module: "scheduling", action: "READ", context: { seasonId: ctx.seasonId },
  });
  if (ctx.homeSeasonTeamId === ctx.awaySeasonTeamId) throw new AuthorizationError();

  const season = await tx.seasons.findUnique({
    where: { id: ctx.seasonId }, select: { league_id: true, status: true, leagues: { select: { timezone: true } } },
  });
  if (!season || season.status === "CLOSED") throw new AuthorizationError();
  const matchday = await tx.matchdays.findFirst({
    where: { id: ctx.matchdayId, season_id: ctx.seasonId }, select: { number: true },
  });
  const teams = await tx.season_teams.findMany({
    where: { id: { in: [ctx.homeSeasonTeamId, ctx.awaySeasonTeamId] }, season_id: ctx.seasonId, status: "ACTIVE" },
    select: { id: true, club_id: true },
  });
  const home = teams.find(team => team.id === ctx.homeSeasonTeamId);
  const away = teams.find(team => team.id === ctx.awaySeasonTeamId);
  if (!matchday || !home || !away) throw new AuthorizationError();

  const roundsAfterThis = await tx.matchdays.count({
    where: { season_id: ctx.seasonId, number: { gt: matchday.number } },
  });
  const rows = await tx.venues.findMany({
    where: { league_id: season.league_id, is_active: true },
    orderBy: [{ code: "asc" }, { id: "asc" }],
    select: {
      id: true, league_id: true, is_active: true, is_league_sports_complex: true, owner_club_id: true,
      match_duration_minutes: true, buffer_minutes: true,
      venue_availability: {
        where: { ends_at: { gt: ctx.startsAt } },
        select: { starts_at: true, ends_at: true, type: true },
      },
      venue_loans: {
        where: { status: "APPROVED", season_id: ctx.seasonId,
          requested_by: { not: null }, approved_by: { not: null }, approved_at: { not: null }, club_id: { in: [home.club_id, away.club_id] },
          owner_decision_required: true, owner_decision: "APPROVED" },
        select: { season_id: true, club_id: true, requested_windows: true },
      },
    },
  });

  const candidates: HomeVenueCandidate[] = rows.map(row => ({
    id: row.id, leagueId: row.league_id, active: row.is_active,
    kind: row.is_league_sports_complex ? "complex" : "private", ownerClubId: row.owner_club_id,
    durationMinutes: row.match_duration_minutes, bufferMinutes: row.buffer_minutes,
    openings: row.venue_availability.filter(w => w.type === "AVAILABLE")
      .map(w => ({ startsAt: w.starts_at, endsAt: w.ends_at })),
    closures: row.venue_availability.filter(w => w.type !== "AVAILABLE")
      .map(w => ({ startsAt: w.starts_at, endsAt: w.ends_at })),
    loans: row.venue_loans.flatMap(loan => {
      const parsed = approvedWindows.safeParse(loan.requested_windows);
      if (!parsed.success) return [];
      return [{
        seasonId: loan.season_id, clubId: loan.club_id, status: "APPROVED" as const,
        windows: parsed.data.map(window => ({ startsAt: new Date(window.startsAt), endsAt: new Date(window.endsAt) })),
      }];
    }),
  }));

  const options = homeVenueOptions({
    leagueId: season.league_id, seasonId: ctx.seasonId, homeClubId: home.club_id, awayClubId: away.club_id,
    roundsAfterThis, complexOnlyFinalRounds: ctx.complexOnlyFinalRounds,
    startsAt: ctx.startsAt, priorHomeVenueId: ctx.priorHomeVenueId,
  }, candidates);
  const local = venueLocalTime(ctx.startsAt, season.leagues.timezone);
  const localDate = new Date(`${local.slice(0, 10)}T00:00:00Z`);
  const assignments = await tx.home_venue_assignments.findMany({ where: { season_team_id: ctx.homeSeasonTeamId,
    weekday: localDate.getUTCDay() || 7, starts_at: { lte: localDate }, ends_at: { gte: localDate }, venue_loan_id: null },
    select: { venue_id: true, start_time: true } });
  const assigned = new Set(assignments.filter(a => a.start_time.toISOString().slice(11, 16) === local.slice(11, 16)).map(a => a.venue_id));
  return options.sort((a, b) => Number(assigned.has(b.venueId)) - Number(assigned.has(a.venueId)));
}
