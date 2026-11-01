import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runLifecycleTests({t,db,admin,reader,baseUrl,league,users}) {
 const reason='PDGLD-94: configuración sintética';
 const send=(url,body,browser=admin,method='PATCH')=>browser.request(url,{method,headers:{origin:baseUrl,'content-type':'application/json'},body:JSON.stringify(body)});
 const sport=(await db.query("SELECT id FROM sports_management.sports WHERE code='SOCCER'")).rows[0].id;
 const season=(await db.query("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,$3,'2026-01-01','2026-12-31') RETURNING id",[league,sport,randomUUID()])).rows[0].id;
 const rule=(await db.query('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,1) RETURNING id',[season])).rows[0].id;
 const catalog=(await db.query('INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,$3) RETURNING id',[league,sport,randomUUID()])).rows[0].id;
 const category=(await db.query("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,eligibility_pending) VALUES($1,$2,$3,1,'YOUTH',true) RETURNING id",[season,catalog,rule])).rows[0].id;
 const url=`/api/competitions/seasons/${season}/categories/${category}/player-policy`;
 const policy={referenceYear:2026,minimumAge:14,maximumAge:16,exceptionMinimumAge:13,documents:['PHOTO','CURP','SCHOOL_CREDENTIAL'],registrationDays:[1,2,3],timezone:'America/Mexico_City',playersOnField:11,maximumCalledUp:18,maximumRoster:null};
 await t.test('jugadores: contrato estricto, permiso, ámbito y configuración concurrente auditada',async()=>{
  const body={policy,reason,expectedSeasonVersion:1};
  assert.equal((await send(url,body,reader)).status,403);
  assert.equal((await send(url,{...body,policy:{...policy,maximumAge:12}})).status,400);
  assert.equal((await send(url,{...body,policy:{...policy,timezone:'No/Existe'}})).status,400);
  assert.equal((await send(url,{...body,approved:true})).status,400);
  const wrong=url.replace(category,randomUUID());assert.equal((await send(wrong,body)).status,400);
  const responses=await Promise.all([send(url,body),send(url,body)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const row=(await db.query('SELECT * FROM sports_management.season_categories WHERE id=$1',[category])).rows[0];
  assert.equal(row.eligibility_pending,false);assert.deepEqual(row.player_policy,policy);assert.equal(row.minimum_age,14);
  assert.equal((await db.query("SELECT count(*)::int n FROM sports_management.audit_logs WHERE entity_id=$1 AND table_name='season_categories' AND action='UPDATE'",[category])).rows[0].n,1);
  const listed=await(await admin.request(`/api/competitions/seasons/${season}/categories`)).json();assert.deepEqual(listed.items.find(c=>c.id===category).playerPolicy,policy);
 });
 await t.test('jugadores: fallo de auditoría revierte política y versión; cerradas no admiten cambios',async()=>{
  await db.query(`CREATE FUNCTION pg_temp.reject_policy_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.table_name='season_categories' THEN RAISE EXCEPTION 'fallo sintético'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER test_policy_audit BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_policy_audit()`);
  try { assert.equal((await send(url,{policy:{...policy,referenceYear:2027},reason,expectedSeasonVersion:2})).status,503); }
  finally { await db.query('DROP TRIGGER test_policy_audit ON sports_management.audit_logs'); }
  assert.equal((await db.query('SELECT version FROM sports_management.seasons WHERE id=$1',[season])).rows[0].version,2);
  await db.query("UPDATE sports_management.seasons SET status='ACTIVE' WHERE id=$1",[season]);
  assert.equal((await send(url,{policy,reason,expectedSeasonVersion:2})).status,409);
 });
 const close=`/api/competitions/seasons/${season}/close`,body={confirm:'CERRAR',reason,expectedSeasonVersion:2};
 await t.test('cierre: permiso, confirmación, auditoría atómica y una sola operación concurrente',async()=>{
  assert.equal((await send(close,body,reader,'POST')).status,403);
  assert.equal((await send(close,{...body,confirm:'si'},admin,'POST')).status,400);
  await db.query(`CREATE FUNCTION pg_temp.reject_closure_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.table_name='seasons' AND NEW.new_data->>'status'='CLOSED' THEN RAISE EXCEPTION 'fallo sintético'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER test_closure_audit BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_closure_audit()`);
  try { assert.equal((await send(close,body,admin,'POST')).status,503); }
  finally { await db.query('DROP TRIGGER test_closure_audit ON sports_management.audit_logs'); }
  assert.equal((await db.query('SELECT status FROM sports_management.seasons WHERE id=$1',[season])).rows[0].status,'ACTIVE');
  const results=await Promise.all([send(close,body,admin,'POST'),send(close,body,admin,'POST')]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const row=(await db.query('SELECT status,version,closed_at FROM sports_management.seasons WHERE id=$1',[season])).rows[0];assert.equal(row.status,'CLOSED');assert.equal(row.version,3);assert.ok(row.closed_at);
  assert.equal((await db.query("SELECT count(*)::int n FROM sports_management.audit_logs WHERE entity_id=$1 AND new_data->>'status'='CLOSED'",[season])).rows[0].n,1);
  assert.equal((await send(url,{policy,reason,expectedSeasonVersion:3})).status,409);
  await assert.rejects(db.query("UPDATE sports_management.seasons SET status='ACTIVE' WHERE id=$1",[season]));
  await assert.rejects(db.query("UPDATE sports_management.season_categories SET hierarchy_order=2 WHERE id=$1",[category]));
  await assert.rejects(db.query("UPDATE sports_management.competition_rule_parameters SET requires_validation=false WHERE competition_rule_id=$1",[rule]).then(async()=>{
   // Una dependencia insertada después del cierre también debe ser rechazada.
   await db.query("INSERT INTO sports_management.competition_rule_parameters(competition_rule_id,parameter_key,parameter_value) VALUES($1,'closed-test','{}')",[rule]);
  }));
 });
 await t.test('cierre: partidos pendientes bloquean API y SQL; resultado definitivo habilita cierre',async()=>{
  // Reutiliza solo el fixture aislado de distribución, nunca la base del usuario.
  const group=(await db.query(`SELECT e.season_id,e.group_id,array_agg(e.id) teams FROM sports_management.season_teams e JOIN sports_management.seasons s ON s.id=e.season_id WHERE s.status IN ('PLANNED','ACTIVE') AND e.group_id IS NOT NULL GROUP BY e.season_id,e.group_id HAVING count(*)>=2 LIMIT 1`)).rows[0];assert.ok(group);
  const sid=group.season_id;
  const matchday=(await db.query("INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) SELECT $1,coalesce(max(number),0)+1,'2026-02-01','2026-02-02' FROM sports_management.matchdays WHERE season_id=$1 RETURNING id",[sid])).rows[0].id;
  const match=(await db.query("INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id) VALUES($1,$2,$3,'Cierre-1',$4,$5) RETURNING id",[sid,group.group_id,matchday,group.teams[0],group.teams[1]])).rows[0].id;
  await db.query("UPDATE sports_management.seasons SET status='ACTIVE' WHERE id=$1",[sid]);
  const version=(await db.query('SELECT version FROM sports_management.seasons WHERE id=$1',[sid])).rows[0].version;
  const endpoint=`/api/competitions/seasons/${sid}/close`,payload={...body,expectedSeasonVersion:version};
  const rejected=await send(endpoint,payload,admin,'POST');assert.equal(rejected.status,409);assert.equal((await rejected.json()).code,'UNRESOLVED_MATCHES');
  await assert.rejects(db.query("UPDATE sports_management.seasons SET status='CLOSED' WHERE id=$1",[sid]));
  await db.query("UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('FINISHED') WHERE id=$1",[match]);
  assert.equal((await send(endpoint,payload,admin,'POST')).status,409);
  await db.query("INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,validated_by) VALUES($1,2,1,'MATCH_REPORT',$2)",[match,users.operational.id]);
  assert.equal((await send(endpoint,payload,admin,'POST')).status,200);
  await assert.rejects(db.query('UPDATE sports_management.match_results SET home_score=3 WHERE match_id=$1',[match]));
 });
}
