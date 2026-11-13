import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { transitionMatchInTransaction } from "../../src/features/matches/server/transition";
import { getRecorderWorkspaceInTransaction } from "../../src/features/matches/server/recorder-workspace";
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
      await row(`INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,requested_by)
        VALUES ($1,$2,$3,$4,'Azul',$5)`, [season, club, league, reference, actor]);
      teams.push((await row("INSERT INTO sports_management.season_teams(season_id,team_id,club_id,group_id) VALUES ($1,$2,$3,$4) RETURNING id", [season, team, club, group])).id);
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
    await row(`INSERT INTO sports_management.referee_assignments(match_id,referee_id,assignment_role,status,created_by,approved_by,approved_at)
      VALUES ($1,$2,'MAIN','APPROVED',$3,$3,now())`, [matchId, referee.id, actor]);
    const confirmation = await run(confirm);
    assert.equal(confirmation.appliedVersion, 3);
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
        for (const path of ["/access", "/matches/recording"]) {
          const response = await browser.request(path);
          assert.equal(response.status, 200, `No abrió ${path} con Preview`);
          assert.doesNotMatch(await response.text(), /No se pudo consultar la alineación|No se pudo cargar el registro/);
        }
        const workspace = await runtime.$transaction(tx => getRecorderWorkspaceInTransaction(tx, refereeUser.id));
        assert.ok(workspace.items.some(item => item.id === matchId && item.canRecordMatch));
        const previewRun = () => runtime.$transaction(tx => transitionMatchInTransaction(tx, refereeUser.id, start), { timeout: 15000 });
        assert.equal((await previewRun()).replayed, false);
        assert.equal((await previewRun()).replayed, true);
        assert.equal((await row("SELECT count(*)::int AS n FROM sports_management.match_status_history WHERE id=$1", [start.operationId])).n, 1);
      } finally { await runtime.$disconnect(); }
    }
    if (process.env.PDGLD132_HTTP_TEST === "1" && process.env.CHROME_BIN) {
      const uiMatch = await draft("navegador-real", 18);
      await run({ ...input, matchId: uiMatch, operationId: randomUUID() });
      await row(`INSERT INTO sports_management.referee_assignments(match_id,referee_id,assignment_role,status,created_by,approved_by,approved_at)
        VALUES ($1,$2,'MAIN','APPROVED',$3,$3,now())`, [uiMatch, referee.id, actor]);
      await run({ ...confirm, matchId: uiMatch, operationId: randomUUID() });
      const { Browser } = await import("./auth.test.mjs");
      const { launchChrome } = await import("../e2e/chrome-session.mjs");
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(".next-auth-tests/match-evidence", { recursive: true });
      const origin = new URL(process.env.NEXTAUTH_URL!).origin;
      const http = new Browser(origin);
      await http.login(email, password);
      const chrome = await launchChrome(origin);
      try {
        await chrome.command("Network.setCookies", { cookies: [...http.cookies].map(([name, value]) => ({ name, value, url: origin })) });
        await chrome.command("Page.navigate", { url: `${origin}/matches/recording` });
        const wait = async (expression: string) => { for (let i=0;i<200;i++) { if (await chrome.evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error("Pantalla de capturista no disponible"); };
        await wait("document.body?.innerText.includes('navegador-real')");
        const selector = "[...document.querySelectorAll('article')].find(a=>a.innerText.includes('navegador-real'))";
        await wait(`(()=>{const b=${selector}?.querySelector('button');return b&&Object.keys(b).some(k=>k.startsWith('__reactProps'));})()`);
        await mkdir(".next-auth-tests/match-evidence", { recursive: true });
        for (const width of [390, 1280]) for (const theme of ["light", "dark"]) {
          await chrome.command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
          await chrome.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
          assert.ok(await chrome.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
          const image = await chrome.command("Page.captureScreenshot", { format: "png" });
          await writeFile(`.next-auth-tests/match-evidence/${width}-${theme}.png`, Buffer.from(image.data, "base64"));
        }
        await chrome.evaluate(`${selector}.querySelector('button').click()`);
        await wait("!!document.querySelector('dialog[open]')");
        assert.ok(await chrome.evaluate("document.querySelector('dialog[open]').contains(document.activeElement)"));
        await chrome.evaluate("(()=>{const t=document.querySelector('dialog textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Inicio desde navegador');t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('dialog input[type=checkbox]').click()})()");
        await chrome.evaluate("document.querySelector('dialog form').requestSubmit()");
        await wait("document.body.innerText.includes('Estado actualizado.')");
        assert.equal((await row(`SELECT s.code FROM sports_management.matches m JOIN sports_management.match_statuses s ON s.id=m.status_id WHERE m.id=$1`, [uiMatch])).code, "IN_PROGRESS");
        assert.equal((await row("SELECT count(*)::int n FROM sports_management.match_status_history WHERE match_id=$1", [uiMatch])).n, 3);
      } finally { await chrome.close(); }
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
    // Una revocación también impide obtener el acuse de una operación anterior.
    await row("UPDATE sports_management.user_roles SET ends_at=now() WHERE id=$1", [assignment]);
    await assert.rejects(run(), { code: "FORBIDDEN" });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
});
