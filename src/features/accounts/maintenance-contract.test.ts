import assert from "node:assert/strict";
import { test } from "node:test";
import { accountListSchema, accountStatusSchema, assertAdministratorReplacement,
  assertMaintenanceTransition, AccountMaintenanceError, accountIdentifiersSchema,
  accountIdentifierChanges, isAccountIdentifierConflict } from "./maintenance-contract";
import { matchesLoginIdentifier } from "../auth/login-identifier";
const available = { active: true, currentAssignment: true, globalRead: true, globalUpdate: true,
  temporarilyBlocked: false, mustChangePassword: false };
function code(work: () => void, expected: string) {
  assert.throws(work, error => error instanceof AccountMaintenanceError && error.code === expected && error.status === 409);
}
test("paginación acotada, búsqueda literal y rechazo de parámetros ajenos", () => {
  assert.deepEqual(accountListSchema.parse({}), { page: 1, pageSize: 20, search: "" });
  assert.equal(accountListSchema.parse({ search: " %_ " }).search, "%_");
  for (const value of [{page:0}, {page:1.5}, {pageSize:51}, {pageSize:0}, {search:"a".repeat(101)}, {leagueId:"inventado"}])
    assert.equal(accountListSchema.safeParse(value).success, false);
});
test("estado requiere motivo, revisión y confirmación explícitos sin campos privilegiados", () => {
  const input = { isActive:false, expectedRevision:0, reason:"Motivo administrativo", confirmed:true };
  assert.equal(accountStatusSchema.safeParse(input).success, true);
  for (const invalid of [{...input,confirmed:false}, {...input,reason:" "}, {...input,expectedRevision:-1},
    {...input,isActive:"false"}, {...input,version:3}, {...input,roles:[]}, {...input,delegatePosition:"PRIMARY"}])
    assert.equal(accountStatusSchema.safeParse(invalid).success, false);
});
test("revisión obsoleta y estado repetido no escriben", () => {
  code(() => assertMaintenanceTransition({isActive:true,revision:2}, {isActive:false,expectedRevision:1}), "ACCOUNT_CHANGED");
  code(() => assertMaintenanceTransition({isActive:true,revision:2}, {isActive:true,expectedRevision:2}), "ACCOUNT_STATE_UNCHANGED");
  assertMaintenanceTransition({isActive:true,revision:2}, {isActive:false,expectedRevision:2});
});
test("cuenta activa, asignación vigente y permiso efectivo son condiciones distintas", () => {
  for (const candidates of [[], [{...available,active:false}], [{...available,currentAssignment:false}]])
    code(() => assertAdministratorReplacement(candidates), "LAST_ACTIVE_SUPERADMIN");
  for (const override of [{globalRead:false}, {globalUpdate:false}])
    code(() => assertAdministratorReplacement([{...available,...override}]), "LAST_EFFECTIVE_SUPERADMIN");
  assertAdministratorReplacement([available]);
});
test("bloqueo temporal y cambio obligatorio requieren decisión cuando no queda otra alternativa", () => {
  for (const override of [{temporarilyBlocked:true}, {mustChangePassword:true}]) {
    code(() => assertAdministratorReplacement([{...available,...override}]), "SUPERADMIN_AVAILABILITY_DECISION_REQUIRED");
    assertAdministratorReplacement([{...available,...override}, available]);
  }
});

test("edición normaliza los identificadores con los contratos del acceso", () => {
  const parsed = accountIdentifiersSchema.parse({ changes: { username: "  UsEr_1.-  ", email: "  User@Example.Test " },
    expectedRevision: 3, confirmed: true, reason: "Corrección administrativa" });
  assert.deepEqual(parsed.changes, { username: "user_1.-", email: "user@example.test" });
  assert.deepEqual(accountIdentifierChanges({ username: "anterior", email: "antes@example.test", revision: 3 }, parsed),
    { username: "user_1.-", email: "user@example.test", changedFields: ["username", "email"] });
});
test("el PATCH de identificadores no acepta campos de persona, seguridad ni captura vacía", () => {
  const input = { changes: { username: "cuenta" }, expectedRevision: 0, confirmed: true, reason: "Corrección administrativa" };
  for (const changes of [{}, { username: " " }, { username: "ñ" }, { username: "a@b.test" }, { username: "a".repeat(65) },
    { email: "incorrecto" }, { email: "" }, { firstName: "Nuevo" }, { birthDate: "2000-01-01" }, { curp: "dato" },
    { username: "cuenta", personId: "ajeno" }, { password: "secreto" }, { isActive: true }, { roles: [] }])
    assert.equal(accountIdentifiersSchema.safeParse({ ...input, changes }).success, false);
  for (const patch of [{confirmed:false}, {expectedRevision:-1}, {reason:" "}, {personId:"ajeno"}])
    assert.equal(accountIdentifiersSchema.safeParse({ ...input, ...patch }).success, false);
});
test("revisión y ausencia de cambio efectivo protegen edición y sesiones", () => {
  const input = accountIdentifiersSchema.parse({ changes: { username: " CUENTA " }, expectedRevision: 2,
    confirmed: true, reason: "Corrección administrativa" });
  const current = { username: "cuenta", email: "cuenta@example.test", revision: 2 };
  code(() => accountIdentifierChanges(current, input), "ACCOUNT_IDENTIFIERS_UNCHANGED");
  code(() => accountIdentifierChanges(current, { ...input, expectedRevision: 1 }), "ACCOUNT_CHANGED");
  assert.deepEqual(accountIdentifierChanges(current, { ...input, changes: { email: "otra@example.test" } }).changedFields, ["email"]);
});
test("unicidad concurrente traduce solo índices de identificadores con SQLSTATE correcto", () => {
  for (const constraint of ["users_username_unique", "users_email_unique"]) {
    assert.equal(isAccountIdentifierConflict({ code: "23505", constraint }), true);
    assert.equal(isAccountIdentifierConflict({ code: "P2010", meta: { code: "23505", message: `duplicate key violates unique constraint "${constraint}"` } }), true);
    assert.equal(isAccountIdentifierConflict({ meta: { driverAdapterError: { cause: { originalCode: "23505", originalMessage: `constraint "${constraint}"` } } } }), true);
    assert.equal(isAccountIdentifierConflict({ code: "40001", constraint }), false);
  }
  assert.equal(isAccountIdentifierConflict({ code: "23505", constraint: "audit_logs_pkey" }), false);
  const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
  assert.equal(isAccountIdentifierConflict(cycle), false);
});
test("un login esperando el bloqueo revalida el identificador vigente", () => {
  const user = { username: "nuevo_usuario", email: "nuevo@example.test" };
  assert.equal(matchesLoginIdentifier("anterior_usuario", user), false);
  assert.equal(matchesLoginIdentifier("anterior@example.test", user), false);
  assert.equal(matchesLoginIdentifier("NUEVO_USUARIO", user), true);
  assert.equal(matchesLoginIdentifier("NUEVO@EXAMPLE.TEST", user), true);
  assert.equal(matchesLoginIdentifier("legacy@example.test", { ...user, username: "legacy@example.test" }), true);
});
