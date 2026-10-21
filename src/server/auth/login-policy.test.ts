import assert from "node:assert/strict";
import test from "node:test";
import { getLoginPolicy } from "./login-policy";

test("política de login: valores ausentes usan cinco intentos y quince minutos", () => {
  assert.deepEqual(getLoginPolicy({}), { maxFailedAttempts: 5, lockoutMs: 900_000 });
});

test("política de login: admite configuración y sus límites seguros", () => {
  for (const [attempts, minutes] of [[1, 1], [3, 2], [20, 1440]]) {
    assert.deepEqual(getLoginPolicy({ AUTH_MAX_FAILED_ATTEMPTS: String(attempts), AUTH_LOCKOUT_MINUTES: String(minutes) }),
      { maxFailedAttempts: attempts, lockoutMs: minutes * 60_000 });
  }
});

test("política de login: valores inválidos fallan sin adoptar defaults ni revelar el valor", () => {
  for (const [key, maximum] of [["AUTH_MAX_FAILED_ATTEMPTS", 20], ["AUTH_LOCKOUT_MINUTES", 1440]] as const) {
    for (const value of ["", " ", "0", "-1", "1.5", "1e1", "0x10", "+1", " 5 ", "Infinity", "NaN",
      "configuracion-no-publica", String(maximum + 1), "9007199254740992"]) {
      assert.throws(() => getLoginPolicy({ [key]: value }),
        { message: `${key} debe ser un entero entre 1 y ${maximum}.` });
    }
  }
});
