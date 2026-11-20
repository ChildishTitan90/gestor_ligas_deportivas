import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import pg from "pg";
import { childEnvironment } from "../../scripts/ci/delegate-isolated-runtime.mjs";
import { PREVIEW_MARKER, provisionPreviewRuntime } from "../../scripts/preview/runtime-plan.mjs";
import { Browser } from "./auth.test.mjs";

type Fixture = {
  proposalId: string;
  storedProposalId: string;
  matchId: string;
  venueId: string;
  password: string;
  scheduler: { id: string; email: string };
  reviewer: { id: string; email: string };
  outsider: { id: string; email: string };
};

export async function verifyScheduleAdjustmentHttp(databaseUrl: URL, fixture: Fixture) {
  assert.equal(`${databaseUrl.hostname}:${databaseUrl.port}`, "127.0.0.1:55425");
  assert.match(databaseUrl.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const name = databaseUrl.pathname.slice(1);
  const admin = new pg.Client({ connectionString: databaseUrl.href });
  const password = randomBytes(24).toString("hex");
  await admin.connect();
  try {
    await admin.query(`COMMENT ON DATABASE "${name}" IS '${PREVIEW_MARKER}'`);
    for (const { tablename } of (await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'sports_management'",
    )).rows) {
      await admin.query(`ALTER TABLE sports_management."${tablename.replaceAll('"', '""')}" ENABLE ROW LEVEL SECURITY`);
    }
    await provisionPreviewRuntime(admin);
    await admin.query(`ALTER ROLE gestor_ligas_preview LOGIN PASSWORD '${password}'`);
  } finally { await admin.end(); }

  const runtime = new URL(databaseUrl);
  runtime.username = "gestor_ligas_preview";
  runtime.password = password;
  const port = 3195;
  const base = `http://127.0.0.1:${port}`;
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: {
      ...childEnvironment(process.env), NODE_ENV: "development", DATABASE_URL: runtime.href,
      NEXTAUTH_URL: base, NEXTAUTH_SECRET: randomBytes(48).toString("hex"), AUTH_TEST_RUN: "1",
    },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  const stopped = once(app, "exit");
  let output = "";
  const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-6000); };
  app.stdout.on("data", capture);
  app.stderr.on("data", capture);
  try {
    const until = Date.now() + 90_000;
    let ready = false;
    while (!ready && app.exitCode === null && Date.now() < until) {
      try {
        ready = (await fetch(base + "/api/auth/csrf", { signal: AbortSignal.timeout(5000) })).ok;
      } catch { /* Next todavía está compilando la ruta. */ }
      if (!ready) await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, "Next no abrió la ruta de autenticación");
    async function login(actor: Fixture["scheduler"]) {
      const session = new Browser(base);
      const loginUrl = await session.login(actor.email, fixture.password);
      assert.ok(!loginUrl.searchParams.has("error"));
      assert.equal((await session.session()).user.id, actor.id);
      return session;
    }
    const scheduler = await login(fixture.scheduler);
    const reviewer = await login(fixture.reviewer);
    const outsider = await login(fixture.outsider);

    async function post(session: Browser, actorId: string, path: string, body: object, status: number, code: string) {
      const response = await session.request(`/api/scheduling/${path}`, {
        method: "POST",
        headers: { origin: base, "content-type": "application/json", "X-Expected-Actor-Id": actorId },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      assert.equal(response.status, status, `${path}: ${result.code}`);
      assert.equal(result.code, code);
      return result;
    }
    async function page(session: Browser) {
      const response = await session.request("/scheduling/proposals");
      assert.equal(response.status, 200);
      return response.text();
    }

    const detailBody = { proposalId: fixture.storedProposalId };
    const detail = await post(scheduler, fixture.scheduler.id, "proposal-detail", detailBody, 200, "PROPOSAL_DETAIL");
    assert.equal(detail.authorId, fixture.scheduler.id);
    assert.ok(detail.proposal.matches[0].matchdayId);
    assert.ok(detail.proposal.matches[0].reservedUntil);
    assert.ok(!JSON.stringify(detail).includes("requestHash"));
    await post(outsider, fixture.outsider.id, "proposal-detail", detailBody, 403, "FORBIDDEN");
    await post(new Browser(base), fixture.scheduler.id, "proposal-detail", detailBody, 401, "UNAUTHENTICATED");
    const adjustment = {
      proposalId: fixture.proposalId, matchId: fixture.matchId, expectedVersion: 1,
      startsAt: "2026-11-14T11:00",
    };
    const save = { ...adjustment, venueId: fixture.venueId, reason: "Ajuste HTTP de aceptación" };
    assert.match(await page(scheduler), /Ajustar horario y cancha/);
    const deniedPage = await page(outsider);
    assert.doesNotMatch(deniedPage, new RegExp(fixture.matchId));
    await post(new Browser(base), fixture.scheduler.id, "adjustments", save, 401, "UNAUTHENTICATED");
    await post(outsider, fixture.outsider.id, "adjustments", save, 403, "FORBIDDEN");
    await post(scheduler, fixture.reviewer.id, "adjustments", save, 403, "FORBIDDEN");
    const preview = await post(scheduler, fixture.scheduler.id, "adjustment-preview", adjustment, 200, "VENUE_OPTIONS");
    assert.ok(preview.venues.some((option: { venueId: string }) => option.venueId === fixture.venueId));
    const saved = await post(scheduler, fixture.scheduler.id, "adjustments", save, 200, "ADJUSTMENT_SAVED");
    await post(scheduler, fixture.scheduler.id, "adjustments", save, 409, "STALE_MATCH");

    const review = { proposalId: fixture.proposalId, expectedVersion: saved.proposalVersion, reason: "Revisión HTTP de aceptación" };
    const submitted = await post(scheduler, fixture.scheduler.id, "review", { ...review, operation: "submit" }, 200, "PROPOSAL_UPDATED");
    const approve = { ...review, expectedVersion: submitted.version, operation: "approve" };
    await post(scheduler, fixture.scheduler.id, "review", approve, 403, "FORBIDDEN");
    await post(outsider, fixture.outsider.id, "review", approve, 403, "FORBIDDEN");
    assert.match(await page(reviewer), /Aprobar propuesta/);
    const approved = await post(reviewer, fixture.reviewer.id, "review", approve, 200, "PROPOSAL_UPDATED");
    assert.equal(approved.status, "APPROVED");
    assert.match(await page(reviewer), /Aprobada para operación/);
  } catch (error) {
    console.error(output.replaceAll(runtime.href, "[base temporal]"));
    throw error;
  } finally {
    if (app.exitCode === null) {
      if (process.platform === "win32" && app.pid) {
        const cleanup = spawn("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        await once(cleanup, "exit");
      } else app.kill();
      await stopped;
    }
  }
}
