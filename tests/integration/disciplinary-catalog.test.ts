import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { mutateCatalogForActor, readCatalogForActor } from "../../src/features/discipline/server/catalog";
import { getPrisma } from "../../src/server/db/prisma";

const target = new URL(process.env.CATALOG_TEST_ADMIN_URL ?? "");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
assert.equal(process.env.AUTH_TEST_RUN, "1");
const runtime = new URL(process.env.DATABASE_URL ?? "");
assert.equal(runtime.username, "gestor_ligas_preview");
assert.equal(runtime.pathname, target.pathname);

test("catálogo: escrituras reales con rol limitado y RLS", async t => {
  const db = new pg.Client({ connectionString: target.href }); await db.connect();
  try {
    const one = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0];
    const { id: person } = await one("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Prueba','Catálogo') RETURNING id");
    const { id: actor } = await one("INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password) VALUES($1,$2,$3,'synthetic',false) RETURNING id", [person, randomUUID(), `${randomUUID()}@example.test`]);
    const { id: outsider } = await one("INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password) VALUES($1,$2,$3,'synthetic',false) RETURNING id", [(await one("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Otra','Persona') RETURNING id")).id, randomUUID(), `${randomUUID()}@example.test`]);
    await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','Fixture sintético',false)", [actor]);
    const { id: league } = await one("INSERT INTO sports_management.leagues(name) VALUES('Liga sintética') RETURNING id");
    const { id: otherLeague } = await one("INSERT INTO sports_management.leagues(name) VALUES('Otra liga sintética') RETURNING id");
    const { id: sport } = await one("SELECT id FROM sports_management.sports WHERE code='SOCCER'");
    const { id: season } = await one("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,'Temporada sintética','2026-01-01','2026-12-31') RETURNING id", [league, sport]);
    const { id: rule } = await one("INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,1) RETURNING id", [season]);
    await db.query("INSERT INTO sports_management.permissions(module,action) VALUES('discipline','READ'),('discipline','UPDATE') ON CONFLICT DO NOTHING");
    await db.query("INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) SELECT r.id,p.id,false FROM sports_management.roles r CROSS JOIN sports_management.permissions p WHERE r.code='DISCIPLINARY_BOARD' AND p.module='discipline' AND p.action IN ('READ','UPDATE') ON CONFLICT DO NOTHING");
    await db.query("INSERT INTO sports_management.user_roles(user_id,role_id,league_id) SELECT $1,id,$2 FROM sports_management.roles WHERE code='DISCIPLINARY_BOARD'", [actor, league]);
    await db.query("INSERT INTO sports_management.user_roles(user_id,role_id,league_id) SELECT $1,id,$2 FROM sports_management.roles WHERE code='DISCIPLINARY_BOARD'", [outsider, otherLeague]);
    const article = { number: "DEMO-01", description: "Conducta sintética", configuration: { schemaVersion: 1 as const, target: "PLAYER" as const, consequence: { type: "MATCHES" as const, quantity: 2 }, source: { origin: "SYNTHETIC" as const, document: "Prueba", season: "Prueba", reference: "Ejemplo", confirmed: false } } };
    const create = { operation: "create" as const, operationId: randomUUID(), ruleId: rule, reason: "Prueba sintética", article };
    await t.test("crea borrador y reenvía sin duplicar", async () => {
      assert.equal((await mutateCatalogForActor(actor, create)).replayed, false);
      assert.equal((await mutateCatalogForActor(actor, create)).replayed, true);
      assert.equal(Number((await one("SELECT count(*) n FROM sports_management.regulation_articles WHERE competition_rule_id=$1", [rule])).n), 1);
    });
    const { id: articleId } = await one("SELECT id FROM sports_management.regulation_articles WHERE competition_rule_id=$1", [rule]);
    await t.test("otra liga no modifica ni consulta", async () => {
      await assert.rejects(mutateCatalogForActor(outsider, { ...create, operationId: randomUUID() }));
      await assert.rejects(readCatalogForActor(outsider, { season }));
    });
    await t.test("edita y rechaza revisión obsoleta", async () => {
      const edit = { operation: "edit" as const, operationId: randomUUID(), ruleId: rule, articleId, expectedRevision: 1, reason: "Cambio sintético", article: { ...article, description: "Actualizado" } };
      await mutateCatalogForActor(actor, edit);
      await assert.rejects(mutateCatalogForActor(actor, { ...edit, operationId: randomUUID() }), /STALE/);
      assert.equal((await one("SELECT revision FROM sports_management.regulation_articles WHERE id=$1", [articleId])).revision, 2);
    });
    await t.test("ejemplo no se aprueba como regla oficial", async () => {
      await assert.rejects(db.query("UPDATE sports_management.competition_rules SET status='APPROVED',approved_by=$2,approved_at=now() WHERE id=$1", [rule, actor]), /CATALOG_REQUIRES_VALIDATION/);
    });
    await t.test("artículo referenciado por resolución conserva contenido ante edición y borrado", async () => {
      const { id: club } = await one("INSERT INTO sports_management.clubs(league_id,name,reference_number,status) VALUES($1,'Club sintético',$2,'ACTIVE') RETURNING id", [league, randomUUID()]);
      const { id: team } = await one("INSERT INTO sports_management.teams(club_id,name,reference_number) VALUES($1,'Equipo sintético',$2) RETURNING id", [club, randomUUID()]);
      await db.query("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,requested_by) VALUES($1,$2,$3,$4,'Azul',$5)", [season, club, league, randomUUID(), actor]);
      const { id: category } = await one("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,'Categoría sintética') RETURNING id", [league, sport]);
      const { id: seasonCategory } = await one("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,eligibility_pending,competition_format) VALUES($1,$2,$3,1,'OPEN',true,'GROUP_STAGE') RETURNING id", [season, category, rule]);
      const { id: entry } = await one("INSERT INTO sports_management.season_teams(season_id,team_id,club_id,season_category_id,status) VALUES($1,$2,$3,$4,'REGISTERED') RETURNING id", [season, team, club, seasonCategory]);
      const { id: caseId } = await one("INSERT INTO sports_management.disciplinary_cases(season_id,reference_number,opened_by,description) VALUES($1,$2,$3,'Incidencia sintética') RETURNING id", [season, randomUUID(), actor]);
      const { id: ruling } = await one("INSERT INTO sports_management.disciplinary_rulings(case_id,version_number,decided_by,decision,reason) VALUES($1,1,$2,'Decisión sintética','Prueba') RETURNING id", [caseId, actor]);
      await db.query("INSERT INTO sports_management.sanctions(ruling_id,article_id,sanction_type_id,season_team_id,starts_at,quantity) SELECT $1,$2,id,$3,now(),2 FROM sports_management.sanction_types WHERE code='MATCHES'", [ruling, articleId, entry]);
      const before = await one("SELECT description,revision,parameters FROM sports_management.regulation_articles WHERE id=$1", [articleId]);
      const cloned = await mutateCatalogForActor(actor, { operation: "clone", operationId: randomUUID(), ruleId: rule, reason: "Nueva versión sintética" });
      assert.notEqual(cloned.ruleId, rule);
      assert.notEqual((await one("SELECT id FROM sports_management.regulation_articles WHERE competition_rule_id=$1", [cloned.ruleId])).id, articleId);
      const edit = { operation: "edit", operationId: randomUUID(), ruleId: rule, articleId, expectedRevision: 2, reason: "Cambio no permitido", article: { ...article, description: "No debe cambiar" } };
      await assert.rejects(mutateCatalogForActor(actor, edit), /READ_ONLY/);
      await assert.rejects(db.query("UPDATE sports_management.regulation_articles SET description='Cambio directo' WHERE id=$1", [articleId]), /CATALOG_REFERENCED/);
      await assert.rejects(db.query("DELETE FROM sports_management.regulation_articles WHERE id=$1", [articleId]), /CATALOG_REFERENCED/);
      assert.deepEqual(await one("SELECT description,revision,parameters FROM sports_management.regulation_articles WHERE id=$1", [articleId]), before);
      assert.equal((await one("SELECT article_id FROM sports_management.sanctions WHERE ruling_id=$1", [ruling])).article_id, articleId);
      const raceArticle = { ...article, number: "DEMO-RACE", description: "Versión antes de la carrera" };
      await mutateCatalogForActor(actor, { ...create, operationId: randomUUID(), article: raceArticle });
      const { id: raceId } = await one("SELECT id FROM sports_management.regulation_articles WHERE competition_rule_id=$1 AND number='DEMO-RACE'", [rule]);
      const reference = new pg.Client({ connectionString: target.href });
      await reference.connect();
      try {
        await reference.query("BEGIN");
        await reference.query("SELECT set_config('app.user_id',$1,true),set_config('app.reason','Carrera sintética',true)", [actor]);
        await reference.query("INSERT INTO sports_management.sanctions(ruling_id,article_id,sanction_type_id,season_team_id,starts_at,quantity) SELECT $1,$2,id,$3,now(),2 FROM sports_management.sanction_types WHERE code='MATCHES'", [ruling, raceId, entry]);
        const attempt = mutateCatalogForActor(actor, { operation: "edit", operationId: randomUUID(), ruleId: rule, articleId: raceId, expectedRevision: 1, reason: "Edición concurrente", article: { ...raceArticle, description: "Cambio concurrente" } });
        const outcome = attempt.then(() => ({ success: true, error: null }), error => ({ success: false, error }));
        let waiting = false;
        for (let i = 0; i < 100; i++) {
          const result = await one("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid <> pg_backend_pid()) AS waiting");
          if (result.waiting) { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(waiting, "La edición debe esperar a la transacción que crea la referencia");
        await reference.query("COMMIT");
        const edited = await outcome;
        assert.equal(edited.success, false, "No se permite editar después de confirmar la referencia");
        assert.match(String(edited.error), /READ_ONLY|CATALOG_REFERENCED/);
        assert.equal((await one("SELECT description FROM sports_management.regulation_articles WHERE id=$1", [raceId])).description, raceArticle.description);
        assert.equal((await one("SELECT article_id FROM sports_management.sanctions WHERE article_id=$1", [raceId])).article_id, raceId);
      } finally { await reference.query("ROLLBACK").catch(() => {}); await reference.end(); }
    });
    await t.test("rechaza el código duplicado y permite corregirlo conservando la captura", async () => {
      const request = { ...create, operationId: randomUUID(), article: { ...article, description: "Captura que se conserva" } };
      await assert.rejects(mutateCatalogForActor(actor, request), { message: "DUPLICATE_ARTICLE_NUMBER" });
      const receipt = await one("SELECT id FROM sports_management.audit_logs WHERE id=$1", [request.operationId]);
      assert.equal(receipt, undefined);
      const corrected = { ...request, operationId: randomUUID(), article: { ...request.article, number: "DEMO-CORREGIDO" } };
      assert.equal((await mutateCatalogForActor(actor, corrected)).replayed, false);
      assert.equal((await mutateCatalogForActor(actor, corrected)).replayed, true);
      const saved = await one("SELECT description FROM sports_management.regulation_articles WHERE competition_rule_id=$1 AND number=$2", [rule, corrected.article.number]);
      assert.equal(saved.description, request.article.description);
    });
  } finally { await getPrisma().$disconnect(); await db.end(); }
});
