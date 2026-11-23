import { effectiveCaptain } from "../captaincy";
import "server-only";
import type { Prisma } from "@prisma/client";
import type { LineupEvaluation } from "@/features/matches/eligibility";
import type { ReportDraft } from "../contract";
import type { ReportDemoData } from "../types";
import type { reportAccess } from "./access";
import { uniformKitsSchema } from "@/features/clubs/uniform-kits";
import { currentPlayerPhotos } from "@/features/players/server/match-photos";
import { readLineupLock } from "./lineup-lock";
import { matchClockSchema } from "../match-clock";
import { getConfirmationAvailability } from "./confirmation-effects";

export async function readMatchLabels(tx: Prisma.TransactionClient, match: Awaited<ReturnType<typeof reportAccess>>) {
  const [meta] = await tx.$queryRaw<{ season: string; category: string; group: string; matchday: number; venue: string; home: string; away: string }[]>`
    SELECT s.name AS season,c.name AS category,g.name AS "group",d.number AS matchday,v.name AS venue,ht.name AS home,at.name AS away
    FROM sports_management.matches m JOIN sports_management.seasons s ON s.id=m.season_id
    JOIN sports_management.groups g ON g.id=m.group_id JOIN sports_management.season_categories sc ON sc.id=g.season_category_id
    JOIN sports_management.categories c ON c.id=sc.category_id JOIN sports_management.matchdays d ON d.id=m.matchday_id
    JOIN sports_management.season_teams h ON h.id=m.home_team_id JOIN sports_management.teams ht ON ht.id=h.team_id
    JOIN sports_management.season_teams a ON a.id=m.away_team_id JOIN sports_management.teams at ON at.id=a.team_id
    LEFT JOIN sports_management.venues v ON v.id=m.venue_id WHERE m.id=${match.id}::uuid`;
  return meta;
}

export async function buildPresentation(tx: Prisma.TransactionClient, match: Awaited<ReturnType<typeof reportAccess>>, report: { id: string; version: number; status: string; confirmed_at: Date | null; draft_data?: unknown }, draft: ReportDraft, evaluation: LineupEvaluation): Promise<ReportDemoData> {
  const meta = await readMatchLabels(tx, match);
  const season = await tx.seasons.findUniqueOrThrow({ where: { id: match.season_id }, select: { sport_id: true } });
  const catalogue = await tx.event_types.findMany({ where: { sport_id: season.sport_id }, orderBy: { code: "asc" } });
  const teams = await tx.season_teams.findMany({ where: { id: { in: [match.home_team_id, match.away_team_id] } }, select: { id: true, club_id: true } });
  const kits = await tx.club_affiliations.findMany({ where: { season_id: match.season_id, club_id: { in: teams.map(t => t.club_id) }, status: "APPROVED" }, select: { club_id: true, uniform_kits: true } });
  const photos = await currentPlayerPhotos(tx, evaluation.players.map(p => p.registrationId));
  const seal = await readLineupLock(tx, report.id);
  const clock = matchClockSchema.safeParse((report.draft_data as { clock?: unknown } | undefined)?.clock).data ?? null;
  const team = (id: string, name: string) => ({ id, name, shortName: name, initials: name.split(/\s+/).slice(0, 2).map(n => n[0]).join(""), uniformKits: uniformKitsSchema.safeParse(kits.find(k => k.club_id === teams.find(t => t.id === id)?.club_id)?.uniform_kits).data ?? null });
  return {
    confirmation: getConfirmationAvailability(),
    scenario: report.status === "CONFIRMED" ? "confirmed" : "draft",
    match: { id: match.id, number: match.number, version: match.version, status: { code: match.match_statuses.code, label: match.match_statuses.name, captureAllowed: ["CONFIRMED", "IN_PROGRESS"].includes(match.match_statuses.code) && match.season.status !== "CLOSED" && report.status === "DRAFT" },
      season: meta.season, category: meta.category, group: meta.group, matchday: `Jornada ${meta.matchday}`, venue: meta.venue ?? "Cancha pendiente", startsAt: match.starts_at?.toISOString() ?? "", home: team(match.home_team_id, meta.home), away: team(match.away_team_id, meta.away) },
    players: evaluation.players.map(player => ({ id: player.registrationId, name: player.name, teamId: player.seasonTeamId, usualJersey: player.jerseyNumber, eligible: player.eligible, blockers: player.blockers, ...(player.halfRestriction ? { halfRestriction: player.halfRestriction } : {}), photoUrl: photos.has(player.registrationId) ? `/api/match-reports/${match.id}/players/${player.registrationId}/photo` : null })),
    eventTypes: catalogue.map(type => ({ code: type.code, label: type.name, team: type.code === "SERIOUS_INCIDENT" ? "optional" : "required", player: ["GOAL", "OWN_GOAL", "ASSIST", "CAUTION", "SENDING_OFF", "SUBSTITUTION", "INJURY"].includes(type.code) ? "required" : "optional", opensCase: type.requires_disciplinary_case })),
    report: { id: report.id, matchId: match.id, version: report.version, status: report.status === "CONFIRMED" ? "CONFIRMED" : "DRAFT", confirmedAt: report.confirmed_at?.toISOString() ?? null, lineupsLock: seal?.lock ?? null, clock,
      persistedLineupOrder: draft.lineups.map(row => row.playerId),
      lineups: [...draft.lineups.filter(row => evaluation.players.some(player => player.registrationId === row.playerId && player.seasonTeamId === row.teamId)), ...evaluation.players.filter(player => !draft.lineups.some(row => row.playerId === player.registrationId)).map(player => ({ playerId: player.registrationId, selected: false, starter: true, matchJersey: player.jerseyNumber, periods: [] }))],
      captains: draft.captains, events: draft.events, score: draft.score, remarks: draft.remarks, incidents: draft.incidents, ...(draft.tactics ? { tactics: draft.tactics } : {}), ...(draft.noShow ? { noShow: draft.noShow } : {}),
      signatures: Object.fromEntries([match.home_team_id, match.away_team_id].map(teamId => [teamId, draft.signatures[teamId] ? { captainId: effectiveCaptain(draft.captains[teamId],draft.events,teamId)!, source: "device", image: `/api/match-reports/${match.id}/signatures/${draft.signatures[teamId]}` } : null])) },
  };
}
