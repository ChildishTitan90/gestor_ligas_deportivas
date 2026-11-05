import assert from "node:assert/strict";
import { test } from "node:test";
import { accountListSchema, accountStatusSchema, assertAdministratorReplacement,
  assertMaintenanceTransition, AccountMaintenanceError } from "./maintenance-contract";
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
