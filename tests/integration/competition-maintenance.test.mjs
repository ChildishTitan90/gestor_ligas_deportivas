import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Browser } from './auth.test.mjs';

export async function runMaintenanceTests({ t, db, baseUrl, admin, reader, league, other }) {
  const sport = (await db.query("SELECT id FROM sports_management.sports WHERE code='SOCCER'")).rows[0].id;
  const createSeason = async leagueId => (await db.query("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,$3,'2026-01-01','2026-12-31') RETURNING id",[leagueId,sport,`Mantenimiento ${randomUUID()}`])).rows[0].id;
  const season = await createSeason(league);
  const rule = (await db.query('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,1) RETURNING id',[season])).rows[0].id;
  const foreignSeason = await createSeason(other);
  const foreignRule = (await db.query('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,1) RETURNING id',[foreignSeason])).rows[0].id;
  const catalog = (await db.query("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,$3) RETURNING id",[league,sport,`Mantenimiento ${randomUUID()}`])).rows[0].id;
  const category = (await db.query("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,eligibility_pending) VALUES($1,$2,$3,1,'OPEN',true) RETURNING id",[season,catalog,rule])).rows[0].id;
  const path = `/api/competitions/seasons/${season}/categories/${category}`;
  const send = (path,method,data,browser=admin,extra={}) => browser.request(path,{method,headers:{origin:baseUrl,'content-type':'application/json',...extra},body:JSON.stringify(data)});
  const version = async () => (await db.query('SELECT version FROM sports_management.seasons WHERE id=$1',[season])).rows[0].version;
  const reason = 'PDGLD-94: mantenimiento sintético';
  const edit = {ruleId:rule,hierarchyOrder:2,type:'YOUTH',expectedSeasonVersion:1,reason};
  await t.test('mantenimiento: edición estricta, ámbito, origen y autorización vigente',async()=>{
    assert.equal((await send(path,'PATCH',edit,new Browser(baseUrl))).status,401);
    assert.equal((await send(path,'PATCH',edit,reader)).status,403);
    assert.equal((await send(path,'PATCH',edit,admin,{origin:'https://outside.invalid'})).status,403);
    assert.equal((await send(path,'PATCH',{...edit,categoryId:randomUUID()})).status,400);
    assert.equal((await send(path,'PATCH',{...edit,ruleId:foreignRule})).status,400);
    assert.equal(await version(),1);
    const results=await Promise.all([send(path,'PATCH',edit),send(path,'PATCH',edit)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal(await version(),2);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE entity_id=$1 AND table_name='season_categories' AND action='UPDATE'",[category])).rows[0].n,1);
    assert.equal((await db.query('SELECT category_id FROM sports_management.season_categories WHERE id=$1',[category])).rows[0].category_id,catalog);
  });
  await t.test('mantenimiento: referencias impiden editar o retirar categoría y temporada',async()=>{
    const group=(await db.query("INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES($1,$2,'Grupo protegido') RETURNING id",[season,category])).rows[0].id;
    for (const [method,payload] of [['PATCH',{...edit,expectedSeasonVersion:2}],['DELETE',{expectedSeasonVersion:2,reason}]]) {
      const response=await send(path,method,payload); assert.equal(response.status,409); assert.equal((await response.json()).code,'CATEGORY_IN_USE');
    }
    const blocked=await send(`/api/competitions/seasons/${season}`,'DELETE',{expectedSeasonVersion:2,reason});
    assert.equal(blocked.status,409); assert.equal((await blocked.json()).code,'SEASON_IN_USE');
    assert.equal(await version(),2);
    await db.query('DELETE FROM sports_management.groups WHERE id=$1',[group]);
  });
  await t.test('mantenimiento: auditoría fallida revierte retirada y versión; retirada concurrente es única',async()=>{
    await db.query(`CREATE FUNCTION pg_temp.reject_maintenance_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.table_name='season_categories' AND NEW.action='DELETE' THEN RAISE EXCEPTION 'fallo sintético'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_maintenance_audit BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_maintenance_audit()`);
    try {
      assert.equal((await send(path,'DELETE',{expectedSeasonVersion:2,reason})).status,503);
      assert.equal(await version(),2);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.season_categories WHERE id=$1',[category])).rows[0].n,1);
    } finally { await db.query('DROP TRIGGER test_maintenance_audit ON sports_management.audit_logs'); }
    const results=await Promise.all([send(path,'DELETE',{expectedSeasonVersion:2,reason}),send(path,'DELETE',{expectedSeasonVersion:2,reason})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal(await version(),3);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE entity_id=$1 AND table_name='season_categories' AND action='DELETE'",[category])).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.categories WHERE id=$1',[catalog])).rows[0].n,1);
  });
  await t.test('mantenimiento: preserva elegibilidad configurada y bloquea competencia iniciada o cerrada',async()=>{
    const item=(await db.query("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date) VALUES($1,$2,$3,1,'YOUTH','2026-01-01') RETURNING id",[season,catalog,rule])).rows[0].id;
    const url=`/api/competitions/seasons/${season}/categories/${item}`;
    const response=await send(url,'PATCH',{...edit,type:'OPEN',expectedSeasonVersion:3});
    assert.equal(response.status,409);assert.equal((await response.json()).code,'CATEGORY_ELIGIBILITY_CONFIGURED');
    assert.equal(await version(),3);
    for (const status of ['ACTIVE','CLOSED']) {
      await db.query("UPDATE sports_management.seasons SET status=$1,closed_at=CASE WHEN $1='CLOSED' THEN clock_timestamp() ELSE closed_at END WHERE id=$2",[status,season]);
      for (const [method,payload] of [['PATCH',{...edit,expectedSeasonVersion:3}],['DELETE',{expectedSeasonVersion:3,reason}]]) {
        const rejected=await send(url,method,payload);assert.equal(rejected.status,409);
        assert.equal((await rejected.json()).code,status==='CLOSED'?'SEASON_CLOSED':'COMPETITION_ALREADY_STARTED');
      }
    }
  });
  await t.test('mantenimiento: eliminación de temporada vacía autorizada y auditada, cerradas protegidas',async()=>{
    const empty=await createSeason(league), path=`/api/competitions/seasons/${empty}`, payload={expectedSeasonVersion:1,reason};
    assert.equal((await send(path,'DELETE',payload,reader)).status,403);
    assert.equal((await send(path,'DELETE',{...payload,expectedSeasonVersion:2})).status,409);
    await db.query(`CREATE FUNCTION pg_temp.reject_empty_season_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.table_name='seasons' AND NEW.action='DELETE' THEN RAISE EXCEPTION 'fallo sintético'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_empty_season_audit BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_empty_season_audit()`);
    try {
      assert.equal((await send(path,'DELETE',payload)).status,503);
      assert.equal((await db.query('SELECT version FROM sports_management.seasons WHERE id=$1',[empty])).rows[0].version,1);
    } finally { await db.query('DROP TRIGGER test_empty_season_audit ON sports_management.audit_logs'); }
    assert.equal((await send(path,'DELETE',payload)).status,200);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.seasons WHERE id=$1',[empty])).rows[0].n,0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE entity_id=$1 AND action='DELETE' AND table_name='seasons'",[empty])).rows[0].n,1);
    const closed=await createSeason(league);
    await db.query("UPDATE sports_management.seasons SET status='ACTIVE' WHERE id=$1",[closed]);
    await db.query("UPDATE sports_management.seasons SET status='CLOSED',closed_at=clock_timestamp() WHERE id=$1",[closed]);
    const response=await send(`/api/competitions/seasons/${closed}`,'DELETE',payload);assert.equal(response.status,409);assert.equal((await response.json()).code,'SEASON_CLOSED');
  });
}
