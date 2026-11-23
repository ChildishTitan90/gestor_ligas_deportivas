import "server-only";
import { halfCrossingProblem, halfBlockerMessages, type ParticipationHalf } from "../participation-halves";
import { draftSchema, type ReportDraft } from "@/features/match-reports/contract";
import { matchClockSchema, verifiedClockBoundaries, type MatchClock } from "@/features/match-reports/match-clock";
import { participationPeriods } from "@/features/match-reports/tactics";
import { lockParticipationPeople } from "./participation-lock";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { assertPermission, AuthorizationError, lockAuthorization } from "@/server/auth/authorization";
import { assertOwnRefereeAssignment } from "@/server/auth/authorization-domain";
import { requireOperationalUser } from "@/server/auth/session";
import { readLockedPlayerTeamContext } from "@/features/players/server/access";
import { assessPlayerEligibility } from "@/features/players/server/eligibility-assessment";
import { readRegistrationLabels } from "@/features/players/server/registration-labels";
import { lockSeasonIdentityHistory } from "@/features/players/server/season-identity-history";
import type { Blocker, LineupEvaluation, MatchPlayer } from "../eligibility";
import { participationTimesSchema } from "../eligibility";

export async function authorizeMatch(tx: Prisma.TransactionClient, actorId: string, matchId: string) {
  if (!z.uuid().safeParse(matchId).success) throw new AuthorizationError();
  await lockAuthorization(tx);
  await assertOwnRefereeAssignment(tx, actorId, matchId);
  const match = await tx.matches.findUniqueOrThrow({ where: { id: matchId }, select: {
    id: true, number: true, version: true, starts_at: true, ends_at: true, season_id: true,
    home_team_id: true, away_team_id: true,
  } });
  const season = await tx.seasons.findUniqueOrThrow({where:{id:match.season_id},select:{league_id:true,status:true}});
  await assertPermission(tx, actorId, { module: "match-reports", action: "CREATE", context: {
    leagueId: season.league_id, seasonId: match.season_id, matchId,
  } });
  return {...match, season};
}

/** Contrato para PDGLD-18: consumir en su transacción y reevaluar antes de escribir.
 * No concede permisos de players ni modifica habilitación o historial. */
export async function evaluateMatchInTransaction(tx: Prisma.TransactionClient, actorId: string, matchId: string): Promise<LineupEvaluation> {
  await lockAuthorization(tx);
  await lockSeasonIdentityHistory(tx);
  const match = await authorizeMatch(tx, actorId, matchId);
  return evaluateAuthorizedMatchInTransaction(tx, match);
}

/** Evaluación compartida: el servicio llamador ya autorizó al actor real y bloqueó el contexto.
 * No sustituye al actor ni concede permisos. No es una entrada invocable desde cliente. */
function matchRosterWhere(seasonId: string, teamId: string, target: { clubId: string; seasonCategoryId: string }): Prisma.player_registrationsWhereInput {
  return { season_id: seasonId, OR: [{ season_team_id: teamId }, { category_participations: { some: {
    season_id: seasonId, club_id: target.clubId, target_season_team_id: teamId,
    target_season_category_id: target.seasonCategoryId, status: "AUTHORIZED",
  } } }] };
}
/** Solo pertenencia al plantel visible; no concede elegibilidad ni permisos.
 * El consumidor ya autorizó al actor para el partido. Reutiliza los destinos
 * autorizados de PDGLD-16, incluidas participaciones en categoría superior. */
export async function isRegistrationInAuthorizedMatchRoster(tx: Prisma.TransactionClient, match: Awaited<ReturnType<typeof authorizeMatch>>, registrationId: string) {
  for (const teamId of [match.home_team_id, match.away_team_id]) {
    const target = await readLockedPlayerTeamContext(tx, teamId);
    if (await tx.player_registrations.findFirst({ where: { ...matchRosterWhere(match.season_id, teamId, target), id: registrationId }, select: { id: true } })) return true;
  }
  return false;
}

