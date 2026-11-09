import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createEmailChangeService, hashEmailToken, type EmailAccount, type EmailRequest, type EmailChangeTransaction } from "./email-change-core";
import { AccountMaintenanceError } from "../maintenance-contract";
import { matchesLoginIdentifier } from "@/features/auth/login-identifier";
import { getEmailTransport, type AccountEmail, type EmailTransport } from "@/server/email/transport";

const actorId = randomUUID(), userId = randomUUID(), otherId = randomUUID();
function harness(transportMode: "ok" | "absent" | "failed" | "timeout" = "ok") {
  let clock = new Date("2026-11-05T12:00:00Z");
  let authorized = true, failAudit = false, failDelivery = false, failUnique = false;
  let state = { accounts: [userId, otherId].map((id, i): EmailAccount & { verifiedAt: Date | null } => ({
    id, email: `old${i}@example.test`, revision: 0, version: 1, active: true, blocked: false, verifiedAt: null,
  })), requests: [] as EmailRequest[], audit: [] as string[], sessions: [userId, otherId], resets: [userId, otherId] };
  const messages: AccountEmail[] = [];
  const transport: EmailTransport | null = transportMode === "absent" ? null : { async send(message) {
    messages.push(message);
    if (transportMode === "timeout") throw new Error("synthetic timeout");
    return transportMode === "failed" ? "FAILED" : "ACCEPTED";
  } };
  let tail = Promise.resolve();
  const service = createEmailChangeService({
    actor: async () => actorId,
    transport,
    async delivery(id, field, value) {
      if (failDelivery) throw new Error("synthetic storage failure");
      state.requests.find(row => row.id === id)![field] = value;
    },
    async transaction(work) {
      const previous = tail; let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const draft = structuredClone(state);
      const tx: EmailChangeTransaction = {
        async authorize(id) { if (!authorized || id !== actorId) throw new AccountMaintenanceError("FORBIDDEN", 403); },
        async lockAccount(id) { return draft.accounts.find(row => row.id === id) ?? null; },
        async now() { return new Date(clock); },
        async operation(actor, key) { return draft.requests.find(row => row.actorId === actor && row.operationKey === key) ?? null; },
        async findToken(hash) { return draft.requests.find(row => row.tokenHash === hash) ?? null; },
        async latest(id) { return draft.requests.filter(row => row.userId === id).at(-1) ?? null; },
        async countRecent(id, since) { return draft.requests.filter(row => row.userId === id && row.createdAt >= since).length; },
        async assertUnique(id, email) {
          if (draft.accounts.some(row => row.id !== id && row.email === email)) throw new AccountMaintenanceError("DUPLICATE_ACCOUNT", 409);
        },
        async supersede(id) { draft.requests.filter(row => row.userId === id && row.status === "PENDING").forEach(row => { row.status = "SUPERSEDED"; }); },
        async advanceRevision(id) { draft.accounts.find(row => row.id === id)!.revision++; },
        async insert(row) { draft.requests.push(structuredClone(row)); },
        async confirm(row, now) {
          if (failUnique) throw { code: "23505", constraint: "users_email_unique" };
          const account = draft.accounts.find(account => account.id === row.userId)!;
          account.email = row.newEmail; account.revision++; account.version++; account.verifiedAt = now;
          draft.sessions = draft.sessions.filter(id => id !== row.userId);
          draft.resets = draft.resets.filter(id => id !== row.userId);
          const stored = draft.requests.find(item => item.id === row.id)!;
          stored.status = "CONFIRMED"; stored.usedAt = now;
        },
        async audit(row, phase) { if (failAudit) throw new Error("synthetic audit failure"); draft.audit.push(`${row.id}:${phase}`); },
      };
      try { const result = await work(tx); state = draft; return result; } finally { release(); }
    },
  });
  const input = (id = userId, email = "new@example.test") => ({ email, operationKey: randomUUID(),
    expectedRevision: state.accounts.find(row => row.id === id)!.revision, reason: "Cambio sintético autorizado", confirmed: true });
  const token = () => {
    const msg = messages.filter(message => message.kind === "EMAIL_CHANGE_CONFIRMATION").at(-1)!;
    if (msg.kind !== "EMAIL_CHANGE_CONFIRMATION") throw new Error("Missing synthetic confirmation");
    return msg.token;
  };
  return { service, messages, input, token, state: () => state,
    advance: (ms: number) => { clock = new Date(clock.getTime() + ms); },
    deny: () => { authorized = false; }, failAudit: () => { failAudit = true; },
    failDelivery: () => { failDelivery = true; }, uniqueRace: () => { failUnique = true; } };
}
const rejects = (work: Promise<unknown>, code: string) => assert.rejects(work,
  error => error instanceof AccountMaintenanceError && error.code === code);

