import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';

/** Datos ficticios exclusivos de la base desechable del runner, sin objetos de Storage. */
export async function prepareAffiliationReviewDemo(db, databaseUrl, users) {
  const target = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const secretary = users.operational.id;
  const delegate = users.underscore.id;
  await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-60: demostración temporal',false)", [secretary]);
  const league = (await db.query("INSERT INTO sports_management.leagues(name) VALUES ('Liga sintética de revisión') RETURNING id")).rows[0].id;
  const club = (await db.query("INSERT INTO sports_management.clubs(league_id,name,reference_number) VALUES ($1,'Club sintético de revisión',$2) RETURNING id", [league, randomUUID()])).rows[0].id;
  const sport = (await db.query("SELECT id FROM sports_management.sports WHERE code='SOCCER'")).rows[0].id;
  const season = (await db.query("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES ($1,$2,'Temporada sintética 2026','2026-01-01','2026-12-31') RETURNING id", [league, sport])).rows[0].id;
  const rule = (await db.query('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES ($1,1) RETURNING id', [season])).rows[0].id;
  const category = (await db.query("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES ($1,$2,'Categoría sintética') RETURNING id", [league, sport])).rows[0].id;
  await db.query("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date) VALUES ($1,$2,$3,1,'OPEN','2026-01-01')", [season, category, rule]);
  for (const [role, actor, clubId, actions] of [
    ['SECRETARY', secretary, null, ['READ', 'APPROVE']],
    ['CLUB_DELEGATE', delegate, club, ['CREATE', 'READ', 'UPDATE']],
  ]) {
    const roleId = (await db.query('SELECT id FROM sports_management.roles WHERE code=$1', [role])).rows[0].id;
    await db.query('INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id) VALUES ($1,$2,$3,$4)', [actor, roleId, league, clubId]);
    for (const action of actions) {
      const permission = (await db.query("INSERT INTO sports_management.permissions(module,action) VALUES ('clubs',$1) ON CONFLICT(module,action) DO UPDATE SET module=EXCLUDED.module RETURNING id", [action])).rows[0].id;
      await db.query('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,$3) ON CONFLICT(role_id,permission_id) DO UPDATE SET context_only=EXCLUDED.context_only', [roleId, permission, !!clubId]);
    }
  }
  const officers = {};
  for (const office of ['PRESIDENT', 'SECRETARY', 'TREASURER']) {
    const id = randomUUID();
    const key = `affiliation-signatures/v1/${club}/${season}/${delegate}/${office}/${id}`;
    await db.query("INSERT INTO sports_management.files(id,storage_key,original_name,mime_type,size_bytes,sha256,uploaded_by) VALUES ($1,$2,'firma-sintetica.png','image/png',100,$3,$4)", [id, key, 'a'.repeat(64), delegate]);
    officers[office] = { firstName: `Persona sintética ${office}`, paternalSurname: 'Prueba', maternalSurname: '', signatureFileId: id };
  }
  const input = { submissionKey: randomUUID(), clubId: club, seasonId: season, clubName: 'Club sintético de revisión', uniformColors: 'Azul y blanco', categoryIds: [category], officers };
  const { canonicalAffiliationSubmission } = await tsImport('../../src/features/clubs/affiliation-submission.ts', import.meta.url);
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(canonicalAffiliationSubmission(input)).digest('hex');
  const affiliation = (await db.query("INSERT INTO sports_management.club_affiliations(club_id,season_id,league_id,reference_number,status,requested_by,club_name,uniform_colors,submission_key,submission_hash) VALUES ($1,$2,$3,'AFL-DEMO-60','PENDING',$4,$5,$6,$7,$8) RETURNING id", [club, season, league, delegate, input.clubName, input.uniformColors, input.submissionKey, hash])).rows[0].id;
  await db.query('INSERT INTO sports_management.club_affiliation_categories(affiliation_id,season_id,category_id) VALUES ($1,$2,$3)', [affiliation, season, category]);
  for (const [office, officer] of Object.entries(officers)) {
    const person = (await db.query('INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ($1,$2) RETURNING id', [officer.firstName, officer.paternalSurname])).rows[0].id;
    await db.query("INSERT INTO sports_management.club_officers(affiliation_id,office,person_id,starts_at,signature_file_id) VALUES ($1,$2,$3,'2026-01-01',$4)", [affiliation, office, person, officer.signatureFileId]);
  }
  return { affiliationId: affiliation, leagueId: league };
}