export async function evaluateAuthorizedMatchInTransaction(tx: Prisma.TransactionClient, match: Awaited<ReturnType<typeof authorizeMatch>>, intent?: { draft: ReportDraft; clock: MatchClock | null }): Promise<LineupEvaluation> {
  const matchId = match.id;
  const stored = await tx.match_reports.findUnique({ where: { match_id: matchId }, select: { draft_data: true } });
  const storedData = stored?.draft_data as { draft?: unknown; clock?: unknown } | undefined;
  const parsedDraft = draftSchema.safeParse(storedData?.draft), parsedClock = matchClockSchema.safeParse(storedData?.clock);
  const draft = intent?.draft ?? (parsedDraft.success ? parsedDraft.data : undefined);
  const clock = intent ? intent.clock : parsedClock.success ? parsedClock.data : null;
  const historical = match.season.status === "CLOSED";
  const result: LineupEvaluation = { matchId, number: match.number, version: match.version,
    startsAt: match.starts_at?.toISOString() ?? null, historical, players: [], notices: [
      "La evaluación no guarda ni confirma una alineación. Se vuelve a validar al capturar la cédula.",
      "RF02.7: reserva mitades distintas para partidos coincidentes del mismo club. El traslado exige las marcas reales del medio tiempo; la reserva no acredita minutos jugados.",
    ] };
  // CLOSED no consulta identidad vigente ni recalcula elegibilidad histórica.
  if (historical) { result.notices = ["Temporada cerrada: consulta la evidencia histórica de la cédula. No se recalcula la elegibilidad con datos actuales."]; return result; }
  const targets = [match.home_team_id, match.away_team_id];
  for (const teamId of targets) {
    const target = await readLockedPlayerTeamContext(tx, teamId);
    const targetLabel = await tx.teams.findUniqueOrThrow({where:{id:target.teamId},select:{name:true}});
    const registrations = await tx.player_registrations.findMany({ where: matchRosterWhere(match.season_id, teamId, target),
      select: { id: true, person_id: true, season_team_id: true, jersey_number: true }, orderBy: { id: "asc" } });
    for (const reg of registrations) {
      const origin = await readLockedPlayerTeamContext(tx, reg.season_team_id);
      const contexts = reg.season_team_id === teamId ? [origin] : [origin, target];
      const assessment = await assessPlayerEligibility(tx, reg.id, contexts, true, {
        sanctionAt: match.starts_at ?? undefined,
      });
      const blockers: Blocker[] = [...assessment.blockers];
      if (!match.starts_at) blockers.push({ code: "MATCH_TIME_REQUIRED", message: "Falta el horario del partido para evaluar la vigencia de sanciones." });
      if (reg.season_team_id !== teamId) {
        const approval = await tx.player_category_participations.findFirst({ where: {
          origin_registration_id: reg.id, target_season_team_id: teamId,
          target_season_category_id: target.seasonCategoryId, season_id: match.season_id,
          club_id: target.clubId, status: "AUTHORIZED",
        }, select: { id: true, eligibility_fingerprint: true } });
        if (!approval) blockers.push({ code: "SUPERIOR_NOT_AUTHORIZED", message: "No existe participación superior autorizada para este equipo inscrito." });
        else if (assessment.ready && approval.eligibility_fingerprint !== assessment.fingerprint)
          blockers.push({code:"SUPERIOR_AUTHORIZATION_STALE",message:"Cambió la evidencia de la participación superior; Secretaría debe volver a autorizarla."});
      }
      const periods = await tx.player_period_participations.findMany({ where: { lineups: {
        player_registrations: { person_id: reg.person_id }, match_reports: { matches: { season_id: match.season_id, deleted_at: null } },
      } }, select: { period_number: true, entry_minute: true, exit_minute: true,
        lineups: { select: { match_reports: { select: { matches: { select: { number: true } } } } } } }, orderBy: [{ period_number: "asc" }, { id: "asc" }] });
      const ownRow = draft?.lineups.find(row => row.playerId === reg.id && row.teamId === teamId && row.selected);
      const ownPeriods = ownRow ? participationPeriods(ownRow, draft!.events, clock) : [];
      // Congelar también el horario de los otros encuentros mientras se guarda.
      // Un interbloqueo aborta la transacción completa; nunca confirma una captura vieja.
      if (intent) await tx.$queryRaw`SELECT m.id FROM sports_management.matches m
        WHERE m.id <> ${matchId}::uuid AND EXISTS (
          SELECT 1 FROM sports_management.match_reports mr
          JOIN sports_management.lineups l ON l.match_report_id=mr.id
          JOIN sports_management.player_registrations r ON r.id=l.registration_id
          WHERE mr.match_id=m.id AND r.person_id=${reg.person_id}::uuid
        ) ORDER BY m.id FOR SHARE OF m`;
      const otherLineups = await tx.lineups.findMany({ where: { player_registrations: { person_id: reg.person_id },
        match_reports: { match_id: { not: matchId }, matches: { deleted_at: null, match_statuses:{code:{not:"CANCELED"}} } } },
        select: { registration_id: true, season_team_id: true, is_starter: true, player_period_participations: { select: { period_number: true, entry_minute: true, exit_minute: true } },
          season_teams: { select: { club_id: true, season_category_id: true } },
          match_reports: { select: { draft_data: true, matches: { select: { season_id: true, starts_at: true, ends_at: true } } } } } });
      const otherHalves: ParticipationHalf[] = [];
      for (const other of otherLineups) {
        const saved = other.match_reports.draft_data as { draft?: unknown; clock?: unknown } | undefined;
        const otherDraft = draftSchema.safeParse(saved?.draft), otherClock = matchClockSchema.safeParse(saved?.clock);
        const otherRow = otherDraft.success ? otherDraft.data.lineups.find(row => row.selected && row.playerId === other.registration_id && row.teamId === other.season_team_id) : undefined;
        const otherHalf = otherRow?.participationHalf;
        const problem = halfCrossingProblem({ seasonId: match.season_id, clubId: target.clubId, categoryId: target.seasonCategoryId,
          half: ownRow?.participationHalf, startsAt: match.starts_at, endsAt: match.ends_at,
          boundaries: verifiedClockBoundaries(clock), hasParticipation: (ownPeriods.length > 0 && !(ownRow?.participationHalf === 2 && clock?.phase === "BREAK" && ownPeriods.every(p => p.periodNumber === 2 && p.entryMinute === 0 && p.exitMinute === null))) || !!ownRow?.starter && !!clock?.boundaries?.firstStartedAt }, {
          seasonId: other.match_reports.matches.season_id, clubId: other.season_teams.club_id, categoryId: other.season_teams.season_category_id!,
          half: otherHalf, startsAt: other.match_reports.matches.starts_at, endsAt: other.match_reports.matches.ends_at,
          boundaries: verifiedClockBoundaries(otherClock.success ? otherClock.data : null), hasParticipation: (other.player_period_participations.length > 0 && !(otherHalf === 2 && otherClock.success && otherClock.data.phase === "BREAK" && other.player_period_participations.every(p => p.period_number === 2 && p.entry_minute === 0 && p.exit_minute === null))) || other.is_starter && !!(otherClock.success && otherClock.data.boundaries?.firstStartedAt),
        });
        if (problem && !blockers.some(b => b.code === problem)) blockers.push({ code: problem, message: halfBlockerMessages[problem] });
        if (problem === "PARTICIPATION_HALF_REQUIRED" && otherHalf) otherHalves.push(otherHalf);
      }
      const halfRestriction: ParticipationHalf | undefined = otherHalves.length && new Set(otherHalves).size === 1 ? (otherHalves[0] === 1 ? 2 : 1) : undefined;
      const labels = await readRegistrationLabels(tx, reg.id);
      const player: MatchPlayer = { registrationId: reg.id, name: labels.name, team: labels.team, targetTeam:targetLabel.name,
        seasonTeamId: teamId, jerseyNumber: reg.jersey_number, eligible: blockers.length === 0, blockers,
        ...(halfRestriction ? { halfRestriction } : {}), participation: periods.map(p => ({ matchNumber: p.lineups.match_reports.matches.number,
          period: p.period_number, entry: p.entry_minute, exit: p.exit_minute })) };
      result.players.push(player);
    }
  }
  return result;
}

