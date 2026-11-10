import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Browser } from './auth.test.mjs';
import { fixturePassword } from './auth-fixtures.mjs';
import { runPendingDistributionTests } from './competition-distribution.test.mjs';

export async function runGeneralTableTests({ t, db, baseUrl, admin, reader, league, users }) {
  const sport = (await db.query("SELECT id FROM sports_management.sports WHERE code='SOCCER'")).rows[0].id;
  const season = (await db.query("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,'Tabla general sintética','2026-01-01','2026-12-31') RETURNING id",[league,sport])).rows[0].id;
  const rule = (await db.query('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,1) RETURNING id',[season])).rows[0].id;
  const category = (await db.query("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,'General sintética') RETURNING id",[league,sport])).rows[0].id;
  const participation = (await db.query("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date) VALUES($1,$2,$3,1,'OPEN','2026-01-01') RETURNING id",[season,category,rule])).rows[0].id;
  const path = `/api/competitions/seasons/${season}/categories/${participation}`;
  const request = (browser,url,method,body) => browser.request(url,{method,headers:{origin:baseUrl,'content-type':'application/json'},body:JSON.stringify(body)});
  const body = {format:'GENERAL_TABLE',expectedSeasonVersion:1,reason:'Configurar tabla sintética'};
  let group;
  await t.test('formato: permisos, versión y único General creado atómicamente', async () => {
    assert.equal((await request(reader,`${path}/format`,'PATCH',body)).status,403);
    const responses = await Promise.all([request(admin,`${path}/format`,'PATCH',body),request(admin,`${path}/format`,'PATCH',body)]);
    assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
    const acknowledged = await responses.find(response=>response.status===200).json();
    assert.equal(acknowledged.id,participation);
    group = acknowledged.group;
    assert.equal(group.name,'General');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.groups WHERE season_category_id=$1',[participation])).rows[0].n,1);
    assert.equal((await request(admin,`${path}/groups`,'POST',{name:'Otro',expectedSeasonVersion:2,reason:'Intento sintético'})).status,409);
    assert.equal((await request(admin,`${path}/groups`,'DELETE',{groupId:group.id,expectedSeasonVersion:2,reason:'Intento sintético'})).status,409);
    await assert.rejects(db.query("UPDATE sports_management.groups SET name='Ajeno' WHERE id=$1",[group.id]));
    await assert.rejects(db.query("INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES($1,$2,'Extra')",[season,participation]));
    assert.equal((await db.query('SELECT name FROM sports_management.groups WHERE id=$1',[group.id])).rows[0].name,'General');
  });
  const club = (await db.query("INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES($1,$2,'Club General sintético') RETURNING id",[league,randomUUID()])).rows[0].id;
  await db.query("INSERT INTO sports_management.permissions(module,action) VALUES('clubs','CREATE'),('clubs','READ') ON CONFLICT DO NOTHING");
  await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
    SELECT r.id,p.id,true FROM sports_management.roles r CROSS JOIN sports_management.permissions p
    WHERE r.code='CLUB_DELEGATE' AND p.module='clubs' AND p.action IN ('CREATE','READ') ON CONFLICT DO NOTHING`);
  await db.query("INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id,delegate_position) SELECT $1,id,$2,$3,'PRIMARY' FROM sports_management.roles WHERE code='CLUB_DELEGATE'",[users.idle.id,league,club]);
  const affiliation = (await db.query(`INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,status,requested_by,reviewed_by,reviewed_at)
    VALUES($1,$2,$3,$4,'Azul','APPROVED',$5,$6,clock_timestamp()) RETURNING id`,[season,club,league,randomUUID(),users.idle.id,users.operational.id])).rows[0].id;
  await db.query('INSERT INTO sports_management.club_affiliation_categories(affiliation_id,season_id,category_id,authorized_by,authorized_at) VALUES($1,$2,$3,$4,clock_timestamp())',[affiliation,season,category,users.operational.id]);
  const delegate = new Browser(baseUrl); await delegate.login(users.idle.email,fixturePassword);
  const enrollment = {enrollmentKey:randomUUID(),clubId:club,seasonId:season,categoryId:category,team:{mode:'new',name:'Equipo General'}};
  await t.test('formato: inscripción sin seleccionar grupo, reintento y recuperación', async () => {
    const response = await request(delegate,'/api/team-enrollments','POST',enrollment); assert.equal(response.status,201);
    const result = await response.json(); assert.equal(result.groupId,group.id); assert.equal(result.status,'REGISTERED');
    const replay = await request(delegate,'/api/team-enrollments','POST',enrollment); assert.equal(replay.status,200); assert.equal((await replay.json()).id,result.id);
    const recovered = await delegate.request(`/api/team-enrollments/operations/${enrollment.enrollmentKey}?clubId=${club}`);
    assert.equal(recovered.status,200); assert.equal((await recovered.json()).enrollment.groupId,group.id);
    const forged = await request(delegate,'/api/team-enrollments','POST',{...enrollment,enrollmentKey:randomUUID(),groupId:randomUUID()}); assert.equal(forged.status,400);
  });
  await t.test('formato: cancelar una intención sin grupo bloquea su envío tardío', async () => {
    const pending = {...enrollment,enrollmentKey:randomUUID(),team:{mode:'new',name:'Cancelado sintético'}};
    const cancelled = await request(delegate,`/api/team-enrollments/operations/${pending.enrollmentKey}/cancel`,'POST',pending);
    assert.equal(cancelled.status,200);
    const late = await request(delegate,'/api/team-enrollments','POST',pending);
    assert.equal(late.status,409); assert.equal((await late.json()).code,'OPERATION_CANCELLED');
  });
  await runPendingDistributionTests({t,db,baseUrl,admin,reader,delegate,club,league,sport,users,request});
}
