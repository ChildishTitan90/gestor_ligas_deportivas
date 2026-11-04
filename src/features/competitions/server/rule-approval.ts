import "server-only";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { ruleApprovalSchema, ruleDraftSchema } from "../schemas";
import { CompetitionError } from "./configuration";

/** Aprueba la versión revisada explícitamente; iniciar nunca aprueba reglas. */
export async function approveCompetitionRule(seasonId: string, ruleId: string, input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = ruleApprovalSchema.safeParse(input);
  if (!parsed.success) throw new CompetitionError("INVALID_RULE_APPROVAL");
  if (![seasonId, ruleId].every(id => z.uuid().safeParse(id).success))
    throw new CompetitionError("INVALID_CONFIGURATION");
  const { expectedSeasonVersion, reason } = parsed.data;
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
    await assertPermission(tx, actor.id, { module: "competitions", action: "APPROVE", context: { seasonId } });
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId } });
    if (season.version !== expectedSeasonVersion) throw new CompetitionError("STALE_CONFIGURATION", 409);
    if (season.status === "CLOSED") throw new CompetitionError("SEASON_CLOSED", 409);
    if (season.status !== "PLANNED" || season.competition_starts_at)
      throw new CompetitionError("COMPETITION_ALREADY_STARTED", 409);
    const rules = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM sports_management.competition_rules WHERE id=${ruleId}::uuid AND season_id=${seasonId}::uuid FOR UPDATE`;
    if (!rules.length) throw new CompetitionError("INVALID_CONTEXT");
    if (rules[0].status !== "DRAFT") throw new CompetitionError("RULE_ALREADY_APPROVED", 409);
    const parameters = await tx.$queryRaw<{ parameter_key: string; parameter_value: unknown }[]>`
      SELECT parameter_key,parameter_value FROM sports_management.competition_rule_parameters
      WHERE competition_rule_id=${ruleId}::uuid FOR UPDATE`;
    // No aprobar reglas incompletas o parámetros fuera del contrato revisado.
    const values = Object.fromEntries(parameters.map(p => [p.parameter_key, p.parameter_value]));
    if (!ruleDraftSchema.safeParse({ ...values, expectedSeasonVersion, reason }).success)
      throw new CompetitionError("INVALID_RULE_PARAMETERS", 409);
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', ${reason}, true)`;
    // El trigger vuelve inmutables los parámetros después de aprobar la versión.
    await tx.competition_rule_parameters.updateMany({ where: { competition_rule_id: ruleId },
      data: { requires_validation: false, validated_by: actor.id } });
    await tx.competition_rules.update({ where: { id: ruleId },
      data: { status: "APPROVED", approved_by: actor.id, approved_at: new Date() } });
    const seasonVersion = await tx.seasons.update({ where: { id: seasonId },
      data: { version: { increment: 1 } }, select: { version: true } });
    // record_audit y audit_season conservan actor/motivo dentro de la transacción.
    return { id: ruleId, status: "APPROVED", seasonVersion: seasonVersion.version };
  });
}
