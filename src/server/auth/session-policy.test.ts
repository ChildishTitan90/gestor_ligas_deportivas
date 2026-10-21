import assert from "node:assert/strict";
import test from "node:test";
import {
  getIdleTimeoutMs,
  isSessionExpired,
} from "./idle-policy";

const start = new Date("2026-10-16T12:00:00.000Z");
const timeout = getIdleTimeoutMs("30");

function makeSession() {
  return {
    last_activity_at: start,
    expires_at: new Date(start.getTime() + timeout),
    revoked_at: null as Date | null,
  };
}

test("permite acceso justo antes del límite de inactividad", () => {
  const now = new Date(start.getTime() + timeout - 1);

  assert.equal(isSessionExpired(makeSession(), now, timeout), false);
});

test("rechaza acceso exactamente al cumplir 30 minutos", () => {
  const now = new Date(start.getTime() + timeout);

  assert.equal(isSessionExpired(makeSession(), now, timeout), true);
});

test("una expiración posterior no elimina el límite de inactividad", () => {
  const session = makeSession();

  session.expires_at = new Date(start.getTime() + 2 * timeout);

  const now = new Date(start.getTime() + timeout);

  assert.equal(isSessionExpired(session, now, timeout), true);
});

test("rechaza una sesión revocada aunque todavía no venza", () => {
  const session = makeSession();

  session.revoked_at = new Date(start.getTime() + 1000);

  const now = new Date(start.getTime() + 2000);

  assert.equal(isSessionExpired(session, now, timeout), true);
});

test("admite configuración y rechaza valores inválidos", () => {
  assert.equal(getIdleTimeoutMs("5"), 300_000);
  assert.equal(getIdleTimeoutMs("30"), 1_800_000);

  assert.equal(getIdleTimeoutMs("1440"), 86_400_000);
  for (const value of ["0", "-1", "abc", "1.5", "", "1441", "Infinity"]) {
    assert.throws(() => getIdleTimeoutMs(value));
  }
});

test("rechaza actividad futura y fechas inválidas", () => {
  assert.equal(isSessionExpired(makeSession(), new Date(start.getTime() - 1), timeout), true);
  assert.equal(isSessionExpired(makeSession(), new Date("invalid"), timeout), true);
  assert.equal(isSessionExpired({ ...makeSession(), expires_at: new Date("invalid") }, start, timeout), true);
});
