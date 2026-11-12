import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

// Run only against the explicitly designated disposable PostgreSQL database.
const target = process.env.PDGLD22_TEST_DATABASE_URL;
if (target) {
  const url = new URL(target);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55427");
  assert.equal(url.pathname, "/pdgld22");
  assert.equal(url.search, "");
}

test("PostgreSQL: duración, holgura, traslapes concurrentes y bloqueos con partidos", {
  skip: !target,
}, async () => {
  let pool = new pg.Pool({ connectionString: target, statement_timeout: 5000 });
  try {
    const row = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
    const tag = randomUUID();
    const { id: sport } = await row("SELECT id FROM sports_management.sports WHERE code = 'SOCCER'");
    const { id: league } = await row("INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id", [tag]);
    const { id: person } = await row("INSERT INTO sports_management.people(first_name, paternal_surname) VALUES ('Fixture', 'Canchas') RETURNING id");
    const { id: actor } = await row(`INSERT INTO sports_management.users(person_id, username, email, password_hash)
      VALUES ($1, $2, $3, 'no-login') RETURNING id`, [person, tag, `${tag}@example.test`]);
    await pool.end();
    pool = new pg.Pool({
      connectionString: target, statement_timeout: 5000,
      options: `-c app.user_id=${actor} -c app.reason=PDGLD-22-fixture`,
    });
    const { id: season } = await row(`INSERT INTO sports_management.seasons(league_id, sport_id, name, start_date, end_date)
      VALUES ($1, $2, $3, '2026-01-01', '2026-12-31') RETURNING id`, [league, sport, tag]);
    const { id: rule } = await row("INSERT INTO sports_management.competition_rules(season_id, version_number) VALUES ($1, 1) RETURNING id", [season]);
    const { id: catalog } = await row("INSERT INTO sports_management.categories(league_id, sport_id, name) VALUES ($1, $2, $3) RETURNING id", [league, sport, tag]);
    const { id: category } = await row(`INSERT INTO sports_management.season_categories(season_id, category_id, competition_rule_id, hierarchy_order, type, eligibility_pending)
      VALUES ($1, $2, $3, 1, 'OPEN', true) RETURNING id`, [season, catalog, rule]);
    const { id: group } = await row("INSERT INTO sports_management.groups(season_id, season_category_id, name) VALUES ($1, $2, $3) RETURNING id", [season, category, tag]);
    const { id: day } = await row(`INSERT INTO sports_management.matchdays(season_id, number, start_date, end_date)
      VALUES ($1, 1, '2026-11-14', '2026-11-14') RETURNING id`, [season]);
    const teams = [];
    for (let i = 0; i < 4; i++) {
      const reference = `${tag}-${i}`;
      const { id: club } = await row("INSERT INTO sports_management.clubs(league_id, name, reference_number) VALUES ($1, $2, $2) RETURNING id", [league, reference]);
      const { id: team } = await row("INSERT INTO sports_management.teams(club_id, name, reference_number) VALUES ($1, $2, $2) RETURNING id", [club, reference]);
      await row(`INSERT INTO sports_management.club_affiliations(season_id, club_id, league_id, reference_number, uniform_colors, requested_by)
        VALUES ($1, $2, $3, $4, 'Azul', $5)`, [season, club, league, reference, actor]);
      const { id } = await row("INSERT INTO sports_management.season_teams(season_id, team_id, club_id, group_id) VALUES ($1, $2, $3, $4) RETURNING id",
        [season, team, club, group]);
      teams.push(id);
    }
    const { id: venue } = await row(`INSERT INTO sports_management.venues(league_id, code, name, address, match_duration_minutes, buffer_minutes)
      VALUES ($1, 'UNO', 'Cancha', 'Domicilio sintético', 60, 15) RETURNING id`, [league]);
    const instant = time => `2026-11-14T${time}:00Z`;
    const addInterval = (db, type, from, to) => db.query(`INSERT INTO sports_management.venue_availability(venue_id, type, starts_at, ends_at)
      VALUES ($1, $2, $3, $4) RETURNING id`, [venue, type, instant(from), instant(to)]);
    const schedule = (db, number, pair, from, duration = 60, buffer = 15) => db.query(`
      INSERT INTO sports_management.matches(season_id, group_id, matchday_id, number, home_team_id, away_team_id, venue_id, starts_at, ends_at, reserved_until, status_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $8::timestamptz + make_interval(mins => $9),
        $8::timestamptz + make_interval(mins => $9 + $10::integer), sports_management.get_match_status_id('SCHEDULED'))
      RETURNING id`, [season, group, day, number, teams[pair], teams[pair + 1], venue, instant(from), duration, buffer]);

    await assert.rejects(schedule(pool, "sin-horario", 0, "10:00"), { code: "23514" });
    await addInterval(pool, "AVAILABLE", "10:00", "18:00");
    await assert.rejects(addInterval(pool, "AVAILABLE", "11:00", "12:00"), { code: "23P01" });
    await assert.rejects(schedule(pool, "duración", 0, "10:00", 45), { code: "23514" });
    await assert.rejects(schedule(pool, "holgura", 0, "10:00", 60, 0), { code: "23514" });
    const bookings = await Promise.allSettled([
      schedule(pool, "uno", 0, "10:00"),
      schedule(pool, "dos", 2, "11:00"),
    ]);
    const accepted = bookings.filter(item => item.status === "fulfilled");
    assert.equal(accepted.length, 1);
    assert.equal(bookings.find(item => item.status === "rejected").reason.code, "23P01");
    const matchId = accepted[0].value.rows[0].id;

    const block = await addInterval(pool, "BLOCK", "11:05", "12:00");
    await assert.rejects(addInterval(pool, "MAINTENANCE", "11:10", "12:00"), { code: "23P01" });
    const conflicts = await pool.query(`SELECT match_id FROM sports_management.venue_reservations r
      JOIN sports_management.venue_availability a ON a.venue_id = r.venue_id
      WHERE a.id = $1 AND r.time_range && tstzrange(a.starts_at, a.ends_at, '[)')`, [block.rows[0].id]);
    assert.deepEqual(conflicts.rows, [{ match_id: matchId }]);
    assert.ok(await row("SELECT id FROM sports_management.matches WHERE id = $1 AND deleted_at IS NULL", [matchId]));
    await pool.query("UPDATE sports_management.matches SET notes = 'Se conserva' WHERE id = $1", [matchId]);
    await assert.rejects(schedule(pool, "bloqueado", 0, "11:30"), { code: "23514" });
    await schedule(pool, "extremo-contiguo", 0, "12:15");

    const first = await pool.connect();
    try {
      await first.query("BEGIN");
      await addInterval(first, "BLOCK", "15:00", "16:00");
      const waiting = assert.rejects(schedule(pool, "bloqueo-concurrente", 2, "15:00"), { code: "23514" });
      await first.query("COMMIT");
      await waiting;
    } finally {
      await first.query("ROLLBACK");
      first.release();
    }
  } finally {
    await pool.end();
  }
});