export async function evaluateMatchForActor(actorId: string, matchId: string) {
  return getPrisma().$transaction(tx => evaluateMatchInTransaction(tx, actorId, matchId), { isolationLevel: "RepeatableRead", timeout: 30000 });
}
export async function getMatchLineup(matchId: string) {
  return evaluateMatchForActor((await requireOperationalUser()).id, matchId);
}

export async function listAssignedMatchesForActor(actorId: string) {
  return getPrisma().$transaction(async tx => {
    const assignments = await tx.referee_assignments.findMany({ where: { status: "APPROVED", referees: {
      is_active: true, people: { users: { id: actorId } },
    }, matches: { deleted_at: null } }, select: { match_id: true }, orderBy: { match_id: "asc" } });
    const rows = [];
    for (const assignment of assignments) {
      try { const match = await authorizeMatch(tx, actorId, assignment.match_id);
        rows.push({ id: match.id, number: match.number, startsAt: match.starts_at?.toISOString() ?? null });
      } catch (error) { if (!(error instanceof AuthorizationError)) throw error; }
    }
    return rows;
  });
}
export async function getAssignedMatches() { return listAssignedMatchesForActor((await requireOperationalUser()).id); }
export async function canAccessMatchEligibility() { return (await getAssignedMatches()).length > 0; }

