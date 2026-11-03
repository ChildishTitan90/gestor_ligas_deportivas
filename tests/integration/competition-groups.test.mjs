import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Browser } from './auth.test.mjs';

export async function runGroupTests({ t, db, baseUrl, admin, reader, league, other }) {
  const sport = (await db.query("SELECT id FROM sports_management.sports WHERE code='SOCCER'")).rows[0].id;
  const season = (await db.query(`INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date)
    VALUES($1,$2,'Grupos sintéticos','2026-01-01','2026-12-31') RETURNING id`,[league,sport])).rows[0].id;
  const rule = (await db.query('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,1) RETURNING id',[season])).rows[0].id;
  const catalog = (await db.query("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,'Catálogo grupos sintéticos') RETURNING id",[league,sport])).rows[0].id;
  const participation = (await db.query(`INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date)
    VALUES($1,$2,$3,1,'OPEN','2026-01-01') RETURNING id`,[season,catalog,rule])).rows[0].id;
  const path = `/api/competitions/seasons/${season}/categories/${participation}/groups`;
  const reason = 'PDGLD-38: prueba aislada de grupos';
  const send = (method,body,browser=admin,headers={}) => browser.request(path,{method,headers:{origin:baseUrl,'content-type':'application/json',...headers},body:JSON.stringify(body)});
  const version = async () => (await db.query('SELECT version FROM sports_management.seasons WHERE id=$1',[season])).rows[0].version;
  let group;
  await t.test('grupos: alta, lectura, renombrado y borrado del vacío con una auditoría por operación', async () => {
    const response = await send('POST',{name:' Grupo A ',expectedSeasonVersion:1,reason}); assert.equal(response.status,201);
    group = await response.json(); assert.equal(group.name,'Grupo A'); assert.equal(group.seasonVersion,2);
    const listed = await reader.request(path); assert.equal(listed.status,200); assert.match(listed.headers.get('cache-control'),/no-store/);
    assert.ok((await listed.json()).items.some(item=>item.id===group.id));
    const rename = await send('PATCH',{groupId:group.id,name:'Grupo Norte',expectedSeasonVersion:2,reason}); assert.equal(rename.status,200);
    assert.equal((await rename.json()).seasonVersion,3);
    assert.equal((await send('DELETE',{groupId:group.id,expectedSeasonVersion:3,reason})).status,200);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE table_name='groups' AND entity_id=$1",[group.id])).rows[0].n,3);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE table_name='seasons' AND entity_id=$1 AND action='UPDATE'",[season])).rows[0].n,3);
    assert.equal(await version(),4);
  });
  await t.test('grupos: autenticación, permisos, origen y participación de la misma edición', async () => {
    assert.equal((await new Browser(baseUrl).request(path)).status,401);
    assert.equal((await send('POST',{name:'Denegado',expectedSeasonVersion:4,reason},reader)).status,403);
    assert.equal((await send('DELETE',{groupId:randomUUID(),expectedSeasonVersion:4,reason},reader)).status,403);
    assert.equal((await send('POST',{name:'Origen',expectedSeasonVersion:4,reason},admin,{origin:'https://foreign.example.test'})).status,403);
    assert.equal((await send('POST',{name:'   ',expectedSeasonVersion:4,reason})).status,400);
    assert.equal((await reader.request(`/api/competitions/seasons/${season}/categories/${randomUUID()}/groups`)).status,400);
    const otherSeason = (await db.query('SELECT id FROM sports_management.seasons WHERE league_id=$1 LIMIT 1',[other])).rows[0].id;
    assert.equal((await reader.request(`/api/competitions/seasons/${otherSeason}/categories/${participation}/groups`)).status,403);
    assert.equal((await send('PATCH',{groupId:randomUUID(),name:'Ajeno',expectedSeasonVersion:4,reason})).status,400);
  });
  await t.test('grupos: duplicados y carreras no sobrescriben la edición', async () => {
    const created = await send('POST',{name:'Grupo B',expectedSeasonVersion:4,reason}); group = await created.json(); assert.equal(created.status,201);
    const duplicate = await send('POST',{name:'Grupo B',expectedSeasonVersion:5,reason}); assert.equal(duplicate.status,409);
    assert.equal((await duplicate.json()).code,'GROUP_ALREADY_EXISTS');
    const responses = await Promise.all(['Grupo C','Grupo D'].map(name=>send('POST',{name,expectedSeasonVersion:5,reason})));
    assert.deepEqual(responses.map(response=>response.status).sort(),[201,409]);
    assert.equal((await responses.find(response=>response.status===409).json()).code,'STALE_CONFIGURATION');
    assert.equal(await version(),6);
  });
  await t.test('grupos: historial de clasificación impide renombrar o borrar', async () => {
    const matchday = (await db.query("INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES($1,1,'2026-02-01','2026-02-02') RETURNING id",[season])).rows[0].id;
    await db.query('INSERT INTO sports_management.standing_versions(season_id,group_id,matchday_id,competition_rule_id,version_number) VALUES($1,$2,$3,$4,1)',[season,group.id,matchday,rule]);
    for (const method of ['PATCH','DELETE']) {
      const response = await send(method,{groupId:group.id,expectedSeasonVersion:6,reason,...(method==='PATCH'?{name:'Historia cambiada'}:{})});
      assert.equal(response.status,409); assert.equal((await response.json()).code,'GROUP_IN_USE');
    }
    assert.equal((await db.query('SELECT name FROM sports_management.groups WHERE id=$1',[group.id])).rows[0].name,'Grupo B');
    assert.equal(await version(),6);
  });
  await t.test('grupos: fallo de auditoría revierte grupo y versión', async () => {
    await db.query(`CREATE FUNCTION pg_temp.reject_group_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.table_name='groups' THEN RAISE EXCEPTION 'Fallo sintético'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_group_audit BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_group_audit()`);
    try {
      assert.equal((await send('POST',{name:'Revertido',expectedSeasonVersion:6,reason})).status,503);
      assert.equal(await version(),6);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.groups WHERE season_id=$1 AND name='Revertido'",[season])).rows[0].n,0);
    } finally { await db.query('DROP TRIGGER test_group_audit ON sports_management.audit_logs'); }
  });
  await t.test('grupos: retirar UPDATE invalida una edición con sesión ya abierta', async () => {
    const grant = (await db.query(`SELECT rp.* FROM sports_management.role_permissions rp
      JOIN sports_management.roles r ON r.id=rp.role_id JOIN sports_management.permissions p ON p.id=rp.permission_id
      WHERE r.code='SUPERADMIN' AND p.module='competitions' AND p.action='UPDATE'`)).rows[0];
    assert.ok(grant);
    await db.query('DELETE FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2',[grant.role_id,grant.permission_id]);
    try {
      const response = await send('PATCH',{groupId:group.id,name:'Cambio sin autoridad',expectedSeasonVersion:6,reason});
      assert.equal(response.status,403); assert.equal((await response.json()).code,'FORBIDDEN');
      assert.equal(await version(),6);
      assert.equal((await db.query('SELECT name FROM sports_management.groups WHERE id=$1',[group.id])).rows[0].name,'Grupo B');
    } finally {
      await db.query('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES($1,$2,$3)',[grant.role_id,grant.permission_id,grant.context_only]);
    }
  });
  await t.test('grupos: cierre e inicio protegen la configuración, manteniendo consulta', async () => {
    await db.query("UPDATE sports_management.seasons SET status='ACTIVE',competition_starts_at=clock_timestamp() WHERE id=$1",[season]);
    const active = await send('POST',{name:'Tardío',expectedSeasonVersion:6,reason});
    assert.equal(active.status,409); assert.equal((await active.json()).code,'COMPETITION_ALREADY_STARTED');
    await db.query("UPDATE sports_management.seasons SET status='CLOSED' WHERE id=$1",[season]);
    assert.equal((await reader.request(path)).status,200);
    const closed = await send('DELETE',{groupId:group.id,expectedSeasonVersion:6,reason});
    assert.equal(closed.status,409); assert.equal((await closed.json()).code,'SEASON_CLOSED');
  });
}
