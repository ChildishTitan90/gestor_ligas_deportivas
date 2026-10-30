import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { delegateAvailability, accountRoleLabel } from "./delegate-position";
import { createDelegateOptionsLoader, formDelegatePeriod } from "./delegate-options.client";
import { DelegatePositionSelect } from "./components/delegate-position-select";
import { createAccountSchema, delegateOptionsSchema } from "./schemas";
import { parseAccountForm } from "./form-input";
import { accountErrorMessage } from "./form-feedback";

const period = { startsAt: "2035-01-01T12:00:00Z", endsAt: "2035-02-01T12:00:00Z" };
const context = () => ({ leagueId: randomUUID(), club: { kind: "existing", id: randomUUID() }, period });
const options = (positions: (string | null)[] = []) => ({ period, positions: delegateAvailability(positions) });

test("cargos sin selección inicial, cupo agotado y regularización accesibles", () => {
  const scenarios: (string | null)[][] = [[], ["PRIMARY"], ["PRIMARY", "DEPUTY"], [null]];
  for (const rows of scenarios) {
    const html = renderToStaticMarkup(<DelegatePositionSelect id="cargo" value="" onChange={() => {}}
      status="ready" options={options(rows)} className="control" />);
    assert.match(html, /name="delegatePosition"/);
    assert.match(html, /type="hidden"[^>]*name="delegatePosition" value=""/);
    assert.match(html, /role="combobox"/);
    assert.match(html, /placeholder="Selecciona un cargo"/);
    assert.doesNotMatch(html, /<select|<option/);
    assert.match(html, /htmlFor="cargo"|for="cargo"/);
    assert.match(html, /aria-describedby="cargo-status"/);
    if (rows.includes(null)) assert.match(html, /Se necesita regularización/);
    if (rows.length === 2) assert.match(html, /No hay cargos disponibles/);
  }
});

test("no se elige cargo mientras carga o falla; errores asociados al selector", () => {
  for (const status of ["idle", "loading", "error"] as const) {
    const html = renderToStaticMarkup(<DelegatePositionSelect id="cargo" value="" onChange={() => {}}
      status={status} options={null} className="control" error={accountErrorMessage("DELEGATE_LEGACY_OVERLAP")} />);
    assert.match(html, /disabled=""/);
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /cargo-status cargo-error/);
    assert.match(html, /Debe regularizarse/);
  }
});

test("el legado bloquea ambos cargos y el cupo conocido bloquea solo su cargo", () => {
  assert.deepEqual(delegateAvailability(["PRIMARY"]).map(p => [p.value, p.available]), [["PRIMARY", false], ["DEPUTY", true]]);
  assert.ok(delegateAvailability([null]).every(p => !p.available && p.reason === "LEGACY"));
  assert.ok(delegateAvailability([]).every(p => p.available));
});

test("la cuenta presenta el cargo real y el legado sin inferir antigüedad", () => {
  const role = { roleCode: "CLUB_DELEGATE", roleName: "Delegado de club" };
  assert.equal(accountRoleLabel({ ...role, delegatePosition: "PRIMARY" }), "Delegado de club · Titular");
  assert.equal(accountRoleLabel({ ...role, delegatePosition: "DEPUTY" }), "Delegado de club · Subdelegado");
  assert.equal(accountRoleLabel({ ...role, delegatePosition: null }), "Delegado de club · Cargo no identificado");
  assert.equal(accountRoleLabel({ roleCode: "SECRETARY", roleName: "Secretaría", delegatePosition: null }), "Secretaría");
});

test("vigencia explícita se valida en servidor y se envía con el cargo seleccionado", () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ username: "fixture", email: "fixture@example.test",
    temporaryPassword: "Clave-Sintetica-107!", "person.firstName": "Persona", "person.paternalSurname": "Sintética",
    "club.id": randomUUID(), delegatePosition: "DEPUTY", delegatePeriodMode: "scheduled",
    "delegatePeriod.startsAt": "2035-01-01T12:00", "delegatePeriod.endsAt": "2035-02-01T12:00" })) form.set(key, value);
  const parsed = parseAccountForm(form, ["CLUB_DELEGATE"], randomUUID(), "new", "existing");
  assert.ok(parsed.success);
  assert.equal(parsed.data.delegatePosition, "DEPUTY");
  assert.deepEqual(parsed.data.delegatePeriod, formDelegatePeriod("scheduled", "2035-01-01T12:00", "2035-02-01T12:00"));
  assert.equal(createAccountSchema.safeParse({ ...parsed.data, delegatePeriod: { ...period, endsAt: period.startsAt } }).success, false);
  assert.equal(delegateOptionsSchema.safeParse({ ...context(), period: { ...period, endsAt: "2034-01-01T00:00:00Z" } }).success, false);
  form.set("delegatePeriodMode", "now");
  const immediate = parseAccountForm(form, ["CLUB_DELEGATE"], randomUUID(), "new", "existing");
  assert.ok(immediate.success); assert.equal(immediate.data.delegatePeriod, undefined);
  form.set("delegatePosition", "");
  assert.equal(parseAccountForm(form, ["CLUB_DELEGATE"], randomUUID(), "new", "existing").success, false);
});

test("consulta solo club/periodo, sin PII y sin confiar en opciones del navegador", async () => {
  let called = "";
  const loader = createDelegateOptionsLoader(async input => {
    called = String(input); return new Response(JSON.stringify(options()), { status: 200 });
  });
  assert.equal((await loader.load(context())).kind, "ready");
  const params = new URL(called, "https://fixture.example.test").searchParams;
  assert.equal(params.get("startsAt"), period.startsAt);
  assert.equal(params.get("endsAt"), period.endsAt);
  assert.deepEqual([...params.keys()].sort(), ["clubId", "clubKind", "endsAt", "leagueId", "startsAt"]);
  called = "";
  assert.equal((await loader.load({ ...context(), leagueId: "invalid" })).kind, "idle");
  assert.equal(called, "");
});

test("respuestas tardías y errores de una selección anterior no sustituyen la actual", async () => {
  const pending: ((response: Response) => void)[] = [];
  const loader = createDelegateOptionsLoader(() => new Promise(resolve => pending.push(resolve)));
  const old = loader.load(context());
  const latest = loader.load(context());
  pending[1](new Response(JSON.stringify(options(["PRIMARY"])), { status: 200 }));
  const current = await latest;
  assert.equal(current.kind, "ready");
  if (current.kind === "ready") assert.equal(current.options.positions[0].available, false);
  pending[0](new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));
  assert.equal((await old).kind, "stale");
});

test("error, revocación y respuesta inválida no habilitan opciones", async () => {
  for (const response of [new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }),
    new Response(JSON.stringify({ positions: [] }), { status: 200 })]) {
    const loader = createDelegateOptionsLoader(async () => response);
    assert.equal((await loader.load(context())).kind, "error");
  }
});
