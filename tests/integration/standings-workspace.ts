import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { INITIAL_PERMISSION_GRANTS } from '../../prisma/permissions-data';
import { hashPassword } from '../../src/server/auth/password';
import { getPrisma } from '../../src/server/db/prisma';
import { AuthorizationError } from '../../src/server/auth/authorization';
import { calculateForActor } from '../../src/features/standings/server/service';
import { getStandingWorkspaceForActor, StandingFilterError } from '../../src/features/standings/server/queries';

async function main() {
assert.equal(process.env.STANDINGS_UI_ISOLATED, '1');
const target = new URL(process.env.DATABASE_URL!);
assert.equal(target.hostname, '127.0.0.1');
assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
const db = new pg.Client({ connectionString: target.href });
const query = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows;
const id = async (sql: string, args: unknown[] = []) => (await query(sql, args))[0].id as string;
try {
  await db.connect();
  const password = `Synthetic!${randomBytes(18).toString('base64url')}9a`;
  const hash = await hashPassword(password);
  const user = async (username: string) => {
    const person = await id("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Persona sintética','Clasificación') RETURNING id");
    return id('INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password) VALUES($1,$2,$3,$4,false) RETURNING id', [person, username, `${username}@example.invalid`, hash]);
  };
  const secretary = await user('secretaria151'), outsider = await user('fuera151'), admin = await user('motor151');
  await query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-151: fixture sintético',false)", [admin]);
  // Use the real initial RF22 catalog, not an invented Secretary permission matrix.
  for (const grant of INITIAL_PERMISSION_GRANTS.filter(g => ['SECRETARY', 'SUPERADMIN'].includes(g.roleCode))) {
    const permission = await id('INSERT INTO sports_management.permissions(module,action) VALUES($1,$2) ON CONFLICT(module,action) DO UPDATE SET module=excluded.module RETURNING id', [grant.module, grant.action]);
    await query('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) SELECT id,$2,$3 FROM sports_management.roles WHERE code=$1 ON CONFLICT DO NOTHING', [grant.roleCode, permission, grant.contextOnly]);
  }
  const competitionId = await id("INSERT INTO sports_management.leagues(name) VALUES('Competencia sintética Morelia') RETURNING id");
  const otherLeague = await id("INSERT INTO sports_management.leagues(name) VALUES('Competencia ajena') RETURNING id");
  for (const [actor, role, league] of [[secretary, 'SECRETARY', competitionId], [outsider, 'SECRETARY', otherLeague], [admin, 'SUPERADMIN', competitionId]]) {
    await query('INSERT INTO sports_management.user_roles(user_id,role_id,league_id) SELECT $1,id,$3 FROM sports_management.roles WHERE code=$2', [actor, role, league]);
  }
  const sport = await id("SELECT id FROM sports_management.sports WHERE code='SOCCER'");
  const seasonId = await id("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,'Temporada sintética 2026','2026-01-01','2026-12-31') RETURNING id", [competitionId, sport]);
  const rule = await id('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,7) RETURNING id', [seasonId]);
  for (const [key, value] of Object.entries({ points: { win: 3, draw: 1, loss: 0 }, tieBreakers: ['GOAL_DIFFERENCE', 'GOALS_FOR'] })) {
    await query('INSERT INTO sports_management.competition_rule_parameters(competition_rule_id,parameter_key,parameter_value,validated_by) VALUES($1,$2,$3,$4)', [rule, key, JSON.stringify(value), admin]);
  }
  await query("UPDATE sports_management.competition_rules SET status='APPROVED',approved_by=$2,approved_at=now() WHERE id=$1", [rule, admin]);
  const category = await id("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,'Categoría libre sintética') RETURNING id", [competitionId, sport]);
  const categoryId = await id("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date) VALUES($1,$2,$3,1,'OPEN','2026-01-01') RETURNING id", [seasonId, category, rule]);
  const makeGroup = (name: string) => id('INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES($1,$2,$3) RETURNING id', [seasonId, categoryId, name]);
  const groupId = await makeGroup('Grupo A'), pending = await makeGroup('Grupo empate'), empty = await makeGroup('Grupo sin resultados');
  async function team(group: string, name: string) {
    const club = await id('INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES($1,$2,$3) RETURNING id', [competitionId, randomUUID(), `Club ${name}`]);
    await query("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,requested_by) VALUES($1,$2,$3,$4,'Azul',$5)", [seasonId, club, competitionId, randomUUID(), admin]);
    const base = await id('INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES($1,$2,$3) RETURNING id', [club, randomUUID(), name]);
    return id('INSERT INTO sports_management.season_teams(season_id,team_id,club_id,group_id,season_category_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [seasonId, base, club, group, categoryId]);
  }
  const teams = await Promise.all(['Águilas', 'Búhos', 'Coyotes', 'Delfines'].map(name => team(groupId, name)));
  const tied = await Promise.all(['Empate uno', 'Empate dos'].map(name => team(pending, name)));
  await team(empty, 'Sin partidos uno'); await team(empty, 'Sin partidos dos');
  const days: string[] = [];
  for (let n = 1; n <= 2; n++) days.push(await id("INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES($1,$2,'2026-02-01','2026-02-02') RETURNING id", [seasonId, n]));
  async function match(group: string, day: string, home: string, away: string, hs: number, as: number, source = 'MATCH_REPORT') {
    const match = await id("INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,status_id) VALUES($1,$2,$3,$4,$5,$6,sports_management.get_match_status_id('FINISHED')) RETURNING id", [seasonId, group, day, randomUUID(), home, away]);
    await query('INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,offending_team_id,validated_by) VALUES($1,$2,$3,$4,$5,$6)', [match, hs, as, source, source === 'DEFAULT' ? away : null, admin]);
    if (source === 'MATCH_REPORT') await query("INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source,status,confirmed_at) VALUES($1,$2,$3,'PAPER','CONFIRMED',now())", [match, randomUUID(), admin]);
    return match;
  }
  const correctedMatch = await match(groupId, days[0], teams[0], teams[1], 2, 0);
  await match(groupId, days[1], teams[1], teams[2], 1, 0, 'DEFAULT');
  await match(groupId, days[1], teams[0], teams[3], 2, 2);
  await match(pending, days[1], tied[0], tied[1], 0, 0);
  const filters = { competitionId, seasonId, categoryId, groupId };
  const saved = await calculateForActor(admin, { groupId, matchdayId: days[1] });
  const versionsBefore = Number((await query('SELECT count(*)::int n FROM sports_management.standing_versions'))[0].n);
  const data = await getStandingWorkspaceForActor(secretary, filters);
  assert.equal(data.table?.version, saved.version);
  assert.equal(data.table?.ruleVersion, 7);
  assert.deepEqual(data.table?.rows.map(r => [r.teamName, r.played, r.won, r.drawn, r.lost, r.scoreFor, r.scoreAgainst, r.difference, r.points]), [
    ['Águilas', 2, 1, 1, 0, 4, 2, 2, 4], ['Búhos', 2, 1, 0, 1, 1, 2, -1, 3], ['Delfines', 1, 0, 1, 0, 2, 2, 0, 1], ['Coyotes', 1, 0, 0, 1, 0, 1, -1, 0],
  ]);
  assert.equal(data.table?.officialResults, 3);
  assert.deepEqual(data.table?.sources.map(s => s.count), [2, 1, 0]);
  for (const privateField of ['input_fingerprint', 'calculation_data', 'reportId', 'playerStatistics', 'token_hash', 'unresolved', 'secretaria151@example.invalid']) assert.ok(!JSON.stringify(data).includes(privateField));
  const noResults = await getStandingWorkspaceForActor(secretary, { ...filters, groupId: empty });
  assert.equal(noResults.table?.officialResults, 0); assert.ok(noResults.table?.rows.every(r => r.points === 0 && r.rank === null));
  const tie = await getStandingWorkspaceForActor(secretary, { ...filters, groupId: pending });
  assert.ok(tie.table?.rows.every(r => r.rank === null && r.points === 1));
  assert.equal(tie.table?.version, null);
  assert.equal(Number((await query('SELECT count(*)::int n FROM sports_management.standing_versions'))[0].n), versionsBefore, 'READ never materializes versions');
  await assert.rejects(getStandingWorkspaceForActor(outsider, filters), AuthorizationError);
  await assert.rejects(getStandingWorkspaceForActor(secretary, { ...filters, competitionId: otherLeague }), AuthorizationError);
  await assert.rejects(getStandingWorkspaceForActor(secretary, { ...filters, matchdayId: randomUUID() }), AuthorizationError);
  await assert.rejects(getStandingWorkspaceForActor(secretary, { ...filters, groupId: 'invalid' }), StandingFilterError);
  await assert.rejects(getStandingWorkspaceForActor(secretary, { groupId }), StandingFilterError);
  await query('UPDATE sports_management.match_results SET home_score=3,version=version+1 WHERE match_id=$1', [correctedMatch]);
  const changed = await getStandingWorkspaceForActor(secretary, filters);
  assert.equal(changed.table?.status, 'PREVIEW'); assert.equal(changed.table?.version, null); assert.equal(changed.table?.latestStoredVersion, saved.version);
  await query('UPDATE sports_management.match_results SET home_score=2,version=version-1 WHERE match_id=$1', [correctedMatch]);
  const assignment = (await query('SELECT id FROM sports_management.user_roles WHERE user_id=$1', [secretary]))[0].id;
  await query("UPDATE sports_management.user_roles SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE id=$1", [assignment]);
  await assert.rejects(getStandingWorkspaceForActor(secretary, filters), AuthorizationError);
  await query('UPDATE sports_management.user_roles SET ends_at=NULL WHERE id=$1', [assignment]);
  writeFileSync(process.env.STANDINGS_MANIFEST!, JSON.stringify({ secretary, outsider, password, filters, pending, empty, matchdays: days }), { mode: 0o600 });
  console.log('PDGLD-151: totales, procedencia, lectura sin escrituras, filtros, ámbitos, revocación, empates y versión obsoleta: aprobados.');
} finally { await getPrisma().$disconnect(); await db.end(); }

}
main().catch(error => { console.error(error); process.exitCode = 1; });
