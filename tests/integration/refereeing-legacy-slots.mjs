import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assertNoLegacyRefereeSlotConflicts,REFEREE_SLOT_MIGRATION} from '../../scripts/ci/refereeing-preflight.mjs';

/** Ejecutar exactamente antes de PDGLD-141, sobre la base propia del ensayo. */
export async function verifyLegacyRefereeSlots(db,sql,migrations,applied){
  const check=()=>assertNoLegacyRefereeSlotConflicts(db,migrations,applied);
  const scalar=async(sql,params=[])=>String((await db.query(sql,params)).rows[0].id);
  async function fixture(duplicates){
    const actorPerson=await scalar("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Actor','Sintético') RETURNING id");
    const actor=await scalar("INSERT INTO sports_management.users(person_id,username,email,password_hash) VALUES($1,$2,$3,'fixture-no-login') RETURNING id",[actorPerson,randomUUID(),`${randomUUID()}@example.test`]);
    await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.reason','Fixture legado PDGLD-143',true)",[actor]);
    const league=await scalar("INSERT INTO sports_management.leagues(name) VALUES('Liga sintética legada') RETURNING id");
    const season=await scalar("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) SELECT $1,id,'Legado','2026-01-01','2026-12-31' FROM sports_management.sports LIMIT 1 RETURNING id",[league]);
    const rule=await scalar("INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,1) RETURNING id",[season]);
    const category=await scalar("INSERT INTO sports_management.categories(league_id,sport_id,name) SELECT $1,id,'Legada' FROM sports_management.sports LIMIT 1 RETURNING id",[league]);
    const sc=await scalar("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date,competition_format) VALUES($1,$2,$3,1,'OPEN','2026-01-01','GROUP_STAGE') RETURNING id",[season,category,rule]);
    const group=await scalar("INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES($1,$2,'Legado') RETURNING id",[season,sc]);
    const teams=[];
    for(let n=0;n<2;n++){
      const club=await scalar("INSERT INTO sports_management.clubs(league_id,name,reference_number) VALUES($1,'Club sintético',$2) RETURNING id",[league,randomUUID()]);
      await db.query("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,requested_by) VALUES($1,$2,$3,$4,'Sintético',$5)",[season,club,league,randomUUID(),actor]);
      const team=await scalar("INSERT INTO sports_management.teams(club_id,name,reference_number) VALUES($1,'Equipo sintético',$2) RETURNING id",[club,randomUUID()]);
      const enrolled=await scalar("INSERT INTO sports_management.season_teams(season_id,team_id,club_id,season_category_id) VALUES($1,$2,$3,$4) RETURNING id",[season,team,club,sc]);
      await db.query("UPDATE sports_management.season_teams SET group_id=$2 WHERE id=$1",[enrolled,group]);teams.push(enrolled);
    }
    const refs=[];
    for(let n=0;n<3;n++){
      const person=await scalar("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Árbitro','Sintético') RETURNING id");
      refs.push(await scalar("INSERT INTO sports_management.referees(person_id) VALUES($1) RETURNING id",[person]));
    }
    const day=await scalar("INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES($1,1,'2026-12-05','2026-12-05') RETURNING id",[season]);
    const matches=[],approved=[];
    for(let n=0;n<2;n++){
      const match=await scalar("INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",[season,group,day,randomUUID(),teams[0],teams[1]]);matches.push(match);
      const role=n===1&&duplicates?'texto privado de fixture':'MAIN';
      approved.push(await scalar("INSERT INTO sports_management.referee_assignments(match_id,referee_id,assignment_role,status,created_by,approved_by,approved_at) VALUES($1,$2,$3,'APPROVED',$4,$4,now()) RETURNING id",[match,refs[0],role,actor]));
      await db.query("INSERT INTO sports_management.referee_assignments(match_id,referee_id,assignment_role,status,created_by,approved_by,approved_at) VALUES($1,$2,$3,'APPROVED',$4,$4,now())",[match,refs[1],duplicates?role:'ASSISTANT',actor]);
      await db.query("INSERT INTO sports_management.referee_assignments(match_id,referee_id,assignment_role,status,created_by) VALUES($1,$2,$3,'PROPOSED',$4),($1,$5,$3,'REVOKED',$4)",[match,refs[2],role,actor,refs[0]]);
      if(n===1)await db.query("UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('FINISHED') WHERE id=$1",[match]);
    }
    return {matches,approved};
  }
  const snapshot=async(matches)=>(await db.query('SELECT id,match_id,referee_id,assignment_role,status,created_by,approved_by,approved_at FROM sports_management.referee_assignments WHERE match_id=ANY($1::uuid[]) ORDER BY id',[matches])).rows;
  await db.query('BEGIN');
  try{
    const f=await fixture(true),before=await snapshot(f.matches);
    await assert.rejects(check(),e=>e.message.includes('LEGACY_REFEREE_SLOT_CONFLICT')&&e.message.includes('"closed_context":true')&&e.message.includes('"closed_context":false')&&f.matches.every(id=>e.message.includes(id))&&f.approved.every(id=>e.message.includes(id))&&!e.message.includes('texto privado'));
    assert.deepEqual(await snapshot(f.matches),before);
    await db.query('SAVEPOINT migration_attempt');
    await assert.rejects(db.query(sql),{code:'23505'});
    await db.query('ROLLBACK TO SAVEPOINT migration_attempt');
    assert.deepEqual(await snapshot(f.matches),before);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='sports_management' AND table_name='referee_assignments' AND column_name='version'")).rows[0].n,0);
    // Resolución sintética explícita del contexto abierto; el cerrado sigue
    // bloqueando. No se elige automáticamente ningún árbitro superviviente.
    await db.query("UPDATE sports_management.referee_assignments SET status='REVOKED' WHERE id=$1",[f.approved[0]]);
    await assert.rejects(check(),/LEGACY_REFEREE_SLOT_CONFLICT/);
    assert.deepEqual((await snapshot([f.matches[1]])),before.filter(r=>r.match_id===f.matches[1]));
  }finally{await db.query('ROLLBACK');}
  await db.query('BEGIN');
  const clean=await fixture(false),before=await snapshot(clean.matches);
  await check();
  await db.query(sql); // COMMIT del SQL original; no se altera la migración.
  assert.deepEqual(await snapshot(clean.matches),before);
  assert.equal((await db.query("SELECT indisunique AND indisvalid AS valid FROM pg_index WHERE indexrelid='sports_management.approved_referee_slot'::regclass")).rows[0].valid,true);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.referee_assignments WHERE identity_snapshot IS NOT NULL OR approved_identity_version IS NOT NULL')).rows[0].n,0);
  await assertNoLegacyRefereeSlotConflicts(db,migrations,new Set([...applied,REFEREE_SLOT_MIGRATION]));
  console.log('Legado arbitral: duplicados abiertos/cerrados detectados sin mutación; índice original rechaza duplicados con rollback; migración limpia conserva todos los antecedentes sin backfill.');
}
