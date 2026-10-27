import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createEnrollmentRecovery } from "./team-enrollment-recovery.client";
import { enrollmentCreationAllowed, type TeamEnrollmentInput } from "./team-enrollment";

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
const actorId = randomUUID();
const input = (): TeamEnrollmentInput => ({ enrollmentKey: randomUUID(), clubId: randomUUID(), seasonId: randomUUID(),
  categoryId: randomUUID(), groupId: randomUUID(), team: { mode: "new", name: " Equipo sintético " } });
const result = (body: TeamEnrollmentInput) => ({ id: randomUUID(), teamId: randomUUID(), clubId: body.clubId,
  seasonId: body.seasonId, categoryId: body.categoryId, groupId: body.groupId, status: "REGISTERED", replayed: true });
function fetcher(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (url, init = {}) => handler(String(url), init)) as typeof fetch;
}

test("cada operación conserva la identidad del dueño tras cambiar la cuenta activa y mantiene el pendiente", async () => {
  for (const action of ["retry", "check", "cancel"] as const) {
    const storage = new MemoryStorage();
    const body = input();
    let sessionActor = randomUUID();
    const owner = createEnrollmentRecovery(actorId.toUpperCase(), storage, fetcher((_url, init) => {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("x-expected-actor-id"), actorId);
      assert.equal(init.credentials, "same-origin");
      assert.equal(init.cache, "no-store");
      assert.equal(init.method, action === "check" ? "GET" : "POST");
      assert.equal(headers.get("content-type"), action === "check" ? null : "application/json");
      if (sessionActor !== actorId) return Response.json({ code: "FORBIDDEN" }, { status: 403 });
      return action === "retry" ? Response.json({ ...result(body), replayed: false }, { status: 201 })
        : Response.json({ enrollmentKey: body.enrollmentKey, clubId: body.clubId, outcome: "CANCELLED", enrollment: null });
    }));
    owner.remember(body);
    const saved = storage.getItem(storage.key(0)!);
    assert.deepEqual(await owner[action](body), { outcome: "UNRESOLVED", code: "FORBIDDEN" });
    assert.equal(storage.getItem(storage.key(0)!), saved);
    assert.equal(createEnrollmentRecovery(sessionActor, storage).pending(body.clubId).length, 0);
    sessionActor = actorId;
    assert.equal((await owner[action](body)).outcome, action === "retry" ? "CONFIRMED" : "CANCELLED");
    assert.equal(storage.length, 0);
  }
});

test("capacidad solo habilita el club seleccionado ante autorización explícita vigente", () => {
  const clubId = randomUUID();
  const allowed = { capabilities: { clubId, canEnroll: true, canCreateTeam: true } };
  assert.equal(enrollmentCreationAllowed(allowed, clubId), true);
  for (const options of [null, {}, { canCreateTeam: true }, { capabilities: { clubId, canCreateTeam: true } },
    { capabilities: { clubId, canEnroll: false, canCreateTeam: true } },
    { capabilities: { clubId, canEnroll: true, canCreateTeam: false } }, allowed]) {
    assert.equal(enrollmentCreationAllowed(options, options === allowed ? randomUUID() : clubId), false);
  }
});

test("respuesta perdida conserva intención normalizada y un GET después de recargar la recupera", async () => {
  const storage = new MemoryStorage();
  const body = input();
  let sent: string | undefined;
  const original = createEnrollmentRecovery(actorId, storage, fetcher(async (url, init) => {
    assert.equal(url, "/api/team-enrollments");
    assert.equal(init.method, "POST");
    sent = String(init.body);
    throw new TypeError("Respuesta perdida después de confirmar");
  }));
  assert.equal((await original.retry(body)).outcome, "UNRESOLVED");
  const saved = original.pending(body.clubId)[0];
  assert.equal(saved.team.mode === "new" && saved.team.name, "Equipo sintético");
  assert.equal(saved.enrollmentKey, body.enrollmentKey);
  original.abandon(saved);
  assert.equal(storage.length, 1);
  const receipt = result(saved);
  const reloaded = createEnrollmentRecovery(actorId, storage, fetcher((url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.ok(url.endsWith(`?clubId=${body.clubId}`));
    return Response.json({ enrollmentKey: saved.enrollmentKey, clubId: body.clubId, outcome: "CONFIRMED", enrollment: receipt });
  }));
  assert.deepEqual(JSON.parse(sent!), saved);
  assert.equal((await reloaded.check(saved)).outcome, "CONFIRMED");
  assert.equal(storage.length, 0);
});

test("los reintentos explícitos conservan cuerpo y clave; una edición no sobrescribe el pendiente", async () => {
  const storage = new MemoryStorage();
  const body = input();
  const calls: string[] = [];
  const recovery = createEnrollmentRecovery(actorId, storage, fetcher((_url, init) => {
    calls.push(String(init.body));
    return Response.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503 });
  }));
  await recovery.retry(body);
  await recovery.retry({ ...body, clubId: body.clubId.toUpperCase() });
  assert.equal(calls[0], calls[1]);
  await assert.rejects(recovery.retry({ ...body, groupId: randomUUID() }), /otro contenido/);
  assert.equal(calls.length, 2);
  assert.equal(recovery.pending(body.clubId).length, 1);
});