const timesInput = z.strictObject({ matchId: z.uuid(), lineupId: z.uuid(),
  expectedMatchVersion: z.number().int().positive(), expectedReportVersion: z.number().int().positive(),
  periods: participationTimesSchema });

/** PDGLD-18 reutiliza esta función dentro de la misma transacción de cédula.
 * No crea una alineación implícita ni sobrescribe una versión desconocida. */
export async function recordParticipationInTransaction(tx: Prisma.TransactionClient, actorId: string, input: unknown) {
  const data = timesInput.parse(input);
  const registration = await tx.lineups.findFirst({ where: { id: data.lineupId, match_reports: { match_id: data.matchId } }, select: { registration_id: true } });
  // Mismo orden que la evaluación: historia antes del partido. FOR SHARE bloquea
  // también UPDATE de horario/version sin cambios de clave (FOR KEY SHARE no).
  // Se conserva hasta COMMIT/ROLLBACK de la transacción del consumidor.
  await lockAuthorization(tx);
  await lockSeasonIdentityHistory(tx);
  const locked = await tx.$queryRaw<{ version: number; status_code: string }[]>`
    SELECT m.version, s.code AS status_code FROM sports_management.matches m
    JOIN sports_management.match_statuses s ON s.id=m.status_id
    WHERE m.id=${data.matchId}::uuid FOR SHARE OF m`;
  await authorizeMatch(tx, actorId, data.matchId);
  await assertPermission(tx,actorId,{module:"match-reports",action:"UPDATE",context:{matchId:data.matchId}});
  if (!registration) throw new AuthorizationError();
  await lockParticipationPeople(tx, [registration.registration_id]);
  const storedReport = await tx.match_reports.findUnique({ where: { match_id: data.matchId }, select: { draft_data: true } });
  const declared = draftSchema.safeParse((storedReport?.draft_data as { draft?: unknown } | undefined)?.draft);
  if (declared.success && declared.data.lineups.some(row => row.selected && row.playerId === registration?.registration_id && row.participationHalf)) throw Error("PARTICIPATION_USE_REPORT");
  const evaluation = await evaluateMatchInTransaction(tx, actorId, data.matchId);
  await assertPermission(tx,actorId,{module:"match-reports",action:"UPDATE",context:{matchId:data.matchId}});
  if (locked[0]?.status_code === "FINISHED") throw Error("MATCH_FINISHED");
  if (evaluation.historical || locked[0]?.version !== data.expectedMatchVersion || evaluation.version !== data.expectedMatchVersion) throw Error("STALE_MATCH");
  const lineup = await tx.lineups.findUnique({ where: { id: data.lineupId }, select: {
    registration_id: true, season_team_id: true, match_report_id: true,
    match_reports: { select: { match_id: true, status: true } },
  } });
  if (!lineup || lineup.match_reports.match_id !== data.matchId) throw new AuthorizationError();
  const player = evaluation.players.find(p => p.registrationId === lineup.registration_id && p.seasonTeamId === lineup.season_team_id);
  if (!player?.eligible) throw Error("PLAYER_NOT_ELIGIBLE");
  await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason','Registro de tiempos de participación por partido',true)`;
  const version = await tx.match_reports.updateMany({ where: { id: lineup.match_report_id, version: data.expectedReportVersion, status: "DRAFT" }, data: { version: { increment: 1 } } });
  if (version.count !== 1) throw Error("STALE_REPORT");
  await tx.player_period_participations.deleteMany({ where: { lineup_id: data.lineupId } });
  await tx.player_period_participations.createMany({ data: data.periods.map(p => ({ lineup_id: data.lineupId,
    period_number: p.periodNumber, entry_minute: p.entryMinute, exit_minute: p.exitMinute })) });
  return { reportVersion: data.expectedReportVersion + 1, periods: data.periods };
}
