import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import * as argon2 from 'argon2';
import { Browser } from './auth.test.mjs';
import { tsImport } from 'tsx/esm/api';

/** Solo la base desechable creada por scripts/test-auth.mjs, nunca .env/Supabase. */
export async function runAffiliationIntegrationSuite({ databaseUrl, baseUrl }) {
  const target = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const password = `Test-${randomBytes(20).toString('hex')}!aA`;
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const prefix = `PD57-${randomUUID()}`;
  let grantExisted;
  let permissionId;
  let delegateRoleId;
  const reviewGrants = [];
  try {
    const league = (await db.query('INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id', [prefix])).rows[0].id;
    const otherLeague = (await db.query('INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id', [`${prefix}-other`])).rows[0].id;
    const sport = (await db.query("SELECT id FROM sports_management.sports WHERE code='SOCCER'")).rows[0].id;
    delegateRoleId = (await db.query("SELECT id FROM sports_management.roles WHERE code='CLUB_DELEGATE'")).rows[0].id;
    permissionId = (await db.query("INSERT INTO sports_management.permissions(module,action) VALUES ('clubs','CREATE') ON CONFLICT(module,action) DO UPDATE SET module=EXCLUDED.module RETURNING id")).rows[0].id;
    grantExisted = (await db.query('SELECT context_only FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [delegateRoleId, permissionId])).rows[0];

    async function fixture(role = 'CLUB_DELEGATE', restricted = false, scopeClub) {
      const person = (await db.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Sintético','PD57') RETURNING id")).rows[0].id;
      const email = `${randomUUID()}@example.test`;
      const user = (await db.query(`INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
        VALUES ($1,$2,$2,$3,$4) RETURNING id`, [person, email, passwordHash, restricted])).rows[0].id;
      await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-57: fixtures sintéticos',false)", [user]);
      await db.query(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id)
        SELECT $1,id,$2,$3 FROM sports_management.roles WHERE code=$4`, [user, league, scopeClub ?? null, role]);
      const browser = new Browser(baseUrl);
      assert.equal((await browser.login(email, password)).searchParams.get('error'), null);
      return { id: user, browser };
    }
    async function createClub(label = randomUUID(), leagueId = league) {
      return (await db.query('INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES ($1,$2,$3) RETURNING id',
        [leagueId, `${prefix}-${label}`, 'Nombre original sintético'])).rows[0].id;
    }
    const clubId = await createClub('own');
    const sameLeagueClub = await createClub('other');
    const outsideClub = await createClub('outside', otherLeague);
    const actor = await fixture('CLUB_DELEGATE', false, clubId);
    await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,true)
      ON CONFLICT(role_id,permission_id) DO UPDATE SET context_only=true`, [delegateRoleId, permissionId]);
    const restricted = await fixture('CLUB_DELEGATE', true, clubId);
    const secretary = await fixture('SECRETARY');
    const ordinary = await fixture('PLAYER');
    const foreignOwner = await fixture('CLUB_DELEGATE', false, sameLeagueClub);
    const files = [];
    for (let i = 0; i < 3; i++) {
      files.push((await db.query(`INSERT INTO sports_management.files(storage_key,original_name,mime_type,size_bytes,sha256,uploaded_by)
        VALUES ($1,'firma-sintetica.png','image/png',100,$2,$3) RETURNING id`,
      [`private/fixtures/${prefix}/${i}`, 'a'.repeat(64), actor.id])).rows[0].id);
    }
    async function season(leagueId = league) {
      const id = (await db.query(`INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date)
        VALUES ($1,$2,$3,'2026-01-01','2026-12-31') RETURNING id`, [leagueId, sport, randomUUID()])).rows[0].id;
      const rule = (await db.query('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES ($1,1) RETURNING id', [id])).rows[0].id;
      const categories = [];
      for (let i = 0; i < 2; i++) {
        const category = (await db.query('INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES ($1,$2,$3) RETURNING id',
          [leagueId, sport, randomUUID()])).rows[0].id;
        await db.query(`INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date)
          VALUES ($1,$2,$3,$4,'OPEN','2026-01-01')`, [id, category, rule, i + 1]);
        categories.push(category);
      }
      return { id, categories };
    }
    function payload(context, extra = {}) {
      const officer = (i) => ({ firstName: `Directivo sintético ${i}`, paternalSurname: 'PD57', maternalSurname: '', signatureFileId: files[i] });
      return { submissionKey: randomUUID(), clubId, seasonId: context.id, clubName: 'Nombre anual sintético',
        uniformColors: 'Azul sintético', categoryIds: context.categories,
        officers: { PRESIDENT: officer(0), SECRETARY: officer(1), TREASURER: officer(2) }, ...extra };
    }
    const post = (browser, body, headers = {}) => browser.request('/api/affiliations', {
      method: 'POST', headers: { origin: baseUrl, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    async function counts() {
      return (await db.query(`SELECT
        (SELECT count(*)::int FROM sports_management.club_affiliations) affiliations,
        (SELECT count(*)::int FROM sports_management.club_affiliation_categories) categories,
        (SELECT count(*)::int FROM sports_management.club_officers) officers,
        (SELECT count(*)::int FROM sports_management.people) people,
        (SELECT count(*)::int FROM sports_management.audit_logs) audits,
        (SELECT count(*)::int FROM sports_management.season_teams) teams`)).rows[0];
    }
    async function deny(browser, body, status, code) {
      const before = await counts();
      const response = await post(browser, body);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { code });
      assert.deepEqual(await counts(), before, 'Una denegación no deja personas/vínculos/auditoría parciales.');
    }
    await test('PDGLD-57: solicitud transaccional por delegado, folio e idempotencia', { timeout: 180_000 }, async (t) => {
      const context = await season();
      await t.test('deniega anónimo, restringido, secretario, jugador y clubes ajenos', async () => {
        await deny(new Browser(baseUrl), payload(context), 401, 'UNAUTHENTICATED');
        await deny(restricted.browser, payload(context), 403, 'PASSWORD_CHANGE_REQUIRED');
        await deny(secretary.browser, payload(context), 403, 'FORBIDDEN');
        await deny(ordinary.browser, payload(context), 403, 'FORBIDDEN');
        await deny(actor.browser, payload(context, { clubId: sameLeagueClub }), 403, 'FORBIDDEN');
        await deny(actor.browser, payload(context, { clubId: outsideClub }), 403, 'FORBIDDEN');
      });
      await t.test('valida origen, tamaño, formato y rechaza campos de autoridad', async () => {
        const before = await counts();
        for (const headers of [{ origin: '' }, { origin: 'https://foreign.example.test' }, { 'sec-fetch-site': 'cross-site' }])
          assert.equal((await post(actor.browser, payload(context), headers)).status, 403);
        assert.equal((await post(actor.browser, payload(context), { 'content-type': 'text/plain' })).status, 400);
        assert.equal((await post(actor.browser, { noise: 'x'.repeat(66_000) })).status, 413);
        const invalid = await actor.browser.request('/api/affiliations', {
          method: 'POST', headers: { origin: baseUrl, 'content-type': 'application/json' }, body: '{',
        });
        assert.equal(invalid.status, 400);
        for (const extra of [{ requestedBy: actor.id }, { status: 'APPROVED' }, { referenceNumber: 'fake' }, { clubId: 'bad' }])
          await deny(actor.browser, payload(context, extra), 400, 'VALIDATION_ERROR');
        assert.deepEqual(await counts(), before);
      });
      await t.test('rechaza otra temporada/liga y categorías inexistentes o de otra temporada', async () => {
        const elsewhere = await season(otherLeague);
        await deny(actor.browser, payload(elsewhere), 400, 'INVALID_CONTEXT');
        await deny(actor.browser, payload(context, { seasonId: randomUUID() }), 400, 'INVALID_CONTEXT');
        await deny(actor.browser, payload(context, { categoryIds: elsewhere.categories }), 400, 'INVALID_CONTEXT');
        await deny(actor.browser, payload(context, { categoryIds: [randomUUID()] }), 400, 'INVALID_CONTEXT');
      });
      await t.test('no admite solicitudes sin las tres firmas o con archivos ajenos/no válidos', async () => {
        const body = payload(context);
        delete body.officers.PRESIDENT.signatureFileId;
        await deny(actor.browser, body, 400, 'VALIDATION_ERROR');
        for (const change of [
          ['uploaded_by', foreignOwner.id], ['size_bytes', 0], ['size_bytes', 10485761],
          ['mime_type', 'text/html'], ['sha256', null],
        ]) {
          await db.query(`UPDATE sports_management.files SET ${change[0]}=$1 WHERE id=$2`, [change[1], files[0]]);
          try { await deny(actor.browser, payload(context), 400, 'INVALID_SIGNATURE'); }
          finally { await db.query(`UPDATE sports_management.files SET uploaded_by=$1,size_bytes=100,mime_type='image/png',sha256=$2 WHERE id=$3`, [actor.id, 'a'.repeat(64), files[0]]); }
        }
      });
      let submitted;
      const body = payload(context);
      await t.test('crea afiliación PENDING, tres directivos, categorías y un evento sin PII', async () => {
        const before = await counts();
        const response = await post(actor.browser, body);
        assert.equal(response.status, 201);
        assert.match(response.headers.get('cache-control'), /private.*no-store/);
        submitted = await response.json();
        assert.deepEqual(Object.keys(submitted).sort(), ['id', 'referenceNumber', 'replayed', 'status']);
        assert.equal(submitted.status, 'PENDING');
        assert.equal(submitted.replayed, false);
        assert.match(submitted.referenceNumber, /^AFL-[0-9a-f-]{36}$/);
        const after = await counts();
        assert.deepEqual(after, { affiliations: before.affiliations + 1, categories: before.categories + 2,
          officers: before.officers + 3, people: before.people + 3, audits: before.audits + 1, teams: before.teams });
        const row = (await db.query('SELECT * FROM sports_management.club_affiliations WHERE id=$1', [submitted.id])).rows[0];
        assert.equal(row.requested_by, actor.id);
        assert.equal(row.league_id, league);
        assert.equal(row.club_name, body.clubName);
        assert.equal(row.reviewed_by, null);
        assert.equal((await db.query('SELECT name FROM sports_management.clubs WHERE id=$1', [clubId])).rows[0].name, 'Nombre original sintético');
        const saved = await db.query('SELECT category_id FROM sports_management.club_affiliation_categories WHERE affiliation_id=$1 ORDER BY category_id', [submitted.id]);
        assert.deepEqual(saved.rows.map((r) => r.category_id), [...body.categoryIds].sort());
        const officers = await db.query('SELECT office,signature_file_id FROM sports_management.club_officers WHERE affiliation_id=$1', [submitted.id]);
        for (const row of officers.rows) assert.equal(row.signature_file_id, body.officers[row.office].signatureFileId);
        const events = await db.query("SELECT * FROM sports_management.audit_logs WHERE table_name='club_affiliations' AND entity_id=$1", [submitted.id]);
        assert.equal(events.rowCount, 1);
        const event = JSON.stringify(events.rows[0]);
        for (const secret of [body.clubName, 'Directivo sintético', 'storage_key', 'sha256', 'submission_hash', 'signature_file_id'])
          assert.equal(event.includes(secret), false);
      });
      await t.test('reenvío igual recupera el folio; cambiar datos con la misma clave da conflicto', async () => {
        const before = await counts();
        const replay = await post(actor.browser, { ...body, categoryIds: [...body.categoryIds].reverse() });
        assert.equal(replay.status, 200);
        assert.deepEqual(await replay.json(), { ...submitted, replayed: true });
        assert.deepEqual(await counts(), before);
        await deny(actor.browser, { ...body, uniformColors: 'Otro color' }, 409, 'IDEMPOTENCY_CONFLICT');
        await deny(actor.browser, { ...body, submissionKey: randomUUID() }, 409, 'AFFILIATION_EXISTS');
      });
      await t.test('revocar CREATE en la misma sesión impide enviar e incluso recuperar un reenvío', async () => {
        await db.query('DELETE FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [delegateRoleId, permissionId]);
        try { await deny(actor.browser, body, 403, 'FORBIDDEN'); }
        finally { await db.query('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,true)', [delegateRoleId, permissionId]); }
      });
      await t.test('asignaciones vencidas o futuras deniegan con la misma sesión', async () => {
        for (const mode of ['expired', 'future']) {
          await db.query(`UPDATE sports_management.user_roles SET starts_at=$1,ends_at=$2 WHERE user_id=$3`,
            [new Date(Date.now() + (mode === 'future' ? 60_000 : -120_000)), mode === 'expired' ? new Date(Date.now() - 60_000) : null, actor.id]);
          try { await deny(actor.browser, body, 403, 'FORBIDDEN'); }
          finally { await db.query('UPDATE sports_management.user_roles SET starts_at=now()-interval \'1 minute\',ends_at=NULL WHERE user_id=$1', [actor.id]); }
        }
      });
      await t.test('reenvíos simultáneos crean un solo agregado, folio y evento', async () => {
        const fresh = payload(await season());
        const before = await counts();
        const responses = await Promise.all(Array.from({ length: 4 }, () => post(actor.browser, fresh)));
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 200, 200, 201]);
        const results = await Promise.all(responses.map((r) => r.json()));
        assert.equal(new Set(results.map((r) => r.id)).size, 1);
        assert.equal(new Set(results.map((r) => r.referenceNumber)).size, 1);
        assert.notEqual(results[0].referenceNumber, submitted.referenceNumber);
        const after = await counts();
        assert.equal(after.affiliations, before.affiliations + 1);
        assert.equal(after.people, before.people + 3);
        assert.equal(after.audits, before.audits + 1);
      });
      await t.test('claves distintas simultáneas para un club/temporada no duplican', async () => {
        const fresh = payload(await season());
        const responses = await Promise.all([post(actor.browser, fresh), post(actor.browser, { ...fresh, submissionKey: randomUUID() })]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
      });
      await t.test('fallo tardío revierte personas, categorías, solicitud y auditoría; se puede reintentar', async () => {
        const fresh = payload(await season());
        const before = await counts();
        // Fallo real de PostgreSQL, sin mocks ni rama de prueba en código productivo.
        await db.query(`CREATE FUNCTION sports_management.pdgld57_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.office='TREASURER' THEN RAISE EXCEPTION 'Fallo sintético PDGLD-57'; END IF; RETURN NEW; END $$`);
        await db.query('CREATE TRIGGER pdgld57_test_failure BEFORE INSERT ON sports_management.club_officers FOR EACH ROW EXECUTE FUNCTION sports_management.pdgld57_test_failure()');
        try {
          await deny(actor.browser, fresh, 503, 'SERVICE_UNAVAILABLE');
          assert.deepEqual(await counts(), before);
        } finally {
          await db.query('DROP TRIGGER pdgld57_test_failure ON sports_management.club_officers');
          await db.query('DROP FUNCTION sports_management.pdgld57_test_failure()');
        }
        assert.equal((await post(actor.browser, fresh)).status, 201);
      });
      await t.test('temporada cerrada impide nuevas solicitudes y conserva reenvíos sin escrituras', async () => {
        const closed = await season();
        await db.query("UPDATE sports_management.seasons SET status='CLOSED' WHERE id=$1", [closed.id]);
        await deny(actor.browser, payload(closed), 409, 'SEASON_CLOSED');
        await db.query("UPDATE sports_management.seasons SET status='CLOSED' WHERE id=$1", [context.id]);
        const before = await counts();
        assert.equal((await post(actor.browser, body)).status, 200);
        assert.deepEqual(await counts(), before);
      });
      await t.test('FK compuestas impiden ligar categorías de otra temporada incluso por SQL', async () => {
        const unrelated = await season();
        await assert.rejects(db.query(`INSERT INTO sports_management.club_affiliation_categories(affiliation_id,season_id,category_id)
          VALUES ($1,$2,$3)`, [submitted.id, unrelated.id, unrelated.categories[0]]), { code: '23503' });
      });
      await t.test('PDGLD-60: revisión, correcciones, alcance y concurrencia por HTTP', async (r) => {
        for (const [role, action, contextOnly] of [
          ['SECRETARY', 'READ', false], ['SECRETARY', 'APPROVE', false],
          ['CLUB_DELEGATE', 'READ', true], ['CLUB_DELEGATE', 'UPDATE', true],
        ]) {
          const roleId = (await db.query('SELECT id FROM sports_management.roles WHERE code=$1', [role])).rows[0].id;
          const permId = (await db.query(`INSERT INTO sports_management.permissions(module,action) VALUES ('clubs',$1)
            ON CONFLICT(module,action) DO UPDATE SET module=EXCLUDED.module RETURNING id`, [action])).rows[0].id;
          const prior = (await db.query('SELECT context_only FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [roleId, permId])).rows[0];
          reviewGrants.push({ roleId, permId, prior });
          await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,$3)
            ON CONFLICT(role_id,permission_id) DO UPDATE SET context_only=EXCLUDED.context_only`, [roleId, permId, contextOnly]);
        }
        const fresh = payload(await season());
        const created = await (await post(actor.browser, fresh)).json();
        const url = `/api/affiliations/${created.id}`;
        const patch = (browser, suffix, data, headers = {}) => browser.request(`${url}/${suffix}`, {
          method: 'PATCH', headers: { origin: baseUrl, 'content-type': 'application/json', ...headers }, body: JSON.stringify(data),
        });
        const approve = { decision: 'APPROVE', expectedVersion: 0 };
        await r.test('listado paginado y detalle privados, sin acceso a otros clubes ni datos de storage', async () => {
          const listing = await secretary.browser.request(`/api/affiliations?leagueId=${league}&pageSize=1`);
          assert.equal(listing.status, 200);
          assert.equal((await listing.json()).items.length, 1);
          assert.equal((await actor.browser.request(`/api/affiliations?leagueId=${league}`)).status, 403);
          assert.equal((await actor.browser.request(`/api/affiliations?leagueId=${league}&clubId=${clubId}`)).status, 200);
          assert.equal((await foreignOwner.browser.request(url)).status, 403);
          assert.equal((await new Browser(baseUrl).request(url)).status, 401);
          const response = await secretary.browser.request(url);
          assert.match(response.headers.get('cache-control'), /private.*no-store/);
          const detail = await response.json();
          assert.equal(detail.version, 0);
          assert.equal(detail.reviewPhase, 'AWAITING_REVIEW');
          assert.equal(detail.officers.length, 3);
          assert.equal(typeof detail.seasonName, 'string');
          assert.equal(detail.categories.length, 2);
          assert.deepEqual(detail.allowedActions, ['APPROVE', 'REQUEST_CORRECTIONS']);
          const delegateDetail = await (await actor.browser.request(url)).json();
          assert.deepEqual(delegateDetail.allowedActions, []);
          assert.equal(JSON.stringify(detail).includes('storage_key'), false);
          assert.equal('submissionKey' in detail, false);
        });
        await r.test('deniega delegado, restringido, anónimo, origen inválido y payload inválido', async () => {
          const before = await counts();
          assert.equal((await patch(actor.browser, 'review', approve)).status, 403);
          assert.equal((await patch(restricted.browser, 'review', approve)).status, 403);
          assert.equal((await patch(new Browser(baseUrl), 'review', approve)).status, 401);
          assert.equal((await patch(secretary.browser, 'review', approve, { origin: '' })).status, 403);
          assert.equal((await patch(secretary.browser, 'review', { ...approve, status: 'APPROVED' })).status, 400);
          assert.equal((await patch(secretary.browser, 'review', { decision: 'REQUEST_CORRECTIONS', expectedVersion: 0, observations: ' ' })).status, 400);
          assert.deepEqual(await counts(), before);
        });
        await r.test('no combina secretario de otra liga ni permite autoaprobación con dos roles', async () => {
          await db.query('UPDATE sports_management.user_roles SET league_id=$1 WHERE user_id=$2', [otherLeague, secretary.id]);
          try { assert.equal((await patch(secretary.browser, 'review', approve)).status, 403); }
          finally { await db.query('UPDATE sports_management.user_roles SET league_id=$1 WHERE user_id=$2', [league, secretary.id]); }
          const extra = (await db.query(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id)
            SELECT $1,id,$2 FROM sports_management.roles WHERE code='SECRETARY' RETURNING id`, [actor.id, league])).rows[0].id;
          try { assert.equal((await patch(actor.browser, 'review', approve)).status, 403); }
          finally { await db.query('DELETE FROM sports_management.user_roles WHERE id=$1', [extra]); }
        });
        await r.test('revocar APPROVE impide revisar con una sesión existente', async () => {
          const grant = reviewGrants.find((g, i) => i === 1);
          await db.query('DELETE FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [grant.roleId, grant.permId]);
          try { assert.equal((await patch(secretary.browser, 'review', approve)).status, 403); }
          finally { await db.query('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,false)', [grant.roleId, grant.permId]); }
        });
        await r.test('solicita correcciones manteniendo PENDING y exige reenvío antes de aprobar', async () => {
          const response = await patch(secretary.browser, 'review', { decision: 'REQUEST_CORRECTIONS', expectedVersion: 0, observations: 'Aclarar colores del uniforme.' });
          assert.equal(response.status, 200);
          const result = await response.json();
          assert.equal(result.status, 'PENDING');
          assert.equal(result.reviewPhase, 'CORRECTIONS_REQUESTED');
          assert.equal(result.version, 1);
          assert.deepEqual(await (await patch(secretary.browser, 'review', { ...approve, expectedVersion: 1 })).json(), { code: 'CORRECTIONS_PENDING' });
        });
        await r.test('corrección inválida o ajena no altera el agregado; reenvío conserva folio e historial', async () => {
          const before = await counts();
          assert.equal((await patch(foreignOwner.browser, 'resubmit', { ...fresh, expectedVersion: 1 })).status, 403);
          assert.equal((await patch(actor.browser, 'resubmit', { ...fresh, expectedVersion: 1, categoryIds: [randomUUID()] })).status, 400);
          assert.deepEqual(await counts(), before);
          const responses = await Promise.all([1, 2].map(() => patch(actor.browser, 'resubmit', { ...fresh, expectedVersion: 1, uniformColors: 'Blanco corregido' })));
          assert.deepEqual(responses.map((x) => x.status).sort(), [200, 409]);
          const detail = await (await actor.browser.request(url)).json();
          assert.equal(detail.referenceNumber, created.referenceNumber);
          assert.equal(detail.status, 'PENDING');
          assert.equal(detail.version, 2);
          assert.equal(detail.reviewPhase, 'AWAITING_REVIEW');
          assert.equal(detail.uniformColors, 'Blanco corregido');
          assert.equal(detail.submissionKey, fresh.submissionKey);
          assert.equal(detail.officers.length, 3);
          assert.equal(detail.history[0].observations, 'Aclarar colores del uniforme.');
          assert.equal(detail.history.length, 2);
          assert.equal((await counts()).affiliations, before.affiliations);
          assert.deepEqual(await (await patch(secretary.browser, 'review', approve)).json(), { code: 'STALE_AFFILIATION' });
        });
        await r.test('fallo al escribir historial revierte la aprobación', async () => {
          await db.query(`CREATE FUNCTION sports_management.pdgld60_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.action='AFFILIATION_APPROVE' THEN RAISE EXCEPTION 'Fallo sintético'; END IF; RETURN NEW; END $$`);
          await db.query('CREATE TRIGGER pdgld60_test_failure BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION sports_management.pdgld60_test_failure()');
          try {
            assert.equal((await patch(secretary.browser, 'review', { ...approve, expectedVersion: 2 })).status, 503);
            const detail = await (await secretary.browser.request(url)).json();
            assert.equal(detail.status, 'PENDING');
            assert.equal(detail.version, 2);
          } finally {
            await db.query('DROP TRIGGER pdgld60_test_failure ON sports_management.audit_logs');
            await db.query('DROP FUNCTION sports_management.pdgld60_test_failure()');
          }
        });
        await r.test('aprobación concurrente tiene un ganador y un solo evento; conserva club/equipos', async () => {
          const before = await counts();
          const responses = await Promise.all([1, 2, 3].map(() => patch(secretary.browser, 'review', { ...approve, expectedVersion: 2 })));
          assert.deepEqual(responses.map((x) => x.status).sort(), [200, 409, 409]);
          for (const response of responses.filter((x) => x.status === 409))
            assert.deepEqual(await response.json(), { code: 'AFFILIATION_ALREADY_REVIEWED' });
          const detail = await (await secretary.browser.request(url)).json();
          assert.equal(detail.status, 'APPROVED');
          assert.equal(detail.version, 3);
          assert.equal(detail.history.filter((h) => h.action === 'AFFILIATION_APPROVE').length, 1);
          assert.equal((await counts()).audits, before.audits + 1);
          assert.equal((await counts()).teams, before.teams);
          assert.equal((await db.query('SELECT name FROM sports_management.clubs WHERE id=$1', [clubId])).rows[0].name, 'Nombre original sintético');
          assert.equal((await patch(actor.browser, 'resubmit', { ...fresh, expectedVersion: 3 })).status, 409);
        });
        await r.test('bandeja PDGLD-61 conectada: consulta, correcciones, reenvío, conflicto y aprobación', async () => {
          const { createReviewApi } = await tsImport('../../src/features/clubs/affiliation-review-adapter.ts', import.meta.url);
          const { createReviewController } = await tsImport('../../src/features/clubs/affiliation-review-controller.ts', import.meta.url);
          const nextPayload = payload(await season());
          const nextResponse = await post(actor.browser, nextPayload);
          assert.equal(nextResponse.status, 201);
          const next = await nextResponse.json();
          const nextUrl = `/api/affiliations/${next.id}`;
          // El adaptador/controlador son los de producción; transporte HTTP real
          // con cookies sintéticas. No sustituye clics/foco/hidratación en navegador.
          const api = createReviewApi((path, init) => secretary.browser.request(String(path), {
            ...init, headers: { ...init?.headers, ...(init?.method === 'PATCH' ? { origin: baseUrl } : {}) },
          }));
          const controller = createReviewController(api);
          const page = await secretary.browser.request('/affiliations/review');
          assert.equal(page.status, 200);
          assert.match(await page.text(), /Revisión de afiliaciones/);
          await controller.load(league);
          assert.equal(controller.getSnapshot().error, null);
          assert.ok(controller.getSnapshot().items.some((item) => item.id === next.id));
          await controller.open(next.id);
          assert.equal(controller.getSnapshot().detail.version, 0);
          controller.observations('Precisar colores del uniforme.');
          await controller.submit('REQUEST_CORRECTIONS');
          assert.equal(controller.getSnapshot().error, null);
          assert.equal(controller.getSnapshot().detail.reviewPhase, 'CORRECTIONS_REQUESTED');
          assert.deepEqual(controller.getSnapshot().detail.allowedActions, []);
          async function resubmit(version) {
            const response = await actor.browser.request(`${nextUrl}/resubmit`, { method: 'PATCH',
              headers: { origin: baseUrl, 'content-type': 'application/json' },
              body: JSON.stringify({ ...nextPayload, expectedVersion: version, uniformColors: 'Blanco precisado' }) });
            assert.equal(response.status, 200);
          }
          await resubmit(1);
          await controller.open(next.id);
          assert.equal(controller.getSnapshot().detail.version, 2);
          // Otra revisión entre abrir detalle y confirmar impide aprobar a ciegas.
          await api.review(next.id, 'REQUEST_CORRECTIONS', 'Revisar nuevamente el uniforme.', 2);
          await controller.submit('APPROVE'); await controller.confirmApproval();
          assert.equal(controller.getSnapshot().error, null);
          assert.equal(controller.getSnapshot().detail.reviewPhase, 'CORRECTIONS_REQUESTED');
          assert.equal(controller.getSnapshot().detail.version, 3);
          assert.match(controller.getSnapshot().message, /Otra persona ya revisó/);
          await resubmit(3);
          await controller.open(next.id);
          await controller.submit('APPROVE'); await controller.confirmApproval();
          assert.equal(controller.getSnapshot().error, null);
          assert.equal(controller.getSnapshot().detail.status, 'APPROVED');
          assert.equal(controller.getSnapshot().detail.reviewPhase, null);
          assert.equal(controller.getSnapshot().detail.version, 5);
          assert.deepEqual(controller.getSnapshot().detail.history.map((entry) => entry.action), [
            'AFFILIATION_REQUEST_CORRECTIONS', 'AFFILIATION_RESUBMIT',
            'AFFILIATION_REQUEST_CORRECTIONS', 'AFFILIATION_RESUBMIT', 'AFFILIATION_APPROVE',
          ]);
          assert.equal(controller.getSnapshot().detail.history[0].observations, 'Precisar colores del uniforme.');
          assert.deepEqual(controller.getSnapshot().detail.allowedActions, []);
          assert.equal(controller.getSnapshot().items.some((item) => item.id === next.id), false);
          assert.match(controller.getSnapshot().message, /Aprobación confirmada/);
        });
      });
    });
  } catch (error) {
    // Identificadores de diagnóstico; nunca URL, SQL, parámetros ni mensaje de pg.
    console.error('[PDGLD-57 test]', error.code ?? error.name, error.constraint ?? '');
    throw error;
  } finally {
    for (const { roleId, permId, prior } of reviewGrants) {
      if (prior) await db.query('UPDATE sports_management.role_permissions SET context_only=$1 WHERE role_id=$2 AND permission_id=$3', [prior.context_only, roleId, permId]);
      else await db.query('DELETE FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [roleId, permId]);
    }
    // No borrar historial: la base completa la elimina su runner al finalizar.
    if (delegateRoleId && permissionId && grantExisted) {
      await db.query('UPDATE sports_management.role_permissions SET context_only=$1 WHERE role_id=$2 AND permission_id=$3',
        [grantExisted.context_only, delegateRoleId, permissionId]);
    }
    await db.end();
  }
}
