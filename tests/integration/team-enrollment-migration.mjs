import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';

/** Prueba de SQL de actualización sobre otro catálogo desechable, sin datos reales. */
export async function verifyEnrollmentOperationMigration(databaseUrl) {
  const target = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const databaseName = `pdgld64_migration_${randomBytes(8).toString('hex')}`;
  assert.match(databaseName, /^pdgld64_migration_[a-f0-9]{16}$/);
  const admin = new pg.Client({ connectionString: databaseUrl });
  let created = false;
  let db;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    target.pathname = `/${databaseName}`;
    db = new pg.Client({ connectionString: target.href });
    await db.connect();
    const directory = new URL('../../prisma/migrations/', import.meta.url);
    const newMigration = '20261026010000_pdgld64_enrollment_operations';
    const migrations = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    // Las migraciones compartidas se leen intactas: fixture del estado anterior.
    for (const name of migrations.filter(name => name < newMigration))
      await db.query(readFileSync(new URL(`${name}/migration.sql`, directory), 'utf8'));
    const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
    const person = await id("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Fixture','Migración') RETURNING id");
    const actor = await id("INSERT INTO sports_management.users(person_id,username,email,password_hash) VALUES ($1,'migration-fixture','migration@example.test','synthetic-not-a-login') RETURNING id", [person]);
    await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-64: fixture de migración',false)", [actor]);
    const league = await id("INSERT INTO sports_management.leagues(name) VALUES ('Liga de migración') RETURNING id");
    const sport = await id("SELECT id FROM sports_management.sports WHERE code='SOCCER'");
    const club = await id("INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES ($1,$2,'Club legado sintético') RETURNING id", [league, randomUUID()]);
    const season = await id("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES ($1,$2,'Temporada legada','2026-01-01','2026-12-31') RETURNING id", [league, sport]);
    const rule = await id('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES ($1,1) RETURNING id', [season]);
    const category = await id("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES ($1,$2,'Categoría legada') RETURNING id", [league, sport]);
    const sc = await id("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date) VALUES ($1,$2,$3,1,'OPEN','2026-01-01') RETURNING id", [season, category, rule]);
    const group = await id("INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES ($1,$2,'Grupo legado') RETURNING id", [season, sc]);
    const affiliation = await id("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,status,requested_by,reviewed_by,reviewed_at) VALUES ($1,$2,$3,$4,'Azul','APPROVED',$5,$5,now()) RETURNING id", [season, club, league, randomUUID(), actor]);
    await db.query('INSERT INTO sports_management.club_affiliation_categories(affiliation_id,season_id,category_id) VALUES ($1,$2,$3)', [affiliation, season, category]);
    const team = await id("INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES ($1,$2,'Equipo legado') RETURNING id", [club, randomUUID()]);
    const key = randomUUID();
    const enrollment = await id("INSERT INTO sports_management.season_teams(team_id,club_id,season_id,group_id,enrolled_by,enrolled_at,enrollment_key,enrollment_hash) VALUES ($1,$2,$3,$4,$5,now(),$6,$7) RETURNING id", [team, club, season, group, actor, key, 'a'.repeat(64)]);
    const snapshot = async () => ({
      enrollment: (await db.query('SELECT * FROM sports_management.season_teams WHERE id=$1', [enrollment])).rows[0],
      audits: (await db.query('SELECT * FROM sports_management.audit_logs ORDER BY id')).rows,
      categories: (await db.query('SELECT * FROM sports_management.club_affiliation_categories ORDER BY affiliation_id,category_id')).rows,
    });
    const before = await snapshot();
    await db.query(readFileSync(new URL(`${newMigration}/migration.sql`, directory), 'utf8'));
    assert.deepEqual(await snapshot(), before);
    const rows = (await db.query('SELECT actor_id,enrollment_key,club_id,fingerprint,outcome,enrollment_id,finalized_at FROM sports_management.team_enrollment_operations')).rows;
    assert.deepEqual(rows, [{ actor_id: actor, enrollment_key: key, club_id: club, fingerprint: 'a'.repeat(64), outcome: 'CONFIRMED',
      enrollment_id: enrollment, finalized_at: before.enrollment.enrolled_at }]);
  } finally {
    if (db) await db.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
}
