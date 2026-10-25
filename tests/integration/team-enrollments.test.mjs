import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import * as argon2 from 'argon2';
import { Browser } from './auth.test.mjs';

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
        VALUES ($1,$2,$3,'2026-01-01','2026-12-31') RETURNING id`, [leagueId, sport, randomUUID()])).rows[0].id;
      const rule = (await db.query('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES ($1,1) RETURNING id', [id])).rows[0].id;
      const categories = [];
      for (let index = 0; index < 2; index++) {
        const categoryId = (await db.query('INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES ($1,$2,$3) RETURNING id', [leagueId, sport, randomUUID()])).rows[0].id;
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
          assert.equal((await actor.browser.request('/api/team-enrollments/options')).status, 403);
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
        const listed = await actor.browser.request(`/api/team-enrollments?clubId=${clubId}&seasonId=${context.id}`);
        assert.equal(listed.status, 200);
        assert.ok((await listed.json()).items.every((item) => item.status === 'REGISTERED'));
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
