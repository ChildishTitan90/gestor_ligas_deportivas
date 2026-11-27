import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { INITIAL_PERMISSION_GRANTS } from '../../prisma/permissions-data';
import { hashPassword } from '../../src/server/auth/password';

async function main() {
assert.equal(process.env.BILLING_ISOLATED, '1');
const target = new URL(process.env.DIRECT_URL!);
assert.equal(target.hostname, '127.0.0.1');
assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
const db = new pg.Client({ connectionString: target.href });
await db.connect();
try {
  const q = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows;
  const id = async (sql: string, args: unknown[] = []) => (await q(sql, args))[0].id as string;
  const password = `Synthetic!${randomBytes(18).toString('hex')}9a`;
  const hash = await hashPassword(password);
  const users: Record<string, string> = {};
  for (const name of ['treasury176', 'other176', 'delegate176', 'guest176', 'board176']) {
    const person = await id("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Persona sintética','Tesorería') RETURNING id");
    users[name] = await id('INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password) VALUES($1,$2,$3,$4,false) RETURNING id', [person, name, `${name}@example.invalid`, hash]);
  }
  await q("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-176 fixture sintético',false)", [users.treasury176]);
  for (const grant of INITIAL_PERMISSION_GRANTS) {
    const permission = await id('INSERT INTO sports_management.permissions(module,action) VALUES($1,$2) ON CONFLICT(module,action) DO UPDATE SET module=excluded.module RETURNING id', [grant.module, grant.action]);
    await q('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) SELECT id,$2,$3 FROM sports_management.roles WHERE code=$1 ON CONFLICT DO NOTHING', [grant.roleCode, permission, grant.contextOnly]);
  }
  const league = await id("INSERT INTO sports_management.leagues(name) VALUES('Liga sintética PDGLD-176') RETURNING id");
  const otherLeague = await id("INSERT INTO sports_management.leagues(name) VALUES('Liga ajena PDGLD-176') RETURNING id");
  const sport = await id("SELECT id FROM sports_management.sports WHERE code='SOCCER'");
  const year = new Date().getUTCFullYear() + 1;
  const start = `${year}-01-01`, end = `${year}-12-31`, due = `${year}-03-01`;
  const season = await id("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,'Temporada sintética 176',$3,$4) RETURNING id", [league, sport, start, end]);
  const otherSeason = await id("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,'Temporada ajena 176',$3,$4) RETURNING id", [otherLeague, sport, start, end]);
  const category = await id("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,'Libre sintética') RETURNING id", [league, sport]);
  const rule = await id('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,1) RETURNING id', [season]);
  const sc = await id("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date) VALUES($1,$2,$3,1,'OPEN',$4) RETURNING id", [season, category, rule, start]);
  const group = await id("INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES($1,$2,'Grupo sintético') RETURNING id", [season, sc]);
  const clubs: string[] = [];
  let team = '';
  for (const name of ['Monarcas sintético', 'Pumas sintético']) {
    const club = await id('INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES($1,$2,$3) RETURNING id', [league, randomUUID(), name]);
    clubs.push(club);
    await q("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,requested_by) VALUES($1,$2,$3,$4,'Azul',$5)", [season, club, league, randomUUID(), users.treasury176]);
    const t = await id('INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES($1,$2,$3) RETURNING id', [club, randomUUID(), name]);
    team = await id('INSERT INTO sports_management.season_teams(season_id,team_id,club_id,season_category_id,group_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [season, t, club, sc, group]);
  }
  for (const [name, role, scopeLeague, club] of [
    ['treasury176', 'TREASURER', league, null], ['other176', 'TREASURER', otherLeague, null],
    ['delegate176', 'CLUB_DELEGATE', league, clubs[0]], ['guest176', 'GUEST', null, null],
    ['board176', 'DISCIPLINARY_BOARD', league, null],
  ]) await q("INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id,delegate_position) SELECT $1,id,$3,$4,CASE WHEN code='CLUB_DELEGATE' THEN 'PRIMARY' ELSE NULL END FROM sports_management.roles WHERE code=$2", [users[name!], role, scopeLeague, club]);
  writeFileSync(process.env.BILLING_MANIFEST!, JSON.stringify({ users, password, league, otherLeague, season, otherSeason, clubs, team, year, start, end, due }), { mode: 0o600 });
  console.log('Fixture PDGLD-176 preparada con matriz RF22 real y datos sintéticos.');
} finally { await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
