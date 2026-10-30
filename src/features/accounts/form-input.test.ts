import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { parseAccountForm } from "./form-input";
import { accountErrorMessage } from "./form-feedback";

function capture() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ username: " Cuenta.Prueba ", email: " SINTETICO@example.test ",
    temporaryPassword: `Tmp-${randomBytes(16).toString("hex")}!aA`, "person.firstName": "Persona", "person.paternalSurname": "Sintética" })) data.set(key, value);
  return data;
}

test("alta global omite la liga y campos residuales de club", () => {
  const data = capture();
  data.set("club.name", "Residuo de otro rol");
  const result = parseAccountForm(data, ["SUPERADMIN"], randomUUID(), "new", "new");
  assert.ok(result.success);
  assert.equal(result.data.username, "cuenta.prueba");
  assert.equal(result.data.email, "sintetico@example.test");
  assert.equal(result.data.leagueId, undefined);
  assert.equal(result.data.club, undefined);
});

test("delegado necesita liga y club y admite registro inicial antes de afiliación", () => {
  const data = capture();
  assert.equal(parseAccountForm(data, ["CLUB_DELEGATE"], "", "new", "existing").success, false);
  const club = randomUUID();
  data.set("delegatePosition", "PRIMARY");
  data.set("club.id", club);
  const existing = parseAccountForm(data, ["CLUB_DELEGATE"], randomUUID(), "new", "existing");
  assert.ok(existing.success);
  assert.deepEqual(existing.data.club, { kind: "existing", id: club });
  data.set("club.name", "Club sintético");
  assert.equal(parseAccountForm(data, ["CLUB_DELEGATE"], randomUUID(), "new", "new").success, true);
});

test("persona existente envía solo referencia y rechaza UUID inválido", () => {
  const data = capture();
  data.set("person.id", "incorrecto");
  assert.equal(parseAccountForm(data, ["SUPERADMIN"], "", "existing", "existing").success, false);
  const person = randomUUID();
  data.set("person.id", person);
  const result = parseAccountForm(data, ["SUPERADMIN"], "", "existing", "existing");
  assert.ok(result.success);
  assert.deepEqual(result.data.person, { id: person });
});

test("rechaza correo, contraseña, rol excluido y combinación global inválidos", () => {
  const data = capture();
  for (const roles of [["PLAYER"], ["GUEST"], ["SUPERADMIN", "SECRETARY"], ["SECRETARY", "SECRETARY"]]) {
    assert.equal(parseAccountForm(data, roles, randomUUID(), "new", "existing").success, false);
  }
  data.set("email", "sin-correo");
  data.set("temporaryPassword", "debil");
  const result = parseAccountForm(data, ["SUPERADMIN"], "", "new", "existing");
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.error.issues.some((issue) => issue.path[0] === "email"));
});

test("duplicados no identifican persona ni campo ocupado; fallos inciertos evitan reenvío ciego", () => {
  assert.match(accountErrorMessage("DUPLICATE_ACCOUNT"), /alguno de sus identificadores/);
  assert.doesNotMatch(accountErrorMessage("DUPLICATE_ACCOUNT"), /correo.*registrado|usuario.*registrado/);
  assert.match(accountErrorMessage("SERVICE_UNAVAILABLE"), /antes de volver/);
  assert.match(accountErrorMessage("FORBIDDEN"), /No tienes permiso/);
  assert.match(accountErrorMessage("UNAUTHENTICATED"), /Inicia sesión/);
});

// El mapeo se prueba con errores del contrato real y no altera su resultado.
test("correo y UUID inválidos tienen mensajes en español asociados a sus campos", async () => {
  const { accountValidationErrors } = await import("./form-feedback");
  const data = capture();
  data.set("email", "incorrecto");
  data.set("person.id", "incorrecto");
  const parsed = parseAccountForm(data, ["SUPERADMIN"], "", "existing", "existing");
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.deepEqual(accountValidationErrors(parsed.error.issues), {
    email: "Escribe un correo electrónico válido.",
    "person.id": "Escribe un UUID de persona válido.",
  });
  data.set("email", "synthetic@example.test");
  data.set("person.id", randomUUID());
  assert.equal(parseAccountForm(data, ["SUPERADMIN"], "", "existing", "existing").success, true);
});

