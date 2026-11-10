import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { configurePlayerPolicySchema, playerPolicySchema } from "../schemas";
import { CompetitionError } from "./configuration";
import { documentPolicyIssues } from "../document-policy";

/** Contrato interno: el consumidor autoriza su operación y comparte su transacción. */
export async function readPlayerPolicy(tx: Prisma.TransactionClient, seasonId: string, participationId: string) {
  if (![seasonId, participationId].every(id => z.uuid().safeParse(id).success)) throw new CompetitionError("INVALID_CONTEXT");
  // Mantener estos bloqueos hasta confirmar el registro: evita validar con una
  // política anterior e insertar después de un cambio concurrente o un cierre.
  const seasons = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR SHARE`;
  if (!seasons.length) throw new CompetitionError("INVALID_CONTEXT");
  if (seasons[0].status === "CLOSED") throw new CompetitionError("SEASON_CLOSED", 409);
  await tx.$queryRaw`SELECT id FROM sports_management.season_categories WHERE id=${participationId}::uuid AND season_id=${seasonId}::uuid FOR SHARE`;
  const category = await tx.season_categories.findFirst({ where: { id: participationId, season_id: seasonId },
    select: { eligibility_pending: true, player_policy: true } });
  const parsed = playerPolicySchema.safeParse(category?.player_policy);
  if (!category || category.eligibility_pending || !parsed.success) throw new CompetitionError("PLAYER_POLICY_PENDING", 409);
  return parsed.data;
}

export async function configurePlayerPolicy(seasonId: string, participationId: string, input: unknown) {
  const actor = await requireOperationalUser();
  return configurePlayerPolicyForActor(actor.id,seasonId,participationId,input);
}
/** Entrada interna: actorId proviene de la sesión del servidor. */
export async function configurePlayerPolicyForActor(actorId: string,seasonId: string, participationId: string,input: unknown) {
  const parsed = configurePlayerPolicySchema.safeParse(input);
  if (!parsed.success || ![seasonId, participationId].every(id => z.uuid().safeParse(id).success)) throw new CompetitionError("INVALID_CONFIGURATION");
  const { policy, reason, expectedSeasonVersion } = parsed.data;
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
    await assertPermission(tx, actorId, { module: "competitions", action: "UPDATE", context: { seasonId } });
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId } });
    if (season.status === "CLOSED") throw new CompetitionError("SEASON_CLOSED", 409);
    if (season.status !== "PLANNED" || season.competition_starts_at) throw new CompetitionError("COMPETITION_ALREADY_STARTED", 409);
    if (season.version !== expectedSeasonVersion) throw new CompetitionError("STALE_CONFIGURATION", 409);
    await tx.$queryRaw`SELECT id FROM sports_management.season_categories WHERE id=${participationId}::uuid FOR UPDATE`;
    const previous = await tx.season_categories.findFirst({ where: { id: participationId, season_id: seasonId } });
    if (!previous) throw new CompetitionError("INVALID_CONTEXT");
    const registrations = { season_id: seasonId, season_teams: { OR:[{season_category_id:participationId},{groups:{season_category_id:participationId}}] } };
    const inUse = await tx.player_registrations.count({ where: registrations }) || await tx.player_category_participations.count({where:{target_season_category_id:participationId}});
    if (inUse) {
      // Resolver decisiones documentales de expedientes pendientes no modifica
      // edades, ventanas, cupos ni inscripciones de origen ya registradas.
      const old = playerPolicySchema.safeParse(previous.player_policy);
      if (!old.success || Array.isArray(policy.documents)) throw new CompetitionError("PLAYER_POLICY_IN_USE", 409);
      const {documents:oldDocuments,...oldSport}=old.data;
      const {documents:newDocuments,...newSport}=policy;
      if (JSON.stringify(oldSport)!==JSON.stringify(newSport) || JSON.stringify(oldDocuments)===JSON.stringify(newDocuments) ||
        previous.minimum_age!==policy.minimumAge || previous.maximum_age!==policy.maximumAge || previous.age_cutoff_date?.getUTCFullYear()!==policy.referenceYear ||
        await tx.player_registrations.count({where:{...registrations,withdrawn_at:null,status:{not:"INELIGIBLE"}}}) ||
        await tx.player_category_participations.count({where:{target_season_category_id:participationId,player_registrations:{withdrawn_at:null,status:{not:"INELIGIBLE"}}}})) throw new CompetitionError("PLAYER_POLICY_IN_USE", 409);
    }
    if ((previous.type === "YOUTH" && policy.maximumAge === null) || (previous.type !== "YOUTH" && policy.exceptionMinimumAge !== null)) throw new CompetitionError("INVALID_CONFIGURATION");
    if (!Array.isArray(policy.documents) && policy.documents.status === "APPROVED") {
      await assertPermission(tx, actorId, { module: "competitions", action: "APPROVE", context: { seasonId } });
      const documentPolicy=policy.documents;
      const populations = [...(policy.minimumAge < 18 ? [true] : []), ...(policy.maximumAge === null || policy.maximumAge >= 18 ? [false] : [])];
      if (populations.some(minor => documentPolicyIssues(documentPolicy, previous.type, minor).length)) throw new CompetitionError("INVALID_CONFIGURATION");
      const codes = [...new Set(policy.documents.requirements.flatMap(rule => rule.anyOf))];
      if (await tx.document_types.count({ where: { code: { in: codes } } }) !== codes.length) throw new CompetitionError("INVALID_CONFIGURATION");
    }
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actorId}, true), set_config('app.reason', ${reason}, true)`;
    const next = await tx.season_categories.update({ where: { id: participationId }, data: { player_policy: policy,
      minimum_age: policy.minimumAge, maximum_age: policy.maximumAge,
      age_cutoff_date: new Date(`${policy.referenceYear}-12-31T00:00:00Z`), eligibility_pending: false } });
    await tx.audit_logs.create({ data: { user_id: actorId, table_name: "season_categories", entity_id: participationId, action: "UPDATE", reason,
      previous_data: JSON.parse(JSON.stringify(previous)), new_data: JSON.parse(JSON.stringify(next)) } });
    const updated = await tx.seasons.update({ where: { id: seasonId }, data: { version: { increment: 1 } }, select: { version: true } });
    return { id: participationId, seasonVersion: updated.version, eligibilityPending: false };
  });
}
