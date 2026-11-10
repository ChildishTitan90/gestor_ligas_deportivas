import "server-only";
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
  await lockSeasonIdentityHistory(tx);
  const match = await authorizeMatch(tx, actorId, matchId);
  const historical = match.season.status === "CLOSED";
  const result: LineupEvaluation = { matchId, number: match.number, version: match.version,
    startsAt: match.starts_at?.toISOString() ?? null, historical, players: [], notices: [
      "La evaluación no guarda ni confirma una alineación. Se vuelve a validar al capturar la cédula.",
      "[PV] Falta confirmar coincidencias de horarios, descanso y límites de participación. Los tiempos se muestran sin presumir autorización para cruces.",
    ] };
  // CLOSED no consulta identidad vigente ni recalcula elegibilidad histórica.
  if (historical) { result.notices = ["Temporada cerrada: consulta la evidencia histórica de la cédula. No se recalcula la elegibilidad con datos actuales."]; return result; }
  const targets = [match.home_team_id, match.away_team_id];
  for (const teamId of targets) {
    const target = await readLockedPlayerTeamContext(tx, teamId);
    const targetLabel = await tx.teams.findUniqueOrThrow({where:{id:target.teamId},select:{name:true}});
    const registrations = await tx.player_registrations.findMany({ where: { season_id: match.season_id,
      OR: [{ season_team_id: teamId }, { season_teams: { club_id: target.clubId } }] },
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
          origin_registration_id: reg.id, target_season_team_id: teamId, status: "AUTHORIZED",
        }, select: { id: true, eligibility_fingerprint: true } });
        if (!approval) blockers.push({ code: "SUPERIOR_NOT_AUTHORIZED", message: "No existe participación superior autorizada para este equipo inscrito." });
        else if (assessment.ready && approval.eligibility_fingerprint !== assessment.fingerprint)
          blockers.push({code:"SUPERIOR_AUTHORIZATION_STALE",message:"Cambió la evidencia de la participación superior; Secretaría debe volver a autorizarla."});
      }
      const periods = await tx.player_period_participations.findMany({ where: { lineups: {
        player_registrations: { person_id: reg.person_id }, match_reports: { matches: { season_id: match.season_id, deleted_at: null } },
      } }, select: { period_number: true, entry_minute: true, exit_minute: true,
        lineups: { select: { match_reports: { select: { matches: { select: { number: true } } } } } } }, orderBy: [{ period_number: "asc" }, { id: "asc" }] });
      const otherLineups = await tx.lineups.findMany({ where: { player_registrations: { person_id: reg.person_id },
        match_reports: { match_id: { not: matchId }, matches: { deleted_at: null, match_statuses:{code:{not:"CANCELED"}} } } },
        select:{match_reports:{select:{matches:{select:{starts_at:true,ends_at:true}}}}} });
      const uncertainCrossing=otherLineups.some(({match_reports:{matches:other}})=>
        !match.starts_at || !match.ends_at || !other.starts_at || !other.ends_at ||
        (other.starts_at < match.ends_at && other.ends_at > match.starts_at));
      if (uncertainCrossing) blockers.push({ code: "PARTICIPATION_RULE_PENDING", message: "Otra alineación coincide con este horario o no tiene horario completo. La participación por mitades requiere precisar la regla [PV]; no se puede certificar este cruce." });
      const labels = await readRegistrationLabels(tx, reg.id);
      const player: MatchPlayer = { registrationId: reg.id, name: labels.name, team: labels.team, targetTeam:targetLabel.name,
        seasonTeamId: teamId, jerseyNumber: reg.jersey_number, eligible: blockers.length === 0, blockers,
        participation: periods.map(p => ({ matchNumber: p.lineups.match_reports.matches.number,
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
  const evaluation = await evaluateMatchInTransaction(tx, actorId, data.matchId);
  await assertPermission(tx,actorId,{module:"match-reports",action:"UPDATE",context:{matchId:data.matchId}});
  if (evaluation.historical || evaluation.version !== data.expectedMatchVersion) throw Error("STALE_MATCH");
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