test("ausencia, 404, 503, 401/403, conflicto y errores de red mantienen el bloqueo recuperable", async () => {
  for (const status of [200, 401, 403, 404, 409, 503]) {
    const storage = new MemoryStorage();
    const body = input();
    const recovery = createEnrollmentRecovery(actorId, storage, fetcher(() => status === 200
      ? Response.json({ enrollmentKey: body.enrollmentKey, clubId: body.clubId, outcome: "UNRESOLVED", enrollment: null })
      : Response.json({ code: "UNCONFIRMED" }, { status })));
    assert.equal((await recovery.check(body)).outcome, "UNRESOLVED");
    assert.equal(storage.length, 1);
  }
});

test("cancelar requiere acuse definitivo; descartar la captura no borra el pendiente", async () => {
  const storage = new MemoryStorage();
  const body = input();
  let cancelConfirmed = false;
  let count = 0;
  const recovery = createEnrollmentRecovery(actorId, storage, fetcher((url, init) => {
    count++;
    assert.ok(url.endsWith("/cancel"));
    assert.equal(init.method, "POST");
    assert.equal(JSON.parse(String(init.body)).enrollmentKey, body.enrollmentKey);
    return cancelConfirmed ? Response.json({ enrollmentKey: body.enrollmentKey, clubId: body.clubId, outcome: "CANCELLED", enrollment: null })
      : Response.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503 });
  }));
  recovery.abandon(body);
  assert.equal(count, 0);
  assert.equal((await recovery.cancel(body)).outcome, "UNRESOLVED");
  assert.equal(storage.length, 1);
  cancelConfirmed = true;
  assert.equal((await recovery.cancel(body)).outcome, "CANCELLED");
  assert.equal(storage.length, 0);
});

test("si la inscripción ganó la carrera, cancelar informa CONFIRMED sin eliminarla", async () => {
  const body = input();
  const storage = new MemoryStorage();
  const receipt = result(body);
  const recovery = createEnrollmentRecovery(actorId, storage, fetcher(() => Response.json({ enrollmentKey: body.enrollmentKey,
    clubId: body.clubId, outcome: "CONFIRMED", enrollment: receipt })));
  const outcome = await recovery.cancel(body);
  assert.equal(outcome.outcome, "CONFIRMED");
  assert.equal(outcome.enrollment?.id, receipt.id);
  assert.equal(storage.length, 0);
});

test("un acuse incompleto o de otra intención no desbloquea la captura", async () => {
  const body = input();
  for (const response of [{}, { enrollmentKey: randomUUID(), clubId: body.clubId, outcome: "CANCELLED", enrollment: null },
    { enrollmentKey: body.enrollmentKey, clubId: randomUUID(), outcome: "CANCELLED", enrollment: null },
    { enrollmentKey: body.enrollmentKey, clubId: body.clubId, outcome: "CONFIRMED", enrollment: { ...result(body), groupId: randomUUID() } },
    { enrollmentKey: body.enrollmentKey, clubId: body.clubId, outcome: "CONFIRMED", enrollment: null }]) {
    const storage = new MemoryStorage();
    const recovery = createEnrollmentRecovery(actorId, storage, fetcher(() => Response.json(response)));
    assert.equal((await recovery.check(body)).outcome, "UNRESOLVED");
    assert.equal(storage.length, 1);
  }
});

test("pendientes separados por usuario, club y clave, sin contraseñas ni tokens", () => {
  const storage = new MemoryStorage();
  const body = input();
  const own = createEnrollmentRecovery(actorId, storage);
  own.remember(body);
  own.remember({ ...body, enrollmentKey: randomUUID() });
  assert.equal(own.pending(body.clubId).length, 2);
  assert.equal(own.load(body.clubId, body.enrollmentKey)?.enrollmentKey, body.enrollmentKey);
  assert.equal(own.load(randomUUID(), body.enrollmentKey), null);
  assert.equal(own.pending(randomUUID()).length, 0);
  assert.equal(createEnrollmentRecovery(randomUUID(), storage).pending(body.clubId).length, 0);
  const serialized = JSON.stringify([...storage.values]);
  for (const forbidden of ["password", "token", "session", "email"]) assert.equal(serialized.includes(forbidden), false);
  assert.throws(() => own.remember({ ...body, password: "never-store" }));
});

test("un acuse de POST con estado, replay o HTTP incoherente mantiene el pendiente", async () => {
  const body = input();
  for (const [http, replayed, status] of [[200, false, "REGISTERED"], [201, true, "REGISTERED"],
    [201, false, "ACTIVE"], [202, true, "REGISTERED"]] as const) {
    const storage = new MemoryStorage();
    const recovery = createEnrollmentRecovery(actorId, storage, fetcher(() => Response.json({ ...result(body), replayed, status }, { status: http })));
    assert.equal((await recovery.retry(body)).outcome, "UNRESOLVED");
    assert.equal(storage.length, 1);
  }
});

test("no envía si no puede guardar el pendiente y conserva recibo definitivo si falla la limpieza local", async () => {
  const body = input();
  const storage = new MemoryStorage();
  let calls = 0;
  storage.setItem = () => { throw new Error("Cuota local"); };
  const blocked = createEnrollmentRecovery(actorId, storage, fetcher(() => { calls++; return Response.json({}); }));
  await assert.rejects(blocked.retry(body), /Cuota local/);
  assert.equal(calls, 0);
  const second = new MemoryStorage();
  second.removeItem = () => { throw new Error("No disponible"); };
  const recovery = createEnrollmentRecovery(actorId, second, fetcher(() => Response.json(result(body))));
  const outcome = await recovery.retry(body);
  assert.equal(outcome.outcome, "CONFIRMED");
  assert.equal("pendingCleanup" in outcome && outcome.pendingCleanup, true);
});
