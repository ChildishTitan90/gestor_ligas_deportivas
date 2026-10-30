import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createAccountSchema } from "./schemas";
import { accountDatabaseError } from "./account-errors";

const input = () => ({ username: "fixture", email: "fixture@example.test", temporaryPassword: "Explicit-Contract-48!",
  person: { firstName: "Persona", paternalSurname: "Sintética" }, roles: ["CLUB_DELEGATE"],
  leagueId: randomUUID(), club: { kind: "existing", id: randomUUID() } });

test("delegado exige selección explícita; no infiere cargo por club o perfil", () => {
  const body = input();
  for (const delegatePosition of [undefined, null, "", "TITULAR", "primary"])
    assert.equal(createAccountSchema.safeParse({ ...body, delegatePosition }).success, false);
  for (const delegatePosition of ["PRIMARY", "DEPUTY"]) {
    const parsed = createAccountSchema.parse({ ...body, delegatePosition });
    assert.equal(parsed.delegatePosition, delegatePosition);
    assert.deepEqual(parsed.roles, ["CLUB_DELEGATE"]);
  }
});

test("el cargo no se admite para otros perfiles ni para SUPERADMIN", () => {
  for (const role of ["SECRETARY", "SUPERADMIN"]) {
    const body = { ...input(), roles: [role], club: undefined, leagueId: role === "SUPERADMIN" ? undefined : randomUUID() };
    assert.equal(createAccountSchema.safeParse(body).success, true);
    assert.equal(createAccountSchema.safeParse({ ...body, delegatePosition: "DEPUTY" }).success, false);
  }
});

test("conflictos pg/Prisma conservan su significado sin exponer mensajes SQL", () => {
  for (const [constraint, code] of [
    ["user_roles_delegate_position_overlap", "DELEGATE_POSITION_OCCUPIED"],
    ["user_roles_delegate_account_overlap", "DELEGATE_ACCOUNT_OVERLAP"],
    ["user_roles_delegate_legacy_overlap", "DELEGATE_LEGACY_OVERLAP"],
  ]) {
    const native = accountDatabaseError({ code: "23P01", constraint, detail: "private fixture data" });
    assert.equal(native?.code, code);
    assert.equal(native?.status, 409);
    const adapter = accountDatabaseError({ code: "P2004", meta: { driverAdapterError: { cause: {
      originalCode: "23P01", originalMessage: `conflicting key violates exclusion constraint "${constraint}"`,
    } } } });
    assert.equal(adapter?.code, code);
    const raw = accountDatabaseError({ code: "P2010", meta: { code: "23P01", message: `constraint "${constraint}"` } });
    assert.equal(raw?.code, code);
    assert.equal(raw?.message.includes("private"), false);
  }
  assert.equal(accountDatabaseError({ code: "23P01", constraint: "another_constraint" }), undefined);
  assert.equal(accountDatabaseError({ code: "23505", constraint: "user_roles_delegate_position_overlap" }), undefined);
  assert.equal(accountDatabaseError(new Error("unrelated failure")), undefined);
  const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
  assert.equal(accountDatabaseError(cycle), undefined);
});

test("contratos de cargo inválidos se traducen solo con su SQLSTATE y constraint", () => {
  const error = accountDatabaseError({ code: "23514", constraint: "user_roles_delegate_position_required" });
  assert.equal(error?.code, "DELEGATE_POSITION_REQUIRED");
  assert.equal(error?.status, 400);
});
