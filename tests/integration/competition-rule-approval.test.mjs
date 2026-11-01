import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runRuleApprovalTests({ t, db, baseUrl, admin, reader, league, other, users }) {
  const sport = (await db.query("SELECT id FROM sports_management.sports WHERE code='SOCCER'")).rows[0].id;
  const season = (await db.query("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,$3,'2026-01-01','2026-12-31') RETURNING id", [league, sport, randomUUID()])).rows[0].id;
  const path = `/api/competitions/seasons/${season}/configuration`;
  const input = { expectedSeasonVersion: 1, reason: 'PDGLD-38: reglamento sintético para aprobación',
    announcement: 'Convocatoria de prueba sin validez oficial', points: { win: 3, draw: 1, loss: 0 },
    tieBreakers: ['GOAL_DIFFERENCE'], calendar: { rounds: 1, matchDurationMinutes: 90 } };
  const post = (url, body, browser = admin, origin = baseUrl) => browser.request(url, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const created = await post(path, input); assert.equal(created.status, 201);
  const draft = await created.json();
  const approve = `${path}/${draft.id}/approve`;
  const body = { confirm: 'APROBAR', reason: 'Revisados los cuatro parámetros sintéticos', expectedSeasonVersion: 2 };
  const snapshot = async () => ({
    rule: (await db.query('SELECT status,approved_by,approved_at FROM sports_management.competition_rules WHERE id=$1', [draft.id])).rows[0],
    parameters: (await db.query('SELECT parameter_key,requires_validation,validated_by FROM sports_management.competition_rule_parameters WHERE competition_rule_id=$1 ORDER BY parameter_key', [draft.id])).rows,
    version: (await db.query('SELECT version FROM sports_management.seasons WHERE id=$1', [season])).rows[0].version,
    audits: (await db.query('SELECT count(*)::int n FROM sports_management.audit_logs')).rows[0].n,
  });
  await t.test('aprobación: permiso independiente, confirmación, origen, ámbito y versión sin escrituras', async () => {
    const before = await snapshot();
    assert.equal((await post(approve, body, reader)).status, 403);
    assert.equal((await post(approve, { ...body, confirm: 'si' })).status, 400);
    assert.equal((await post(approve, { ...body, approvedBy: users.operational.id })).status, 400);
    assert.equal((await post(approve, body, admin, 'https://foreign.example.test')).status, 403);
    assert.equal((await post(approve, { ...body, expectedSeasonVersion: 1 })).status, 409);
    const foreign = (await db.query("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,$3,'2026-01-01','2026-12-31') RETURNING id", [other, sport, randomUUID()])).rows[0].id;
    assert.equal((await post(`/api/competitions/seasons/${foreign}/configuration/${draft.id}/approve`, body)).status, 403);
    assert.equal((await post(`${path}/${randomUUID()}/approve`, body)).status, 400);
    await db.query(`DELETE FROM sports_management.role_permissions rp USING sports_management.roles r,sports_management.permissions p WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.code='SUPERADMIN' AND p.module='competitions' AND p.action='APPROVE'`);
    try { assert.equal((await post(approve, body)).status, 403, 'CREATE/UPDATE no sustituyen APPROVE.'); }
    finally { await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) SELECT r.id,p.id,false FROM sports_management.roles r,sports_management.permissions p WHERE r.code='SUPERADMIN' AND p.module='competitions' AND p.action='APPROVE'`); }
    // La preparación/revocación genera su propia auditoría; los rechazos conservan reglas y versión.
    const after = await snapshot();
    assert.deepEqual(after.rule, before.rule); assert.deepEqual(after.parameters, before.parameters); assert.equal(after.version, before.version);
    assert.match(await (await admin.request(`/competitions/seasons/${season}`)).text(), /Aprobar reglamento versión/);
    assert.doesNotMatch(await (await reader.request(`/competitions/seasons/${season}`)).text(), /Aprobar reglamento versión/);
  });
  await t.test('aprobación: reglas incompletas se rechazan y un fallo tardío revierte parámetros, versión y auditoría', async () => {
    const incomplete = (await db.query('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,2) RETURNING id', [season])).rows[0].id;
    const invalid = await post(`${path}/${incomplete}/approve`, body);
    assert.equal(invalid.status, 409); assert.equal((await invalid.json()).code, 'INVALID_RULE_PARAMETERS');
    await db.query(`CREATE FUNCTION pg_temp.reject_rule_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='APPROVED' THEN RAISE EXCEPTION 'Fallo sintético de aprobación'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_rule_approval BEFORE UPDATE ON sports_management.competition_rules FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_rule_approval()`);
    const before = await snapshot();
    try { assert.equal((await post(approve, body)).status, 503); assert.deepEqual(await snapshot(), before); }
    finally { await db.query('DROP TRIGGER test_rule_approval ON sports_management.competition_rules'); }
  });
  await t.test('aprobación: un ganador concurrente, validador real y reglas aprobadas inmutables', async () => {
    const results = await Promise.all([post(approve, body), post(approve, body)]);
    assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
    const saved = await snapshot();
    assert.equal(saved.rule.status, 'APPROVED'); assert.equal(saved.rule.approved_by, users.operational.id); assert.ok(saved.rule.approved_at);
    assert.equal(saved.version, 3); assert.equal(saved.parameters.length, 4);
    assert.ok(saved.parameters.every(parameter => !parameter.requires_validation && parameter.validated_by === users.operational.id));
    assert.equal((await db.query("SELECT count(*)::int n FROM sports_management.audit_logs WHERE entity_id=$1 AND table_name='competition_rules' AND action='UPDATE'", [draft.id])).rows[0].n, 1);
    await assert.rejects(db.query("UPDATE sports_management.competition_rule_parameters SET parameter_value='{}' WHERE competition_rule_id=$1", [draft.id]));
    await assert.rejects(db.query("UPDATE sports_management.competition_rules SET status='DRAFT' WHERE id=$1", [draft.id]));
    assert.equal((await post(approve, { ...body, expectedSeasonVersion: 3 })).status, 409);
  });
  await t.test('aprobación: la versión revisada y asociada habilita iniciar, sin aprobar el otro borrador', async () => {
    const category = (await db.query('INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,$3) RETURNING id', [league, sport, randomUUID()])).rows[0].id;
    const associated = await post(`/api/competitions/seasons/${season}/categories`, {
      categoryId: category, ruleId: draft.id, expectedSeasonVersion: 3, hierarchyOrder: 1, type: 'OPEN', reason: body.reason,
    });
    assert.equal(associated.status, 201);
    const lifecycle = `/api/competitions/seasons/${season}/lifecycle`;
    assert.equal((await post(`${lifecycle}/close-registrations`, { reason: body.reason, expectedSeasonVersion: 4 })).status, 200);
    assert.equal((await post(`${lifecycle}/start`, { reason: body.reason, expectedSeasonVersion: 5 })).status, 200);
    const rules = (await db.query('SELECT status FROM sports_management.competition_rules WHERE season_id=$1 ORDER BY version_number', [season])).rows;
    assert.deepEqual(rules.map(rule => rule.status), ['APPROVED', 'DRAFT']);
    assert.equal((await db.query('SELECT status FROM sports_management.seasons WHERE id=$1', [season])).rows[0].status, 'ACTIVE');
  });
}