test("obligatoriedad, longitudes y formato de usuario se presentan en español", async () => {
  const { accountValidationErrors } = await import("./form-feedback");
  for (const [field, value, message] of [
    ["username", "", "Este campo es obligatorio."],
    ["username", "x".repeat(65), "No superes los 64 caracteres."],
    ["username", "usuario inválido", "Usa letras, números, punto, guion o guion bajo."],
    ["email", "x".repeat(255), "No superes los 254 caracteres."],
    ["person.firstName", "", "Este campo es obligatorio."],
    ["person.paternalSurname", "x".repeat(101), "No superes los 100 caracteres."],
  ]) {
    const data = capture();
    data.set(field, value);
    const parsed = parseAccountForm(data, ["SUPERADMIN"], "", "new", "existing");
    assert.equal(parsed.success, false);
    if (!parsed.success) assert.equal(accountValidationErrors(parsed.error.issues)[field], message);
  }
});

test("cada requisito de contraseña conserva su validación y mensaje específico en español", async () => {
  const { accountValidationErrors } = await import("./form-feedback");
  for (const [value, message] of [
    ["Ab1!", "Escribe al menos 8 caracteres."],
    ["Aa1!".repeat(33), "No superes los 128 caracteres."],
    ["synthetic123!", "Incluye al menos una letra mayúscula."],
    ["SYNTHETIC123!", "Incluye al menos una letra minúscula."],
    ["SyntheticOnly!", "Incluye al menos un número."],
    ["Synthetic123", "Incluye al menos un símbolo."],
  ]) {
    const data = capture();
    data.set("temporaryPassword", value);
    const parsed = parseAccountForm(data, ["SUPERADMIN"], "", "new", "existing");
    assert.equal(parsed.success, false);
    if (!parsed.success) assert.equal(accountValidationErrors(parsed.error.issues).temporaryPassword, message);
  }
});

test("selecciones y reglas de ámbito muestran errores en español en el grupo correcto", async () => {
  const { accountValidationErrors } = await import("./form-feedback");
  for (const [roles, league, field, message] of [
    [[], randomUUID(), "roles", "Selecciona al menos un rol."],
    [["GUEST"], randomUUID(), "roles", "Selecciona una opción válida."],
    [["SECRETARY"], "incorrecto", "leagueId", "Selecciona una opción válida."],
    [["SECRETARY"], "", "leagueId", "Selecciona una liga."],
    [["SECRETARY", "SECRETARY"], randomUUID(), "roles", "No repitas roles. SUPERADMIN debe asignarse de forma global y exclusiva."],
  ] as const) {
    const parsed = parseAccountForm(capture(), [...roles], league, "new", "existing");
    assert.equal(parsed.success, false);
    if (!parsed.success) assert.equal(accountValidationErrors(parsed.error.issues)[field], message);
  }
  const parsed = parseAccountForm(capture(), ["CLUB_DELEGATE"], randomUUID(), "new", "existing");
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.equal(accountValidationErrors(parsed.error.issues)["club.id"], "Selecciona una opción válida.");
});

test("la traducción no depende del texto inglés ni incluye valores sensibles", async () => {
  const { accountValidationMessage } = await import("./form-feedback");
  assert.equal(accountValidationMessage({ code: "invalid_format", format: "email", path: ["email"], message: "Mensaje arbitrario" }), "Escribe un correo electrónico válido.");
  assert.equal(accountValidationMessage({ code: "invalid_union", errors: [], path: ["person"], message: "Invalid input" }), "Revisa los datos de la persona o la selección indicada.");
});
