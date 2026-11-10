import assert from 'node:assert/strict';
import { Browser } from './auth.test.mjs';

/** Recibe exclusivamente los recursos de la base desechable de seasons.test.mjs. */
export async function runRuleDraftTests({ t, db, baseUrl, admin, reader, league, other }) {
  const season = (await db.query('SELECT id FROM sports_management.seasons WHERE league_id=$1 ORDER BY name',[league])).rows[0].id;
  const sport = (await db.query("SELECT id FROM sports_management.sports WHERE code='SOCCER'")).rows[0].id;
  const foreignSeason = (await db.query(`INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date)
    VALUES ($1,$2,'Temporada ajena','2026-09-01','2027-06-30') RETURNING id`,[other,sport])).rows[0].id;
  const path = `/api/competitions/seasons/${season}/configuration`;
  // Parámetros sintéticos suministrados por la prueba; nunca defaults de negocio.
  const input = { expectedSeasonVersion:1,reason:'PDGLD-38: propuesta sintética',announcement:'Convocatoria ficticia de prueba',
    points:{win:3,draw:1,loss:0},tieBreakers:['GOAL_DIFFERENCE','GOALS_FOR'],calendar:{rounds:2,matchDurationMinutes:90} };
  const send = (browser, data=input, headers={}) => browser.request(path,{method:'POST',headers:{origin:baseUrl,'content-type':'application/json',...headers},body:JSON.stringify(data)});
  await t.test('reglas: lectura privada y rechazo de ligas ajenas o sesión ausente', async () => {
    const response = await admin.request(path);
    assert.equal(response.status,200); assert.match(response.headers.get('cache-control'),/no-store/);
    assert.equal((await response.json()).rules.length,0);
    assert.equal((await new Browser(baseUrl).request(path)).status,401);
    assert.equal((await admin.request(`/api/competitions/seasons/${foreignSeason}/configuration`)).status,403);
  });
  await t.test('reglas: esquema estricto, origen y permisos no se confían al cliente', async () => {
    assert.equal((await send(reader)).status,403);
    assert.equal((await send(admin,input,{origin:'https://foreign.example.test'})).status,403);
    assert.equal((await send(admin,{...input,tieBreakers:['WINS','WINS']})).status,400);
    assert.equal((await send(admin,{...input,status:'APPROVED',approvedBy:'forged'})).status,400);
    assert.equal((await send(new Browser(baseUrl))).status,401);
  });
  await t.test('reglas: borrador versionado, parámetros pendientes y auditoría sin duplicar', async () => {
    const response = await send(admin); assert.equal(response.status,201);
    const draft = await response.json(); assert.equal(draft.version,1); assert.equal(draft.seasonVersion,2); assert.equal(draft.status,'DRAFT');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE table_name='seasons' AND entity_id=$1 AND action='UPDATE'",[season])).rows[0].n,1);
    const configuration = await (await reader.request(path)).json();
    assert.equal(configuration.rules.length,1);
    assert.equal(configuration.rules[0].parameters.length,4);
    assert.ok(configuration.rules[0].parameters.every(parameter=>parameter.requiresValidation));
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE table_name='competition_rules' AND entity_id=$1 AND action='INSERT'",[draft.id])).rows[0].n,1);
    assert.equal((await db.query('SELECT approved_by,file_id FROM sports_management.competition_rules WHERE id=$1',[draft.id])).rows[0].approved_by,null);
    const page = await admin.request(`/competitions/seasons/${season}`);
    assert.equal(page.status,200);
    const html = await page.text();
    assert.match(html,/Borrador/);
    assert.match(html,/Pendiente de validación/);
    assert.doesNotMatch(html,/No se pudo cargar la configuración/);
  });
  await t.test('reglas: carreras rechazan una versión obsoleta y conservan el borrador anterior', async () => {
    const responses = await Promise.all([send(admin,{...input,expectedSeasonVersion:2,announcement:'Nueva propuesta A'}),send(admin,{...input,expectedSeasonVersion:2,announcement:'Nueva propuesta B'})]);
    assert.deepEqual(responses.map(response=>response.status).sort(),[201,409]);
    const conflict = await responses.find(response=>response.status===409).json(); assert.equal(conflict.code,'STALE_CONFIGURATION');
    const data = await (await admin.request(path)).json();
    assert.equal(data.rules.length,2); assert.equal(data.rules[1].version,1);
    assert.equal(data.rules[1].parameters.find(parameter=>parameter.key==='announcement').value,input.announcement);
  });
  await t.test('reglas: fallo al guardar parámetros revierte borrador, versión y auditoría', async () => {
    await db.query(`CREATE FUNCTION pg_temp.reject_rule_parameter() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Fallo sintético de parámetro'; END $$;
      CREATE TRIGGER test_rule_failure BEFORE INSERT ON sports_management.competition_rule_parameters
      FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_rule_parameter()`);
    const before = await (await admin.request(path)).json();
    const audits = (await db.query('SELECT count(*)::int AS n FROM sports_management.audit_logs')).rows[0].n;
    try {
      assert.equal((await send(admin,{...input,expectedSeasonVersion:3})).status,503);
      assert.deepEqual(await (await admin.request(path)).json(),before);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.audit_logs')).rows[0].n,audits);
    } finally { await db.query('DROP TRIGGER test_rule_failure ON sports_management.competition_rule_parameters'); }
  });
  await t.test('reglas: temporada cerrada permite consulta y deniega nuevas versiones', async () => {
    // Cierre sintético para probar la barrera; no implementa el proceso de cierre.
    await db.query("UPDATE sports_management.seasons SET status='ACTIVE' WHERE id=$1",[season]);
    await db.query("UPDATE sports_management.seasons SET status='CLOSED',closed_at=clock_timestamp() WHERE id=$1",[season]);
    const response = await send(admin,{...input,expectedSeasonVersion:3});
    assert.equal(response.status,409); assert.equal((await response.json()).code,'SEASON_CLOSED');
    assert.equal((await admin.request(path)).status,200);
  });
}
