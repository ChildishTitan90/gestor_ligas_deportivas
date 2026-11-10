import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { configurationDeleteSchema, seasonCategoryEditSchema } from "../schemas";
import { CompetitionError } from "./configuration";

function checkSeason(season: { status: string; competition_starts_at: Date | null; version: number }, version: number) {
  if (season.status === "CLOSED") throw new CompetitionError("SEASON_CLOSED", 409);
  if (season.status !== "PLANNED" || season.competition_starts_at) throw new CompetitionError("COMPETITION_ALREADY_STARTED", 409);
  if (season.version !== version) throw new CompetitionError("STALE_CONFIGURATION", 409);
}

/** Retira solo una temporada vacía. audit_season registra DELETE en la misma transacción. */
export async function deleteEmptySeason(seasonId: string, input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = configurationDeleteSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(seasonId).success) throw new CompetitionError("INVALID_CONFIGURATION");
  const data = parsed.data;
  try {
    return await getPrisma().$transaction(async tx => {
      await lockAuthorization(tx);
      await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
      // RF22 no tiene DELETE: el mantenimiento exige UPDATE vigente y alcance de temporada.
      await assertPermission(tx, actor.id, { module: "competitions", action: "UPDATE", context: { seasonId } });
      // Enumerar referencias de negocio: _count:true incorporaría snapshots privados
      // al crecer Prisma y exigiría permisos ajenos al mantenimiento de temporadas.
      // Los cierres se rechazan por estado y las FK siguen protegiendo toda referencia.
      const season = await tx.seasons.findUnique({ where: { id: seasonId }, include: { _count: { select: {
        billing_plans: true, charges: true, club_affiliations: true, club_team_changes: true,
        competition_rules: true, correction_authorizations: true, disciplinary_cases: true,
        imports: true, matchdays: true, official_documents: true, publications: true,
        schedule_proposals: true, season_breaks: true, season_categories: true, venue_loans: true,
      } } } });
      if (!season) throw new CompetitionError("INVALID_CONTEXT");
      checkSeason(season, data.expectedSeasonVersion);
      if (Object.values(season._count).some(count => count > 0)) throw new CompetitionError("SEASON_IN_USE", 409);
      await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', ${data.reason}, true)`;
      const deleted = await tx.seasons.delete({ where: { id: seasonId }, select: { id: true } });
      return { ...deleted, deleted: true };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") throw new CompetitionError("SEASON_IN_USE", 409);
    throw error;
  }
}

/** Conserva la identidad del catálogo y solo mantiene participaciones sin dependencias. */
export async function maintainSeasonCategory(seasonId: string, participationId: string, operation: "UPDATE" | "DELETE", input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = (operation === "UPDATE" ? seasonCategoryEditSchema : configurationDeleteSchema).safeParse(input);
  if (!parsed.success || ![seasonId, participationId].every(id => z.uuid().safeParse(id).success)) throw new CompetitionError("INVALID_CONFIGURATION");
  const data = parsed.data;
  try {
    return await getPrisma().$transaction(async tx => {
      await lockAuthorization(tx);
      await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
      await assertPermission(tx, actor.id, { module: "competitions", action: "UPDATE", context: { seasonId } });
      const season = await tx.seasons.findUnique({ where: { id: seasonId } });
      if (!season) throw new CompetitionError("INVALID_CONTEXT");
      checkSeason(season, data.expectedSeasonVersion);
      // FOR UPDATE serializa también contra inserciones directas que verifican su FK.
      await tx.$queryRaw`SELECT id FROM sports_management.season_categories WHERE id=${participationId}::uuid FOR UPDATE`;
      const previous = await tx.season_categories.findFirst({ where: { id: participationId, season_id: seasonId }, include: { _count: true } });
      if (!previous) throw new CompetitionError("INVALID_CONTEXT");
      if (Object.values(previous._count).some(count => count > 0)) throw new CompetitionError("CATEGORY_IN_USE", 409);
      await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', ${data.reason}, true)`;
      let next;
      if (operation === "DELETE") {
        await tx.season_categories.delete({ where: { id: participationId } });
      } else {
        const edit = seasonCategoryEditSchema.parse(data);
        if (!previous.eligibility_pending && (edit.type !== previous.type || edit.ruleId !== previous.competition_rule_id))
          throw new CompetitionError("CATEGORY_ELIGIBILITY_CONFIGURED", 409);
        if (!await tx.competition_rules.findFirst({ where: { id: edit.ruleId, season_id: seasonId }, select: { id: true } })) throw new CompetitionError("INVALID_CONTEXT");
        next = await tx.season_categories.update({ where: { id: participationId }, data: { competition_rule_id: edit.ruleId, hierarchy_order: edit.hierarchyOrder, type: edit.type } });
      }
      const { _count: counts, ...before } = previous;
      void counts;
      // season_categories no tiene record_audit; registrar exactamente un evento propio.
      await tx.audit_logs.create({ data: { user_id: actor.id, table_name: "season_categories", entity_id: participationId,
        action: operation, reason: data.reason, previous_data: JSON.parse(JSON.stringify(before)),
        new_data: next ? JSON.parse(JSON.stringify(next)) : Prisma.JsonNull } });
      const updated = await tx.seasons.update({ where: { id: seasonId }, data: { version: { increment: 1 } }, select: { version: true } });
      return { id: participationId, deleted: operation === "DELETE", seasonVersion: updated.version };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") throw new CompetitionError("CATEGORY_IN_USE", 409);
    throw error;
  }
}
