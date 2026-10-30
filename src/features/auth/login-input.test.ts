import assert from "node:assert/strict";
import test from "node:test";
import { emailSchema, loginSchema } from "./schemas";

test("login acepta usuario o correo, normaliza el identificador y conserva la contraseña", () => {
  for (const [input, expected] of [["  DEMO-Admin  ", "demo-admin"], [" User_1.Test ", "user_1.test"], ["  Persona@Example.Test ", "persona@example.test"]]) {
    assert.deepEqual(loginSchema.parse({ email: input, password: "  contraseña literal  " }), { email: expected, password: "  contraseña literal  " });
  }
});
test("el acceso rechaza identificadores inválidos y el alta sigue exigiendo correo", () => {
  for (const email of ["", " ", "a b", "a@", "a%", "a".repeat(65)])
    assert.equal(loginSchema.safeParse({ email, password: "clave" }).success, false);
  assert.equal(emailSchema.safeParse("demo-admin").success, false);
  assert.equal(emailSchema.safeParse("persona@example.test").success, true);
});
