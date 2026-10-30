import assert from "node:assert/strict";
import test from "node:test";
import { getLoginFeedback, loginLockoutCode } from "./login-feedback";

test("el bloqueo muestra la política real y el tiempo restante redondeado", () => {
  const feedback = getLoginFeedback(loginLockoutCode(5, 15 * 60_000));
  assert.equal(feedback.title, "Acceso bloqueado temporalmente");
  assert.match(feedback.description, /5 intentos fallidos/);
  assert.match(feedback.description, /15 minutos/);
  assert.match(feedback.description, /no prolongan/);
  assert.match(getLoginFeedback(loginLockoutCode(3, 61_000)).description, /3 intentos fallidos.*2 minutos/);
  assert.match(getLoginFeedback(loginLockoutCode(1, 500)).description, /1 intento fallido.*1 minuto/);
});

test("solo acepta códigos de bloqueo controlados y conserva errores genéricos", () => {
  assert.equal(getLoginFeedback("CredentialsSignin").title, "Datos de acceso incorrectos");
  for (const code of [undefined, "Error interno privado", "LOGIN_LOCKED_0_15", "LOGIN_LOCKED_21_15", "LOGIN_LOCKED_5_1441", "LOGIN_LOCKED_5_15_extra"])
    assert.equal(getLoginFeedback(code).title, "No pudimos conectar con el servicio");
});
