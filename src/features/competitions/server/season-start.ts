import "server-only";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { configurationDeleteSchema } from "../schemas";
import { CompetitionError } from "./configuration";

export async function advanceSeason(seasonId: string, action: "close-registrations" | "start", input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = configurationDeleteSchema.safeParse(input);
  if (!z.uuid().safeParse(seasonId).success || !parsed.success) throw new CompetitionError("INVALID_CONFIGURATION");
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    const rows = await tx.$queryRaw<{ status: string; version: number; team_registration_closed_at: Date | null; competition_starts_at: Date | null }[]>`
      SELECT status, version, team_registration_closed_at, competition_starts_at FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
    await assertPermission(tx, actor.id, { module: "competitions", action: "UPDATE", context: { seasonId } });
    const current = rows[0];
    if (!current) throw new CompetitionError("INVALID_CONTEXT");
    if (current.version !== parsed.data.expectedSeasonVersion) throw new CompetitionError("STALE_CONFIGURATION", 409);
    if (current.status !== "PLANNED" || current.competition_starts_at) throw new CompetitionError("COMPETITION_ALREADY_STARTED", 409);
    if (action === "close-registrations" && current.team_registration_closed_at) throw new CompetitionError("TEAM_REGISTRATION_ALREADY_CLOSED", 409);
    if (action === "start") {
      if (!current.team_registration_closed_at) throw new CompetitionError("TEAM_REGISTRATION_STILL_OPEN", 409);
      const pending = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM sports_management.season_teams WHERE season_id=${seasonId}::uuid AND status IN ('REGISTERED','ACTIVE') AND group_id IS NULL`;
      if (Number(pending[0].count) > 0) throw new CompetitionError("UNASSIGNED_TEAMS", 409);
      // Solo cuentan las versiones vinculadas a las categorías de esta edición.
      // El bloqueo se conserva hasta activar la temporada; un borrador nuevo no
      // sustituye ni acredita la aprobación de las reglas que se van a usar.
      const rules = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT r.id, r.status FROM sports_management.season_categories sc
        JOIN sports_management.competition_rules r ON r.id=sc.competition_rule_id AND r.season_id=sc.season_id
        WHERE sc.season_id=${seasonId}::uuid FOR SHARE OF sc,r`;
      if (!rules.length || rules.some(rule => rule.status !== "APPROVED"))
        throw new CompetitionError("RULES_NOT_APPROVED", 409);
      const parameters = await tx.competition_rule_parameters.findMany({
        where: { competition_rule_id: { in: rules.map(rule => rule.id) }, requires_validation: true },
        select: { id: true }, take: 1,
      });
      if (parameters.length) throw new CompetitionError("RULES_PENDING_VALIDATION", 409);
    }
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', ${parsed.data.reason}, true)`;
    const updated = action === "close-registrations"
      ? await tx.$queryRaw<{ id: string; version: number }[]>`UPDATE sports_management.seasons SET team_registration_closed_at=now(),version=version+1 WHERE id=${seasonId}::uuid RETURNING id,version`
      : await tx.$queryRaw<{ id: string; version: number }[]>`UPDATE sports_management.seasons SET status='ACTIVE',competition_starts_at=now(),version=version+1 WHERE id=${seasonId}::uuid RETURNING id,version`;
    return updated[0];
  });
}
