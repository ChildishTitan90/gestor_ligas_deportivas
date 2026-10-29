import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Browser } from './auth.test.mjs';
import { createAuthFixtures, fixturePassword } from './auth-fixtures.mjs';
import { runRuleDraftTests } from './competition-rules.test.mjs';
import { runCategoryTests } from './competition-categories.test.mjs';

export async function runSeasonIntegrationSuite({ databaseUrl, baseUrl }) {
  const target = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const users = await createAuthFixtures(db);
    const league = (await db.query('INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id', [`PD38-${randomUUID()}`])).rows[0].id;
    const other = (await db.query('INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id', [`PD38-${randomUUID()}`])).rows[0].id;
    await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-38: prueba aislada',false)", [users.operational.id]);
    for (const [role, actions] of [['SUPERADMIN', ['READ', 'CREATE', 'UPDATE']], ['SECRETARY', ['READ']]]) {
      for (const action of actions) {
        await db.query("INSERT INTO sports_management.permissions(module,action) VALUES ('competitions',$1) ON CONFLICT DO NOTHING", [action]);
        await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
          SELECT r.id,p.id,false FROM sports_management.roles r CROSS JOIN sports_management.permissions p
          WHERE r.code=$1 AND p.module='competitions' AND p.action=$2 ON CONFLICT DO NOTHING`, [role,action]);
      }
    }
    for (const [user,role] of [[users.operational,'SUPERADMIN'],[users.concurrent,'SECRETARY']]) {
      await db.query('INSERT INTO sports_management.user_roles(user_id,role_id,league_id) SELECT $1,id,$2 FROM sports_management.roles WHERE code=$3', [user.id,league,role]);
    }
    const admin = new Browser(baseUrl), reader = new Browser(baseUrl);
    await admin.login(users.operational.email,fixturePassword);
    await reader.login(users.concurrent.email,fixturePassword);
    const path = '/competitions/seasons';
    const page = await admin.request(path);
    assert.equal(page.status,200);
    const html = await page.text();
    const action = html.match(/name="(\$ACTION_ID_[^"]+)"/)[1];
    async function submit(browser, fields = {}) {
      const body = new FormData();
      body.set(action,'');
      for (const [key,value] of Object.entries({leagueId:league,name:'Apertura sintética',startDate:'2026-09-01',endDate:'2027-06-30',...fields})) body.set(key,value);
      const result = await browser.request(path,{method:'POST',headers:{origin:baseUrl},body});
      assert.equal(result.status,303);
      return result.headers.get('location');
    }
    await test('PDGLD-38: temporadas con servidor y PostgreSQL reales', async t => {
      await t.test('vacío y consulta por liga, sin autoridad global implícita', async () => {
        assert.match(html,/No hay temporadas registradas/);
        assert.ok(!html.includes(other));
        const read = await reader.request(path);
        assert.equal(read.status,200);
        assert.doesNotMatch(await read.text(),/>Crear temporada</);
        assert.equal((await new Browser(baseUrl).request(path)).status,307);
      });
      await t.test('alta planificada y una auditoría atómica', async () => {
        assert.match(await submit(admin),/created=1/);
        const rows = (await db.query('SELECT id,status,version FROM sports_management.seasons WHERE league_id=$1',[league])).rows;
        assert.equal(rows.length,1); assert.equal(rows[0].status,'PLANNED'); assert.equal(rows[0].version,1);
        assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE table_name='seasons' AND entity_id=$1 AND action='INSERT'",[rows[0].id])).rows[0].n,1);
      });
      await t.test('fechas inválidas, alcance ajeno y permiso insuficiente no crean filas', async () => {
        assert.match(await submit(admin,{endDate:'2026-01-01'}),/INVALID_SEASON/);
        assert.match(await submit(admin,{startDate:'2026-02-30'}),/INVALID_SEASON/);
        assert.match(await submit(admin,{leagueId:other}),/FORBIDDEN/);
        assert.match(await submit(reader,{name:'Intento sin permiso'}),/FORBIDDEN/);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.seasons WHERE league_id IN ($1,$2)',[league,other])).rows[0].n,1);
      });
      await t.test('doble envío concurrente conserva una sola temporada y auditoría', async () => {
        const results = await Promise.all([submit(admin,{name:'Carrera sintética'}),submit(admin,{name:'Carrera sintética'})]);
        assert.equal(results.filter(value=>value.includes('created=1')).length,1);
        assert.equal(results.filter(value=>value.includes('DUPLICATE_SEASON')).length,1);
        assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE table_name='seasons' AND new_data->>'name'='Carrera sintética'")).rows[0].n,1);
      });
      await t.test('fallo de auditoría revierte el alta completa', async () => {
        await db.query(`CREATE FUNCTION pg_temp.reject_season_audit() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.table_name='seasons' THEN RAISE EXCEPTION 'Fallo sintético de auditoría'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER test_season_audit_failure BEFORE INSERT ON sports_management.audit_logs
          FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_season_audit()`);
        try {
          assert.match(await submit(admin,{name:'Alta revertida'}),/UNAVAILABLE/);
          assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.seasons WHERE name='Alta revertida'")).rows[0].n,0);
        } finally { await db.query('DROP TRIGGER test_season_audit_failure ON sports_management.audit_logs'); }
      });
      await runRuleDraftTests({ t, db, baseUrl, admin, reader, league, other });
      await runCategoryTests({ t, db, baseUrl, admin, reader, league, other });
      await t.test('revocar CREATE invalida un formulario ya abierto', async () => {
        await db.query(`DELETE FROM sports_management.role_permissions rp USING sports_management.roles r,sports_management.permissions p
          WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.code='SUPERADMIN' AND p.module='competitions' AND p.action='CREATE'`);
        assert.match(await submit(admin,{name:'Formulario antiguo'}),/FORBIDDEN/);
      });
    });
  } finally { await db.end(); }
}
