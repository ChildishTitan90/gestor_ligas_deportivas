import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import pg from "pg";
import type {
  TwoFactorCommand,
  TwoFactorResult,
} from "../../src/features/auth/two-factor-contract";
import { MFA_STEP_MS, totpAt } from "../../src/server/auth/two-factor-crypto";
import { launchChrome } from "../e2e/chrome-session.mjs";
import { createAuthFixtures, fixturePassword } from "./auth-fixtures.mjs";
import { Browser } from "./auth.test.mjs";

const dbUrl = new URL(process.env.MFA_TEST_ADMIN_URL ?? "");
const origin = new URL(process.env.NEXTAUTH_URL ?? "");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(dbUrl.hostname));
assert.match(dbUrl.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
assert.equal(origin.hostname, "127.0.0.1");

function codeAt(secret: string, offset = 0) {
  return totpAt(secret, Math.floor(Date.now() / MFA_STEP_MS) + offset);
}

async function waitFor(check: () => Promise<boolean>, description: string) {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(120);
  }
  assert.fail(description);
}

test("TOTP: ingreso pendiente, recuperación del último código y revocación con acceso limitado", async () => {
  const db = new pg.Client({ connectionString: dbUrl.href });
  await db.connect();
  try {
    const { operational, idle } = (await createAuthFixtures(db)) as Record<
      string,
      { id: string; email: string }
    >;
    const assigned = await db.query(
      `
      INSERT INTO sports_management.user_roles(user_id, role_id)
      SELECT $1, id FROM sports_management.roles WHERE code = 'SUPERADMIN'
    `,
      [operational.id],
    );
    assert.equal(assigned.rowCount, 1);

    async function login(email = operational.email) {
      const browser = new Browser(origin.origin);
      await browser.login(email, fixturePassword);
      return browser;
    }

    async function command(
      browser: Browser,
      body: TwoFactorCommand,
      expected: number | readonly number[] = 200,
    ): Promise<TwoFactorResult> {
      const response = await browser.request("/api/auth/two-factor", {
        method: "POST",
        headers: { origin: origin.origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as TwoFactorResult;
      assert.ok(
        (typeof expected === "number" ? [expected] : expected).includes(
          response.status,
        ),
        `Respuesta inesperada para ${body.action}: ${data.code}`,
      );
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      return data;
    }

    function enrollment(data: TwoFactorResult) {
      assert.equal(data.code, "ENROLLMENT_PENDING");
      assert.ok(
        data.secret && data.operation && Number.isInteger(data.revision),
      );
      return {
        secret: data.secret,
        operation: data.operation,
        revision: data.revision!,
      };
    }

    const outsider = await login(idle.email);
    await outsider.assertAccess(200);
    await command(
      outsider,
      { action: "begin", password: fixturePassword, revision: 0 },
      403,
    );

    const first = await login();
    const oldCookie = await login();
    await first.assertAccess(200);
    const initial = enrollment(
      await command(first, {
        action: "begin",
        password: fixturePassword,
        revision: 0,
      }),
    );
    assert.equal((await command(first, { action: "status" })).active, false);
    await oldCookie.assertAccess(200);
    const activated = await command(first, {
      action: "confirm",
      operation: initial.operation,
      revision: initial.revision,
      code: codeAt(initial.secret, -1),
    });
    assert.equal(activated.codes?.length, 10);
    await oldCookie.assertAccess(401);

    const challenge = await login();
    const competitor = await login();
    await challenge.assertAccess(403, "MFA_REQUIRED");
    await competitor.assertAccess(403, "MFA_REQUIRED");

    const chrome = await launchChrome(origin.origin);
    try {
      await chrome.command("Network.enable");
      for (const [name, value] of challenge.cookies) {
        if (name.includes("session-token")) {
          await chrome.command("Network.setCookie", {
            url: origin.origin,
            name,
            value,
            httpOnly: true,
            path: "/",
          });
        }
      }
      await chrome.command("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await chrome.command("Page.navigate", { url: `${origin.origin}/login` });
      await waitFor(
        () =>
          chrome.evaluate(
            "location.pathname === '/two-factor' && !!document.querySelector('#mfa-code')",
          ),
        "Chrome no mostró el desafío navegable",
      );
      assert.equal(
        await chrome.evaluate("document.documentElement.scrollWidth <= 390"),
        true,
        "Desborde en móvil",
      );
      assert.equal(
        await chrome.evaluate(
          "!!document.querySelector('label[for=mfa-code]')",
        ),
        true,
      );
      await chrome.command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
      });
      await chrome.command("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
      });
      assert.equal(
        await chrome.evaluate("document.activeElement !== document.body"),
        true,
        "El Tab no mueve el foco",
      );
    } finally {
      await chrome.close();
    }

    const onlyCode = activated.codes![0];
    const consumed = await db.query(
      `
      UPDATE sports_management.mfa_recovery_codes SET consumed_at=now()
      WHERE user_id=$1 AND code_hash<>encode(sha256(convert_to('pdgld-mfa-v1:' || $1::text || ':' || $2,'UTF8')),'hex')
    `,
      [operational.id, onlyCode],
    );
    assert.equal(consumed.rowCount, 9);
    const attempts = await Promise.all([
      command(challenge, { action: "recover", code: onlyCode }, [200, 400]),
      command(competitor, { action: "recover", code: onlyCode }, [200, 400]),
    ]);
    // Both requests race; either session may win.
    const inRecovery = await Promise.all([
      challenge.session(),
      competitor.session(),
    ]);
    const winner = inRecovery.findIndex(
      (session) => session.user?.secondFactor === "RECOVERY",
    );
    assert.notEqual(winner, -1);
    assert.equal(
      inRecovery.filter((session) => session.user?.secondFactor === "RECOVERY")
        .length,
      1,
    );
    assert.equal(
      attempts.filter((attempt) => attempt.code === "INVALID_PROOF").length,
      1,
    );
    const recovery = enrollment(attempts[winner]);
    const recovering = [challenge, competitor][winner];
    await recovering.assertAccess(403, "MFA_REQUIRED");
    const before = await db.query(
      `
      SELECT count(*)::int AS count FROM sports_management.mfa_recovery_codes WHERE user_id=$1 AND consumed_at IS NULL
    `,
      [operational.id],
    );
    assert.equal(before.rows[0].count, 0);
    const recovered = await command(recovering, {
      action: "confirm",
      operation: recovery.operation,
      revision: recovery.revision,
      code: codeAt(recovery.secret, -1),
    });
    assert.equal(recovered.codes?.length, 10);
    await challenge.assertAccess(401);
    await competitor.assertAccess(401);
    const fresh = await login();
    await command(fresh, { action: "verify", code: codeAt(recovery.secret) });
    await fresh.assertAccess(200);
    const events = await db.query(
      "SELECT action FROM sports_management.authentication_events WHERE user_id=$1",
      [operational.id],
    );
    assert.equal(
      events.rows.filter((event) => event.action === "MFA_RECOVERY_STARTED")
        .length,
      1,
    );
    assert.equal(
      events.rows.filter((event) => event.action === "MFA_RECOVERED").length,
      1,
    );
    const discarded = await login();
    const backup = recovered.codes![0];
    const replacement = enrollment(
      await command(discarded, { action: "recover", code: backup }),
    );
    await command(discarded, {
      action: "cancel",
      operation: replacement.operation,
      revision: replacement.revision,
    });
    await discarded.assertAccess(401);
    await fresh.assertAccess(200);
    assert.equal(
      (await command(fresh, { action: "status" })).remainingCodes,
      9,
    );
    const retry = await login();
    await command(retry, { action: "recover", code: backup }, 400);
    for (let attempt = 0; attempt < 3; attempt++) {
      await command(retry, { action: "verify", code: "invalid" }, 400);
    }
    const blocked = await command(
      retry,
      { action: "verify", code: "invalid" },
      429,
    );
    const anotherChallenge = await login();
    const stillBlocked = await command(
      anotherChallenge,
      { action: "verify", code: "invalid" },
      429,
    );
    assert.ok(blocked.retryAt);
    assert.equal(stillBlocked.retryAt, blocked.retryAt);
  } finally {
    await db.end();
  }
});
