import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { transitionMatchInTransaction } from "../../src/features/matches/server/transition";
import { finishConfirmedReportMatch } from "../../src/features/matches/server/report-finish";
import { getRecorderWorkspaceInTransaction } from "../../src/features/matches/server/recorder-workspace";
import { rescheduleAbsentMatchInTransaction } from "../../src/features/matches/server/reschedule";
import { getRescheduleSlotsInTransaction } from "../../src/features/matches/server/reschedule-slots";
import { confirmMatchdayForActor } from "../../src/features/matches/server/confirm-matchday";
import { cancelReviewedMatchInTransaction } from "../../src/features/matches/server/resolve-review";
import { hashPassword } from "../../src/server/auth/password";

// Solo bases desechables explícitas. Nunca lee .env ni el DATABASE_URL habitual.
const target = process.env.PDGLD132_TEST_DATABASE_URL;
assert.ok(target, "Configura PDGLD132_TEST_DATABASE_URL con la base temporal aislada");
const url = new URL(target);
assert.equal(url.protocol, "postgresql:");
assert.ok(process.env.PDGLD132_HTTP_TEST === "1" ? ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) : url.hostname === "127.0.0.1");
assert.equal(url.search, "");
assert.equal(url.hash, "");
if (process.env.PDGLD132_HTTP_TEST === "1") {
  assert.equal(process.env.AUTH_TEST_RUN, "1");
  assert.match(url.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
} else assert.equal(`${url.port}${url.pathname}`, process.env.GITHUB_ACTIONS === "true" ? "5432/gestor_ligas_ci" : "55432/pdgld132");

test("PDGLD-132: servicio real, alcance, reenvío concurrente, historial y rollback", async () => {
  let pool = new pg.Pool({ connectionString: target, statement_timeout: 10000 });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target }) });
  try {
    const row = async (sql: string, values: unknown[] = []) => (await pool.query(sql, values)).rows[0];
    const tag = randomUUID();
    const { id: sport } = await row("SELECT id FROM sports_management.sports WHERE code='SOCCER'");
    const { id: league } = await row("INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id", [tag]);
    const { id: otherLeague } = await row("INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id", [tag + '-other']);
    const { id: person } = await row("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Fixture','Partidos') RETURNING id");
    const { id: actor } = await row(`INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
      VALUES ($1,$2,$3,'no-login',false) RETURNING id`, [person, tag, tag + '@example.test']);
    await pool.end();
    pool = new pg.Pool({ connectionString: target, statement_timeout: 10000,
      options: `-c app.user_id=${actor} -c app.reason=PDGLD-132-fixture -c timezone=UTC` });
    const { id: role } = await row("SELECT id FROM sports_management.roles WHERE code='SCHEDULER'");
    await row("INSERT INTO sports_management.permissions(module,action) VALUES ('scheduling','UPDATE') ON CONFLICT DO NOTHING");
    const { id: permission } = await row("SELECT id FROM sports_management.permissions WHERE module='scheduling' AND action='UPDATE'");
    await row("INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,false) ON CONFLICT DO NOTHING", [role, permission]);
    const { id: assignment } = await row(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,starts_at)
      VALUES ($1,$2,$3,now()-interval '1 day') RETURNING id`, [actor, role, otherLeague]);
    const { id: season } = await row(`INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date)
      VALUES ($1,$2,$3,'2026-01-01','2026-12-31') RETURNING id`, [league, sport, tag]);
    const { id: rule } = await row("INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES ($1,1) RETURNING id", [season]);
    const { id: catalog } = await row("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES ($1,$2,$3) RETURNING id", [league, sport, tag]);
    const { id: category } = await row(`INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,eligibility_pending)
      VALUES ($1,$2,$3,1,'OPEN',true) RETURNING id`, [season, catalog, rule]);
    const { id: group } = await row("INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES ($1,$2,$3) RETURNING id", [season, category, tag]);
    const { id: day } = await row(`INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date)
      VALUES ($1,1,'2026-11-14','2026-11-14') RETURNING id`, [season]);
    const teams: string[] = [];
    for (let i = 0; i < 2; i++) {
      const reference = `${tag}-${i}`;
      const { id: club } = await row("INSERT INTO sports_management.clubs(league_id,name,reference_number,status) VALUES ($1,$2,$2,'ACTIVE') RETURNING id", [league, reference]);
      const { id: team } = await row("INSERT INTO sports_management.teams(club_id,name,reference_number) VALUES ($1,$2,$2) RETURNING id", [club, reference]);
      await row(`INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,requested_by,status)
        VALUES ($1,$2,$3,$4,'Azul',$5,'APPROVED')`, [season, club, league, reference, actor]);
      teams.push((await row("INSERT INTO sports_management.season_teams(season_id,team_id,club_id,group_id,season_category_id) VALUES ($1,$2,$3,$4,$5) RETURNING id", [season, team, club, group, category])).id);
    }
    const { id: venue } = await row(`INSERT INTO sports_management.venues(league_id,code,name,address,match_duration_minutes,buffer_minutes)
      VALUES ($1,'UNO','Cancha','Sintético',60,15) RETURNING id`, [league]);
    await row(`INSERT INTO sports_management.venue_availability(venue_id,type,starts_at,ends_at)
      VALUES ($1,'AVAILABLE','2026-11-14T10:00:00Z','2026-11-14T21:00:00Z')`, [venue]);
    const draft = async (number: string, hour = 10) => (await row(`INSERT INTO sports_management.matches
      (season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'2026-11-14'::date+make_interval(hours=>$8),
        '2026-11-14'::date+make_interval(hours=>$8+1),'2026-11-14'::date+make_interval(hours=>$8+1,mins=>15)) RETURNING id`,
    [season, group, day, number, ...teams, venue, hour])).id as string;
    const matchId = await draft("uno");
    const input = { matchId, operationId: randomUUID(), expectedVersion: 1, toStatus: "SCHEDULED", reason: "Programación sintética" };
    const run = (data = input) => prisma.$transaction(tx => transitionMatchInTransaction(tx, actor, data), { timeout: 15000 });
    await assert.rejects(run(), { code: "FORBIDDEN" });
    await row("UPDATE sports_management.user_roles SET league_id=$1 WHERE id=$2", [league, assignment]);
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.match_status_transitions.deleteMany({ where: { role_id: role } });
      return transitionMatchInTransaction(tx, actor, input);
    }), { code: "FORBIDDEN" }); // El rollback restaura la matriz.

    const receipts = await Promise.all([run(), run()]);
    assert.equal(receipts.filter(receipt => !receipt.replayed).length, 1);
    assert.equal(receipts.filter(receipt => receipt.replayed).length, 1);
    assert.equal(receipts[0].appliedVersion, 2);
    assert.equal((await row("SELECT version FROM sports_management.matches WHERE id=$1", [matchId])).version, 2);
    assert.equal((await row("SELECT count(*)::int AS n FROM sports_management.match_status_history WHERE match_id=$1", [matchId])).n, 1);
    assert.equal((await row("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE entity_id=$1 AND action='UPDATE'", [matchId])).n, 1);
    assert.equal((await row("SELECT count(*)::int AS n FROM sports_management.team_reservations WHERE match_id=$1", [matchId])).n, 2);
    assert.equal((await row("SELECT count(*)::int AS n FROM sports_management.venue_reservations WHERE match_id=$1", [matchId])).n, 1);
    const confirm = { ...input, operationId: randomUUID(), expectedVersion: 2, toStatus: "CONFIRMED", reason: "Confirmación sintética" };
    await assert.rejects(run(confirm), { code: "MAIN_REFEREE_REQUIRED" });
    const refereePerson = await row("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Árbitro','Sintético') RETURNING id");
    const referee = await row("INSERT INTO sports_management.referees(person_id) VALUES ($1) RETURNING id", [refereePerson.id]);
    const presenting = `${tag}-arbitraje`;
    const { id: presentingClub } = await row("INSERT INTO sports_management.clubs(league_id,name,reference_number,status) VALUES ($1,$2,$2,'ACTIVE') RETURNING id", [league, presenting]);
    await row(`INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,requested_by,status)
      VALUES ($1,$2,$3,$4,'Negro',$5,'APPROVED')`, [season, presentingClub, league, presenting, actor]);
    await row("INSERT INTO sports_management.club_season_referees(referee_id,season_id,club_id) VALUES ($1,$2,$3)", [referee.id, season, presentingClub]);
    await row(`INSERT INTO sports_management.referee_availability(referee_id,starts_at,ends_at,is_available)
      VALUES ($1,'2026-11-14T10:00:00Z','2026-11-14T11:00:00Z',true)`, [referee.id]);
    await row(`INSERT INTO sports_management.referee_assignments(match_id,referee_id,assignment_role,status,created_by,approved_by,approved_at,approved_identity_version)
      VALUES ($1,$2,'MAIN','APPROVED',$3,$3,now(),$4)`, [matchId, referee.id, actor, refereePerson.identity_version ?? 1]);
    const confirmation = await run(confirm);
    assert.equal(confirmation.appliedVersion, 3);
    await assert.rejects(run({ ...input, operationId:randomUUID(), expectedVersion:3, toStatus:"UNSCHEDULED", reason:"Aplazar encuentro" }), {code:"REFEREE_REASSIGN_REQUIRED"});
    assert.equal((await run(confirm)).replayed, true);
    assert.equal((await row("SELECT count(*)::int AS n FROM sports_management.match_status_history WHERE match_id=$1", [matchId])).n, 2);
    await assert.rejects(run({ ...input, reason: "Contenido distinto" }), { code: "IDEMPOTENCY_CONFLICT" });
    await assert.rejects(run({ ...input, operationId: randomUUID() }), { code: "STALE_MATCH" });
    await assert.rejects(pool.query("UPDATE sports_management.match_status_history SET reason='cambio' WHERE id=$1", [input.operationId]));
    await assert.rejects(pool.query("DELETE FROM sports_management.match_status_history WHERE id=$1", [input.operationId]));

    const email = `${randomUUID()}@example.test`;
    const password = `Synthetic-${randomUUID()}!aA`;
    const refereeUser = await row(`INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
      VALUES ($1,$2,$3,$4,false) RETURNING id`, [refereePerson.id, randomUUID(), email, await hashPassword(password)]);
    const refereeRole = await row("SELECT id FROM sports_management.roles WHERE code='DATA_ENTRY'");
    await row("INSERT INTO sports_management.permissions(module,action) VALUES ('match-reports','UPDATE') ON CONFLICT DO NOTHING");
    await row(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
      SELECT $1,id,true FROM sports_management.permissions WHERE module='match-reports' AND action='UPDATE' ON CONFLICT DO NOTHING`, [refereeRole.id]);
    const recorderAssignment = await row("INSERT INTO sports_management.user_roles(user_id,role_id,league_id) VALUES ($1,$2,$3) RETURNING id", [refereeUser.id, refereeRole.id, league]);
    const start = { ...input, operationId: randomUUID(), expectedVersion: 3, toStatus: "IN_PROGRESS", reason: "Inicio sintético" };
    const schedulerWorkspace = await prisma.$transaction(tx => getRecorderWorkspaceInTransaction(tx, actor));
    assert.ok(schedulerWorkspace.items.some(item => item.id === matchId && !item.canRecordMatch));
    const initialWorkspace = await prisma.$transaction(tx => getRecorderWorkspaceInTransaction(tx, refereeUser.id));
    assert.ok(initialWorkspace.items.some(item => item.id === matchId && item.canRecordMatch && item.status === "CONFIRMED"));
    if (process.env.PDGLD132_PREVIEW_TEST === "1") {
      const runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
      try {
        const identity = await runtime.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
        assert.equal(identity[0].current_user, "gestor_ligas_preview");
        const privileges = await runtime.$queryRaw<{ venue_write: boolean; team_write: boolean; history_write: boolean }[]>`
          SELECT has_table_privilege(current_user, 'sports_management.venue_reservations', 'INSERT,UPDATE,DELETE') AS venue_write,
                 has_table_privilege(current_user, 'sports_management.team_reservations', 'INSERT,UPDATE,DELETE') AS team_write,
                 has_table_privilege(current_user, 'sports_management.match_status_history', 'UPDATE,DELETE') AS history_write`;
        assert.deepEqual(privileges[0], { venue_write: false, team_write: false, history_write: false });
        const { Browser } = await import("./auth.test.mjs");
        const browser = new Browser(new URL(process.env.NEXTAUTH_URL!).origin);
        const login = await browser.login(email, password);
        assert.equal(login.pathname, "/access");
        for (const path of ["/access", "/matches/recording", `/matches/recording?jornada=${day}`]) {
          const response = await browser.request(path);
          assert.equal(response.status, 200, `No abrió ${path} con Preview`);
          const html = await response.text();
          assert.doesNotMatch(html, /No se pudo consultar la alineación|No se pudo cargar el registro/);
          if (path.startsWith("/matches/recording")) {
            assert.ok(html.includes(tag), "La sesión HTTP debe mostrar la temporada autorizada");
            if(path.includes("jornada=")) assert.match(html, /Iniciar partido/);
            else assert.match(html, /Jornada\s*(?:<!--\s*-->)?\s*1/);
          }
        }
        const workspace = await runtime.$transaction(tx => getRecorderWorkspaceInTransaction(tx, refereeUser.id));
        assert.ok(workspace.items.some(item => item.id === matchId && item.canRecordMatch));
        const previewRun = () => runtime.$transaction(tx => transitionMatchInTransaction(tx, refereeUser.id, start), { timeout: 15000 });
        assert.equal((await previewRun()).replayed, false);
        assert.equal((await previewRun()).replayed, true);
        assert.equal((await row("SELECT count(*)::int AS n FROM sports_management.match_status_history WHERE id=$1", [start.operationId])).n, 1);
        assert.deepEqual(await row(`SELECT m.version,s.code FROM sports_management.matches m
          JOIN sports_management.match_statuses s ON s.id=m.status_id WHERE m.id=$1`, [matchId]),
        { version: 4, code: "IN_PROGRESS" });
        // Consultar de nuevo por HTTP verifica la lectura persistida con sesión y RLS,
        // sin depender de hidratación, eventos de React ni tiempos de un navegador.
        const updated = await browser.request(`/matches/recording?jornada=${day}`);
        assert.equal(updated.status, 200);
        const updatedHtml = await updated.text();
        assert.ok(updatedHtml.includes(tag));
        assert.match(updatedHtml, /En curso/);
        assert.match(updatedHtml, /Suspender partido/);
      } finally { await runtime.$disconnect(); }
    }
    const refereeRun = (data: typeof start) => prisma.$transaction(tx => transitionMatchInTransaction(tx, refereeUser.id, data), { timeout: 15000 });
    await assert.rejects(run(start), { code: "FORBIDDEN" });
    await row("UPDATE sports_management.user_roles SET ends_at=now() WHERE id=$1", [recorderAssignment.id]);
    await assert.rejects(refereeRun(start), { code: "FORBIDDEN" });
    await row("UPDATE sports_management.user_roles SET ends_at=NULL WHERE id=$1", [recorderAssignment.id]);
    assert.equal((await refereeRun(start)).appliedVersion, 4);
    assert.equal((await refereeRun(start)).replayed, true);
    const overlap = await draft("traslape");
    await assert.rejects(run({ ...input, matchId: overlap }), { code: "IDEMPOTENCY_CONFLICT" });
    await assert.rejects(run({ ...input, matchId: overlap, operationId: randomUUID() }));
    assert.equal((await row("SELECT version FROM sports_management.matches WHERE id=$1", [overlap])).version, 1);
    assert.equal((await row("SELECT count(*)::int AS n FROM sports_management.match_status_history WHERE match_id=$1", [overlap])).n, 0);
    assert.equal((await row("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE entity_id=$1 AND action='UPDATE'", [overlap])).n, 0);
    const suspend = { ...start, operationId: randomUUID(), expectedVersion: 4, toStatus: "SUSPENDED", reason: "Suspensión sintética" };
    assert.equal((await refereeRun(suspend)).appliedVersion, 5);
    assert.equal((await row("SELECT count(*)::int AS n FROM sports_management.venue_reservations WHERE match_id=$1", [matchId])).n, 0);
    const cancel = { ...input, operationId: randomUUID(), expectedVersion: 5, toStatus: "CANCELED", reason: "Cancelación sintética" };
    await assert.rejects(run(cancel), { code: "FORBIDDEN" });
    const president = await row("SELECT id FROM sports_management.roles WHERE code='EXECUTIVE_PRESIDENT'");
    await row("INSERT INTO sports_management.permissions(module,action) VALUES ('scheduling','APPROVE') ON CONFLICT DO NOTHING");
    await row(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
      SELECT $1,id,false FROM sports_management.permissions WHERE module='scheduling' AND action='APPROVE' ON CONFLICT DO NOTHING`, [president.id]);
    await row("INSERT INTO sports_management.user_roles(user_id,role_id,league_id) VALUES ($1,$2,$3)", [actor, president.id, league]);
    assert.equal((await run(cancel)).appliedVersion, 6);
    assert.equal((await run(cancel)).replayed, true);
    const reportedMatch = await draft("con-cedula", 15);
    await run({ ...input, matchId: reportedMatch, operationId: randomUUID() });
    await row(`INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source)
      VALUES ($1,$2,$3,'PAPER')`, [reportedMatch, randomUUID(), actor]);
    await assert.rejects(run({ ...cancel, matchId: reportedMatch, operationId: randomUUID(), expectedVersion: 2 }), { code: "MATCH_REPORT_EXISTS" });
    assert.equal((await row("SELECT version FROM sports_management.matches WHERE id=$1", [reportedMatch])).version, 2);

    // PDGLD-132 aporta únicamente el cierre interno de cédula. La operación
    // genérica continúa sin poder finalizar un partido directamente.
    const reportMatch = await draft("cierre-cedula", 18);
    await row(`UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('IN_PROGRESS'),
      version=2 WHERE id=$1`, [reportMatch]);
    const { id: reportId } = await row(`INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source)
      VALUES ($1,$2,$3,'MOBILE') RETURNING id`, [reportMatch, randomUUID(), refereeUser.id]);
    const finishOperation = randomUUID();
    const finishContext = { actorId: refereeUser.id, matchId: reportMatch, reportId,
      operationId: finishOperation, expectedMatchVersion: 2, homeScore: 1, awayScore: 0,
      eventIds: [], dismissals: [] };
    const finish = () => prisma.$transaction(tx => finishConfirmedReportMatch(tx, finishContext));
    await assert.rejects(finish(), { code: "REPORT_RESULT_REQUIRED" });
    assert.equal((await row("SELECT version FROM sports_management.matches WHERE id=$1", [reportMatch])).version, 2);
    await row(`INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,validated_by)
      VALUES ($1,1,0,'MATCH_REPORT',$2)`, [reportMatch, refereeUser.id]);
    await assert.rejects(prisma.$transaction(tx => finishConfirmedReportMatch(tx,
      { ...finishContext, reportId: randomUUID(), operationId: randomUUID() })),
    { code: "REPORT_RESULT_REQUIRED" });
    await assert.rejects(prisma.$transaction(tx => finishConfirmedReportMatch(tx,
      { ...finishContext, homeScore: 2, operationId: randomUUID() })),
    { code: "REPORT_RESULT_REQUIRED" });
    await assert.rejects(run({ ...input, matchId: reportMatch, operationId: randomUUID(), expectedVersion: 2,
      toStatus: "FINISHED" }), { code: "FORBIDDEN" });
    assert.equal(await finish(), 3);
    assert.deepEqual(await row(`SELECT m.version,s.code FROM sports_management.matches m
      JOIN sports_management.match_statuses s ON s.id=m.status_id WHERE m.id=$1`, [reportMatch]),
    { version: 3, code: "FINISHED" });
    assert.deepEqual(await row(`SELECT h.expected_version,h.reason,s.code FROM sports_management.match_status_history h
      JOIN sports_management.match_statuses s ON s.id=h.new_status_id WHERE h.id=$1`, [finishOperation]),
    { expected_version: 2, reason: "Confirmación de cédula arbitral", code: "FINISHED" });
    await assert.rejects(finish(), { code: "TRANSITION_NOT_IMPLEMENTED" });
    await assert.rejects(pool.query("UPDATE sports_management.matches SET notes='edición directa' WHERE id=$1", [reportMatch]),
      /FINISHED_MATCH_LOCKED/);

    // Un partido finalizado no se reabre ni cancela desde este servicio, aunque
    // quien lo solicita tenga permisos de programación y aprobación.
    const finished = await draft("finalizado", 16);
    await row(`UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('FINISHED'),
      starts_at=NULL, ends_at=NULL, reserved_until=NULL WHERE id=$1`, [finished]);
    const beforeFinished = await row("SELECT version,status_id FROM sports_management.matches WHERE id=$1", [finished]);
    for (const toStatus of ["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "SUSPENDED", "CANCELED", "FINISHED"]) {
      const caller = ["IN_PROGRESS", "SUSPENDED"].includes(toStatus) ? refereeRun : run;
      await assert.rejects(caller({ ...input, matchId: finished, operationId: randomUUID(), expectedVersion: beforeFinished.version, toStatus }));
    }
    assert.deepEqual(await row("SELECT version,status_id FROM sports_management.matches WHERE id=$1", [finished]), beforeFinished);
    assert.equal((await row("SELECT count(*)::int n FROM sports_management.match_status_history WHERE match_id=$1", [finished])).n, 0);

    // Si falla el historial, la transición, su auditoría y las reservas revierten.
    const rollbackMatch = await draft("fallo-historial", 11);
    await pool.query(`CREATE FUNCTION sports_management.pd134_reject_history() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.reason = 'PD134 rollback sintético' THEN RAISE EXCEPTION 'fixture rollback'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER pd134_reject_history BEFORE INSERT ON sports_management.match_status_history
      FOR EACH ROW EXECUTE FUNCTION sports_management.pd134_reject_history()`);
    try {
      await assert.rejects(run({ ...input, matchId: rollbackMatch, operationId: randomUUID(), reason: "PD134 rollback sintético" }));
      const unchanged = await row(`SELECT m.version,s.code FROM sports_management.matches m
        JOIN sports_management.match_statuses s ON s.id=m.status_id WHERE m.id=$1`, [rollbackMatch]);
      assert.deepEqual(unchanged, { version: 1, code: "DRAFT" });
      for (const table of ["match_status_history", "venue_reservations", "team_reservations"])
        assert.equal((await row(`SELECT count(*)::int n FROM sports_management.${table} WHERE match_id=$1`, [rollbackMatch])).n, 0);
      assert.equal((await row("SELECT count(*)::int n FROM sports_management.audit_logs WHERE entity_id=$1 AND action='UPDATE'", [rollbackMatch])).n, 0);
    } finally {
      await pool.query("DROP TRIGGER pd134_reject_history ON sports_management.match_status_history");
      await pool.query("DROP FUNCTION sports_management.pd134_reject_history()");
    }

    const concurrent = await draft("concurrencia", 13);
    const race = await Promise.allSettled([run({ ...input, matchId: concurrent, operationId: randomUUID() }),
      run({ ...input, matchId: concurrent, operationId: randomUUID() })]);
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((race.find(result => result.status === "rejected") as PromiseRejectedResult).reason.code, "STALE_MATCH");
    // Más de una página: los cursores nunca repiten ni pierden registros visibles.
    const paginated = await pool.query(`INSERT INTO sports_management.matches
      (season_id,group_id,matchday_id,number,home_team_id,away_team_id)
      SELECT $1,$2,$3,$4 || '-' || n,$5,$6 FROM generate_series(1,55) n RETURNING id`,
    [season, group, day, `PD134-${tag}`, ...teams]);
    const found = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await prisma.$transaction(tx => getRecorderWorkspaceInTransaction(tx, actor, cursor));
      for (const item of page.items) { assert.equal(found.has(item.id), false); found.add(item.id); }
      cursor = page.nextAfter ?? undefined;
    } while (cursor);
    assert.ok(paginated.rows.every(item => found.has(item.id)));
    const otherDay=await row(`INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date)
      VALUES($1,2,'2026-11-21','2026-11-21') RETURNING id`,[season]);
    const otherDayMatch=await row(`INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[season,group,otherDay.id,`J2-${tag}`,...teams]);
    const byDay=new Set<string>();cursor=undefined;
    do {
      const page=await prisma.$transaction(tx=>getRecorderWorkspaceInTransaction(tx,actor,cursor,day));
      assert.ok(page.matchdays.some(item=>item.id===day));
      for(const item of page.items){assert.equal(item.matchday,1);assert.equal(byDay.has(item.id),false);byDay.add(item.id);}
      cursor=page.nextAfter??undefined;
    } while(cursor);
    assert.ok(paginated.rows.every(item=>byDay.has(item.id)));
    assert.equal(byDay.has(otherDayMatch.id),false);
    await assert.rejects(prisma.$transaction(tx=>getRecorderWorkspaceInTransaction(tx,actor,undefined,randomUUID())),{code:"FORBIDDEN"});
    await row(`INSERT INTO sports_management.venue_availability(venue_id,type,starts_at,ends_at)
      VALUES($1,'AVAILABLE','2026-11-21T10:00Z','2026-11-21T18:00Z')`,[venue]);
    await row(`INSERT INTO sports_management.referee_availability(referee_id,starts_at,ends_at,is_available)
      VALUES($1,'2026-11-21T12:00Z','2026-11-21T13:00Z',true)`,[referee.id]);
    const batchMatches=[];
    for(const hour of [12,14]) batchMatches.push(await row(`INSERT INTO sports_management.matches
      (season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until,status_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,'2026-11-21'::date+make_interval(hours=>$8),'2026-11-21'::date+make_interval(hours=>$8+1),
      '2026-11-21'::date+make_interval(hours=>$8+1,mins=>15),sports_management.get_match_status_id('SCHEDULED')) RETURNING id`,
      [season,group,otherDay.id,`BATCH-${hour}-${tag}`,...teams,venue,hour]));
    await row(`INSERT INTO sports_management.referee_assignments(match_id,referee_id,assignment_role,status,created_by,approved_by,approved_at,approved_identity_version)
      VALUES($1,$2,'MAIN','APPROVED',$3,$3,now(),$4)`,[batchMatches[0].id,referee.id,actor,refereePerson.identity_version??1]);
    const batch={matchdayId:otherDay.id,operationId:randomUUID(),reason:"Confirmación de jornada de prueba"};
    await assert.rejects(confirmMatchdayForActor(refereeUser.id,batch,prisma),{code:"FORBIDDEN"});
    const firstBatch=await confirmMatchdayForActor(actor,batch,prisma);
    assert.equal(firstBatch.confirmed.length,1);
    assert.ok(firstBatch.pending.some(item=>item.code==="MAIN_REFEREE_REQUIRED"));
    const repeatedBatch=await confirmMatchdayForActor(actor,batch,prisma);
    assert.equal(repeatedBatch.confirmed.length,0);
    assert.equal((await row("SELECT count(*)::int n FROM sports_management.match_status_history WHERE match_id=$1",[batchMatches[0].id])).n,1);
    assert.equal((await row(`SELECT s.code FROM sports_management.matches m JOIN sports_management.match_statuses s ON s.id=m.status_id WHERE m.id=$1`,[batchMatches[1].id])).code,"SCHEDULED");
    const rollbackReview=new Error("ROLLBACK_RESULTADO");
    await assert.rejects(prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.user_id',${actor},true),set_config('app.reason','Prueba de resultado existente',true)`;
      await tx.$executeRaw`INSERT INTO sports_management.permissions(module,action) VALUES ('discipline','APPROVE') ON CONFLICT DO NOTHING`;
      await tx.$executeRaw`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
        SELECT r.id,p.id,false FROM sports_management.roles r CROSS JOIN sports_management.permissions p
        WHERE r.code='DISCIPLINARY_BOARD' AND p.module='discipline' AND p.action='APPROVE' ON CONFLICT DO NOTHING`;
      const board=await tx.roles.findUniqueOrThrow({where:{code:"DISCIPLINARY_BOARD"}});
      await tx.user_roles.create({data:{user_id:actor,role_id:board.id,league_id:league}});
      const reviewStatus=await tx.match_statuses.findUniqueOrThrow({where:{code:"UNDER_REVIEW"}});
      const review=await tx.matches.create({data:{season_id:season,group_id:group,matchday_id:day,number:"con-resultado",home_team_id:teams[0],away_team_id:teams[1],status_id:reviewStatus.id}});
      await tx.match_results.create({data:{match_id:review.id,home_score:1,away_score:0,source:"ADMINISTRATIVE",validated_by:actor}});
      const cancel={matchId:review.id,operationId:randomUUID(),expectedVersion:review.version,toStatus:"CANCELED",reason:"Revisión de prueba"};
      await assert.rejects(cancelReviewedMatchInTransaction(tx,actor,cancel),{code:"MATCH_RESULT_EXISTS"});
      assert.equal((await tx.matches.findUniqueOrThrow({where:{id:review.id}})).version,review.version);
      throw rollbackReview;
    }),error=>error===rollbackReview);
    // Reprogramar conserva el partido y reemplaza las reservas en una sola transacción.
    const rollbackReschedule = new Error("ROLLBACK_REPROGRAMACION");
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.user_id',${actor},true),set_config('app.reason','Prueba de reprogramación',true)`;
      await tx.$executeRaw`INSERT INTO sports_management.permissions(module,action) VALUES ('scheduling','READ') ON CONFLICT DO NOTHING`;
      await tx.$executeRaw`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
        SELECT ${role}::uuid,id,false FROM sports_management.permissions WHERE module='scheduling' AND action='READ' ON CONFLICT DO NOTHING`;
      await tx.seasons.update({where:{id:season},data:{end_date:new Date("2035-12-31")}});
      await tx.leagues.update({where:{id:league},data:{timezone:"UTC"}});
      await tx.season_teams.updateMany({where:{id:{in:teams}},data:{status:"ACTIVE"}});
      await tx.competition_rule_parameters.create({data:{competition_rule_id:rule,parameter_key:"calendar",parameter_value:{complexOnlyFinalRounds:0},validated_by:actor}});
      await tx.competition_rules.update({where:{id:rule},data:{status:"APPROVED",approved_by:actor,approved_at:new Date()}});
      const court=await tx.venues.create({data:{league_id:league,code:"PD132-FUTURA",name:"Cancha sintética",address:"Prueba",is_league_sports_complex:true,match_duration_minutes:60,buffer_minutes:15}});
      await tx.venue_availability.create({data:{venue_id:court.id,type:"AVAILABLE",starts_at:new Date("2035-11-14T08:00:00Z"),ends_at:new Date("2035-11-14T20:00:00Z")}});
      const alternate=await tx.venues.create({data:{league_id:league,code:"PD132-ALTERNA",name:"Cancha alterna",address:"Prueba",is_league_sports_complex:true,match_duration_minutes:60,buffer_minutes:15}});
      await tx.venue_availability.create({data:{venue_id:alternate.id,type:"AVAILABLE",starts_at:new Date("2035-11-14T08:00:00Z"),ends_at:new Date("2035-11-14T20:00:00Z")}});
      const scheduled=await tx.match_statuses.findUniqueOrThrow({where:{code:"SCHEDULED"}});
      const moving=await tx.matches.create({data:{season_id:season,group_id:group,matchday_id:day,number:"reprogramar",home_team_id:teams[0],away_team_id:teams[1],venue_id:court.id,
        starts_at:new Date("2035-11-14T10:00:00Z"),ends_at:new Date("2035-11-14T11:00:00Z"),reserved_until:new Date("2035-11-14T11:15:00Z"),status_id:scheduled.id}});
      await tx.matches.create({data:{season_id:season,group_id:group,matchday_id:day,number:"ocupado",home_team_id:teams[0],away_team_id:teams[1],venue_id:court.id,
        starts_at:new Date("2035-11-14T16:00:00Z"),ends_at:new Date("2035-11-14T17:00:00Z"),reserved_until:new Date("2035-11-14T17:15:00Z"),status_id:scheduled.id}});
      const unscheduledDraft=await tx.matches.create({data:{season_id:season,group_id:group,matchday_id:day,number:"borrador-sin-horario",home_team_id:teams[0],away_team_id:teams[1]}});
      const initialInput={matchId:unscheduledDraft.id,operationId:randomUUID(),expectedVersion:unscheduledDraft.version,venueId:court.id,startsAtLocal:"2035-11-14T18:00",reason:"Asignar fecha y cancha"};
      await assert.rejects(rescheduleAbsentMatchInTransaction(tx,refereeUser.id,initialInput),{code:"FORBIDDEN"});
      const initialResult=await rescheduleAbsentMatchInTransaction(tx,actor,initialInput);
      assert.equal(initialResult.replayed,false);
      assert.equal((await rescheduleAbsentMatchInTransaction(tx,actor,initialInput)).replayed,true);
      assert.equal((await tx.matches.findUniqueOrThrow({where:{id:unscheduledDraft.id},include:{match_statuses:true}})).match_statuses.code,"SCHEDULED");
      assert.equal(await tx.venue_reservations.count({where:{match_id:unscheduledDraft.id}}),1);
      assert.equal(await tx.team_reservations.count({where:{match_id:unscheduledDraft.id}}),2);
      const move={matchId:moving.id,operationId:randomUUID(),expectedVersion:moving.version,venueId:court.id,startsAtLocal:"2035-11-14T12:00",reason:"Lluvia y seguridad de la cancha"};
      const slotQuery={matchId:moving.id,venueId:court.id,date:"2035-11-14",expectedVersion:moving.version};
      await assert.rejects(getRescheduleSlotsInTransaction(tx,refereeUser.id,slotQuery),{code:"FORBIDDEN"});
      await assert.rejects(getRescheduleSlotsInTransaction(tx,actor,{...slotQuery,expectedVersion:999}),{code:"STALE_MATCH"});
      const slots=await getRescheduleSlotsInTransaction(tx,actor,slotQuery);
      assert.ok(slots.some(s=>s.value==="2035-11-14T12:00"));
      assert.ok(!slots.some(s=>s.value==="2035-11-14T16:00"));
      assert.ok(!slots.some(s=>s.value==="2035-11-14T19:00")); // el partido y su holgura no caben.
      let afterId: string | undefined, canMove = false;
      do {
        const page=await getRecorderWorkspaceInTransaction(tx,actor,afterId);
        canMove ||= page.items.some(item=>item.id===moving.id && item.canReschedule);
        afterId=page.nextAfter ?? undefined;
      } while(afterId && !canMove);
      assert.equal(canMove,true);
      await assert.rejects(rescheduleAbsentMatchInTransaction(tx,refereeUser.id,move),{code:"FORBIDDEN"});
      await assert.rejects(rescheduleAbsentMatchInTransaction(tx,actor,{...move,expectedVersion:999}),{code:"STALE_MATCH"});
      await assert.rejects(rescheduleAbsentMatchInTransaction(tx,actor,{...move,startsAtLocal:"2035-11-14T10:00"}),{code:"RESCHEDULE_UNCHANGED"});
      await assert.rejects(rescheduleAbsentMatchInTransaction(tx,actor,{...move,venueId:randomUUID()}),{code:"VENUE_NOT_AVAILABLE"});
      await assert.rejects(rescheduleAbsentMatchInTransaction(tx,actor,{...move,venueId:alternate.id,startsAtLocal:"2035-11-14T16:00"}),{code:"RESERVATION_CONFLICT"});
      const saved=await rescheduleAbsentMatchInTransaction(tx,actor,move);
      assert.equal(saved.replayed,false);
      assert.equal((await rescheduleAbsentMatchInTransaction(tx,actor,move)).replayed,true);
      const after=await tx.matches.findUniqueOrThrow({where:{id:moving.id},include:{match_statuses:true}});
      assert.equal(after.match_statuses.code,"RESCHEDULED");
      assert.equal(after.starts_at?.toISOString(),"2035-11-14T12:00:00.000Z");
      assert.equal(await tx.venue_reservations.count({where:{match_id:moving.id}}),1);
      assert.equal(await tx.team_reservations.count({where:{match_id:moving.id}}),2);
      assert.equal(await tx.match_status_history.count({where:{id:move.operationId}}),1);
      const sanctionType=await tx.sanction_types.findUniqueOrThrow({where:{code:"TIME"}});
      const draftRule=await tx.competition_rules.create({data:{season_id:season,version_number:2}});
      const article=await tx.regulation_articles.create({data:{competition_rule_id:draftRule.id,number:"S-REPROGRAMACION",description:"Prueba",sanction_type_id:sanctionType.id}});
      const disciplinaryCase=await tx.disciplinary_cases.create({data:{season_id:season,reference_number:randomUUID(),opened_by:actor,description:"Prueba"}});
      const ruling=await tx.disciplinary_rulings.create({data:{case_id:disciplinaryCase.id,version_number:1,decided_by:actor,decision:"Prueba",reason:"Prueba"}});
      await tx.sanctions.create({data:{ruling_id:ruling.id,article_id:article.id,sanction_type_id:sanctionType.id,season_team_id:teams[0],starts_at:new Date("2035-11-14T14:30:00Z"),ends_at:new Date("2035-11-14T15:30:00Z"),blocks_participation:true}});
      await assert.rejects(rescheduleAbsentMatchInTransaction(tx,actor,{...move,operationId:randomUUID(),expectedVersion:after.version,startsAtLocal:"2035-11-14T14:00"}),{code:"TEAM_SUSPENDED"});
      const again=await rescheduleAbsentMatchInTransaction(tx,actor,{...move,operationId:randomUUID(),expectedVersion:after.version,venueId:alternate.id});
      assert.equal(again.appliedVersion,after.version+1);
      assert.equal((await tx.venue_reservations.findUniqueOrThrow({where:{match_id:moving.id}})).venue_id,alternate.id);
      const pending={matchId:moving.id,operationId:randomUUID(),expectedVersion:again.appliedVersion,toStatus:"UNSCHEDULED" as const,reason:"Sin cancha para la fecha"};
      await assert.rejects(transitionMatchInTransaction(tx,refereeUser.id,pending),{code:"FORBIDDEN"});
      assert.equal((await transitionMatchInTransaction(tx,actor,pending)).replayed,false);
      assert.equal((await transitionMatchInTransaction(tx,actor,pending)).replayed,true);
      const waiting=await tx.matches.findUniqueOrThrow({where:{id:moving.id},include:{match_statuses:true}});
      assert.equal(waiting.match_statuses.code,"UNSCHEDULED");
      assert.equal(waiting.starts_at,null); assert.equal(waiting.venue_id,null);
      assert.equal(await tx.venue_reservations.count({where:{match_id:moving.id}}),0);
      assert.equal(await tx.team_reservations.count({where:{match_id:moving.id}}),0);
      const scheduledAgain=await rescheduleAbsentMatchInTransaction(tx,actor,{...move,operationId:randomUUID(),expectedVersion:waiting.version,startsAtLocal:"2035-11-14T12:00"});
      assert.equal(scheduledAgain.appliedVersion,waiting.version+1);
      assert.equal(await tx.venue_reservations.count({where:{match_id:moving.id}}),1);
      throw rollbackReschedule;
    },{timeout:30000}),error=>error===rollbackReschedule);
    // Una revocación también impide obtener el acuse de una operación anterior.
    await row("UPDATE sports_management.user_roles SET ends_at=now() WHERE id=$1", [assignment]);
    await assert.rejects(run(), { code: "FORBIDDEN" });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
});