test("solicitud conserva login anterior, normaliza y solo almacena hash; DTO y avisos sin secretos", async () => {
  const h = harness(); const before = structuredClone(h.state().accounts[0]);
  const response = await h.service.request(userId, h.input(userId, " NEW@EXAMPLE.TEST "));
  assert.equal(response.status, "PENDING"); assert.equal(response.confirmationDelivery, "ACCEPTED");
  const row = h.state().requests[0];
  assert.equal(row.newEmail, "new@example.test");
  assert.ok(row.tokenHash === hashEmailToken(h.token())); assert.ok(!JSON.stringify(row).includes(h.token()));
  assert.ok(!JSON.stringify(response).includes(h.token())); assert.ok(!("token" in response));
  assert.equal(h.state().accounts[0].email, before.email); assert.equal(h.state().accounts[0].version, before.version);
  assert.equal(h.state().sessions.length, 2); assert.equal(h.state().resets.length, 2);
  assert.equal(matchesLoginIdentifier(before.email, { username: "synthetic", email: h.state().accounts[0].email }), true);
  assert.equal(matchesLoginIdentifier(row.newEmail, { username: "synthetic", email: h.state().accounts[0].email }), false);
  assert.equal(h.messages[0].to, row.newEmail); assert.equal(h.messages[1].to, before.email);
  assert.ok(!("token" in h.messages[1]));
});
test("confirmación actualiza propiedad, revisión, versión, sesiones, resets y aviso; token no reutilizable", async () => {
  const h = harness(); await h.service.request(userId, h.input());
  const response = await h.service.confirm({ token: h.token() });
  assert.equal(response.revision, 2); assert.equal(response.sessionsRevoked, true);
  const account = h.state().accounts[0]; assert.equal(account.email, "new@example.test"); assert.equal(account.version, 2);
  assert.ok(account.verifiedAt); assert.ok(!h.state().sessions.includes(userId)); assert.ok(!h.state().resets.includes(userId));
  assert.equal(h.state().audit.length, 2); assert.equal(h.messages.at(-1)?.to, "old0@example.test");
  assert.ok(!("token" in h.messages.at(-1)!));
  await rejects(h.service.confirm({ token: h.token() }), "EMAIL_CHANGE_INVALID");
});
test("sin proveedor no se declara envío, no hay fallback ni secreto en respuestas o consulta", async () => {
  assert.equal(getEmailTransport(), null);
  const h = harness("absent"), input = h.input();
  const response = await h.service.request(userId, input);
  assert.equal(response.confirmationDelivery, "NOT_CONFIGURED"); assert.equal(response.previousNoticeDelivery, "NOT_CONFIGURED");
  assert.equal(h.messages.length, 0); assert.ok(!("tokenHash" in response));
  assert.deepEqual(await h.service.status(userId, input.operationKey), response);
  assert.equal(h.state().accounts[0].email, "old0@example.test");
});
test("fallo/timeout de transporte conserva pendiente; reintento de misma operación no reenvía", async () => {
  for (const mode of ["failed", "timeout"] as const) {
    const h = harness(mode), input = h.input();
    const response = await h.service.request(userId, input);
    assert.equal(response.confirmationDelivery, mode === "failed" ? "FAILED" : "UNKNOWN");
    assert.equal(response.status, "PENDING");
    assert.deepEqual(await h.service.request(userId, input), response); assert.equal(h.messages.length, 2);
    await rejects(h.service.request(userId, { ...input, email: "different@example.test" }), "EMAIL_OPERATION_CONFLICT");
  }
});
test("si falla guardar acuse no se declara éxito ni se reenvía automáticamente", async () => {
  const h = harness(), input = h.input(); h.failDelivery();
  const response = await h.service.request(userId, input); assert.equal(response.confirmationDelivery, "UNKNOWN");
  assert.equal((await h.service.status(userId, input.operationKey)).confirmationDelivery, "PENDING");
  await h.service.request(userId, input); assert.equal(h.messages.length, 2);
});
test("autorización en solicitud/consulta y revalidación de autoridad antes de confirmar", async () => {
  const h = harness(), input = h.input(); await h.service.request(userId, input); const before = structuredClone(h.state()); h.deny();
  await rejects(h.service.request(userId, h.input()), "FORBIDDEN");
  await rejects(h.service.status(userId, input.operationKey), "FORBIDDEN");
  await rejects(h.service.confirm({ token: h.token() }), "FORBIDDEN");
  assert.deepEqual(h.state(), before);
});
test("vencimiento en el límite y propósito/formato incorrectos rechazan sin cambios", async () => {
  const h = harness(); await h.service.request(userId, h.input()); h.advance(30 * 60_000);
  const before = structuredClone(h.state());
  for (const token of [h.token(), h.token().slice(4), `reset_${h.token().slice(4)}`, `ec1_${"a".repeat(43)}`])
    await rejects(h.service.confirm({ token }), "EMAIL_CHANGE_INVALID");
  assert.deepEqual(h.state(), before);
});
test("nueva solicitud invalida token anterior y conserva solo una pendiente", async () => {
  const h = harness(); await h.service.request(userId, h.input()); const old = h.token();
  h.advance(60_000); await h.service.request(userId, h.input(userId, "replacement@example.test"));
  assert.equal(h.state().requests.filter(row => row.status === "PENDING").length, 1);
  await rejects(h.service.confirm({ token: old }), "EMAIL_CHANGE_INVALID");
  await h.service.confirm({ token: h.token() }); assert.equal(h.state().accounts[0].email, "replacement@example.test");
});
test("solicitudes concurrentes con revisión compartida: solo una confirma su intención", async () => {
  const h = harness(); const input = h.input();
  const results = await Promise.allSettled([h.service.request(userId, input), h.service.request(userId, { ...input, operationKey: randomUUID() })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(h.state().requests.length, 1);
});
test("confirmaciones concurrentes del mismo token tienen un único ganador", async () => {
  const h = harness(); await h.service.request(userId, h.input());
  const results = await Promise.allSettled([h.service.confirm({ token: h.token() }), h.service.confirm({ token: h.token() })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(h.state().audit.length, 2);
  assert.equal(h.state().accounts[0].revision, 2);
});
test("dos solicitudes de distinto usuario por destino libre: una confirmación gana", async () => {
  const h = harness(); await h.service.request(userId, h.input()); const first = h.token();
  await h.service.request(otherId, h.input(otherId)); const second = h.token();
  const results = await Promise.allSettled([h.service.confirm({ token: first }), h.service.confirm({ token: second })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const failure = results.find(r => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(failure.reason.code, "DUPLICATE_ACCOUNT");
  assert.equal(h.state().accounts.filter(row => row.email === "new@example.test").length, 1);
});
test("duplicado conocido y carrera de índice único no alteran cuenta/token/sesiones", async () => {
  const h = harness(); await rejects(h.service.request(userId, h.input(userId, "old1@example.test")), "DUPLICATE_ACCOUNT");
  assert.equal(h.state().requests.length, 0);
  await h.service.request(userId, h.input()); h.uniqueRace(); const before = structuredClone(h.state());
  await rejects(h.service.confirm({ token: h.token() }), "DUPLICATE_ACCOUNT"); assert.deepEqual(h.state(), before);
});
test("cambio de revisión, versión, correo, actividad o bloqueo invalidan la confirmación", async () => {
  for (const field of ["revision", "version", "email", "active", "blocked"] as const) {
    const h = harness(); await h.service.request(userId, h.input());
    const account = h.state().accounts[0];
    if (field === "revision" || field === "version") account[field]++;
    else if (field === "email") account.email = "changed@example.test";
    else if (field === "active") account.active = false;
    else account.blocked = true;
    await rejects(h.service.confirm({ token: h.token() }), "EMAIL_CHANGE_INVALID");
  }
});
test("rollback de solicitud/auditoría y confirmación no deja efectos parciales ni envía después del fallo", async () => {
  const failed = harness(), empty = structuredClone(failed.state()); failed.failAudit();
  await assert.rejects(failed.service.request(userId, failed.input())); assert.deepEqual(failed.state(), empty); assert.equal(failed.messages.length, 0);
  const h = harness(); await h.service.request(userId, h.input()); const before = structuredClone(h.state()); h.failAudit();
  await assert.rejects(h.service.confirm({ token: h.token() })); assert.deepEqual(h.state(), before); assert.equal(h.messages.length, 2);
});
test("límites de frecuencia, validación estricta y consulta de otra cuenta", async () => {
  const h = harness(), input = h.input();
  await rejects(h.service.request(userId, { ...input, actorId }), "VALIDATION_ERROR");
  await rejects(h.service.request(userId, { ...input, expectedRevision: 2147483646 }), "VALIDATION_ERROR");
  await h.service.request(userId, input);
  await rejects(h.service.status(otherId, input.operationKey), "EMAIL_CHANGE_NOT_FOUND");
  await rejects(h.service.request(userId, h.input()), "EMAIL_CHANGE_RATE_LIMITED");
  for (let i = 0; i < 4; i++) { h.advance(60_000); await h.service.request(userId, h.input(userId, `new${i}@example.test`)); }
  h.advance(60_000); await rejects(h.service.request(userId, h.input()), "EMAIL_CHANGE_RATE_LIMITED");
});
