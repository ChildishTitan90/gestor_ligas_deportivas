import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { billingJourney } from '../e2e/billing-journey.mjs';
import { readChargeBalanceForActor, readChargeCreatedEventForActor } from '../../src/features/billing/server/consumer-queries.ts';
import { getPrisma } from '../../src/server/db/prisma.ts';

test('PDGLD-176 HTTP, sesión, PostgreSQL y RLS reales', { timeout: 540000 }, async t => {
  assert.equal(process.env.BILLING_ISOLATED, '1');
  const fixture = JSON.parse(readFileSync(process.env.BILLING_MANIFEST, 'utf8'));
  const origin = process.env.NEXTAUTH_URL;
  const adminTarget = new URL(process.env.BILLING_ADMIN_URL);
  assert.equal(adminTarget.hostname, '127.0.0.1'); assert.match(adminTarget.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const db = new pg.Client({ connectionString: adminTarget.href });
  const runtime = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const evidence = [];
  const check = async (name, body) => {
    const before = evidence.length;
    await t.test(name, async () => { await body(); evidence.push(name); });
    assert.equal(evidence.length, before + 1, 'No continuar dependencias después de un caso fallido');
  };
  await db.connect(); await runtime.connect();
  await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD176 comprobación sintética',false)", [fixture.users.treasury176]);
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const count = async table => Number((await q(`SELECT count(*)::int n FROM sports_management.${table}`))[0].n);
  const fresh = command => ({ ...command, input: { ...command.input, operationId: randomUUID() } });
  const create = (changes = {}) => ({ action: 'CREATE', input: {
    operationId: randomUUID(), seasonId: fixture.season, recipient: { kind: 'CLUB', clubId: fixture.clubs[0] },
    concept: 'REFEREE_FEE', frequency: 'ONCE', amount: '100.50', dueOn: fixture.due,
    periodStart: `${fixture.year}-02-01`, periodEnd: `${fixture.year}-02-28`, reason: 'PDGLD176 cargo sintético', ...changes,
  } });
  const login = async name => {
    const jar = new Map();
    const cookies = response => { for (const c of response.headers.getSetCookie()) { const [key, ...value] = c.split(';')[0].split('='); jar.set(key, value.join('=')); } };
    const csrf = await fetch(origin + '/api/auth/csrf'); cookies(csrf);
    const response = await fetch(origin + '/api/auth/callback/credentials', { method: 'POST', redirect: 'manual',
      headers: { cookie: [...jar].map(c => c.join('=')).join('; '), origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken: (await csrf.json()).csrfToken, email: name, password: fixture.password, json: 'true', callbackUrl: origin + '/access' }) });
    cookies(response); assert.ok(jar.get('next-auth.session-token'), 'Login real debe emitir cookie');
    return [...jar].map(c => c.join('=')).join('; ');
  };
  let actions, treasury, delegate, other, guest, board;
  // Las referencias se capturan del navegador compilado, nunca se agrega una API de pruebas.
  const invoke = async (command, cookie = treasury, consult = false) => {
    const response = await fetch(origin + '/treasury/charges/new', { method: 'POST',
      headers: { cookie, origin, 'next-action': consult ? actions.consult : actions.save, 'content-type': 'text/plain;charset=UTF-8', accept: 'text/x-component' },
      body: JSON.stringify([command]), signal: AbortSignal.timeout(60000) });
    assert.equal(response.status, 200, 'La Server Action devuelve el contrato de aplicación');
    const body = await response.text();
    const find = value => {
      if (value && typeof value === 'object') {
        if (['CONFIRMED', 'REJECTED', 'UNCERTAIN', 'NOT_APPLIED'].includes(value.status)) return value;
        for (const item of Object.values(value)) { const result = find(item); if (result) return result; }
      }
    };
    for (const line of body.split('\n')) {
      const json = line.slice(line.indexOf(':') + 1);
      if (!json.startsWith('{') && !json.startsWith('[')) continue;
      try { const result = find(JSON.parse(json)); if (result) return result; } catch { /* Otra parte del Flight stream. */ }
    }
    throw Error('Respuesta HTTP sin contrato BillingResult');
  };
  const rejected = async (command, code, cookie = treasury) => assert.deepEqual(await invoke(command, cookie), { status: 'REJECTED', code });
  const confirmed = async command => { const response = await invoke(command); assert.equal(response.status, 'CONFIRMED'); return response.receipt; };
  let command, receipt, plan, generation;
  try {
    await check('Perfil limitado con RLS, sin pagos, borrados, cambio de origen ni ledger', async () => {
      const { rows: [p] } = await runtime.query(`SELECT current_user role,
        row_security_active('sports_management.charges'::regclass) rls,
        has_column_privilege('sports_management.charges','amount','UPDATE') correction,
        has_column_privilege('sports_management.charges','club_id','UPDATE') origin,
        has_any_column_privilege('sports_management.payments','INSERT') payments,
        has_table_privilege('sports_management.charges','DELETE') deletion,
        has_table_privilege('public._prisma_migrations','SELECT') ledger`);
      assert.deepEqual(p, { role: 'gestor_ligas_preview', rls: true, correction: true, origin: false, payments: false, deletion: false, ledger: false });
      await assert.rejects(runtime.query('DELETE FROM sports_management.charges'), { code: '42501' });
    });
    await check('Recorrido Chrome real, cancelación, validación, teclado, foco, incertidumbre tras commit, corrección y semanal', async () => {
      actions = await billingJourney(origin, fixture, db);
    });
    treasury = await login('treasury176'); delegate = await login('delegate176'); other = await login('other176'); guest = await login('guest176'); board = await login('board176');
    await check('Cargo válido nace pendiente con importe exacto y cero pagos', async () => {
      command = create(); receipt = await confirmed(command);
      const [row] = await q('SELECT amount::text,currency,version,voided_at FROM sports_management.charges WHERE id=$1', [receipt.chargeId]);
      assert.deepEqual(row, { amount: '100.50', currency: 'MXN', version: 1, voided_at: null });
      assert.equal(await count('payments'), 0);
      assert.deepEqual(await readChargeBalanceForActor(fixture.users.treasury176, receipt.chargeId), { chargeId: receipt.chargeId, version: 1, currency: 'MXN', amount: '100.50', paid: '0.00', balance: '100.50', dueOn: fixture.due, voided: false });
    });
    await check('Importes inválidos, precisión, límites Decimal(12,2) y contrato estricto', async () => {
      const before = await count('charges');
      for (const amount of ['0', '-1', '1.001', '10000000000.00', '1e3', 'NaN', '', '1,000.00', 1.25]) await rejected(create({ amount }), 'INVALID_INPUT');
      await rejected(create({ actorId: fixture.users.treasury176 }), 'INVALID_INPUT');
      await rejected(create({ reason: ' ' }), 'INVALID_INPUT');
      await rejected(create({ dueOn: '2025-02-30' }), 'INVALID_INPUT');
      await rejected(create({ dueOn: '2000-01-01' }), 'INVALID_DUE_DATE');
      await rejected(create({ periodEnd: `${fixture.year}-01-01` }), 'INVALID_INPUT');
      assert.equal(await count('charges'), before);
      for (const [amount, expected, day] of [['0.01', '0.01', '01'], ['9999999999.99', '9999999999.99', '02'], ['001,20', '1.20', '03']]) {
        const r = await confirmed(create({ amount, periodStart: `${fixture.year}-04-${day}`, periodEnd: `${fixture.year}-04-${day}` }));
        assert.equal((await q('SELECT amount::text FROM sports_management.charges WHERE id=$1', [r.chargeId]))[0].amount, expected);
      }
      const sql = `INSERT INTO sports_management.charges(season_id,club_id,charge_concept_id,amount,issued_on,due_on,period_start_date,period_end_date,created_by)
        SELECT season_id,club_id,charge_concept_id,$2,issued_on,due_on,$3,$3,created_by FROM sports_management.charges WHERE id=$1`;
      await assert.rejects(db.query(sql, [receipt.chargeId, '0', `${fixture.year}-04-10`]), { code: '23514' });
      await assert.rejects(db.query(sql, [receipt.chargeId, '10000000000.00', `${fixture.year}-04-10`]), { code: '22003' });
    });
    await check('Destinatario inexistente, temporada inconsistente y liga ajena se rechazan', async () => {
      for (const change of [{ recipient: { kind: 'CLUB', clubId: randomUUID() } }, { recipient: { kind: 'TEAM', seasonTeamId: randomUUID() } },
        { seasonId: fixture.otherSeason }, { seasonId: fixture.otherSeason, recipient: { kind: 'TEAM', seasonTeamId: fixture.team } }, { seasonId: randomUUID() }]) await rejected(create(change), 'FORBIDDEN');
      await rejected(create(), 'FORBIDDEN', other);
    });
    await check('Sin permiso no se crea, modifica, genera ni concilia, incluso por POST directo', async () => {
      const modify = { action: 'MODIFY', input: { operationId: randomUUID(), chargeId: receipt.chargeId, version: 1, amount: '9.00', dueOn: fixture.due, reason: 'Sin autorización' } };
      for (const cookie of [delegate, guest, board, '']) {
        await rejected(create(), 'FORBIDDEN', cookie); await rejected(modify, 'FORBIDDEN', cookie);
      }
      assert.deepEqual(await invoke(command, other, true), { status: 'REJECTED', code: 'FORBIDDEN' });
    });
    await check('Misma intención concurrente devuelve el mismo acuse sin duplicar auditoría', async () => {
      const before = await count('charges'), audit = await count('audit_logs');
      const responses = await Promise.all([invoke(command), invoke(command), invoke(command)]);
      for (const response of responses) assert.deepEqual(response, { status: 'CONFIRMED', receipt });
      assert.equal(await count('charges'), before); assert.equal(await count('audit_logs'), audit);
      assert.deepEqual(await invoke(command, treasury, true), { status: 'CONFIRMED', receipt });
      assert.deepEqual(await invoke(fresh(command), treasury, true), { status: 'NOT_APPLIED' });
    });
    await check('Misma clave con contenido distinto se rechaza también en conciliación', async () => {
      const changed = { ...command, input: { ...command.input, amount: '101.00' } };
      await rejected(changed, 'OPERATION_KEY_REUSED');
      assert.deepEqual(await invoke(changed, treasury, true), { status: 'REJECTED', code: 'OPERATION_KEY_REUSED' });
      await rejected(fresh(changed), 'DUPLICATE_CHARGE');
    });
    await check('Plan guardado no genera; dos generaciones concurrentes producen un cargo', async () => {
      const before = await count('charges');
      plan = await confirmed(create({ frequency: 'WEEKLY', concept: 'REFEREE_FEE', recipient: { kind: 'TEAM', seasonTeamId: fixture.team }, periodStart: fixture.start, periodEnd: fixture.end, amount: '80.25' }));
      assert.ok(plan.planId); assert.equal(plan.chargeId, undefined); assert.equal(await count('charges'), before);
      generation = { action: 'GENERATE', input: { operationId: randomUUID(), planId: plan.planId, periodStart: `${fixture.year}-02-01`, periodEnd: `${fixture.year}-02-07`, dueOn: fixture.due, reason: 'Periodo sintético concurrente' } };
      const results = await Promise.all([invoke(generation), invoke(fresh(generation))]);
      assert.ok(results.every(r => r.status === 'CONFIRMED')); assert.equal(results[0].receipt.chargeId, results[1].receipt.chargeId);
      assert.deepEqual(results.map(r => r.receipt.existing).sort(), [false, true]);
      assert.equal(await count('charges'), before + 1);
    });
    await check('Otro periodo semanal cobra una vez; reejecutar, periodo inválido y plan ajeno', async () => {
      const before = await count('charges');
      const next = { ...generation, input: { ...generation.input, operationId: randomUUID(), periodStart: `${fixture.year}-02-08`, periodEnd: `${fixture.year}-02-14` } };
      const r = await confirmed(next);
      const repeated = await confirmed(fresh(next)); assert.equal(repeated.chargeId, r.chargeId); assert.equal(repeated.existing, true);
      assert.equal(await count('charges'), before + 1);
      await rejected({ ...generation, input: { ...generation.input, operationId: randomUUID(), periodEnd: `${fixture.year}-02-08` } }, 'INVALID_INPUT');
      await rejected({ ...generation, input: { ...generation.input, operationId: randomUUID(), periodStart: `${fixture.year + 1}-01-01`, periodEnd: `${fixture.year + 1}-01-07` } }, 'INVALID_PERIOD');
      for (const cookie of [other, delegate, guest, board]) await rejected(fresh(generation), 'FORBIDDEN', cookie);
    });
    await check('Índices PostgreSQL rechazan dos INSERT directos concurrentes sin bloqueo de aplicación', async () => {
      const sql = `INSERT INTO sports_management.charges(season_id,club_id,season_team_id,charge_concept_id,amount,currency,issued_on,due_on,period_start_date,period_end_date,created_by)
        SELECT season_id,club_id,season_team_id,charge_concept_id,amount,currency,issued_on,due_on,$2::date,$2::date,created_by FROM sports_management.charges WHERE id=$1 RETURNING id`;
      for (const chargeId of [receipt.chargeId, (await q('SELECT id FROM sports_management.charges WHERE billing_plan_id=$1 LIMIT 1', [plan.planId]))[0].id]) {
        const second = new pg.Client({ connectionString: adminTarget.href }); await second.connect();
        try {
          const result = await Promise.allSettled([db.query(sql, [chargeId, `${fixture.year}-05-01`]), second.query(sql, [chargeId, `${fixture.year}-05-01`])]);
          assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
          assert.equal(result.find(r => r.status === 'rejected').reason.code, '23505');
        } finally { await second.end(); }
      }
      await assert.rejects(db.query(sql, [receipt.chargeId, `${fixture.year}-05-01`]), { code: '23505' });
    });
    await check('Modificación concurrente conserva autor, motivo, valores anteriores y versión', async () => {
      const modify = { action: 'MODIFY', input: { operationId: randomUUID(), chargeId: receipt.chargeId, version: 1, amount: '125.75', dueOn: fixture.due, reason: 'Corrección de aceptación 176' } };
      const results = await Promise.all([invoke(modify), invoke(fresh(modify))]);
      assert.equal(results.filter(r => r.status === 'CONFIRMED').length, 1);
      assert.deepEqual(results.find(r => r.status === 'REJECTED'), { status: 'REJECTED', code: 'VERSION_CONFLICT' });
      const history = await q("SELECT user_id,reason,previous_data,new_data FROM sports_management.audit_logs WHERE table_name='charges' AND entity_id=$1 AND action='UPDATE'", [receipt.chargeId]);
      assert.equal(history.length, 1); assert.equal(history[0].user_id, fixture.users.treasury176); assert.equal(history[0].reason, modify.input.reason);
      assert.equal(String(history[0].previous_data.amount), '100.5'); assert.equal(String(history[0].new_data.amount), '125.75');
      assert.equal(history[0].previous_data.version, 1); assert.equal(history[0].new_data.version, 2);
    });
    await check('Pagos existentes bloquean corrección y saldo usa Decimal; no se borran movimientos', async () => {
      await q("INSERT INTO sports_management.payments(charge_id,reference_number,amount,paid_at,method,recorded_by) VALUES($1,$2,'0.10',now(),'CASH',$3)", [receipt.chargeId, randomUUID(), fixture.users.treasury176]);
      const balance = await readChargeBalanceForActor(fixture.users.delegate176, receipt.chargeId);
      assert.equal(balance.paid, '0.10'); assert.equal(balance.balance, '125.65');
      await rejected({ action: 'MODIFY', input: { operationId: randomUUID(), chargeId: receipt.chargeId, version: 2, amount: '9.00', dueOn: fixture.due, reason: 'Con pago asociado' } }, 'CHARGE_HAS_PAYMENTS');
      assert.equal(await count('payments'), 1);
    });
    await check('Fallo después del efecto revierte cargo, plan, acuse e historial; misma intención se recupera', async () => {
      await q(`CREATE FUNCTION sports_management.fail_billing176() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
        IF NEW.action='BILLING_OPERATION' AND NEW.reason='PDGLD176 rollback' THEN RAISE EXCEPTION 'Fallo sintético después del efecto'; END IF; RETURN NEW; END $f$;
        CREATE TRIGGER fail_billing176 BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION sports_management.fail_billing176()`);
      const retry = create({ reason: 'PDGLD176 rollback', periodStart: `${fixture.year}-06-01`, periodEnd: `${fixture.year}-06-30` });
      try {
        for (const intent of [retry, create({ reason: 'PDGLD176 rollback', frequency: 'WEEKLY' })]) {
          const before = [await count('charges'), await count('billing_plans'), await count('audit_logs')];
          assert.deepEqual(await invoke(intent), { status: 'UNCERTAIN' });
          assert.deepEqual(await invoke(intent, treasury, true), { status: 'NOT_APPLIED' });
          assert.deepEqual([await count('charges'), await count('billing_plans'), await count('audit_logs')], before);
        }
      } finally { await q('DROP TRIGGER fail_billing176 ON sports_management.audit_logs; DROP FUNCTION sports_management.fail_billing176()'); }
      const recovered = await confirmed(retry); assert.ok(recovered.chargeId);
      assert.deepEqual(await confirmed(retry), recovered);
    });
    await check('Multas protegidas: UUID de resolución no acredita PDGLD-27 y nunca crea deuda', async () => {
      const before = await count('charges');
      const fine = create({ concept: 'FINE', resolutionId: randomUUID() });
      for (const intent of [fine, fine, fresh(fine)]) await rejected(intent, 'RESOLUTION_UNAVAILABLE');
      assert.equal(await count('charges'), before);
      // Una propuesta o un plan legado tampoco puede eludir el bloqueo.
      const [legacy] = await q(`INSERT INTO sports_management.billing_plans(season_id,club_id,charge_concept_id,amount,frequency,starts_at,ends_at,created_by)
        SELECT $1,$2,id,'50.00','WEEKLY',$3,$4,$5 FROM sports_management.charge_concepts WHERE code='FINE' RETURNING id`, [fixture.season, fixture.clubs[0], fixture.start, fixture.end, fixture.users.treasury176]);
      await rejected({ ...generation, input: { ...generation.input, operationId: randomUUID(), planId: legacy.id } }, 'RESOLUTION_UNAVAILABLE');
    });
    await check('Consulta privada, ID ajeno, filtros y consistencia listado/detalle/consumidores', async () => {
      const foreign = await confirmed(create({ concept: 'VENUE', recipient: { kind: 'CLUB', clubId: fixture.clubs[1] }, amount: '876.54' }));
      const html = async (path, cookie) => (await fetch(origin + path, { headers: { cookie }, redirect: 'manual' })).text();
      const list = await html('/treasury/charges', delegate);
      assert.ok(list.includes('Monarcas sintético') && list.includes(receipt.chargeId));
      assert.ok(!list.includes('Pumas sintético') && !list.includes(foreign.chargeId));
      const detail = await html('/treasury/charges/' + receipt.chargeId, delegate);
      assert.ok(detail.includes('125.75') && detail.includes('125.65') && detail.includes('Corrección de aceptación 176'));
      for (const path of ['/treasury/charges/' + foreign.chargeId, '/treasury/charges?recipient=' + fixture.clubs[1], '/treasury/charges?season=' + fixture.otherSeason]) {
        const denied = await html(path, delegate); assert.ok(!denied.includes('876.54') && !denied.includes('Pumas sintético'));
      }
      const denied = await html('/treasury/charges/' + receipt.chargeId, guest); assert.ok(!denied.includes('125.75') && !denied.includes('Corrección de aceptación 176'));
      for (const privateValue of ['treasury176@example.invalid', 'password_hash', fixture.password, 'token_hash', 'input_fingerprint']) assert.ok(!detail.includes(privateValue));
      await assert.rejects(readChargeBalanceForActor(fixture.users.delegate176, foreign.chargeId));
      const [event] = await q("SELECT id FROM sports_management.audit_logs WHERE table_name='charges' AND action='INSERT' AND entity_id=$1", [receipt.chargeId]);
      assert.deepEqual(await readChargeCreatedEventForActor(fixture.users.delegate176, event.id), { eventId: event.id, kind: 'CHARGE_CREATED', chargeId: receipt.chargeId });
      await assert.rejects(readChargeCreatedEventForActor(fixture.users.other176, event.id));
    });
    await check('Pérdida de permiso impide reenvío y conciliación de un acuse anterior', async () => {
      await q("UPDATE sports_management.user_roles SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1", [fixture.users.treasury176]);
      await rejected(command, 'FORBIDDEN'); assert.deepEqual(await invoke(command, treasury, true), { status: 'REJECTED', code: 'FORBIDDEN' });
    });
    mkdirSync(process.env.BILLING_EVIDENCE, { recursive: true });
    const [version] = await q('SHOW server_version');
    writeFileSync(join(process.env.BILLING_EVIDENCE, 'results.json'), JSON.stringify({ ticket: 'PDGLD-176', postgres: version.server_version, passed: evidence, blocked: ['Multa desde resolución válida PDGLD-27: integración ausente'], transportFault: 'Respuesta real interrumpida después de commit; conciliada por intención', runtime: 'gestor_ligas_preview con RLS', at: new Date().toISOString() }, null, 2));
  } finally { await getPrisma().$disconnect(); await runtime.end(); await db.end(); }
});
