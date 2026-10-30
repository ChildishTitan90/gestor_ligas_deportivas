import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Browser } from './auth.test.mjs';

export async function runCategoryTests({ t, db, baseUrl, admin, reader, league, other }) {
  const catalog = '/api/competitions/categories';
  const reason = 'PDGLD-38: categoría sintética';
  const post = (browser,path,body) => browser.request(path,{method:'POST',headers:{origin:baseUrl,'content-type':'application/json'},body:JSON.stringify(body)});
  const sport = (await db.query("SELECT id FROM sports_management.sports WHERE code='SOCCER'")).rows[0].id;
  const makeSeason = async name => (await db.query(`INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date)
    VALUES ($1,$2,$3,'2026-01-01','2026-12-31') RETURNING id`,[league,sport,name])).rows[0].id;
  const season = await makeSeason('Categorías edición A');
  const seasonB = await makeSeason('Categorías edición B');
  const makeDraft = async id => {
    const response = await post(admin,`/api/competitions/seasons/${id}/configuration`,{expectedSeasonVersion:1,reason,
      announcement:'Propuesta sintética',points:{win:3,draw:1,loss:0},tieBreakers:['WINS'],calendar:{rounds:1,matchDurationMinutes:90}});
    assert.equal(response.status,201); return (await response.json()).id;
  };
  const rule = await makeDraft(season), ruleB = await makeDraft(seasonB);
  await t.test('categorías: la migración conserva una participación anterior y su corte', async () => {
    await db.query('BEGIN');
    try {
      // Solo dentro de esta base desechable y transacción revertida se reconstruye
      // la forma anterior; se ejecuta el archivo real sobre una fila preexistente.
      await db.query(`ALTER TABLE sports_management.season_categories
        DROP CONSTRAINT season_categories_eligibility_configuration_check,
        DROP COLUMN eligibility_pending, ALTER COLUMN age_cutoff_date SET NOT NULL`);
      const legacy = (await db.query("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,'Legada para migración') RETURNING id",[league,sport])).rows[0].id;
      const participation = (await db.query(`INSERT INTO sports_management.season_categories
        (season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date)
        VALUES ($1,$2,$3,1,'OPEN','2026-08-01') RETURNING id`,[season,legacy,rule])).rows[0].id;
      const migration = readFileSync(new URL('../../prisma/migrations/20261028120000_pdgld38_pending_category_eligibility/migration.sql',import.meta.url),'utf8');
      await db.query('SET CONSTRAINTS ALL IMMEDIATE');
      await db.query(migration);
      const row = (await db.query('SELECT category_id,competition_rule_id,age_cutoff_date::text,eligibility_pending FROM sports_management.season_categories WHERE id=$1',[participation])).rows[0];
      assert.equal(row.category_id,legacy); assert.equal(row.competition_rule_id,rule);
      assert.equal(row.age_cutoff_date,'2026-08-01'); assert.equal(row.eligibility_pending,false);
    } finally { await db.query('ROLLBACK'); }
  });
  const path = `/api/competitions/seasons/${season}/categories`;
  let category;
  await t.test('categorías: catálogo con autenticación, ámbito y permiso de creación', async () => {
    assert.equal((await new Browser(baseUrl).request(`${catalog}?leagueId=${league}`)).status,401);
    assert.equal((await reader.request(`${catalog}?leagueId=${other}`)).status,403);
    assert.equal((await post(reader,catalog,{leagueId:league,name:'Sin permiso',reason})).status,403);
    assert.equal((await post(admin,catalog,{leagueId:other,name:'Fuera de ámbito',reason})).status,403);
    assert.equal((await post(admin,catalog,{leagueId:league,name:'  ',reason})).status,400);
    const response = await post(admin,catalog,{leagueId:league,name:' Juvenil sintética ',reason});
    assert.equal(response.status,201); category = await response.json(); assert.equal(category.name,'Juvenil sintética');
    const list = await reader.request(`${catalog}?leagueId=${league}`); assert.match(list.headers.get('cache-control'),/no-store/);
    assert.ok((await list.json()).items.some(item=>item.id===category.id));
  });
  await t.test('categorías: unicidad concurrente y auditoría del catálogo', async () => {
    const responses = await Promise.all([post(admin,catalog,{leagueId:league,name:'Libre sintética',reason}),post(admin,catalog,{leagueId:league,name:'Libre sintética',reason})]);
    assert.deepEqual(responses.map(response=>response.status).sort(),[201,409]);
    const created = await responses.find(response=>response.status===201).json();
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE table_name='categories' AND entity_id=$1",[created.id])).rows[0].n,1);
  });
  const association = () => ({categoryId:category.id,ruleId:rule,expectedSeasonVersion:2,hierarchyOrder:1,type:'YOUTH',reason});
  await t.test('categorías: relación exige permiso, misma liga/deporte y reglas de la edición', async () => {
    assert.equal((await post(reader,path,association())).status,403);
    assert.equal((await post(admin,path,{...association(),ruleId:ruleB})).status,400);
    const alien = (await db.query("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,'Ajena') RETURNING id",[other,sport])).rows[0].id;
    assert.equal((await post(admin,path,{...association(),categoryId:alien})).status,400);
    const basketball = (await db.query("INSERT INTO sports_management.sports(code,name) VALUES('TEST_BASKET','Solo prueba') RETURNING id")).rows[0].id;
    const alienSport = (await db.query("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,'Otro deporte') RETURNING id",[league,basketball])).rows[0].id;
    assert.equal((await post(admin,path,{...association(),categoryId:alienSport})).status,400);
    assert.equal((await post(admin,path,{...association(),minimumAge:12})).status,400);
  });
  await t.test('categorías: asociación pendiente de PV-04 sin edades ni corte inventados', async () => {
    const response = await post(admin,path,association()); assert.equal(response.status,201);
    const result = await response.json(); assert.equal(result.seasonVersion,3); assert.equal(result.eligibilityPending,true);
    const detail = await (await reader.request(path)).json(); const item = detail.items.find(item=>item.id===result.id);
    assert.equal(item.name,category.name); assert.equal(item.ageCutoffDate,null); assert.equal(item.minimumAge,null); assert.equal(item.maximumAge,null);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE table_name='season_categories' AND entity_id=$1",[result.id])).rows[0].n,1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE table_name='seasons' AND entity_id=$1 AND action='UPDATE'",[season])).rows[0].n,2);
    assert.equal((await post(admin,path,association())).status,409);
    const repeated = await post(admin,path,{...association(),expectedSeasonVersion:3});
    assert.equal(repeated.status,409); assert.equal((await repeated.json()).code,'CATEGORY_ALREADY_EXISTS');
  });
  await t.test('categorías: reutilizar catálogo en otra temporada conserva la primera edición', async () => {
    const before = await (await admin.request(path)).json();
    const response = await post(admin,`/api/competitions/seasons/${seasonB}/categories`,{...association(),ruleId:ruleB});
    assert.equal(response.status,201);
    assert.deepEqual(await (await admin.request(path)).json(),before);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.season_categories WHERE category_id=$1',[category.id])).rows[0].n,2);
  });
  await t.test('categorías: constraint conserva corte obligatorio para configuraciones no pendientes', async () => {
    await assert.rejects(db.query('UPDATE sports_management.season_categories SET eligibility_pending=false WHERE season_id=$1',[season]), error=>error.code==='23514');
    assert.equal((await db.query('SELECT eligibility_pending FROM sports_management.season_categories WHERE season_id=$1',[season])).rows[0].eligibility_pending,true);
  });
  await t.test('categorías: dos asociaciones simultáneas no sobrescriben la versión de temporada', async () => {
    const catalogA = await (await post(admin,catalog,{leagueId:league,name:'Carrera A',reason})).json();
    const catalogB = await (await post(admin,catalog,{leagueId:league,name:'Carrera B',reason})).json();
    const results = await Promise.all([catalogA,catalogB].map(item=>post(admin,`/api/competitions/seasons/${seasonB}/categories`,{
      ...association(),ruleId:ruleB,categoryId:item.id,expectedSeasonVersion:3,hierarchyOrder:2,
    })));
    assert.deepEqual(results.map(response=>response.status).sort(),[201,409]);
    assert.equal((await results.find(response=>response.status===409).json()).code,'STALE_CONFIGURATION');
    assert.equal((await db.query('SELECT version FROM sports_management.seasons WHERE id=$1',[seasonB])).rows[0].version,4);
  });
  await t.test('categorías: falla de auditoría revierte asociación y versión', async () => {
    const newCategory = await (await post(admin,catalog,{leagueId:league,name:'Rollback sintético',reason})).json();
    await db.query(`CREATE FUNCTION pg_temp.reject_category_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.table_name='season_categories' THEN RAISE EXCEPTION 'Fallo sintético'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_category_audit BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_category_audit()`);
    try {
      assert.equal((await post(admin,path,{...association(),categoryId:newCategory.id,expectedSeasonVersion:3})).status,503);
      assert.equal((await db.query('SELECT version FROM sports_management.seasons WHERE id=$1',[season])).rows[0].version,3);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.season_categories WHERE category_id=$1',[newCategory.id])).rows[0].n,0);
    } finally { await db.query('DROP TRIGGER test_category_audit ON sports_management.audit_logs'); }
  });
  await t.test('categorías: cerrada consultable, asociación prohibida y temporada iniciada protegida', async () => {
    await db.query("UPDATE sports_management.seasons SET status='CLOSED' WHERE id=$1",[season]);
    assert.equal((await admin.request(path)).status,200);
    assert.equal((await post(admin,path,{...association(),expectedSeasonVersion:3})).status,409);
    await db.query("UPDATE sports_management.seasons SET status='ACTIVE',competition_starts_at=clock_timestamp() WHERE id=$1",[seasonB]);
    const response = await post(admin,`/api/competitions/seasons/${seasonB}/categories`,{...association(),ruleId:ruleB,expectedSeasonVersion:3});
    assert.equal(response.status,409); assert.equal((await response.json()).code,'COMPETITION_ALREADY_STARTED');
  });
}
