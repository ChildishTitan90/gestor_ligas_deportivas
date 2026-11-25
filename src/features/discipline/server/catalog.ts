import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError, getPermissionGrants, lockAuthorization } from "@/server/auth/authorization";
import { articleSchema, catalogMutation } from "../contract";

type Tx = Prisma.TransactionClient;
export class CatalogError extends Error {}
async function grants(tx: Tx, actorId: string, write = false) {
  const roles = await tx.roles.findMany({ where: { code: { in: ["DISCIPLINARY_BOARD", "SUPERADMIN"] } }, select: { id: true, code: true } });
  const board = roles.find(r => r.code === "DISCIPLINARY_BOARD")?.id;
  const admin = roles.find(r => r.code === "SUPERADMIN")?.id;
  const discipline = await getPermissionGrants(tx, actorId, "discipline", write ? "UPDATE" : "READ");
  const authority = await getPermissionGrants(tx, actorId, "users", write ? "UPDATE" : "READ");
  return [...discipline.filter(g => g.roleId === board), ...authority.filter(g => g.roleId === admin)]
    .filter(g => !g.clubId && (!g.contextOnly || !!g.leagueId));
}
async function authorize(tx: Tx, actorId: string, leagueId: string, write = false) {
  if (!(await grants(tx, actorId, write)).some(g => !g.leagueId || g.leagueId === leagueId)) throw new AuthorizationError();
}
export async function canReadCatalog() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => (await grants(tx, actor.id)).length > 0);
}
export type CatalogRow = { id: string; number: string; description: string; parameters: Prisma.JsonValue; revision: number; referenced: boolean };
async function articles(tx: Tx, ruleId: string): Promise<CatalogRow[]> {
  return tx.$queryRaw<CatalogRow[]>`SELECT a.id,a.number,a.description,a.parameters,a.revision,
    (EXISTS(SELECT 1 FROM sports_management.sanctions s WHERE s.article_id=a.id)
    OR EXISTS(SELECT 1 FROM sports_management.team_withdrawals w WHERE w.article_id=a.id)) AS referenced
    FROM sports_management.regulation_articles a WHERE competition_rule_id=${ruleId}::uuid ORDER BY number,id`;
}
export async function readCatalogForActor(actorId: string, filter: { season?: string; rule?: string }) {
  for (const id of [filter.season, filter.rule]) if (id && !z.uuid().safeParse(id).success) throw new CatalogError("INVALID");
  return getPrisma().$transaction(async tx => {
    const access = await grants(tx, actorId);
    if (!access.length) throw new AuthorizationError();
    const seasons = await tx.seasons.findMany({ where: { leagues: { is_active: true },
      ...(access.some(g => !g.leagueId) ? {} : { league_id: { in: access.flatMap(g => g.leagueId ? [g.leagueId] : []) } }) },
      select: { id: true, name: true, status: true, league_id: true, leagues: { select: { name: true } } }, orderBy: [{ start_date: "desc" }, { id: "asc" }] });
    const season = filter.season ? seasons.find(s => s.id === filter.season) : undefined;
    if (filter.season && !season) throw new AuthorizationError();
    const rules = season ? await tx.competition_rules.findMany({ where: { season_id: season.id }, select: { id: true, version_number: true, status: true }, orderBy: { version_number: "desc" } }) : [];
    const rule = filter.rule ? rules.find(r => r.id === filter.rule) : rules[0];
    if (filter.rule && !rule) throw new AuthorizationError();
    const write = await grants(tx, actorId, true);
    return { seasons, season: season ?? null, rules, rule: rule ?? null,
      canEdit: !!season && season.status !== "CLOSED" && write.some(g => !g.leagueId || g.leagueId === season.league_id),
      articles: rule ? await articles(tx, rule.id) : [] };
  }, { isolationLevel: "RepeatableRead" });
}
export async function readCatalog(filter: { season?: string; rule?: string }) {
  return readCatalogForActor((await requireOperationalUser()).id, filter);
}
export async function mutateCatalogForActor(actorId: string, input: unknown) {
  const parsed = catalogMutation.safeParse(input);
  if (!parsed.success) throw new CatalogError("INVALID");
  const data = parsed.data;
  const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    const parent = await tx.competition_rules.findUnique({ where: { id: data.ruleId }, select: { season_id: true } });
    if (!parent) throw new AuthorizationError();
    await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${parent.season_id}::uuid FOR UPDATE`;
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: parent.season_id }, select: { id: true, league_id: true, status: true } });
    await authorize(tx, actorId, season.league_id, true);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.operationId},26))::text`;
    const receipt = await tx.audit_logs.findUnique({ where: { id: data.operationId }, select: { user_id: true, table_name: true, new_data: true } });
    if (receipt) {
      const body = receipt.new_data as { hash?: string; ruleId?: string } | null;
      if (receipt.user_id !== actorId || receipt.table_name !== "disciplinary_catalog_operations" || body?.hash !== hash || !body.ruleId) throw new CatalogError("REPLAY_CONFLICT");
      return { ruleId: body.ruleId, seasonId: season.id, replayed: true };
    }
    if (season.status === "CLOSED") throw new CatalogError("SEASON_CLOSED");
    const rules = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM sports_management.competition_rules WHERE id=${data.ruleId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${data.reason},true)`;
    let targetRule = data.ruleId;
    if (data.operation === "clone") {
      const last = await tx.competition_rules.aggregate({ where: { season_id: season.id }, _max: { version_number: true } });
      const next = await tx.competition_rules.create({ data: { season_id: season.id, version_number: (last._max.version_number ?? 0) + 1, status: "DRAFT" }, select: { id: true } });
      targetRule = next.id;
      const parameters = await tx.competition_rule_parameters.findMany({ where: { competition_rule_id: data.ruleId }, select: { parameter_key: true, parameter_value: true } });
      for (const p of parameters) await tx.competition_rule_parameters.create({ data: { competition_rule_id: next.id, parameter_key: p.parameter_key, parameter_value: p.parameter_value as Prisma.InputJsonValue, requires_validation: true }, select: { id: true } });
      await tx.$executeRaw`INSERT INTO sports_management.regulation_articles(competition_rule_id,number,description,sanction_type_id,parameters)
        SELECT ${next.id}::uuid,number,description,sanction_type_id,
        CASE WHEN parameters->>'schemaVersion'='1' THEN jsonb_set(parameters,'{source,confirmed}','false') ELSE parameters END
        FROM sports_management.regulation_articles WHERE competition_rule_id=${data.ruleId}::uuid`;
    } else {
      if (rules[0]?.status !== "DRAFT") throw new CatalogError("READ_ONLY");
      const article = articleSchema.parse(data.article);
      const types = await tx.sanction_types.findUnique({ where: { code: article.configuration.consequence.type }, select: { id: true } });
      if (!types) throw new CatalogError("INVALID");
      if (data.operation === "edit") {
        const locked = await tx.$queryRaw<{ revision: number }[]>`SELECT revision FROM sports_management.regulation_articles WHERE id=${data.articleId}::uuid AND competition_rule_id=${data.ruleId}::uuid FOR UPDATE`;
        if (!locked.length) throw new AuthorizationError();
        if (locked[0].revision !== data.expectedRevision) throw new CatalogError("STALE");
        if ((await articles(tx, data.ruleId)).find(a => a.id === data.articleId)?.referenced) throw new CatalogError("READ_ONLY");
        try {
          await tx.$executeRaw`UPDATE sports_management.regulation_articles SET number=${article.number},description=${article.description},
            sanction_type_id=${types.id}::uuid,parameters=${JSON.stringify(article.configuration)}::jsonb WHERE id=${data.articleId}::uuid`;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" &&
            error.message.includes("Code: `23505`") &&
            error.message.includes('"regulation_articles_competition_rule_id_number_key"')) {
            throw new CatalogError("DUPLICATE_ARTICLE_NUMBER");
          }
          throw error;
        }
      } else {
        const inserted = await tx.$executeRaw`INSERT INTO sports_management.regulation_articles(id,competition_rule_id,number,description,sanction_type_id,parameters)
          VALUES (${randomUUID()}::uuid,${data.ruleId}::uuid,${article.number},${article.description},${types.id}::uuid,${JSON.stringify(article.configuration)}::jsonb)
          ON CONFLICT (competition_rule_id,number) DO NOTHING`;
        if (inserted === 0) throw new CatalogError("DUPLICATE_ARTICLE_NUMBER");
      }
    }
    await tx.seasons.update({ where: { id: season.id }, data: { version: { increment: 1 } }, select: { id: true } });
    await tx.audit_logs.create({ data: { id: data.operationId, user_id: actorId, action: "INSERT", table_name: "disciplinary_catalog_operations", entity_id: targetRule, reason: data.reason, new_data: { hash, ruleId: targetRule } }, select: { id: true } });
    return { ruleId: targetRule, seasonId: season.id, replayed: false };
  }, { timeout: 15000 });
}
export async function mutateCatalog(input: unknown) {
  return mutateCatalogForActor((await requireOperationalUser()).id, input);
}
