import "server-only";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { ruleDraftSchema } from "../schemas";
import { playoffDatesRequired } from "../playoff-qualification";

export class CompetitionError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
function validId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new CompetitionError("INVALID_CONFIGURATION");
}

export async function getCompetitionConfiguration(seasonId: string) {
  const actor = await requireOperationalUser();
  validId(seasonId);
  return getPrisma().$transaction(async tx => {
    await assertPermission(tx, actor.id, { module: "competitions", action: "READ", context: { seasonId } });
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId }, select: {
      id: true, name: true, league_id: true, version: true, status: true,
    } });
    const registration = await tx.$queryRaw<{ team_registration_closed_at: Date | null }[]>`SELECT team_registration_closed_at FROM sports_management.seasons WHERE id=${seasonId}::uuid`;
    const rules = await tx.competition_rules.findMany({ where: { season_id: seasonId },
      select: { id: true, version_number: true, status: true, created_at: true,
        competition_rule_parameters: { select: { parameter_key: true, parameter_value: true, requires_validation: true }, orderBy: { parameter_key: "asc" } } },
      orderBy: { version_number: "desc" },
    });
    const venues = await tx.venues.findMany({ where: { league_id: season.league_id },
      select: { id: true, name: true, code: true, is_active: true }, orderBy: { name: "asc" } });
    return { venues: venues.map(venue => ({ id: venue.id, name: venue.name, code: venue.code, active: venue.is_active })),
      season: { id: season.id, name: season.name, leagueId: season.league_id, version: season.version, status: season.status, teamRegistrationClosed: registration[0]?.team_registration_closed_at != null },
      rules: rules.map(rule => ({ id: rule.id, version: rule.version_number, status: rule.status,
        createdAt: rule.created_at.toISOString(), parameters: rule.competition_rule_parameters.map(parameter => ({
          key: parameter.parameter_key, value: parameter.parameter_value, requiresValidation: parameter.requires_validation,
        })) })) };
  }, { isolationLevel: "RepeatableRead" });
}

/** Cada nueva propuesta conserva íntegramente las versiones anteriores. */
export async function createCompetitionRuleDraft(seasonId: string, input: unknown) {
  const actor = await requireOperationalUser();
  validId(seasonId);
  const parsed = ruleDraftSchema.safeParse(input);
  if (!parsed.success) throw new CompetitionError("INVALID_CONFIGURATION");
  const data = parsed.data;
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    // Primero se bloquea la temporada, como en inscripción, y después se verifica
    // el ámbito para evitar invertir FOR UPDATE/FOR SHARE entre escritores.
    await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id = ${seasonId}::uuid FOR UPDATE`;
    await assertPermission(tx, actor.id, { module: "competitions", action: "UPDATE", context: { seasonId } });
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId }, select: { status: true, version: true, league_id: true, start_date: true, end_date: true } });
    if (season.status === "CLOSED") throw new CompetitionError("SEASON_CLOSED", 409);
    if (season.version !== data.expectedSeasonVersion) throw new CompetitionError("STALE_CONFIGURATION", 409);
    if (data.calendar.playoff && (data.calendar.playoff.regularDeadline < season.start_date.toISOString().slice(0, 10) || data.calendar.playoff.regularDeadline >= season.end_date.toISOString().slice(0, 10))) throw new CompetitionError("INVALID_PLAYOFF_DEADLINE");
    const playoff = data.calendar.playoff;
    if (playoff && (!playoff.dates || playoff.dates.length !== playoffDatesRequired(playoff.format) || playoff.dates.some((date, index) => date <= playoff.regularDeadline || date > season.end_date.toISOString().slice(0, 10) || (index > 0 && date <= playoff.dates![index - 1])))) throw new CompetitionError("INVALID_PLAYOFF_DATES");
    const neutralIds = playoff?.venuePolicy?.mode === "NEUTRAL" ? playoff.venuePolicy.venueIds : [];
    const venueIds = [...new Set([...(data.calendar.scheduling?.venueStages.flatMap(stage => stage.venueIds) ?? []), ...neutralIds])];
    if (venueIds.length) {
      const count = await tx.venues.count({ where: { id: { in: venueIds }, league_id: season.league_id, is_active: true } });
      if (count !== venueIds.length) throw new CompetitionError("INVALID_SCHEDULING_VENUES");
    }
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', ${data.reason}, true)`;
    const last = await tx.competition_rules.aggregate({ where: { season_id: seasonId }, _max: { version_number: true } });
    const rule = await tx.competition_rules.create({ data: {
      season_id: seasonId, version_number: (last._max.version_number ?? 0) + 1, status: "DRAFT",
    }, select: { id: true, version_number: true, status: true } });
    for (const [key, value] of Object.entries({ announcement: data.announcement, points: data.points,
      tieBreakers: data.tieBreakers, calendar: data.calendar })) {
      await tx.competition_rule_parameters.create({ data: {
        competition_rule_id: rule.id, parameter_key: key, parameter_value: value, requires_validation: true,
      } });
    }
    const updated = await tx.seasons.update({ where: { id: seasonId }, data: { version: { increment: 1 } }, select: { version: true } });
    // Reglas/parámetros usan record_audit; seasons tiene audit_season para UPDATE.
    return { id: rule.id, version: rule.version_number, status: rule.status, seasonVersion: updated.version };
  });
}
