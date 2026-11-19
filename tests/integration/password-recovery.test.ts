import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { completePasswordRecovery, requestPasswordRecovery } from "../../src/server/auth/password-recovery";
import { hashPassword, verifyPassword } from "../../src/server/auth/password";
import { getPrisma } from "../../src/server/db/prisma";
import type { AccountEmail } from "../../src/server/email/transport";

const admin = new URL(process.env.RECOVERY_TEST_ADMIN_URL ?? "");
const runtime = new URL(process.env.DATABASE_URL ?? "");
assert.equal(process.env.AUTH_TEST_RUN, "1");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(admin.hostname));
assert.match(admin.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
assert.equal(runtime.host, admin.host);
assert.equal(runtime.pathname, admin.pathname);
assert.equal(runtime.username, "gestor_ligas_preview");

test("PDGLD-32: emisión privada, caducidad, consumo concurrente y revocación", async () => {
  const db = new pg.Client({ connectionString: admin.href });
  await db.connect();
  try {
    await db.query(`ALTER ROLE gestor_ligas_preview IN DATABASE "${admin.pathname.slice(1)}" SET timezone TO 'America/Mexico_City'`);
    const email = `${randomUUID()}@example.test`;
    const original = "Original!Synthetic123";
    const replacement = "Replacement!Synthetic456";
    const person = (await db.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Fixture','Recuperación') RETURNING id")).rows[0].id;
    const id = (await db.query(
      "INSERT INTO sports_management.users(person_id,username,email,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now()) RETURNING id",
      [person, randomUUID(), email, await hashPassword(original)],
    )).rows[0].id;
    await db.query("INSERT INTO sports_management.sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')", [id, randomUUID()]);
    const sent: AccountEmail[] = [];
    const transport = { async send(message: AccountEmail) { sent.push(message); return "ACCEPTED" as const; } };
    const policy = { ttlMs: 900_000, maxPerHour: 2 };
    const snapshot = async () => (await db.query(
      "SELECT password_hash, version, (SELECT revoked_at FROM sports_management.sessions WHERE user_id=$1) AS revoked_at FROM sports_management.users WHERE id=$1", [id],
    )).rows[0];
    const initial = await snapshot();
    await requestPasswordRecovery("unknown@example.test", transport, policy);
    assert.equal(sent.length, 0);
    await Promise.all([requestPasswordRecovery(email, transport, policy), requestPasswordRecovery(email, transport, policy)]);
    assert.equal(sent.length, 1);
    const first = sent[0];
    assert.ok(first.kind === "PASSWORD_RECOVERY");
    assert.equal(first.to, email);
    const row = (await db.query("SELECT token_hash, expires_at FROM sports_management.password_resets WHERE id=$1", [first.idempotencyKey])).rows[0];
    assert.match(row.token_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(row.token_hash, first.token);
    assert.equal(row.expires_at.toISOString(), first.expiresAt.toISOString());
    await db.query("UPDATE sports_management.password_resets SET created_at=now()-interval '2 minutes', expires_at=now()-interval '1 minute' WHERE id=$1", [first.idempotencyKey]);
    assert.equal(await completePasswordRecovery(first.token, replacement), false);
    assert.deepEqual(await snapshot(), initial);

    await requestPasswordRecovery(email, transport, policy);
    assert.equal(sent.length, 2);
    const second = sent[1];
    assert.ok(second.kind === "PASSWORD_RECOVERY");
    const outcomes = await Promise.all([completePasswordRecovery(second.token, replacement), completePasswordRecovery(second.token, replacement)]);
    assert.deepEqual(outcomes.sort(), [false, true]);
    assert.equal(await completePasswordRecovery(second.token, original), false);
    const updated = await snapshot();
    assert.equal(await verifyPassword(updated.password_hash, original), false);
    assert.equal(await verifyPassword(updated.password_hash, replacement), true);
    assert.equal(updated.version, initial.version + 1);
    assert.ok(updated.revoked_at instanceof Date);
    const audit = await db.query("SELECT action FROM sports_management.authentication_events WHERE user_id=$1 AND action='PASSWORD_CHANGED'", [id]);
    assert.equal(audit.rowCount, 1);
    await requestPasswordRecovery(email, transport, policy);
    assert.equal(sent.length, 2, "respeta el límite incluso después de consumir");
  } finally {
    await getPrisma().$disconnect();
    await db.end();
  }
});


test("PDGLD-32: rechazo confirmado permite nueva solicitud; incertidumbre conserva enlace y privacidad", async () => {
  const db = new pg.Client({ connectionString: admin.href });
  await db.connect();
  try {
    const email = `${randomUUID()}@example.test`;
    const person = (await db.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Fixture','Reintento') RETURNING id")).rows[0].id;
    const id = (await db.query(
      "INSERT INTO sports_management.users(person_id,username,email,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now()) RETURNING id",
      [person, randomUUID(), email, await hashPassword("Original!Synthetic123")],
    )).rows[0].id;
    const sent: AccountEmail[] = [];
    let outcome: "FAILED" | "ACCEPTED" | "UNKNOWN" = "FAILED";
    const transport = { async send(message: AccountEmail) { sent.push(message); return outcome; } };
    const policy = { ttlMs: 900_000, maxPerHour: 3 };
    const unknown = await requestPasswordRecovery("unknown@example.test", transport, policy);
    assert.equal(sent.length, 0);
    const rejected = await requestPasswordRecovery(email, transport, policy);
    assert.equal(rejected, unknown, "no revela existencia ni resultado de entrega");
    const first = sent[0];
    assert.ok(first.kind === "PASSWORD_RECOVERY");
    const failed = (await db.query("SELECT used_at, expires_at FROM sports_management.password_resets WHERE id=$1", [first.idempotencyKey])).rows[0];
    assert.ok(failed.used_at instanceof Date);
    assert.ok(failed.expires_at > new Date(), "no espera a que venza para liberar la solicitud");
    assert.equal(await completePasswordRecovery(first.token, "Rejected!Synthetic456"), false);

    outcome = "ACCEPTED";
    const retry = await requestPasswordRecovery(email, transport, policy);
    assert.equal(retry, unknown);
    assert.equal(sent.length, 2, "nueva solicitud sí contacta al proveedor");
    const second = sent[1];
    assert.ok(second.kind === "PASSWORD_RECOVERY");
    assert.notEqual(second.token, first.token);
    assert.equal(await completePasswordRecovery(second.token, "Replacement!Synthetic456"), true);

    outcome = "UNKNOWN";
    await requestPasswordRecovery(email, transport, policy);
    const uncertain = sent[2];
    assert.ok(uncertain.kind === "PASSWORD_RECOVERY");
    await requestPasswordRecovery(email, transport, policy);
    assert.equal(sent.length, 3, "no reenvía ante una entrega incierta");
    assert.equal(await completePasswordRecovery(uncertain.token, "Uncertain!Synthetic789"), true);
    await requestPasswordRecovery(email, transport, policy);
    assert.equal(sent.length, 3, "el rechazo sigue contando para el límite por hora");
    const count = await db.query("SELECT count(*)::int AS total FROM sports_management.password_resets WHERE user_id=$1", [id]);
    assert.equal(count.rows[0].total, 3);
  } finally {
    await getPrisma().$disconnect();
    await db.end();
  }
});
