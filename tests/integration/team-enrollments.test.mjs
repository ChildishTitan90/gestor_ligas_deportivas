import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import * as argon2 from 'argon2';
import { tsImport } from 'tsx/esm/api';
import { readFileSync } from 'node:fs';
import { Browser } from './auth.test.mjs';
import { verifyEnrollmentOperationMigration } from './team-enrollment-migration.mjs';

/** HTTP real y PostgreSQL desechable. El primer recorrido solicita, aprueba
 * seleccionando una categoría e inscribe con servicios reales. Los demás
 * escenarios aislados conservan sus fixtures autorizados separados. */
export async function runTeamEnrollmentIntegrationSuite({ databaseUrl, baseUrl }) {
  const target = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const password = `Test-${randomBytes(20).toString('hex')}!aA`;
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const savedGrants = [];
  let roleId;
  try {
    await test('PDGLD-64: migración recupera claves legadas sin cambiar inscripciones, categorías ni auditoría',
      () => verifyEnrollmentOperationMigration(databaseUrl));
    const league = (await db.query('INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id', [`PD62-${randomUUID()}`])).rows[0].id;
    const foreignLeague = (await db.query('INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id', [`PD62-other-${randomUUID()}`])).rows[0].id;
    const sport = (await db.query("SELECT id FROM sports_management.sports WHERE code='SOCCER'")).rows[0].id;
    const club = async (leagueId = league) => (await db.query(`INSERT INTO sports_management.clubs(league_id,reference_number,name)
      VALUES ($1,$2,'Club sintético PD62') RETURNING id`, [leagueId, randomUUID()])).rows[0].id;
    const clubId = await club();
    const otherClub = await club();
    const foreignClub = await club(foreignLeague);
    async function user(role, scopeClub, restricted = false) {
      const person = (await db.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Sintético','PD62') RETURNING id")).rows[0].id;
      const email = `${randomUUID()}@example.test`;
      const id = (await db.query(`INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
        VALUES ($1,$2,$2,$3,$4) RETURNING id`, [person, email, hash, restricted])).rows[0].id;
      await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-64: fixtures sintéticos',false)", [id]);
      await db.query(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id)
        SELECT $1,id,$2,$3 FROM sports_management.roles WHERE code=$4`, [id, league, scopeClub ?? null, role]);
      const browser = new Browser(baseUrl);
      assert.equal((await browser.login(email, password)).searchParams.get('error'), null);
      return { id, browser };
    }
    const actor = await user('CLUB_DELEGATE', clubId);
    const peer = await user('CLUB_DELEGATE', clubId);
    const restricted = await user('CLUB_DELEGATE', clubId, true);
    const ordinary = await user('PLAYER');
    const secretary = await user('SECRETARY');
    roleId = (await db.query("SELECT id FROM sports_management.roles WHERE code='CLUB_DELEGATE'")).rows[0].id;
    await db.query("SELECT set_config('app.user_id',$1,false)", [actor.id]);
    for (const action of ['CREATE', 'READ']) {
      const permission = (await db.query(`INSERT INTO sports_management.permissions(module,action) VALUES ('clubs',$1)
        ON CONFLICT(module,action) DO UPDATE SET module=EXCLUDED.module RETURNING id`, [action])).rows[0].id;
      const prior = (await db.query('SELECT context_only FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [roleId, permission])).rows[0];
      savedGrants.push({ roleId, permission, prior, action });
      await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,true)
        ON CONFLICT(role_id,permission_id) DO UPDATE SET context_only=true`, [roleId, permission]);
    }
    const secretaryRoleId = (await db.query("SELECT id FROM sports_management.roles WHERE code='SECRETARY'")).rows[0].id;
    for (const action of ['READ', 'APPROVE']) {
      const permission = (await db.query(`INSERT INTO sports_management.permissions(module,action) VALUES ('clubs',$1)
        ON CONFLICT(module,action) DO UPDATE SET module=EXCLUDED.module RETURNING id`, [action])).rows[0].id;
      const prior = (await db.query('SELECT context_only FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [secretaryRoleId, permission])).rows[0];
      savedGrants.push({ roleId: secretaryRoleId, permission, prior, action });
      await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,false)
        ON CONFLICT(role_id,permission_id) DO UPDATE SET context_only=false`, [secretaryRoleId, permission]);
    }
    async function season(leagueId = league) {
      const id = (await db.query(`INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date)
        VALUES ($1,$2,$3,'2026-01-01','2026-12-31') RETURNING id`, [leagueId, sport, `Temporada sintética ${randomUUID().slice(0, 8)}`])).rows[0].id;
      const rule = (await db.query('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES ($1,1) RETURNING id', [id])).rows[0].id;
      const categories = [];
      for (let index = 0; index < 2; index++) {
        const categoryId = (await db.query('INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES ($1,$2,$3) RETURNING id', [leagueId, sport, `Categoría ${index + 1} ${randomUUID().slice(0, 8)}`])).rows[0].id;
        const sc = (await db.query(`INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date)
          VALUES ($1,$2,$3,$4,'OPEN','2026-01-01') RETURNING id`, [id, categoryId, rule, index + 1])).rows[0].id;
        const groups = [];
        for (const name of ['A', 'B']) groups.push((await db.query('INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES ($1,$2,$3) RETURNING id', [id, sc, name])).rows[0].id);
        categories.push({ id: categoryId, seasonCategoryId: sc, groups });
      }
      return { id, categories };
    }
    const context = await season();
    const elsewhere = await season(foreignLeague);
    const nextSeason = await season();
    const reviewContext = await season();
    const post = (browser, body, headers = {}) => browser.request('/api/team-enrollments', {
      method: 'POST', headers: { origin: baseUrl, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    const operationPath = (body) => `/api/team-enrollments/operations/${body.enrollmentKey}`;
    const recover = (browser, body, headers = {}) => browser.request(`${operationPath(body)}?clubId=${body.clubId}`, { headers });
    const cancel = (browser, body, headers = {}) => browser.request(`${operationPath(body)}/cancel`, {
      method: 'POST', headers: { origin: baseUrl, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    const payload = (ctx = context, extra = {}) => ({ enrollmentKey: randomUUID(), clubId, seasonId: ctx.id,
      categoryId: ctx.categories[0].id, groupId: ctx.categories[0].groups[0], team: { mode: 'new', name: 'Equipo sintético PD62' }, ...extra });
    const counts = async () => (await db.query(`SELECT
      (SELECT count(*)::int FROM sports_management.teams WHERE club_id=$1) teams,
      (SELECT count(*)::int FROM sports_management.season_teams WHERE club_id=$1) enrollments,
      (SELECT count(*)::int FROM sports_management.audit_logs WHERE table_name='season_teams' AND new_data->>'club_id'=$1::text) audits`, [clubId])).rows[0];
    async function deny(browser, body, status, code) {
      const before = await counts();
      const response = await post(browser, body);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { code });
      assert.match(response.headers.get('cache-control'), /private.*no-store/);
      assert.deepEqual(await counts(), before);
    }
    // Datos aprobados preparados solo en la base temporal. No hay aprobación
    // ficticia ni bypass en servicios, handlers o UI de producción.
    async function approvedFixture(ctx, scopeClub = clubId, authorizedCategoryIds = ctx.categories.map((category) => category.id)) {
      const affiliation = (await db.query(`INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,
        uniform_colors,status,requested_by,reviewed_by,reviewed_at)
        VALUES ($1,$2,$3,$4,'Azul','APPROVED',$5,$6,now()) RETURNING id`,
      [ctx.id, scopeClub, scopeClub === foreignClub ? foreignLeague : league, randomUUID(), actor.id, secretary.id])).rows[0].id;
      for (const category of ctx.categories) {
        const authorized = authorizedCategoryIds.includes(category.id);
        await db.query(`INSERT INTO sports_management.club_affiliation_categories
          (affiliation_id,season_id,category_id,authorized_by,authorized_at) VALUES ($1,$2,$3,$4,$5)`,
        [affiliation, ctx.id, category.id, authorized ? secretary.id : null, authorized ? new Date() : null]);
      }
      return affiliation;
    }
    await test('PDGLD-62/64: inscripción HTTP, permisos, integridad y reintentos', { timeout: 240_000 }, async (t) => {
      await t.test('solicitud, aprobación con selección e inscripción reales; no autoriza otras categorías ni activa equipos', async () => {
        const officers = {};
        for (const office of ['PRESIDENT', 'SECRETARY', 'TREASURER']) {
          const id = randomUUID();
          await db.query(`INSERT INTO sports_management.files(id,storage_key,original_name,mime_type,size_bytes,sha256,uploaded_by)
            VALUES ($1,$2,'firma-sintetica.png','image/png',100,$3,$4)`,
          [id, `affiliation-signatures/v1/${clubId}/${reviewContext.id}/${actor.id}/${office}/${id}`, 'a'.repeat(64), actor.id]);
          officers[office] = { firstName: 'Sintético', paternalSurname: 'PD64', maternalSurname: '', signatureFileId: id };
        }
        const response = await actor.browser.request('/api/affiliations', { method: 'POST',
          headers: { origin: baseUrl, 'content-type': 'application/json' }, body: JSON.stringify({
            submissionKey: randomUUID(), clubId, seasonId: reviewContext.id, clubName: 'Club sintético', uniformColors: 'Azul',
            categoryIds: reviewContext.categories.map((c) => c.id), officers }) });
        assert.equal(response.status, 201);
        const request = await response.json();
        assert.equal(request.status, 'PENDING');
        assert.deepEqual(await counts(), { teams: 0, enrollments: 0, audits: 0 });
        await deny(actor.browser, payload(reviewContext), 409, 'AFFILIATION_NOT_APPROVED');
        const options = await actor.browser.request(`/api/team-enrollments/options?clubId=${clubId}&seasonId=${reviewContext.id}`);
        assert.deepEqual((await options.json()).categories, []);
        // Registro legado sintético, preparado solo para comprobar que la
        // aprobación no cambia a ACTIVE equipos que ya estaban REGISTERED.
        const legacyTeam = (await db.query("INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES ($1,$2,'Equipo legado sintético') RETURNING id", [clubId, randomUUID()])).rows[0].id;
        const legacyEnrollment = (await db.query(`INSERT INTO sports_management.season_teams(team_id,club_id,season_id,group_id,status)
          VALUES ($1,$2,$3,$4,'REGISTERED') RETURNING id`, [legacyTeam, clubId, reviewContext.id, reviewContext.categories[0].groups[0]])).rows[0].id;
        const beforeApproval = await counts();
        const detailResponse = await secretary.browser.request(`/api/affiliations/${request.id}`);
        assert.equal(detailResponse.status, 200);
        const detail = await detailResponse.json();
        assert.equal(Number.isInteger(detail.version), true);
        assert.ok(detail.allowedActions.includes('APPROVE'));
        const approval = await secretary.browser.request(`/api/affiliations/${request.id}/review`, {
          method: 'PATCH', headers: { origin: baseUrl, 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'APPROVE', expectedVersion: detail.version,
            authorizedCategoryIds: [reviewContext.categories[0].id] }),
        });
        assert.equal(approval.status, 200);
        const approved = await approval.json();
        assert.equal(approved.status, 'APPROVED');
        assert.equal(approved.version, detail.version + 1);
        const saved = (await db.query('SELECT status,reviewed_by FROM sports_management.club_affiliations WHERE id=$1', [request.id])).rows[0];
        assert.deepEqual(saved, { status: 'APPROVED', reviewed_by: secretary.id });
        const events = (await db.query("SELECT user_id FROM sports_management.audit_logs WHERE table_name='club_affiliations' AND entity_id=$1 AND action='AFFILIATION_APPROVE'", [request.id])).rows;
        assert.deepEqual(events, [{ user_id: secretary.id }]);
        const categories = (await db.query('SELECT category_id,authorized_by,authorized_at FROM sports_management.club_affiliation_categories WHERE affiliation_id=$1', [request.id])).rows;
        assert.equal(categories.length, reviewContext.categories.length);
        const authorized = categories.find(c => c.category_id === reviewContext.categories[0].id);
        assert.equal(authorized.authorized_by, secretary.id);
        assert.ok(authorized.authorized_at);
        const unselected = categories.find(c => c.category_id === reviewContext.categories[1].id);
        assert.equal(unselected.authorized_by, null);
        assert.equal(unselected.authorized_at, null);
        await deny(actor.browser, payload(reviewContext, { categoryId: reviewContext.categories[1].id,
          groupId: reviewContext.categories[1].groups[0] }), 409, 'CATEGORY_NOT_AUTHORIZED');
        const approvedOptions = await actor.browser.request(`/api/team-enrollments/options?clubId=${clubId}&seasonId=${reviewContext.id}`);
        assert.deepEqual((await approvedOptions.json()).categories.map(c => c.id), [reviewContext.categories[0].id]);
        assert.deepEqual(await counts(), beforeApproval);
        assert.equal((await db.query('SELECT status FROM sports_management.season_teams WHERE id=$1', [legacyEnrollment])).rows[0].status, 'REGISTERED');
        const enrollment = payload(reviewContext);
        const enrolledResponse = await post(actor.browser, enrollment);
        assert.equal(enrolledResponse.status, 201);
        const enrolled = await enrolledResponse.json();
        assert.equal(enrolled.status, 'REGISTERED');
        assert.equal(enrolled.categoryId, reviewContext.categories[0].id);
        assert.deepEqual(await counts(), { teams: beforeApproval.teams + 1, enrollments: beforeApproval.enrollments + 1, audits: beforeApproval.audits + 1 });
        const replay = await post(actor.browser, enrollment);
        assert.equal(replay.status, 200);
        assert.deepEqual(await replay.json(), { ...enrolled, replayed: true });
      });
      // Otra temporada: fixture explícito para pruebas aisladas de inscripción.
      // Los siguientes casos aíslan inscripción, además del recorrido real anterior.
      await approvedFixture(context, clubId, [context.categories[0].id]);
      await t.test('sesión operativa y alcance: anónimo, cambio de contraseña, sin permiso y otros clubes', async () => {
        await deny(new Browser(baseUrl), payload(), 401, 'UNAUTHENTICATED');
        await deny(restricted.browser, payload(), 403, 'PASSWORD_CHANGE_REQUIRED');
        await deny(ordinary.browser, payload(), 403, 'FORBIDDEN');
        await deny(secretary.browser, payload(), 403, 'FORBIDDEN');
        for (const id of [otherClub, foreignClub]) await deny(actor.browser, payload(context, { clubId: id }), 403, 'FORBIDDEN');
        for (const path of ['/api/team-enrollments/options', `/api/team-enrollments?clubId=${clubId}`]) {
          assert.equal((await new Browser(baseUrl).request(path)).status, 401);
          assert.equal((await restricted.browser.request(path)).status, 403);
          assert.equal((await ordinary.browser.request(path)).status, 403);
        }
      });
      await t.test('rechaza autoridad, ACTIVE y modalidades simultáneas o incompletas', async () => {
        for (const extra of [{ status: 'ACTIVE' }, { enrolledBy: actor.id }, { leagueId: league }, { authorizedBy: actor.id },
          { team: { mode: 'new', name: 'Equipo', teamId: randomUUID() } }, { team: { mode: 'existing', teamId: randomUUID(), name: 'Equipo' } },
          { team: { mode: 'new', name: ' ' } }, { team: { mode: 'existing' } }, { categoryId: 'invalid' }])
          await deny(actor.browser, payload(context, extra), 400, 'VALIDATION_ERROR');
        for (const headers of [{ origin: '' }, { origin: 'https://foreign.example.test' }, { 'sec-fetch-site': 'cross-site' }])
          assert.equal((await post(actor.browser, payload(), headers)).status, 403);
        assert.equal((await post(actor.browser, payload(), { 'content-type': 'text/plain' })).status, 400);
        assert.equal((await post(actor.browser, { noise: 'x'.repeat(8200) })).status, 413);
        const invalid = await actor.browser.request('/api/team-enrollments', { method: 'POST',
          headers: { origin: baseUrl, 'content-type': 'application/json' }, body: '{' });
        assert.equal(invalid.status, 400);
      });
      await t.test('rechaza combinaciones inválidas y categoría solicitada sin autorización', async () => {
        for (const extra of [{ seasonId: elsewhere.id }, { seasonId: randomUUID() }, { groupId: elsewhere.categories[0].groups[0] },
          { categoryId: elsewhere.categories[0].id }, { groupId: context.categories[1].groups[0] }, { groupId: randomUUID() }])
          await deny(actor.browser, payload(context, extra), 400, 'INVALID_CONTEXT');
        await deny(actor.browser, payload(context, { categoryId: context.categories[1].id, groupId: context.categories[1].groups[0] }), 409, 'CATEGORY_NOT_AUTHORIZED');
        await deny(actor.browser, payload(context, { team: { mode: 'existing', teamId: randomUUID() } }), 400, 'INVALID_CONTEXT');
        const foreignTeam = (await db.query("INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES ($1,$2,'Ajeno') RETURNING id", [otherClub, randomUUID()])).rows[0].id;
        await deny(actor.browser, payload(context, { team: { mode: 'existing', teamId: foreignTeam } }), 400, 'INVALID_CONTEXT');
      });
      let first;
      const body = payload();
      await t.test('crea equipo e inscripción REGISTERED con un evento mínimo e inmutable', async () => {
        const before = await counts();
        const response = await post(actor.browser, body);
        assert.equal(response.status, 201);
        first = await response.json();
        assert.equal(first.status, 'REGISTERED');
        assert.equal(first.replayed, false);
        assert.deepEqual(Object.keys(first).sort(), ['categoryId', 'clubId', 'groupId', 'id', 'replayed', 'seasonId', 'status', 'teamId']);
        assert.deepEqual(await counts(), { teams: before.teams + 1, enrollments: before.enrollments + 1, audits: before.audits + 1 });
        const saved = (await db.query('SELECT * FROM sports_management.season_teams WHERE id=$1', [first.id])).rows[0];
        assert.equal(saved.enrolled_by, actor.id);
        assert.ok(saved.enrolled_at);
        const events = (await db.query("SELECT * FROM sports_management.audit_logs WHERE table_name='season_teams' AND entity_id=$1", [first.id])).rows;
        assert.equal(events.length, 1);
        assert.equal(events[0].user_id, actor.id);
        assert.equal(events[0].new_data.status, 'REGISTERED');
        for (const forbidden of [body.team.name, body.enrollmentKey, 'enrollment_hash', 'password', 'signature'])
          assert.equal(JSON.stringify(events).includes(forbidden), false);
        await assert.rejects(db.query('UPDATE sports_management.audit_logs SET reason=reason WHERE id=$1', [events[0].id]), { code: 'P0001' });
      });
      await t.test('reintentos normalizados recuperan el mismo equipo sin otra auditoría', async () => {
        const before = await counts();
        const response = await post(actor.browser, { ...body, clubId: clubId.toUpperCase(), team: { mode: 'new', name: ` ${body.team.name} ` } });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ...first, replayed: true });
        assert.deepEqual(await counts(), before);
        await deny(actor.browser, { ...body, team: { mode: 'new', name: 'Otro nombre' } }, 409, 'IDEMPOTENCY_CONFLICT');
        await deny(actor.browser, { ...body, groupId: context.categories[0].groups[1] }, 409, 'IDEMPOTENCY_CONFLICT');
      });
      await t.test('respuesta perdida: GET recupera el resultado sin inscribir y una nueva sesión conserva la clave', async () => {
        const fresh = payload();
        const before = await counts();
        const initial = await recover(actor.browser, fresh);
        assert.equal(initial.status, 200);
        assert.deepEqual(await initial.json(), { enrollmentKey: fresh.enrollmentKey, clubId, outcome: 'UNRESOLVED', enrollment: null });
        assert.deepEqual(await counts(), before);
        // El servidor confirma; el cliente pierde deliberadamente el acuse.
        assert.equal((await post(actor.browser, fresh)).status, 201);
        const reloaded = new Browser(baseUrl);
        reloaded.cookies = new Map(actor.browser.cookies);
        const confirmed = await recover(reloaded, fresh);
        assert.equal(confirmed.status, 200);
        assert.match(confirmed.headers.get('cache-control'), /private.*no-store/);
        const receipt = await confirmed.json();
        assert.equal(receipt.outcome, 'CONFIRMED');
        const replay = await post(reloaded, fresh);
        assert.equal(replay.status, 200);
        assert.deepEqual(await replay.json(), receipt.enrollment);
        const after = await counts();
        assert.deepEqual(after, { teams: before.teams + 1, enrollments: before.enrollments + 1, audits: before.audits + 1 });
        const cancellation = await cancel(reloaded, fresh);
        assert.equal(cancellation.status, 200);
        assert.equal((await cancellation.json()).outcome, 'CONFIRMED');
        assert.deepEqual(await counts(), after);
        assert.equal((await recover(peer.browser, fresh)).status, 200);
        assert.equal((await (await recover(peer.browser, fresh)).json()).outcome, 'UNRESOLVED');
      });
      await t.test('adaptador del cliente con HTTP real: pérdida de respuesta y reinicio conservan la misma operación', async () => {
        const { createEnrollmentRecovery } = await tsImport('../../src/features/clubs/team-enrollment-recovery.client.ts', import.meta.url);
        const values = new Map();
        const storage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
          getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
        const fresh = payload();
        const before = await counts();
        const lost = createEnrollmentRecovery(actor.id, storage, async (url, init) => {
          const response = await actor.browser.request(url, { ...init, headers: { ...init.headers, origin: baseUrl } });
          assert.equal(response.status, 201);
          throw new TypeError('Acuse perdido deliberadamente');
        });
        assert.equal((await lost.retry(fresh)).outcome, 'UNRESOLVED');
        assert.equal(values.size, 1);
        const requests = [];
        const resumed = createEnrollmentRecovery(actor.id, storage, async (url, init) => {
          requests.push(init.method);
          return actor.browser.request(url, init);
        });
        const [pending] = resumed.pending(clubId);
        assert.equal(pending.enrollmentKey, fresh.enrollmentKey);
        assert.equal((await resumed.check(pending)).outcome, 'CONFIRMED');
        assert.deepEqual(requests, ['GET']);
        assert.equal(values.size, 0);
        assert.deepEqual(await counts(), { teams: before.teams + 1, enrollments: before.enrollments + 1, audits: before.audits + 1 });
      });
      await t.test('cancelación persistente: impide solicitudes tardías, es idempotente y no duplica auditoría', async () => {
        const fresh = payload();
        const before = await counts();
        const cancelled = await cancel(actor.browser, fresh);
        assert.equal(cancelled.status, 200);
        assert.deepEqual(await cancelled.json(), { enrollmentKey: fresh.enrollmentKey, clubId, outcome: 'CANCELLED', enrollment: null });
        assert.equal((await cancel(actor.browser, fresh)).status, 200);
        await deny(actor.browser, fresh, 409, 'OPERATION_CANCELLED');
        await deny(actor.browser, { ...fresh, team: { mode: 'new', name: 'Cambio posterior' } }, 409, 'IDEMPOTENCY_CONFLICT');
        assert.equal((await cancel(actor.browser, { ...fresh, groupId: context.categories[0].groups[1] })).status, 409);
        assert.deepEqual(await counts(), before);
        const operation = (await db.query('SELECT id FROM sports_management.team_enrollment_operations WHERE actor_id=$1 AND enrollment_key=$2', [actor.id, fresh.enrollmentKey])).rows[0];
        const audit = (await db.query("SELECT * FROM sports_management.audit_logs WHERE table_name='team_enrollment_operations' AND entity_id=$1", [operation.id])).rows;
        assert.equal(audit.length, 1);
        assert.equal(audit[0].action, 'TEAM_ENROLLMENT_CANCEL');
        assert.equal(JSON.stringify(audit).includes(fresh.enrollmentKey), false);
        assert.equal(JSON.stringify(audit).includes(fresh.team.name), false);
        await assert.rejects(db.query('DELETE FROM sports_management.team_enrollment_operations WHERE id=$1', [operation.id]), { code: 'P0001' });
        await assert.rejects(db.query("UPDATE sports_management.team_enrollment_operations SET outcome='CANCELLED' WHERE id=$1", [operation.id]), { code: 'P0001' });
      });
      await t.test('cancelación y envío concurrentes tienen un único resultado definitivo', async () => {
        for (let index = 0; index < 3; index++) {
          const fresh = payload();
          const before = await counts();
          const [sent, stopped] = await Promise.all([post(actor.browser, fresh), cancel(actor.browser, fresh)]);
          assert.equal(stopped.status, 200);
          const outcome = (await stopped.json()).outcome;
          assert.equal(sent.status, outcome === 'CONFIRMED' ? 201 : 409);
          assert.equal((await (await recover(actor.browser, fresh)).json()).outcome, outcome);
          assert.equal((await post(actor.browser, fresh)).status, outcome === 'CONFIRMED' ? 200 : 409);
          const delta = outcome === 'CONFIRMED' ? 1 : 0;
          assert.deepEqual(await counts(), { teams: before.teams + delta, enrollments: before.enrollments + delta, audits: before.audits + delta });
        }
      });
      await t.test('una clave antigua sin cuerpo se recupera o cancela; contexto obsoleto no impide detener la intención propia', async () => {
        const fresh = payload();
        const reference = { clubId, enrollmentKey: fresh.enrollmentKey };
        const before = await counts();
        assert.equal((await cancel(actor.browser, reference)).status, 200);
        assert.equal((await (await recover(actor.browser, reference)).json()).outcome, 'CANCELLED');
        await deny(actor.browser, fresh, 409, 'OPERATION_CANCELLED');
        await deny(actor.browser, { ...fresh, team: { mode: 'new', name: 'Otra captura' } }, 409, 'OPERATION_CANCELLED');
        assert.deepEqual(await counts(), before);
        const stale = payload(context, { seasonId: randomUUID() });
        assert.equal((await cancel(actor.browser, stale)).status, 200);
        await deny(actor.browser, stale, 409, 'OPERATION_CANCELLED');
        const existing = await cancel(actor.browser, { clubId, enrollmentKey: body.enrollmentKey });
        assert.equal(existing.status, 200);
        assert.equal((await existing.json()).outcome, 'CONFIRMED');
        assert.deepEqual(await counts(), before);
      });
      await t.test('la precondición de identidad impide enviar o cancelar una intención tras cambiar de cuenta', async () => {
        const fresh = payload();
        const before = await counts();
        const headers = { 'x-expected-actor-id': peer.id };
        assert.equal((await post(actor.browser, fresh, headers)).status, 403);
        assert.equal((await cancel(actor.browser, fresh, headers)).status, 403);
        assert.equal((await recover(actor.browser, fresh, headers)).status, 403);
        assert.deepEqual(await counts(), before);
        assert.equal((await (await recover(actor.browser, fresh, { 'x-expected-actor-id': actor.id })).json()).outcome, 'UNRESOLVED');
        assert.equal((await db.query('SELECT count(*)::int n FROM sports_management.team_enrollment_operations WHERE enrollment_key=$1', [fresh.enrollmentKey])).rows[0].n, 0);
      });
      await t.test('recuperación y cancelación exigen sesión, alcance y contrato; nunca revelan operaciones ajenas', async () => {
        const fresh = payload();
        assert.equal((await recover(new Browser(baseUrl), fresh)).status, 401);
        assert.equal((await cancel(new Browser(baseUrl), fresh)).status, 401);
        for (const browser of [restricted.browser, ordinary.browser]) {
          assert.equal((await recover(browser, fresh)).status, 403);
          assert.equal((await cancel(browser, fresh)).status, 403);
        }
        assert.equal((await recover(actor.browser, { ...fresh, clubId: otherClub })).status, 403);
        assert.equal((await cancel(actor.browser, { ...fresh, clubId: otherClub })).status, 403);
        assert.equal((await actor.browser.request(`${operationPath(fresh)}?clubId=${clubId}&enrollmentKey=${body.enrollmentKey}`)).status, 400);
        assert.equal((await actor.browser.request(`${operationPath(fresh)}?clubId=${clubId}&clubId=${clubId}`)).status, 400);
        assert.equal((await actor.browser.request(`${operationPath(fresh)}/cancel`, { method: 'POST', headers: {
          origin: 'https://other.example.test', 'content-type': 'application/json' }, body: JSON.stringify(fresh) })).status, 403);
        assert.equal((await actor.browser.request(`${operationPath(fresh)}/cancel`, { method: 'POST', headers: {
          origin: baseUrl, 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, 400);
      });
      await t.test('varios equipos del mismo club, sin activar ni sobrescribir inscripciones', async () => {
        const response = await post(actor.browser, payload());
        assert.equal(response.status, 201);
        const second = await response.json();
        assert.notEqual(second.teamId, first.teamId);
        assert.equal(second.status, 'REGISTERED');
        assert.equal((await db.query('SELECT status FROM sports_management.season_teams WHERE id=$1', [first.id])).rows[0].status, 'REGISTERED');
      });
      await t.test('un equipo no se reinscribe en la misma temporada ni cambiando de grupo', async () => {
        for (const groupId of context.categories[0].groups) await deny(actor.browser,
          payload(context, { team: { mode: 'existing', teamId: first.teamId }, groupId }), 409, 'TEAM_ALREADY_ENROLLED');
        await assert.rejects(db.query(`INSERT INTO sports_management.season_teams(team_id,club_id,season_id,group_id)
          VALUES ($1,$2,$3,$4)`, [first.teamId, clubId, context.id, context.categories[0].groups[1]]), { code: '23505' });
      });
      await t.test('reutiliza teams.id en otra temporada y conserva el registro histórico', async () => {
        await approvedFixture(nextSeason);
        const response = await post(actor.browser, payload(nextSeason, { team: { mode: 'existing', teamId: first.teamId } }));
        assert.equal(response.status, 201);
        const next = await response.json();
        assert.equal(next.teamId, first.teamId);
        assert.notEqual(next.id, first.id);
        assert.equal((await db.query('SELECT count(*)::int n FROM sports_management.season_teams WHERE team_id=$1', [first.teamId])).rows[0].n, 2);
        const original = (await db.query('SELECT season_id,group_id,status FROM sports_management.season_teams WHERE id=$1', [first.id])).rows[0];
        assert.deepEqual(original, { season_id: context.id, group_id: body.groupId, status: 'REGISTERED' });
      });
      await t.test('concurrencia: clave estable crea un equipo y claves diferentes no reinscriben', async () => {
        const fresh = payload();
        const before = await counts();
        const replies = await Promise.all(Array.from({ length: 4 }, () => post(actor.browser, fresh)));
        assert.deepEqual(replies.map((r) => r.status).sort(), [200, 200, 200, 201]);
        const results = await Promise.all(replies.map((r) => r.json()));
        assert.equal(new Set(results.map((r) => r.id)).size, 1);
        assert.equal(new Set(results.map((r) => r.teamId)).size, 1);
        assert.deepEqual(await counts(), { teams: before.teams + 1, enrollments: before.enrollments + 1, audits: before.audits + 1 });
        const teamId = (await db.query("INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES ($1,$2,'Concurrente') RETURNING id", [clubId, randomUUID()])).rows[0].id;
        const races = await Promise.all(context.categories[0].groups.map((groupId) => post(actor.browser, payload(context, { groupId, team: { mode: 'existing', teamId } }))));
        assert.deepEqual(races.map((r) => r.status).sort(), [201, 409]);
        assert.deepEqual(await races.find((r) => r.status === 409).json(), { code: 'TEAM_ALREADY_ENROLLED' });
      });
      await t.test('opciones autorizadas, listado con historial, paginación y respuestas privadas', async () => {
        const base = await actor.browser.request('/api/team-enrollments/options');
        assert.match(base.headers.get('cache-control'), /private.*no-store/);
        assert.deepEqual((await base.json()).clubs.map((c) => c.id), [clubId]);
        const options = await (await actor.browser.request(`/api/team-enrollments/options?clubId=${clubId}&seasonId=${context.id}`)).json();
        assert.equal(options.categories.length, 1);
        assert.deepEqual(options.capabilities, { clubId, canEnroll: true, canCreateTeam: true });
        assert.equal(options.categories[0].id, context.categories[0].id);
        assert.equal(options.groups.length, 2);
        assert.ok(options.teams.find((team) => team.id === first.teamId).enrolledSeasonIds.includes(nextSeason.id));
        for (const path of [`/api/team-enrollments/options?clubId=${otherClub}`, `/api/team-enrollments?clubId=${otherClub}`])
          assert.equal((await actor.browser.request(path)).status, 403);
        assert.equal((await actor.browser.request(`/api/team-enrollments/options?clubId=${clubId}&seasonId=${elsewhere.id}`)).status, 400);
        for (const suffix of ['?status=ACTIVE', `?clubId=${clubId}&clubId=${clubId}`, `?clubId=${clubId}&limit=101`])
          assert.equal((await actor.browser.request(`/api/team-enrollments${suffix}`)).status, 400);
        const listed = await actor.browser.request(`/api/team-enrollments?clubId=${clubId}&limit=1`);
        assert.match(listed.headers.get('cache-control'), /private.*no-store/);
        const page = await listed.json();
        assert.equal(page.items.length, 1);
        assert.ok(page.nextAfter);
        const next = await (await actor.browser.request(`/api/team-enrollments?clubId=${clubId}&limit=1&after=${page.nextAfter}`)).json();
        assert.notEqual(next.items[0].id, page.items[0].id);
        for (const field of ['enrollment_hash', 'enrollmentKey', 'enrolled_by', 'password_hash']) assert.equal(JSON.stringify(page).includes(field), false);
      });
      await t.test('revocaciones, asignaciones vencidas/futuras y club inactivo afectan a la misma sesión', async () => {
        const permission = savedGrants.find((g) => g.action === 'CREATE').permission;
        await db.query('DELETE FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [roleId, permission]);
        try {
          await deny(actor.browser, body, 403, 'FORBIDDEN');
          const options = await actor.browser.request(`/api/team-enrollments/options?clubId=${clubId}`);
          assert.equal(options.status, 200);
          assert.deepEqual((await options.json()).capabilities, { clubId, canEnroll: false, canCreateTeam: false });
          const catalog = await actor.browser.request(`/api/team-enrollments/catalogs?clubId=${clubId}`);
          assert.equal(catalog.status, 200);
          assert.ok((await catalog.json()).seasons.length);
          assert.equal((await actor.browser.request(`/api/team-enrollments?clubId=${clubId}`)).status, 200);
          // READ puede recuperar un resultado propio aunque CREATE se haya retirado.
          assert.equal((await (await recover(actor.browser, body)).json()).outcome, 'CONFIRMED');
          assert.equal((await (await cancel(actor.browser, payload())).json()).outcome, 'CANCELLED');
        } finally { await db.query('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,true)', [roleId, permission]); }
        const readPermission = savedGrants.find((g) => g.action === 'READ').permission;
        await db.query('DELETE FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [roleId, readPermission]);
        try {
          assert.equal((await actor.browser.request('/api/team-enrollments/options')).status, 403);
          assert.equal((await actor.browser.request(`/api/team-enrollments?clubId=${clubId}`)).status, 403);
        } finally { await db.query('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,true)', [roleId, readPermission]); }
        for (const future of [true, false]) {
          await db.query('UPDATE sports_management.user_roles SET starts_at=$1,ends_at=$2 WHERE user_id=$3',
            [new Date(Date.now() + (future ? 60_000 : -120_000)), future ? null : new Date(Date.now() - 60_000), actor.id]);
          try { await deny(actor.browser, body, 403, 'FORBIDDEN'); }
          finally { await db.query("UPDATE sports_management.user_roles SET starts_at=now()-interval '1 minute',ends_at=NULL WHERE user_id=$1", [actor.id]); }
        }
        await db.query("UPDATE sports_management.clubs SET status='SUSPENDED' WHERE id=$1", [clubId]);
        try { await deny(actor.browser, body, 403, 'FORBIDDEN'); }
        finally { await db.query("UPDATE sports_management.clubs SET status='ACTIVE' WHERE id=$1", [clubId]); }
      });
      await t.test('no mezcla CREATE de Secretaría ni de otro club con una asignación de delegado sin CREATE', async () => {
        const permission = savedGrants.find(g => g.roleId === roleId && g.action === 'CREATE').permission;
        await db.query('DELETE FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [roleId, permission]);
        const extra = (await db.query(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id)
          VALUES ($1,$2,$3,$4) RETURNING id`, [actor.id, secretaryRoleId, league, otherClub])).rows[0].id;
        try {
          const response = await actor.browser.request(`/api/team-enrollments/options?clubId=${clubId}`);
          assert.equal(response.status, 200);
          assert.equal((await response.json()).capabilities.canCreateTeam, false);
          await deny(actor.browser, payload(), 403, 'FORBIDDEN');
          // Ni siquiera CREATE del mismo club, pero de otro rol, sustituye la concesión del delegado.
          await db.query('UPDATE sports_management.user_roles SET club_id=$1 WHERE id=$2', [clubId, extra]);
          assert.equal((await (await actor.browser.request(`/api/team-enrollments/options?clubId=${clubId}`)).json()).capabilities.canCreateTeam, false);
          await deny(actor.browser, payload(), 403, 'FORBIDDEN');
        } finally {
          await db.query('DELETE FROM sports_management.user_roles WHERE id=$1', [extra]);
          await db.query('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,true)', [roleId, permission]);
        }
      });
      await t.test('fallo de auditoría revierte el equipo nuevo y la inscripción; permite reintentar', async () => {
        const fresh = payload();
        await db.query(`CREATE FUNCTION sports_management.pdgld64_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.table_name='season_teams' THEN RAISE EXCEPTION 'Fallo sintético PD64'; END IF; RETURN NEW; END $$`);
        await db.query('CREATE TRIGGER pdgld64_test_failure BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION sports_management.pdgld64_test_failure()');
        try { await deny(actor.browser, fresh, 503, 'SERVICE_UNAVAILABLE'); }
        finally {
          await db.query('DROP TRIGGER pdgld64_test_failure ON sports_management.audit_logs');
          await db.query('DROP FUNCTION sports_management.pdgld64_test_failure()');
        }
        assert.equal((await post(actor.browser, fresh)).status, 201);
      });
      await t.test('otra categoría autorizada tampoco permite segunda inscripción anual del equipo', async () => {
        await db.query('UPDATE sports_management.club_affiliation_categories SET authorized_by=$1,authorized_at=now() WHERE season_id=$2 AND category_id=$3',
          [secretary.id, context.id, context.categories[1].id]);
        await deny(actor.browser, payload(context, { team: { mode: 'existing', teamId: first.teamId },
          categoryId: context.categories[1].id, groupId: context.categories[1].groups[0] }), 409, 'TEAM_ALREADY_ENROLLED');
      });
      await t.test('restricciones compuestas PostgreSQL y metadatos incompletos no admiten combinaciones ajenas', async () => {
        const teamId = (await db.query("INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES ($1,$2,'FK') RETURNING id", [clubId, randomUUID()])).rows[0].id;
        await approvedFixture(elsewhere, foreignClub);
        await assert.rejects(db.query(`INSERT INTO sports_management.season_teams(team_id,club_id,season_id,group_id)
          VALUES ($1,$2,$3,$4)`, [teamId, foreignClub, elsewhere.id, elsewhere.categories[0].groups[0]]), { code: '23503' });
        await assert.rejects(db.query(`INSERT INTO sports_management.season_teams(team_id,club_id,season_id,group_id)
          VALUES ($1,$2,$3,$4)`, [teamId, clubId, context.id, elsewhere.categories[0].groups[0]]), { code: '23503' });
        await assert.rejects(db.query(`UPDATE sports_management.club_affiliation_categories SET authorized_at=NULL
          WHERE season_id=$1 AND category_id=$2`, [context.id, context.categories[0].id]), { code: '23514' });
      });
      await t.test('temporada cerrada bloquea nuevas altas; reintento confirmado y lectura conservan historial', async () => {
        await db.query("UPDATE sports_management.seasons SET status='CLOSED' WHERE id=$1", [context.id]);
        await deny(actor.browser, payload(), 409, 'SEASON_CLOSED');
        const before = await counts();
        const replay = await post(actor.browser, body);
        assert.equal(replay.status, 200);
        assert.deepEqual(await replay.json(), { ...first, replayed: true });
        assert.deepEqual(await counts(), before);
        const options = await (await actor.browser.request(`/api/team-enrollments/options?clubId=${clubId}&seasonId=${context.id}`)).json();
        assert.deepEqual(options.categories, []);
        assert.equal(options.seasons.length, 0);
        const historical = await actor.browser.request(`/api/team-enrollments/catalogs?clubId=${clubId}&seasonId=${context.id}`);
        assert.equal(historical.status, 200);
        const catalogs = await historical.json();
        assert.deepEqual(catalogs.seasons.map(s => s.id), [context.id]);
        assert.equal(catalogs.seasons[0].status, 'CLOSED');
        const listed = await actor.browser.request(`/api/team-enrollments?clubId=${clubId}&seasonId=${context.id}`);
        assert.equal(listed.status, 200);
        const rows = (await listed.json()).items;
        assert.ok(rows.every((item) => item.status === 'REGISTERED'));
        assert.ok(rows.every((item) => item.seasonName === catalogs.seasons[0].name && item.teamName && item.categoryName && item.groupName));
      });
      await t.test('catálogos READ incluyen temporadas cerradas y sin afiliación; filtros paginados sin CREATE', async () => {
        const permission = savedGrants.find(g => g.roleId === roleId && g.action === 'CREATE').permission;
        await db.query('DELETE FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [roleId, permission]);
        const noAffiliation = await season();
        try {
          const seen = [];
          let after = '';
          do {
            const response = await actor.browser.request(`/api/team-enrollments/catalogs?clubId=${clubId}&limit=1${after ? `&seasonAfter=${after}` : ''}`);
            assert.equal(response.status, 200);
            const page = await response.json();
            assert.equal(page.capabilities.canEnroll, false);
            assert.equal(page.capabilities.canCreateTeam, false);
            seen.push(...page.seasons);
            after = page.nextSeasonAfter;
          } while (after);
          assert.equal(new Set(seen.map(s => s.id)).size, seen.length);
          assert.ok(seen.some(s => s.id === context.id && s.status === 'CLOSED'));
          assert.ok(seen.some(s => s.id === noAffiliation.id));
          assert.equal(seen.some(s => s.id === elsewhere.id), false);
          assert.equal((await actor.browser.request(`/api/team-enrollments/catalogs?clubId=${otherClub}`)).status, 403);
          assert.equal((await actor.browser.request(`/api/team-enrollments/catalogs?clubId=${clubId}&limit=101`)).status, 400);
          assert.equal((await actor.browser.request(`/api/team-enrollments?clubId=${clubId}&seasonId=${context.id}`)).status, 200);
        } finally {
          await db.query('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,true)', [roleId, permission]);
        }
      });
      await t.test('seguridad de operaciones: Docker sin RLS, Supabase simulado con RLS y API sin ACL', async () => {
        const sql = readFileSync(new URL('../../prisma/migrations/20261026010000_pdgld64_enrollment_operations/migration.sql', import.meta.url), 'utf8');
        const targetGuard = sql.match(/DO \$target\$[\s\S]*?\$target\$;/)[0];
        const security = sql.match(/DO \$security\$[\s\S]*?\$security\$;/)[0];
        const rls = async () => (await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='sports_management.team_enrollment_operations'::regclass")).rows[0].relrowsecurity;
        assert.equal(await rls(), false);
        await db.query('BEGIN');
        try {
          await db.query('CREATE SCHEMA auth');
          await db.query('SAVEPOINT partial_markers');
          await assert.rejects(db.query(targetGuard), /Marcadores parciales/);
          await db.query('ROLLBACK TO SAVEPOINT partial_markers');
          await db.query('CREATE SCHEMA storage; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
          await db.query('GRANT USAGE ON SCHEMA sports_management TO anon,authenticated,service_role');
          await db.query('GRANT SELECT,INSERT ON sports_management.team_enrollment_operations TO anon,authenticated,service_role');
          await db.query(targetGuard);
          await db.query(security);
          assert.equal(await rls(), true);
          for (const role of ['anon', 'authenticated', 'service_role']) {
            assert.equal((await db.query("SELECT has_table_privilege($1, 'sports_management.team_enrollment_operations','SELECT,INSERT,UPDATE,DELETE') allowed", [role])).rows[0].allowed, false);
            await db.query('SAVEPOINT denied_api');
            await db.query(`SET LOCAL ROLE ${role}`);
            await assert.rejects(db.query('SELECT * FROM sports_management.team_enrollment_operations'), { code: '42501' });
            await db.query('ROLLBACK TO SAVEPOINT denied_api');
          }
        } finally { await db.query('ROLLBACK'); }
        assert.equal(await rls(), false);
      });
      await t.test('READ global pagina clubes y resuelve la selección aunque esté fuera de la primera página', async () => {
        await db.query('UPDATE sports_management.user_roles SET league_id=NULL WHERE user_id=$1', [secretary.id]);
        try {
          const firstPage = await (await secretary.browser.request('/api/team-enrollments/catalogs?limit=1')).json();
          assert.equal(firstPage.clubs.length, 1);
          assert.ok(firstPage.nextClubAfter);
          const selectedClub = [clubId, otherClub, foreignClub].find(id => id !== firstPage.clubs[0].id);
          const selected = await secretary.browser.request(`/api/team-enrollments/catalogs?clubId=${selectedClub}&limit=1`);
          assert.equal(selected.status, 200);
          const options = await selected.json();
          assert.equal(options.clubs[0].id, firstPage.clubs[0].id);
          assert.equal(options.capabilities.clubId, selectedClub);
          assert.equal(options.capabilities.canCreateTeam, false);
          assert.ok(options.seasons.length);
          const secondPage = await (await secretary.browser.request(`/api/team-enrollments/catalogs?limit=1&clubAfter=${firstPage.nextClubAfter}`)).json();
          assert.notEqual(secondPage.clubs[0].id, firstPage.clubs[0].id);
        } finally { await db.query('UPDATE sports_management.user_roles SET league_id=$1 WHERE user_id=$2', [league, secretary.id]); }
      });
    });
  } finally {
    // Restaurar los permisos del runner; el historial queda hasta eliminar la BD.
    for (const { roleId: grantRoleId, permission, prior } of savedGrants) {
      if (prior) await db.query('UPDATE sports_management.role_permissions SET context_only=$1 WHERE role_id=$2 AND permission_id=$3', [prior.context_only, grantRoleId, permission]);
      else await db.query('DELETE FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [grantRoleId, permission]);
    }
    await db.end();
  }
}
