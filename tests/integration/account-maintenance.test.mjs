import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tsImport } from 'tsx/esm/api';
import { Browser } from './auth.test.mjs';
import { createAuthFixtures, fixturePassword } from './auth-fixtures.mjs';
import { runEmailChangeDatabaseSuite } from './account-email-change.mjs';
import { runAccountIdentifierChecks, runAccountSelfIdentifierCheck } from './account-identifiers.mjs';

// Solo invocado por el puente IPC tras validar base/host/puertos de la copia propia.
export async function runAccountMaintenanceSuite({ databaseUrl, baseUrl, runtimeDatabaseUrl }) {
  const url = new URL(databaseUrl);
  assert.equal(url.hostname, '127.0.0.1');
  assert.ok(['55415','55417'].includes(url.port));
  assert.match(url.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const db = new pg.Client({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  await db.connect();
  try {
    const { loadPermissionCatalog } = await tsImport('../../prisma/permissions-catalog.ts', import.meta.url);
    const { installPermissionCatalog } = await tsImport('../../prisma/seed-permissions.ts', import.meta.url);
    const users = await createAuthFixtures(db);
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(54,2026)::text`;
      await installPermissionCatalog(tx, await loadPermissionCatalog(), users.operational.id);
    });
    async function assignment(user, role, league = null) {
      await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-118: fixture aislado',false)", [users.operational.id]);
      await db.query(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id)
        SELECT $1,id,$3 FROM sports_management.roles WHERE code=$2`, [user.id,role,league]);
    }
    await assignment(users.operational, 'SUPERADMIN');
    await assignment(users.concurrent, 'SUPERADMIN');
    const league = (await db.query('INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id', [randomUUID()])).rows[0].id;
    await assignment(users.idle, 'SUPERADMIN', league);
    const club=(await db.query('INSERT INTO sports_management.clubs(league_id,name,reference_number) VALUES ($1,$2,$3) RETURNING id',[league,'Club sintético',randomUUID()])).rows[0].id;
    await db.query(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id,delegate_position,starts_at,ends_at)
      SELECT $1,id,$2,$3,'PRIMARY',now()-interval '1 day',now()+interval '1 day' FROM sports_management.roles WHERE code='CLUB_DELEGATE'`,[users.underscore.id,league,club]);
    const admin = new Browser(baseUrl), second = new Browser(baseUrl), scoped = new Browser(baseUrl), target = new Browser(baseUrl);
    for (const [browser,user] of [[admin,users.operational],[second,users.concurrent],[scoped,users.idle],[target,users.underscore]])
      await browser.login(user.email,fixturePassword);
    const root='/api/account-maintenance';
    const detail = async (id, browser=admin) => {
      const response=await browser.request(`${root}/${id}`); assert.equal(response.status,200); return response.json();
    };
    const patch = (browser,id,body) => browser.request(`${root}/${id}/status`, {method:'PATCH',
      headers:{origin:baseUrl,'content-type':'application/json'}, body:JSON.stringify(body)});
    const body = (revision,isActive=false) => ({isActive,expectedRevision:revision,confirmed:true,reason:'Mantenimiento sintético autorizado'});
    await test('PDGLD-118 HTTP y transacciones en base exclusiva', async t => {
      await t.test('lista/detalle mínimos, paginación, búsqueda literal y opciones de alta conservadas', async () => {
        const response=await admin.request(`${root}?pageSize=2`); assert.equal(response.status,200);
        const list=await response.json(); assert.equal(list.items.length,2); assert.ok(list.total>=11);
        assert.deepEqual(Object.keys(list.items[0]).sort(), ['id','isActive','revision','username']);
        const info=await detail(users.underscore.id); assert.deepEqual(Object.keys(info).sort(), ['id','isActive','revision','username']);
        const search=await (await admin.request(`${root}?search=pdgld48_underscore`)).json();
        assert.deepEqual(search.items.map(x=>x.id),[users.underscore.id]);
        assert.equal((await (await admin.request(`${root}?search=%25`)).json()).total,0);
        const options=await admin.request('/api/accounts'); assert.equal(options.status,200);
        assert.ok(Array.isArray((await options.json()).roles));
        assert.equal((await admin.request(`${root}?page=0`)).status,400);
        assert.equal((await admin.request(`${root}?page=1&page=2`)).status,400);
      });
      await t.test('sin permiso o con autoridad parcial no se administra una identidad global', async () => {
        for (const browser of [scoped,target,new Browser(baseUrl)]) {
          assert.ok([401,403].includes((await browser.request(root)).status));
          assert.ok([401,403].includes((await browser.request(`${root}/${users.underscore.id}`)).status));
          assert.ok([401,403].includes((await patch(browser,users.underscore.id,body(0))).status));
        }
      });
      await t.test('confirmación y motivo obligatorios; conflicto no deja efectos', async () => {
        assert.equal((await patch(admin,users.underscore.id,{...body(0),confirmed:false})).status,400);
        assert.equal((await patch(admin,users.underscore.id,{...body(0),reason:''})).status,400);
        assert.equal((await patch(admin,users.underscore.id,body(99))).status,409);
        assert.equal((await detail(users.underscore.id)).revision,0);
      });
      await t.test('baja/reactivación revocan sesiones y conservan persona, referencias y asignaciones', async () => {
        const before=(await db.query('SELECT person_id,version FROM sports_management.users WHERE id=$1',[users.underscore.id])).rows[0];
        const assignments=(await db.query('SELECT * FROM sports_management.user_roles WHERE user_id=$1 ORDER BY id',[users.underscore.id])).rows;
        const cookies=new Map(target.cookies);
        const results=await Promise.all([patch(admin,users.underscore.id,body(0)),patch(second,users.underscore.id,body(0))]);
        assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
        assert.equal((await target.request('/api/auth/session')).status,200);
        assert.equal((await target.session()).user,undefined);
        assert.equal((await patch(admin,users.underscore.id,body(1,true))).status,200);
        target.cookies=cookies; assert.equal((await target.session()).user,undefined);
        const after=(await db.query('SELECT person_id,version,maintenance_revision FROM sports_management.users WHERE id=$1',[users.underscore.id])).rows[0];
        assert.equal(after.person_id,before.person_id); assert.equal(after.version,before.version+2); assert.equal(after.maintenance_revision,2);
        assert.deepEqual((await db.query('SELECT * FROM sports_management.user_roles WHERE user_id=$1 ORDER BY id',[users.underscore.id])).rows,assignments);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.sessions WHERE user_id=$1 AND revoked_at IS NULL',[users.underscore.id])).rows[0].n,0);
        const audit=(await db.query("SELECT * FROM sports_management.audit_logs WHERE table_name='users' AND entity_id=$1 AND action='UPDATE' ORDER BY occurred_at",[users.underscore.id])).rows;
        assert.equal(audit.length,2); for(const event of audit) {
          assert.deepEqual(Object.keys(event.new_data).sort(),['is_active','maintenance_revision']);
          assert.ok([users.operational.id,users.concurrent.id].includes(event.user_id));
        }
        await target.login(users.underscore.email,fixturePassword); assert.ok((await target.session()).user);
      });
      await t.test('fallo de auditoría revierte estado, revisión, versión y revocación', async () => {
        const before=(await db.query('SELECT is_active,version,maintenance_revision FROM sports_management.users WHERE id=$1',[users.underscore.id])).rows[0];
        const sessions=(await db.query('SELECT id,revoked_at FROM sports_management.sessions WHERE user_id=$1 ORDER BY id',[users.underscore.id])).rows;
        const trigger=`fail_maintenance_${randomBytes(5).toString('hex')}`;
        await db.query(`CREATE FUNCTION sports_management.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.table_name='users' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
        await db.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION sports_management.${trigger}()`);
        try { assert.equal((await patch(admin,users.underscore.id,body(2))).status,503); }
        finally { await db.query(`DROP TRIGGER ${trigger} ON sports_management.audit_logs`); await db.query(`DROP FUNCTION sports_management.${trigger}()`); }
        assert.deepEqual((await db.query('SELECT is_active,version,maintenance_revision FROM sports_management.users WHERE id=$1',[users.underscore.id])).rows[0],before);
        assert.deepEqual((await db.query('SELECT id,revoked_at FROM sports_management.sessions WHERE user_id=$1 ORDER BY id',[users.underscore.id])).rows,sessions);
      });
      await runAccountIdentifierChecks({ t, db, users, admin, second, scoped, target, baseUrl });
      await t.test('alternativa bloqueada o con cambio obligatorio exige decisión explícita', async () => {
        for (const field of ["locked_until=now()+interval '15 minutes'", 'must_change_password=true']) {
          await db.query(`UPDATE sports_management.users SET ${field} WHERE id=$1`,[users.concurrent.id]);
          try {
            const response=await patch(admin,users.operational.id,body(0));
            assert.equal(response.status,409);
            assert.equal((await response.json()).code,'LAST_OPERATIONAL_SUPERADMIN');
            assert.equal((await detail(users.operational.id)).revision,0);
          } finally { await db.query('UPDATE sports_management.users SET locked_until=NULL,must_change_password=false WHERE id=$1',[users.concurrent.id]); }
        }
      });
      await t.test('correo pendiente: transacciones, tokens, autorización y transporte sintético en base aislada', async () => {
        await runEmailChangeDatabaseSuite({databaseUrl,baseUrl,...(runtimeDatabaseUrl?{suite:'maintenance-preview',runtimeDatabaseUrl}:{suite:'maintenance'})}, users.operational.id, users.idle.id);
      });
      await t.test('dos bajas concurrentes no eliminan el último SUPERADMIN global efectivo', async () => {
        const responses=await Promise.all([patch(admin,users.operational.id,body(0)),patch(second,users.concurrent.id,body(0))]);
        assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
        const denied=responses.find(r=>r.status===409); assert.equal((await denied.json()).code,'LAST_EFFECTIVE_SUPERADMIN');
        assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.users WHERE id=ANY($1::uuid[]) AND is_active',[[users.operational.id,users.concurrent.id]])).rows[0].n,1);
      });
      await runAccountSelfIdentifierCheck({ t, db, users, admin, second, baseUrl });
    });
  } finally { await db.end(); await prisma.$disconnect(); }
}
