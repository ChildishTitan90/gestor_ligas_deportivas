import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export async function runPendingDistributionTests({t,db,admin,reader,delegate,club,league,sport,users,request}) {
  await t.test('distribución: migración conserva inscripciones previas, huellas y auditoría incluso en temporada cerrada',async()=>{
    await db.query('BEGIN');
    try {
      const previous=(await db.query('SELECT season_id FROM sports_management.season_teams LIMIT 1')).rows[0];
      assert.ok(previous);
      await db.query("UPDATE sports_management.seasons SET status='ACTIVE' WHERE id=$1",[previous.season_id]);
      await db.query("UPDATE sports_management.seasons SET status='CLOSED' WHERE id=$1",[previous.season_id]);
      await db.query('SET CONSTRAINTS ALL IMMEDIATE');
      const snapshot=async()=> (await db.query(`SELECT to_jsonb(e)-'season_category_id' AS row FROM sports_management.season_teams e ORDER BY id`)).rows;
      const audit=async()=> (await db.query('SELECT to_jsonb(a) AS row FROM sports_management.audit_logs a ORDER BY id')).rows;
      const triggers=async()=> (await db.query("SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='sports_management.season_teams'::regclass AND tgname IN ('record_enrollment_audit','season_read_only') ORDER BY tgname")).rows;
      const before=await snapshot(),auditBefore=await audit(),triggersBefore=await triggers();
      await db.query(`DROP TRIGGER enrollment_distribution ON sports_management.season_teams;
        DROP TRIGGER assigned_teams_before_match ON sports_management.matches;
        DROP TRIGGER distribution_category_history ON sports_management.season_categories;
        DROP TRIGGER distribution_group_history ON sports_management.groups;
        DROP FUNCTION sports_management.enforce_enrollment_distribution();
        DROP FUNCTION sports_management.require_assigned_match_teams();
        DROP FUNCTION sports_management.protect_distributed_category();
        ALTER TABLE sports_management.season_teams DROP COLUMN season_category_id,ALTER COLUMN group_id SET NOT NULL;
        ALTER TABLE sports_management.season_categories DROP CONSTRAINT season_category_format_check,
          ADD CONSTRAINT season_category_format_check CHECK(competition_format IN ('LEGACY_GROUPS','GENERAL_TABLE'))`);
      const sql=readFileSync(new URL('../../prisma/migrations/20261029130000_pdgld38_pending_distribution/migration.sql',import.meta.url),'utf8');
      // El archivo real se ejecuta dentro de esta transacción aislada y revertida.
      await db.query(sql.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,''));
      assert.deepEqual(await snapshot(),before); assert.deepEqual(await audit(),auditBefore); assert.deepEqual(await triggers(),triggersBefore);
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM sports_management.season_teams e JOIN sports_management.groups g ON g.id=e.group_id
        WHERE e.season_category_id IS DISTINCT FROM g.season_category_id`)).rows[0].n,0);
    } finally { await db.query('ROLLBACK'); }
  });
  const season=(await db.query("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,'Distribución sintética','2026-01-01','2026-12-31') RETURNING id",[league,sport])).rows[0].id;
  const rule=(await db.query('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,1) RETURNING id',[season])).rows[0].id;
  const category=(await db.query("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,'Categoría distribución sintética') RETURNING id",[league,sport])).rows[0].id;
  const participation=(await db.query("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date) VALUES($1,$2,$3,1,'OPEN','2026-01-01') RETURNING id",[season,category,rule])).rows[0].id;
  const path=`/api/competitions/seasons/${season}/categories/${participation}`;
  const reason='Prueba sintética de distribución';
  const configured=await request(admin,`${path}/format`,'PATCH',{format:'GROUP_STAGE',expectedSeasonVersion:1,reason});
  assert.equal(configured.status,200); assert.equal((await configured.json()).group,null);
  const groupA=await (await request(admin,`${path}/groups`,'POST',{name:'Grupo A',expectedSeasonVersion:2,reason})).json();
  const groupB=await (await request(admin,`${path}/groups`,'POST',{name:'Grupo B',expectedSeasonVersion:3,reason})).json();
  assert.ok(groupA.id && groupB.id);
  await db.query("INSERT INTO sports_management.permissions(module,action) VALUES('clubs','APPROVE'),('clubs','READ') ON CONFLICT DO NOTHING");
  await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
    SELECT r.id,p.id,false FROM sports_management.roles r CROSS JOIN sports_management.permissions p
    WHERE r.code='SECRETARY' AND p.module='clubs' AND p.action IN ('APPROVE','READ') ON CONFLICT DO NOTHING`);
  const affiliation=(await db.query(`INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,status,requested_by,reviewed_by,reviewed_at)
    VALUES($1,$2,$3,$4,'Azul','APPROVED',$5,$6,clock_timestamp()) RETURNING id`,[season,club,league,randomUUID(),users.idle.id,users.operational.id])).rows[0].id;
  await db.query('INSERT INTO sports_management.club_affiliation_categories(affiliation_id,season_id,category_id,authorized_by,authorized_at) VALUES($1,$2,$3,$4,clock_timestamp())',[affiliation,season,category,users.operational.id]);
  const body={enrollmentKey:randomUUID(),clubId:club,seasonId:season,categoryId:category,team:{mode:'new',name:'Pendiente sintético'}};
  let enrollment;
  await t.test('distribución: inscripción REGISTERED sin grupo conserva categoría, clave e historial',async()=>{
    const forged=await request(delegate,'/api/team-enrollments','POST',{...body,enrollmentKey:randomUUID(),groupId:groupA.id}); assert.equal(forged.status,400);
    const response=await request(delegate,'/api/team-enrollments','POST',body); assert.equal(response.status,201); enrollment=await response.json();
    assert.equal(enrollment.groupId,null); assert.equal(enrollment.categoryId,category); assert.equal(enrollment.status,'REGISTERED');
    const replay=await request(delegate,'/api/team-enrollments','POST',body); assert.equal(replay.status,200); assert.equal((await replay.json()).id,enrollment.id);
    const listed=await (await delegate.request(`/api/team-enrollments?clubId=${club}`)).json();
    assert.ok(listed.items.some(item=>item.id===enrollment.id && item.groupId===null && item.categoryId===category));
    const pending=await (await reader.request(`${path}/distribution`)).json(); assert.ok(pending.items.some(item=>item.enrollmentId===enrollment.id));
    const options=await (await delegate.request(`/api/team-enrollments/options?clubId=${club}&seasonId=${season}`)).json(); assert.equal(options.groups.length,0);
    const row=(await db.query('SELECT season_category_id,group_id FROM sports_management.season_teams WHERE id=$1',[enrollment.id])).rows[0];
    assert.equal(row.season_category_id,participation); assert.equal(row.group_id,null);
  });
  const assign=()=>({enrollmentId:enrollment.id,groupId:groupA.id,expectedSeasonVersion:4,reason});
  await t.test('distribución: delegado no se autoasigna y se rechazan grupos ajenos',async()=>{
    assert.equal((await request(delegate,`${path}/distribution`,'POST',assign())).status,403);
    assert.equal((await delegate.request(`${path}/distribution`)).status,403);
    assert.equal((await request(reader,`${path}/distribution`,'POST',{...assign(),groupId:randomUUID()})).status,400);
  });
  await t.test('distribución: SQL no permite programar ni clasificar al equipo sin grupo',async()=>{
    const matchday=(await db.query("INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES($1,1,'2026-02-01','2026-02-02') RETURNING id",[season])).rows[0].id;
    await assert.rejects(db.query(`INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id)
      VALUES($1,$2,$3,'PENDING-MATCH',$4,$4)`,[season,groupA.id,matchday,enrollment.id]),error=>error.code==='P0001');
    const standing=(await db.query('INSERT INTO sports_management.standing_versions(season_id,group_id,matchday_id,competition_rule_id,version_number) VALUES($1,$2,$3,$4,1) RETURNING id',[season,groupA.id,matchday,rule])).rows[0].id;
    await assert.rejects(db.query(`INSERT INTO sports_management.standing_entries
      (standing_version_id,group_id,season_id,season_team_id,rank,played,won,drawn,lost,score_for,score_against,points)
      VALUES($1,$2,$3,$4,1,0,0,0,0,0,0,0)`,[standing,groupA.id,season,enrollment.id]),error=>error.code==='23503');
  });
  await t.test('distribución: revocar permiso o categoría impide asignar sin alterar la inscripción',async()=>{
    await db.query(`DELETE FROM sports_management.role_permissions rp USING sports_management.roles r,sports_management.permissions p
      WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.code='SECRETARY' AND p.module='clubs' AND p.action='APPROVE'`);
    try { assert.equal((await request(reader,`${path}/distribution`,'POST',assign())).status,403); }
    finally { await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
      SELECT r.id,p.id,false FROM sports_management.roles r CROSS JOIN sports_management.permissions p
      WHERE r.code='SECRETARY' AND p.module='clubs' AND p.action='APPROVE' ON CONFLICT DO NOTHING`); }
    await db.query('UPDATE sports_management.club_affiliation_categories SET authorized_by=NULL,authorized_at=NULL WHERE affiliation_id=$1',[affiliation]);
    try {
      const response=await request(reader,`${path}/distribution`,'POST',assign());
      assert.equal(response.status,409);
      assert.equal((await db.query('SELECT group_id FROM sports_management.season_teams WHERE id=$1',[enrollment.id])).rows[0].group_id,null);
      assert.equal((await db.query('SELECT version FROM sports_management.seasons WHERE id=$1',[season])).rows[0].version,4);
    } finally { await db.query('UPDATE sports_management.club_affiliation_categories SET authorized_by=$2,authorized_at=clock_timestamp() WHERE affiliation_id=$1',[affiliation,users.operational.id]); }
  });
  await t.test('distribución: fallo de auditoría revierte asignación y versión',async()=>{
    await db.query(`CREATE FUNCTION pg_temp.reject_distribution_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.table_name='season_teams' AND NEW.action='UPDATE' THEN RAISE EXCEPTION 'Fallo sintético'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_distribution_audit BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_distribution_audit()`);
    try {
      assert.equal((await request(reader,`${path}/distribution`,'POST',assign())).status,503);
      assert.equal((await db.query('SELECT group_id FROM sports_management.season_teams WHERE id=$1',[enrollment.id])).rows[0].group_id,null);
      assert.equal((await db.query('SELECT version FROM sports_management.seasons WHERE id=$1',[season])).rows[0].version,4);
    } finally { await db.query('DROP TRIGGER test_distribution_audit ON sports_management.audit_logs'); }
  });
  await t.test('distribución: un ganador concurrente, sin activar ni duplicar auditoría',async()=>{
    const results=await Promise.all([request(reader,`${path}/distribution`,'POST',assign()),request(reader,`${path}/distribution`,'POST',{...assign(),groupId:groupB.id})]);
    assert.deepEqual(results.map(response=>response.status).sort(),[200,409]);
    const row=(await db.query('SELECT group_id,status,season_category_id FROM sports_management.season_teams WHERE id=$1',[enrollment.id])).rows[0];
    assert.ok([groupA.id,groupB.id].includes(row.group_id)); assert.equal(row.status,'REGISTERED'); assert.equal(row.season_category_id,participation);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE table_name='season_teams' AND entity_id=$1 AND action='UPDATE'",[enrollment.id])).rows[0].n,1);
    assert.equal((await (await reader.request(`${path}/distribution`)).json()).items.length,0);
    const replay=await request(delegate,'/api/team-enrollments','POST',body); assert.equal(replay.status,200); assert.equal((await replay.json()).groupId,row.group_id);
    assert.equal((await request(reader,`${path}/distribution`,'POST',{...assign(),expectedSeasonVersion:5})).status,409);
    const other=row.group_id===groupA.id ? groupB.id : groupA.id;
    await assert.rejects(db.query('UPDATE sports_management.season_teams SET group_id=$2 WHERE id=$1',[enrollment.id,other]),error=>error.code==='P0001');
    await assert.rejects(db.query("UPDATE sports_management.season_categories SET competition_format='LEGACY_GROUPS' WHERE id=$1",[participation]),error=>error.code==='P0001');
  });
  await t.test('distribución automática: equilibrio, permisos, rollback y repetición sin mover historial',async()=>{
    const previous=(await db.query('SELECT group_id FROM sports_management.season_teams WHERE id=$1',[enrollment.id])).rows[0].group_id;
    for (let i=0;i<3;i++) {
      const response=await request(delegate,'/api/team-enrollments','POST',{...body,enrollmentKey:randomUUID(),team:{mode:'new',name:`Automático sintético ${i}`}});
      assert.equal(response.status,201);
    }
    const payload={expectedSeasonVersion:5,reason};
    assert.equal((await request(delegate,`${path}/distribution/automatic`,'POST',payload)).status,403);
    assert.equal((await request(reader,`${path}/distribution/automatic`,'POST',{...payload,groupId:groupA.id})).status,400);
    await db.query(`CREATE FUNCTION pg_temp.reject_automatic_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.table_name='season_teams' AND NEW.action='UPDATE' THEN RAISE EXCEPTION 'Fallo sintético'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_automatic_audit BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_automatic_audit()`);
    try {
      assert.equal((await request(reader,`${path}/distribution/automatic`,'POST',payload)).status,503);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.season_teams WHERE season_category_id=$1 AND group_id IS NULL',[participation])).rows[0].n,3);
      assert.equal((await db.query('SELECT version FROM sports_management.seasons WHERE id=$1',[season])).rows[0].version,5);
    } finally { await db.query('DROP TRIGGER test_automatic_audit ON sports_management.audit_logs'); }
    const responses=await Promise.all([request(reader,`${path}/distribution/automatic`,'POST',payload),request(reader,`${path}/distribution/automatic`,'POST',payload)]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const result=await responses.find(r=>r.status===200).json();
    assert.equal(result.assignments.length,3); assert.equal(result.seasonVersion,6);
    const rows=(await db.query('SELECT group_id,status FROM sports_management.season_teams WHERE season_category_id=$1',[participation])).rows;
    assert.equal(rows.filter(row=>row.group_id===groupA.id).length,2);
    assert.equal(rows.filter(row=>row.group_id===groupB.id).length,2);
    assert.ok(rows.every(row=>row.status==='REGISTERED'));
    assert.equal((await db.query('SELECT group_id FROM sports_management.season_teams WHERE id=$1',[enrollment.id])).rows[0].group_id,previous);
    const again=await request(reader,`${path}/distribution/automatic`,'POST',{...payload,expectedSeasonVersion:6});
    assert.equal(again.status,200); assert.deepEqual((await again.json()).assignments,[]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE table_name='season_teams' AND action='UPDATE' AND entity_id IN (SELECT id FROM sports_management.season_teams WHERE season_category_id=$1)",[participation])).rows[0].n,4);
  });
}
