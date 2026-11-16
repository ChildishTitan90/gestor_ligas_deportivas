import assert from "node:assert/strict";
import type { Client } from "pg";
import { getCaptureMatches } from "../../src/features/match-reports/server/service";

/** PostgreSQL y servicio reales con el rol Preview/RLS del ejecutor desechable. */
export async function verifyCaptureMatchList(f: {
  db: Client; actorId: string; refereeId: string; unassignedRefereeId: string;
  otherLeague: string; season: string; group: string; teams: string[]; match: string; nonParticipantClub: string;
  scalar: (sql: string, values?: unknown[]) => Promise<string>;
}) {
  const { db, scalar } = f;
  const foreignSeason = await scalar("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) SELECT $1,sport_id,'Temporada ajena sintética de listado','2026-01-01','2028-12-31' FROM sports_management.seasons WHERE id=$2 RETURNING id", [f.otherLeague, f.season]);
  const rule = await scalar("INSERT INTO sports_management.competition_rules(season_id,version_number,status,approved_by,approved_at) VALUES($1,1,'APPROVED',$2,now()) RETURNING id", [foreignSeason, f.actorId]);
  const category = await scalar("INSERT INTO sports_management.categories(league_id,sport_id,name) SELECT $1,sport_id,'Categoría ajena sintética de listado' FROM sports_management.seasons WHERE id=$2 RETURNING id", [f.otherLeague, foreignSeason]);
  const seasonCategory = await scalar("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date,competition_format) VALUES($1,$2,$3,1,'OPEN','2026-12-31','GROUP_STAGE') RETURNING id", [foreignSeason, category, rule]);
  const group = await scalar("INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES($1,$2,'Listado sintético') RETURNING id", [foreignSeason, seasonCategory]);
  const teams: string[] = [];
  for (const side of ["local", "visitante"]) {
    const club = await scalar("INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES($1,$2,$3) RETURNING id", [f.otherLeague, `LIST-${side}`, `Club ajeno sintético ${side}`]);
    await db.query("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,status,requested_by) VALUES($1,$2,$3,$4,'Sintético','APPROVED',$5)", [foreignSeason, club, f.otherLeague, `LIST-A-${side}`, f.actorId]);
    const team = await scalar("INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES($1,$2,$3) RETURNING id", [club, `LIST-T-${side}`, `Equipo ajeno sintético ${side}`]);
    const enrolled = await scalar("INSERT INTO sports_management.season_teams(season_id,team_id,club_id,season_category_id,status) VALUES($1,$2,$3,$4,'REGISTERED') RETURNING id", [foreignSeason, team, club, seasonCategory]);
    await db.query("UPDATE sports_management.season_teams SET group_id=$2 WHERE id=$1", [enrolled, group]);
    teams.push(enrolled);
  }
  const day = await scalar("INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES($1,1,'2027-01-01','2028-12-31') RETURNING id", [foreignSeason]);
  async function recent(season: string, group: string, day: string, teams: string[], prefix: string) {
    const venue = await scalar("INSERT INTO sports_management.venues(league_id,code,name,address,match_duration_minutes) SELECT league_id,$2,'Cancha sintética de listado','Sin domicilio real',120 FROM sports_management.seasons WHERE id=$1 RETURNING id", [season, prefix]);
    await db.query("INSERT INTO sports_management.venue_availability(venue_id,starts_at,ends_at,type) VALUES($1,'2027-01-01','2028-01-01','AVAILABLE')", [venue]);
    return (await db.query<{ id: string }>(`INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until,status_id)
      SELECT $1,$2,$3,$6||n,$4,$5,$7,'2027-01-01'::timestamptz+n*interval '1 day',
        '2027-01-01'::timestamptz+n*interval '1 day'+interval '2 hours',
        '2027-01-01'::timestamptz+n*interval '1 day'+interval '2 hours',sports_management.get_match_status_id('SCHEDULED')
      FROM generate_series(1,105) n RETURNING id`, [season, group, day, teams[0], teams[1], prefix, venue])).rows.map(row => row.id);
  }
  const foreign = await recent(foreignSeason, group, day, teams, "FUERA-DE-AMBITO-");
  const globalLatest = (await db.query<{ id: string }>("SELECT id FROM sports_management.matches WHERE deleted_at IS NULL ORDER BY starts_at DESC NULLS FIRST,id DESC LIMIT 100")).rows;
  assert.equal(globalLatest.length, 100);
  assert.ok(globalLatest.every(row => foreign.includes(row.id)), "El fixture debe reproducir 100 partidos globales ajenos más recientes");
  const capturer = await getCaptureMatches(f.actorId);
  assert.ok(capturer.some(row => row.id === f.match), "DATA_ENTRY debe ver su partido antiguo aunque los últimos 100 globales sean ajenos");
  assert.ok(capturer.every(row => !foreign.includes(row.id)));
  const referee = await getCaptureMatches(f.refereeId);
  assert.ok(referee.some(row => row.id === f.match), "El árbitro debe ver su designación antigua después de 105 partidos ajenos");
  assert.deepEqual(await getCaptureMatches(f.unassignedRefereeId), []);

  const role = (await db.query<{ id: string; club_id: string | null }>("SELECT ur.id,ur.club_id FROM sports_management.user_roles ur JOIN sports_management.roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.code='DATA_ENTRY'", [f.actorId])).rows[0];
  assert.ok(role);
  try {
    await db.query("UPDATE sports_management.user_roles SET club_id=$2 WHERE id=$1", [role.id, f.nonParticipantClub]);
    assert.deepEqual(await getCaptureMatches(f.actorId), [], "Un permiso de club no concede acceso a los partidos de otros clubes de su liga");
    const homeClub = await scalar("SELECT club_id AS id FROM sports_management.season_teams WHERE id=$1", [f.teams[0]]);
    await db.query("UPDATE sports_management.user_roles SET club_id=$2 WHERE id=$1", [role.id, homeClub]);
    assert.ok((await getCaptureMatches(f.actorId)).some(row => row.id === f.match));
  } finally {
    await db.query("UPDATE sports_management.user_roles SET club_id=$2 WHERE id=$1", [role.id, role.club_id]);
  }

  const ownDay = await scalar("INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES($1,2,'2027-01-01','2027-12-31') RETURNING id", [f.season]);
  const unassigned = await recent(f.season, f.group, ownDay, f.teams, "SIN-DESIGNACION-");
  try {
    assert.deepEqual((await getCaptureMatches(f.refereeId)).map(row => row.id), [f.match], "105 partidos de su liga sin designación no desplazan el propio del árbitro");
    const limited = await getCaptureMatches(f.actorId);
    const expected = (await db.query<{ id: string }>("SELECT id FROM sports_management.matches WHERE season_id=$1 AND deleted_at IS NULL ORDER BY starts_at DESC NULLS FIRST,id DESC LIMIT 100", [f.season])).rows.map(row => row.id);
    assert.equal(limited.length, 100);
    assert.deepEqual(limited.map(row => row.id), expected, "El límite y el orden estable se aplican a partidos del ámbito autorizado");
    await db.query("UPDATE sports_management.matches SET deleted_at=now() WHERE id=ANY($1::uuid[])", [unassigned.slice(0, 30)]);
    const afterDelete = await getCaptureMatches(f.actorId);
    assert.equal(afterDelete.length, 76);
    assert.ok(afterDelete.some(row => row.id === f.match));
    assert.ok(afterDelete.every(row => !unassigned.slice(0, 30).includes(row.id)));
  } finally {
    await db.query("UPDATE sports_management.matches SET deleted_at=now() WHERE id=ANY($1::uuid[])", [unassigned]);
  }
  console.log("PDGLD-18 listado real Preview/RLS: 105 partidos de otra liga, 105 sin designación, límite autorizado, orden estable y eliminados: OK");
  // Los ajenos permanecen para comprobar también /matches con una sesión HTTP real.
}
