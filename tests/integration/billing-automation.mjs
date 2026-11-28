import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getPrisma } from '../../src/server/db/prisma.ts';
import { transitionMatchInTransaction } from '../../src/features/matches/server/transition.ts';
import { chargeScheduledMatchesInTransaction } from '../../src/features/billing/server/automation-service.ts';

export async function billingAutomationCases({ check, q, fixture: f, origin, login, treasury, delegate, other }) {
  const db = getPrisma();
  const request = async (path, input, cookie = treasury, method = 'POST') => {
    const r = await fetch(origin + path, { method, headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    return { status: r.status, body: await r.json() };
  };
  const policy = (kind, changes = {}) => ({ operationId: randomUUID(), seasonId: f.season, kind,
    expectedRevision: 0, enabled: true, amount: '125.50', dueDays: 7, firstMatchday: 1, lastMatchday: 4, reason: 'Política sintética explícita', ...changes });
  const save = input => request('/api/v1/billing/automation', input);
  let clubPolicy, refereePolicy, venue, teams;
  await check('Automatización HTTP: permiso/ámbito, precisión, revisión e intención recuperable', async () => {
    const input = policy('CLUB_AFFILIATION');
    for (const cookie of [delegate, other, '']) assert.equal((await request('/api/v1/billing/automation', input, cookie)).status, 403);
    for (const change of [{ amount: '1.001' }, { amount: '-1' }, { dueDays: -1 }, { dueDays: 0.5 }, { dueDays: 366 }, { firstMatchday: 5, lastMatchday: 4 }, { actorId: f.users.treasury176 }])
      assert.equal((await save({ ...input, ...change })).body.code, 'INVALID_INPUT');
    const [a, b] = await Promise.all([save(input), save(input)]);
    assert.equal(a.body.status, 'CONFIRMED'); assert.deepEqual(a.body, b.body); clubPolicy = a.body.policy;
    assert.equal((await save({ ...input, amount: '150' })).body.code, 'OPERATION_KEY_REUSED');
    assert.equal((await save(policy('CLUB_AFFILIATION'))).body.code, 'VERSION_CONFLICT');
    await assert.rejects(db.$executeRaw`UPDATE sports_management.billing_automation_policies SET amount=1 WHERE id=${clubPolicy.id}::uuid`, /permission denied/);
    await assert.rejects(q('UPDATE sports_management.billing_automation_policies SET amount=1 WHERE id=$1', [clubPolicy.id]), /solo insercion/);
    assert.equal((await q('SELECT count(*)::int n FROM sports_management.charges WHERE automation_source IS NOT NULL'))[0].n, 0, 'Guardar inscripción no cobra afiliaciones pendientes/anteriores');
  });
  await check('Afiliación HTTP con sesión de Secretaría crea exactamente un cargo bajo mandato de Tesorería', async () => {
    const [aff] = await q('SELECT id,review_version FROM sports_management.club_affiliations WHERE season_id=$1 AND club_id=$2', [f.season, f.clubs[0]]);
    await q('INSERT INTO sports_management.club_affiliation_categories(affiliation_id,season_id,category_id) VALUES($1,$2,$3)', [aff.id, f.season, f.category]);
    const cookie = await login('secretary176');
    const input = { decision: 'APPROVE', expectedVersion: aff.review_version, authorizedCategoryIds: [f.category] };
    const result = await request(`/api/affiliations/${aff.id}/review`, input, cookie, 'PATCH');
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal((await request(`/api/affiliations/${aff.id}/review`, input, cookie, 'PATCH')).status, 409);
    const rows = await q('SELECT id,amount::text,created_by,automation_policy_id FROM sports_management.charges WHERE automation_source=$1', [`CLUB_AFFILIATION:${aff.id}`]);
    assert.equal(rows.length, 1); assert.equal(rows[0].amount, '125.50');
    assert.equal(rows[0].created_by, f.users.treasury176); assert.equal(rows[0].automation_policy_id, clubPolicy.id);
    await assert.rejects(q('UPDATE sports_management.charges SET automation_source=$2,version=version+1 WHERE id=$1', [rows[0].id, 'forged-origin']), /CHARGE_CONTEXT_IMMUTABLE/);
    assert.equal((await q('SELECT count(*)::int n FROM sports_management.payments WHERE charge_id=$1', [rows[0].id]))[0].n, 0);
    const [audit] = await q("SELECT user_id FROM sports_management.audit_logs WHERE table_name='club_affiliations' AND entity_id=$1 AND action='AFFILIATION_APPROVE'", [aff.id]);
    assert.equal(audit.user_id, f.users.secretary176, 'La autoría del trámite no se sustituye por el mandato');
  });
  await check('Inscripción HTTP del delegado crea un cargo; repetir la clave recupera equipo y deuda', async () => {
    assert.equal((await save(policy('TEAM_ENROLLMENT', { amount: '250.01' }))).body.status, 'CONFIRMED');
    await q("UPDATE sports_management.season_categories SET competition_format='LEGACY_GROUPS' WHERE id=$1", [f.sc]);
    const input = { enrollmentKey: randomUUID(), clubId: f.clubs[0], seasonId: f.season, categoryId: f.category,
      groupId: f.group, team: { mode: 'new', name: 'Equipo automatización sintético' } };
    const response = await request('/api/team-enrollments', input, delegate);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal((await request('/api/team-enrollments', input, delegate)).status, 200);
    const [enrollment] = await q('SELECT id FROM sports_management.season_teams WHERE enrollment_key=$1', [input.enrollmentKey]);
    const [charge] = await q('SELECT amount::text FROM sports_management.charges WHERE automation_source=$1', [`TEAM_ENROLLMENT:${enrollment.id}`]);
    assert.equal(charge.amount, '250.01');
  });
  const draftMatch = async (number, extra = {}) => {
    const start = `${f.year}-07-${String(number * 2).padStart(2, '0')}`;
    const [day] = await q('INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES($1,$2,$3,$3) RETURNING id', [f.season, number, start]);
    // Comprueba las columnas usadas por la materialización real del calendario;
    // la fixture de etapa futura sigue siendo owner, sin ampliar ACL para un PR ajeno.
    if (!extra.stage_id) {
      return db.$transaction(async tx => {
      const status = await tx.match_statuses.findUniqueOrThrow({ where: { code: 'DRAFT' }, select: { id: true } });
      await tx.$queryRaw`SELECT set_config('app.user_id',${f.users.scheduler176},true),set_config('app.reason','Fixture de calendario sintético',true)`;
      const [match] = await tx.$queryRaw`INSERT INTO sports_management.matches
        (season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until,status_id,schedule_proposal_id)
        VALUES(${f.season}::uuid,${f.group}::uuid,${day.id}::uuid,${`AUTO-${number}`},${teams[0].id}::uuid,${teams[1].id}::uuid,${venue}::uuid,
        ${new Date(start + 'T16:00:00Z')},${new Date(start + 'T17:30:00Z')},${new Date(start + 'T17:30:00Z')},${status.id}::uuid,NULL) RETURNING id`;
      return match;
      });
    }
    const [match] = await q(`INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until,stage_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) RETURNING id`, [f.season, f.group, day.id, `AUTO-${number}`,
      teams[0].id, teams[1].id, venue, start + 'T16:00:00Z', start + 'T17:30:00Z', extra.stage_id ?? null]);
    return match;
  };
  const schedule = match => db.$transaction(tx => transitionMatchInTransaction(tx, f.users.scheduler176,
    { operationId: randomUUID(), matchId: match.id, expectedVersion: 1, toStatus: 'SCHEDULED', reason: 'Programación sintética automatización' }), { timeout: 30000 });
  const generated = () => q("SELECT id,automation_source,amount::text,version FROM sports_management.charges WHERE automation_source LIKE 'REFEREE_MATCHDAY:%' ORDER BY automation_source");
  await check('Programar partido dispara arbitraje para ambos equipos; DRAFT y descanso no cobran', async () => {
    const r = await save(policy('REFEREE_MATCHDAY', { amount: '75.50' })); assert.equal(r.body.status, 'CONFIRMED'); refereePolicy = r.body.policy;
    venue = (await q("INSERT INTO sports_management.venues(league_id,code,name,address) VALUES($1,'AUTO176','Cancha sintética','Domicilio sintético') RETURNING id", [f.league]))[0].id;
    await q("INSERT INTO sports_management.venue_availability(venue_id,type,starts_at,ends_at) VALUES($1,'AVAILABLE',$2,$3)", [venue, `${f.year}-07-01T00:00:00Z`, `${f.year}-07-31T23:59:59Z`]);
    teams = await q('SELECT id FROM sports_management.season_teams WHERE season_id=$1 ORDER BY id', [f.season]);
    const match = await draftMatch(1);
    assert.equal((await generated()).length, 0);
    await schedule(match);
    assert.equal((await generated()).length, 2, 'El tercer equipo descansa');
    assert.ok((await generated()).every(c => c.amount === '75.50'));
    const [charge] = await generated();
    const detail = await (await fetch(origin + '/treasury/charges/' + charge.id, { headers: { cookie: treasury } })).text();
    assert.ok(detail.includes('Arbitraje por jornada programada') && detail.includes('75.50'));
  });
  await check('Dos generaciones simultáneas y cambio de tarifa preservan cargos anteriores; otra jornada cobra una vez', async () => {
    const run = () => db.$transaction(tx => chargeScheduledMatchesInTransaction(tx, f.season), { timeout: 30000 });
    await Promise.all([run(), run()]); assert.equal((await generated()).length, 2);
    const r = await save(policy('REFEREE_MATCHDAY', { amount: '90.25', expectedRevision: refereePolicy.revision, firstMatchday: 2 }));
    assert.equal(r.body.status, 'CONFIRMED'); refereePolicy = r.body.policy;
    await schedule(await draftMatch(2)); await run();
    assert.deepEqual((await generated()).map(c => c.amount).sort(), ['75.50','75.50','90.25','90.25']);
  });
  await check('Rollback de programación revierte partido, cargos, reservas y auditoría; permite reintentar', async () => {
    const match = await draftMatch(3);
    const before = (await generated()).length;
    await assert.rejects(db.$transaction(async tx => {
      await transitionMatchInTransaction(tx, f.users.scheduler176, { operationId: randomUUID(), matchId: match.id, expectedVersion: 1, toStatus: 'SCHEDULED', reason: 'Rollback sintético' });
      throw Error('FAULT_AFTER_CHARGES');
    }, { timeout: 30000 }), /FAULT_AFTER_CHARGES/);
    assert.equal((await generated()).length, before);
    assert.equal((await q('SELECT count(*)::int n FROM sports_management.match_status_history WHERE match_id=$1', [match.id]))[0].n, 0);
    assert.equal((await q('SELECT count(*)::int n FROM sports_management.venue_reservations WHERE match_id=$1', [match.id]))[0].n, 0);
    await schedule(match); assert.equal((await generated()).length, before + 2);
  });
  await check('Reconciliación real de lote: 20 equipos en 14 jornadas, 280 cargos y repetición sin duplicados', async () => {
    const updated = await save(policy('REFEREE_MATCHDAY', { expectedRevision: refereePolicy.revision,
      firstMatchday: 5, lastMatchday: 18, amount: '90.25' }));
    assert.equal(updated.body.status, 'CONFIRMED'); refereePolicy = updated.body.policy;
    await q(`WITH made AS (INSERT INTO sports_management.teams(club_id,reference_number,name)
      SELECT $1,gen_random_uuid()::text,'Equipo lote sintético '||n FROM generate_series(1,17) n RETURNING id,club_id)
      INSERT INTO sports_management.season_teams(season_id,team_id,club_id,season_category_id,group_id)
      SELECT $2,id,club_id,$3,$4 FROM made`, [f.clubs[0], f.season, f.sc, f.group]);
    const participants = await q('SELECT id FROM sports_management.season_teams WHERE season_id=$1 ORDER BY id', [f.season]);
    assert.equal(participants.length, 20);
    await q("INSERT INTO sports_management.venue_availability(venue_id,type,starts_at,ends_at) VALUES($1,'AVAILABLE',$2,$3)", [venue, `${f.year}-08-01T00:00:00Z`, `${f.year}-12-31T23:59:59Z`]);
    const matches = [];
    for (let round = 5; round <= 18; round++) {
      const day = `${f.year}-08-${String(round).padStart(2, '0')}`;
      const [matchday] = await q('INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES($1,$2,$3,$3) RETURNING id', [f.season, round, day]);
      for (let pair = 0; pair < 10; pair++) {
        const start = new Date(`${day}T06:00:00Z`); start.setUTCMinutes(start.getUTCMinutes() + pair * 90);
        matches.push({ matchday: matchday.id, number: `AUTO-LOTE-${round}-${pair}`, home: participants[2 * pair].id, away: participants[2 * pair + 1].id,
          start: start.toISOString(), end: new Date(+start + 90 * 60000).toISOString() });
      }
    }
    // Fixture de partidos ya programados: demuestra el reconciliador, no otro generador de calendarios.
    await q(`INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until,status_id)
      SELECT $1,$2,m.matchday,m.number,m.home,m.away,$3,m.start,m.end,m.end,sports_management.get_match_status_id('SCHEDULED')
      FROM jsonb_to_recordset($4::jsonb) AS m(matchday uuid,number text,home uuid,away uuid,start timestamptz,"end" timestamptz)`, [f.season, f.group, venue, JSON.stringify(matches)]);
    const headers = { authorization: `Bearer ${process.env.BILLING_CRON_SECRET}`, 'x-billing-environment': 'LOCAL', 'x-billing-project': 'local-isolated' };
    const before = (await generated()).length;
    const result = await fetch(origin + '/api/internal/billing/reconcile', { method: 'POST', headers });
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { created: 280, failed: 0 });
    assert.equal((await generated()).length, before + 280);
    assert.deepEqual(await (await fetch(origin + '/api/internal/billing/reconcile', { method: 'POST', headers })).json(), { created: 0, failed: 0 });
  });
  await check('Jornadas distintas con fechas iguales cobran una vez cada una; manual y automático no se duplican', async () => {
    const saved = await save(policy('REFEREE_MATCHDAY', { expectedRevision: refereePolicy.revision, firstMatchday: 19, lastMatchday: 20, amount: '95.25' }));
    assert.equal(saved.body.status, 'CONFIRMED'); refereePolicy = saved.body.policy;
    async function scheduled(number, day, hour) {
      const [matchday] = await q('INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES($1,$2,$3,$3) RETURNING id', [f.season, number, day]);
      const start = new Date(`${day}T${hour}:00:00Z`), end = new Date(+start + 90 * 60000);
      await q(`INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until,status_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,sports_management.get_match_status_id('SCHEDULED'))`,
      [f.season, f.group, matchday.id, `AUTO-DOBLE-${number}`, teams[0].id, teams[1].id, venue, start, end]);
    }
    const day = `${f.year}-09-10`;
    await scheduled(19, day, '10'); await scheduled(20, day, '12');
    const headers = { authorization: `Bearer ${process.env.BILLING_CRON_SECRET}`, 'x-billing-environment': 'LOCAL', 'x-billing-project': 'local-isolated' };
    const run = () => fetch(origin + '/api/internal/billing/reconcile', { method: 'POST', headers });
    assert.deepEqual(await (await run()).json(), { created: 4, failed: 0 });
    assert.deepEqual(await (await run()).json(), { created: 0, failed: 0 });
    const insertManual = date => q(`INSERT INTO sports_management.charges(season_id,season_team_id,charge_concept_id,amount,issued_on,due_on,period_start_date,period_end_date,created_by)
      SELECT $1,$2,id,50,current_date,$3,$4,$4,$5 FROM sports_management.charge_concepts WHERE code='REFEREE_FEE'`, [f.season, teams[0].id, f.due, date, f.users.treasury176]);
    await assert.rejects(insertManual(day), { code: '23P01' });
    const nextDay = `${f.year}-09-11`;
    await insertManual(nextDay); await scheduled(21, nextDay, '10');
    const conflict = await save(policy('REFEREE_MATCHDAY', { expectedRevision: refereePolicy.revision, firstMatchday: 21, lastMatchday: 21, amount: '50.00' }));
    assert.deepEqual(conflict.body, { status: 'REJECTED', code: 'DUPLICATE_CHARGE' });
    assert.equal((await q("SELECT max(revision)::int n FROM sports_management.billing_automation_policies WHERE season_id=$1 AND kind='REFEREE_MATCHDAY'", [f.season]))[0].n, refereePolicy.revision, 'El conflicto revierte también la nueva política');
  });
  await check('Fase PLAYOFF_8 y partidos con stage_id quedan excluidos sin borrar deudas previas', async () => {
    const before = await generated();
    const [stage] = await q(`INSERT INTO sports_management.competition_stages(season_id,season_category_id,name,sort_order,format,competition_rule_id)
      VALUES($1,$2,'Liguilla sintética de contrato',1,'{"kind":"PLAYOFF_8"}',$3) RETURNING id`, [f.season, f.sc, f.rule]);
    await schedule(await draftMatch(4, { stage_id: stage.id }));
    await db.$transaction(tx => chargeScheduledMatchesInTransaction(tx, f.season));
    assert.deepEqual(await generated(), before);
    assert.equal((await q('SELECT count(*)::int n FROM sports_management.payments WHERE charge_id IN (SELECT id FROM sports_management.charges WHERE automation_source IS NOT NULL)'))[0].n, 0);
    // Este caso acredita exclusión del contrato, no la selección oficial de clasificados del PR #75.
  });
  await check('Cron HTTP exige secreto y entorno/proyecto; reejecutar conserva deuda y pagos', async () => {
    const endpoint = origin + '/api/internal/billing/reconcile';
    assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
    const headers = { authorization: `Bearer ${process.env.BILLING_CRON_SECRET}`, 'x-billing-environment': 'LOCAL', 'x-billing-project': 'local-isolated' };
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, 'x-billing-environment': 'PRODUCTION' } })).status, 401);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, 'x-billing-project': 'foreign' } })).status, 401);
    assert.equal((await fetch(endpoint, { headers })).status, 200);
    const before = await generated();
    assert.deepEqual(await (await fetch(endpoint, { method: 'POST', headers })).json(), { created: 0, failed: 0 });
    assert.deepEqual(await generated(), before);
  });
}
