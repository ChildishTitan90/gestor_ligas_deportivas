import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createEnrollmentApi, enrollmentPayload, registrationOptions } from "./team-registration-adapter";
import { createRegistrationWorkspace } from "./team-registration-workspace-controller";
import { TeamRegistrationWorkspaceView } from "./components/team-registration-workspace";
import type { TeamRegistrationSubmission } from "./team-registration-model";

// Todos los datos y respuestas son sintéticos. No red, sesiones ni base reales.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const capture: TeamRegistrationSubmission = { clubId: id(1), seasonId: id(2), categoryId: id(3), groupId: id(4), team: { kind: "existing", id: id(5) } };
const options = { capabilities: { clubId: id(1), canEnroll: true, canCreateTeam: true },
  nextClubAfter: null, nextSeasonAfter: null, nextTeamAfter: null, clubs: [{ id: id(1), name: "Club sintético", leagueId: id(9) }],
  seasons: [{ id: id(2), name: "Temporada sintética", status: "OPEN" }],
  teams: [{ id: id(5), clubId: id(1), name: "Equipo sintético", referenceNumber: "SYNTHETIC", enrolledSeasonIds: [] as string[] }],
  categories: [{ id: id(3), name: "Categoría sintética", seasonId: id(2), seasonCategoryId: id(6) }],
  groups: [{ id: id(4), name: "Grupo sintético", categoryId: id(3), seasonId: id(2) }] };
const receipt = { id: id(7), teamId: id(5), clubId: id(1), seasonId: id(2), categoryId: id(3), groupId: id(4), status: "REGISTERED", replayed: false };
const item = { ...receipt, seasonName: "Temporada sintética", teamName: "Equipo sintético", teamReferenceNumber: "SYNTHETIC", categoryName: "Categoría sintética", groupName: "Grupo sintético" };
function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
function setup(respond: (path: string, init?: RequestInit) => Promise<Response> | Response, store = memory(), catalogRespond?: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { path: string; init?: RequestInit }[] = [];
  let keys = 0;
  let session: () => Response | Promise<Response> = () => response({ user: { id: id(90), mustChangePassword: false } });
  const fetcher = (async (path, init) => { if (String(path) === "/api/auth/session") return session();
    calls.push({ path: String(path), init });
    if (String(path).startsWith("/api/team-enrollments/catalogs")) return catalogRespond ? catalogRespond(String(path), init) : response({ ...options, teams: [], categories: [], groups: [] });
    return respond(String(path), init); }) as typeof fetch;
  return { api: createEnrollmentApi(fetcher, store, "synthetic-user", id(90), () => id(100 + ++keys)), calls, store, keys: () => keys,
    setSession: (next: () => Response | Promise<Response>) => { session = next; } };
}
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test("POST JSON exacto: team.mode excluyente, categoryId y clave estable", async () => {
  assert.deepEqual(enrollmentPayload(capture, id(8)), { enrollmentKey: id(8), clubId: id(1), seasonId: id(2), categoryId: id(3), groupId: id(4), team: { mode: "existing", teamId: id(5) } });
  const fresh = { ...capture, team: { kind: "new", name: "  Equipo sintético  " } as const };
  const s = setup(() => response(receipt, 201));
  await s.api.submit(fresh);
  assert.deepEqual(JSON.parse(String(s.calls[0].init?.body)), { enrollmentKey: id(101), clubId: id(1), seasonId: id(2), categoryId: id(3), groupId: id(4), team: { mode: "new", name: "Equipo sintético" } });
  assert.equal(s.calls[0].init?.credentials, "same-origin");
  assert.equal(s.calls[0].init?.cache, "no-store");
  assert.equal(new Headers(s.calls[0].init?.headers).get("x-expected-actor-id"), id(90));
});

test("cambiar cuenta después de comprobar la sesión no reasigna el POST ni pierde el pendiente", async () => {
  let currentUser = id(90);
  let writes = 0;
  const s = setup((_path, init) => {
    const expectedActor = new Headers(init?.headers).get("x-expected-actor-id");
    assert.equal(expectedActor, id(90));
    if (currentUser !== expectedActor) return response({ code: "FORBIDDEN" }, 403);
    writes++;
    return response(receipt, 201);
  });
  s.setSession(() => {
    const checked = response({ user: { id: currentUser, mustChangePassword: false } });
    currentUser = id(91);
    return checked;
  });
  await assert.rejects(s.api.submit(capture), { code: "FORBIDDEN", status: 403 });
  assert.equal(writes, 0);
  const saved = s.api.pending();
  assert.ok(saved);
  currentUser = id(90);
  s.setSession(() => response({ user: { id: currentUser, mustChangePassword: false } }));
  assert.equal((await s.api.submit(capture)).kind, "confirmed");
  assert.equal(s.calls[1].init?.body, s.calls[0].init?.body);
  assert.equal(s.keys(), 1);
  assert.equal(writes, 1);
  assert.equal(s.api.pending(), null);
});

test("opciones reales dependientes: excluye equipos inscritos y grupos ajenos; consume capacidad del club seleccionado", async () => {
  const s = setup(() => response(options));
  const data = await s.api.options(id(1), id(2));
  assert.equal(s.calls[0].path, `/api/team-enrollments/options?clubId=${id(1)}&seasonId=${id(2)}`);
  assert.equal(registrationOptions(data, id(1), id(2)).clubs[0].seasons[0].canCreateTeam, true);
  data.teams[0].enrolledSeasonIds.push(id(2));
  data.groups.push({ ...options.groups[0], id: id(30), seasonId: id(31) });
  const season = registrationOptions(data, id(1), id(2)).clubs[0].seasons[0];
  assert.equal(season.teams.length, 0);
  assert.deepEqual(season.categories[0].groups.map(g => g.id), [id(4)]);
});

test("201 confirma creación y 200 recupera el estado vigente sin activarlo", async () => {
  for (const status of ["REGISTERED", "ACTIVE", "WITHDRAWN"]) {
    const s = setup(() => response({ ...receipt, replayed: true, status }));
    assert.deepEqual(await s.api.submit(capture), { kind: "confirmed", teamId: id(5), seasonTeamId: id(7), replayed: true, status, pendingCleanup: false });
    assert.equal(s.api.pending(), null);
  }
  const s = setup(() => response(receipt, 201));
  assert.equal((await s.api.submit(capture)).kind, "confirmed");
});

test("red incierta/503 conserva captura y clave incluso al recrear adaptador; ningún reintento automático", async () => {
  const store = memory();
  const s = setup(() => { throw new Error("Synthetic offline"); }, store);
  assert.deepEqual(await s.api.submit(capture), { kind: "unconfirmed", retryAllowed: true });
  assert.equal(s.calls.length, 1);
  const first = s.calls[0].init?.body;
  const recovered = setup(() => response({ code: "SERVICE_UNAVAILABLE" }, 503), store);
  await recovered.api.submit(capture);
  assert.equal(recovered.calls[0].init?.body, first);
  assert.equal(recovered.keys(), 0);
  const final = setup(() => response({ ...receipt, replayed: true }), store);
  assert.equal((await final.api.submit(capture)).kind, "confirmed");
  assert.equal(final.calls[0].init?.body, first);
  assert.equal(final.keys(), 0);
});

test("una captura distinta no sustituye la clave pendiente ni envía POST", async () => {
  const s = setup(() => response({}, 503)); await s.api.submit(capture);
  const previous = s.api.pending();
  assert.equal((await s.api.submit({ ...capture, groupId: id(20) })).kind, "unconfirmed");
  assert.equal(s.calls.length, 1); assert.deepEqual(s.api.pending(), previous); assert.equal(s.keys(), 1);
});

test("respuestas incoherentes/ilegibles nunca anuncian éxito ni descartan el pendiente", async () => {
  for (const [body, http] of [[receipt, 200], [{ ...receipt, replayed: true }, 201], [{ ...receipt, clubId: id(40) }, 201], [{ ...receipt, status: "ACTIVE" }, 201], [{}, 201]] as const) {
    const s = setup(() => response(body, http));
    assert.equal((await s.api.submit(capture)).kind, "unconfirmed"); assert.ok(s.api.pending());
  }
  const s = setup(() => new Response("not-json", { status: 201 }));
  assert.equal((await s.api.submit(capture)).kind, "unconfirmed");
});

test("errores 400/409/413 conservan pendiente hasta un resultado definitivo; conflicto de clave conserva bloqueo", async () => {
  for (const [code, http] of [["VALIDATION_ERROR", 400], ["INVALID_CONTEXT", 400], ["TEAM_ALREADY_ENROLLED", 409], ["CATEGORY_NOT_AUTHORIZED", 409], ["AFFILIATION_NOT_APPROVED", 409], ["SEASON_CLOSED", 409], ["PAYLOAD_TOO_LARGE", 413]] as const) {
    const s = setup(() => response({ code }, http));
    assert.equal((await s.api.submit(capture)).kind, "unconfirmed"); assert.ok(s.api.pending());
  }
  const s = setup(() => response({ code: "IDEMPOTENCY_CONFLICT" }, 409));
  assert.equal((await s.api.submit(capture)).kind, "unconfirmed"); assert.ok(s.api.pending());
});

test("fallo de almacenamiento impide enviar; pendiente corrupto no se borra", async () => {
  const store = memory(); store.setItem("synthetic-user", "invalid");
  const s = setup(() => response(receipt, 201), store);
  assert.equal((await s.api.submit(capture)).kind, "unconfirmed"); assert.equal(s.calls.length, 0);
  assert.equal(store.getItem("synthetic-user"), "invalid");
});

test("listado mapea identidades, paginación e historial sin inventar nombres", async () => {
  const s = setup(() => response({ items: [item], nextAfter: id(7) }));
  const result = await s.api.list(id(1), "", id(6));
  assert.equal(s.calls[0].path, `/api/team-enrollments?clubId=${id(1)}&after=${id(6)}`);
  assert.equal(result.items[0].seasonTeamId, id(7)); assert.equal(result.items[0].teamId, id(5));
  assert.equal(result.items[0].seasonName, "Temporada sintética"); assert.equal(result.nextAfter, id(7));
  assert.equal((await s.api.list(id(1), "", "")).items[0].seasonName, "Temporada sintética");
});

test("lecturas 401/403/404 y formatos inesperados producen error, nunca lista ficticia", async () => {
  for (const http of [401, 403, 404]) {
    const s = setup(() => response({ code: http === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" }, http));
    await assert.rejects(s.api.options()); await assert.rejects(s.api.list(id(1)));
  }
  for (const data of [{}, { items: [{ ...item, clubId: id(50) }], nextAfter: null }]) {
    const s = setup(() => response(data)); await assert.rejects(s.api.list(id(1)));
  }
});

test("workspace carga opciones/listado simulados y renderiza acceso denegado separado del formulario", async () => {
  const s = setup(path => path.includes("options") ? response(options) : response({ items: [item], nextAfter: null }));
  const c = createRegistrationWorkspace(s.api);
  assert.match(renderToStaticMarkup(<TeamRegistrationWorkspaceView controller={c} />), /Cargando opciones/);
  await c.initialize(); c.form.change("clubId", id(1)); await c.context(id(1), "");
  c.form.change("seasonId", id(2)); await c.context(id(1), id(2));
  assert.equal(c.form.getSnapshot().options.clubs[0].seasons[0].canCreateTeam, true);
  assert.match(renderToStaticMarkup(<TeamRegistrationWorkspaceView controller={c} />), /Equipo sintético/);
  c.dispose();
  const denied = createRegistrationWorkspace(setup(() => response({ code: "FORBIDDEN" }, 403)).api);
  await denied.initialize();
  assert.match(renderToStaticMarkup(<TeamRegistrationWorkspaceView controller={denied} />), /Acceso denegado/);
  assert.equal(denied.getSnapshot().items.length, 0);
});

test("restaura captura pendiente y recuperación explícita usa mismo cuerpo, incluso estado ACTIVE", async () => {
  const store = memory(); const first = setup(() => response({}, 503), store); await first.api.submit(capture);
  const s = setup((path, init) => init?.method === "POST" ? response({ ...receipt, replayed: true, status: "ACTIVE" }) :
    path.includes("options") ? response(options) : response({ items: [item], nextAfter: null }), store);
  const c = createRegistrationWorkspace(s.api); await c.initialize();
  assert.equal(c.form.getSnapshot().outcome, "unconfirmed");
  c.form.change("groupId", id(50)); assert.equal(c.form.getSnapshot().draft.groupId, id(4));
  await c.form.submit(); assert.equal(s.calls.filter(call => call.init?.method === "POST").length, 0);
  await c.form.retry();
  assert.equal(c.form.getSnapshot().outcome, "confirmed"); assert.match(c.form.getSnapshot().message, /recuperado como «Activo»/);
  assert.equal(s.calls.find(call => call.init?.method === "POST")?.init?.body, first.calls[0].init?.body);
  assert.equal(s.keys(), 0); c.dispose();
});

test("respuestas tardías de opciones no sobrescriben otro contexto", async () => {
  let resolve!: (value: Response) => void;
  const s = setup(path => path.includes(`clubId=${id(1)}`) ? new Promise<Response>(done => { resolve = done; }) : response({ ...options, teams: [], categories: [], groups: [] }));
  const c = createRegistrationWorkspace(s.api);
  const pending = c.context(id(1), ""); await c.context("", ""); resolve(response(options)); await pending;
  assert.equal(c.getSnapshot().clubId, ""); assert.equal(c.form.getSnapshot().options.clubs[0].seasons.length, 0); c.dispose();
});

test("un rechazo posterior a incertidumbre no borra el envío anterior ni genera otra clave", async () => {
  for (const [code, status] of [["UNAUTHENTICATED", 401], ["FORBIDDEN", 403], ["INVALID_CONTEXT", 400], ["TEAM_ALREADY_ENROLLED", 409]] as const) {
    const store = memory(); const first = setup(() => response({}, 503), store); await first.api.submit(capture);
    const retry = setup(() => response({ code }, status), store);
    if (status === 401 || status === 403) await assert.rejects(retry.api.submit(capture));
    else assert.equal((await retry.api.submit(capture)).kind, "unconfirmed"); assert.deepEqual(retry.api.pending(), first.api.pending());
    assert.equal(retry.keys(), 0);
  }
});

test("no restaura ni permite recuperar si las opciones dejaron de estar autorizadas", async () => {
  const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
  const s = setup(path => path.includes("options") ? response({ code: "FORBIDDEN" }, 403) : response({ ...receipt, replayed: true }), store);
  const c = createRegistrationWorkspace(s.api); await c.initialize();
  assert.ok(c.getSnapshot().optionsError);
  assert.doesNotMatch(renderToStaticMarkup(<TeamRegistrationWorkspaceView controller={c} />), /Recuperar resultado con el mismo envío/);
  assert.equal(c.form.getSnapshot().draft.clubId, "");
  await c.form.retry(); assert.equal(s.calls.filter(call => call.init?.method === "POST").length, 0); assert.ok(s.api.pending()); c.dispose();
});

test("JSON exacto del POST existente, sin campos de autoridad; fallos de lectura no son envíos inciertos", async () => {
  const s = setup(() => response(receipt, 201)); await s.api.submit(capture);
  assert.deepEqual(JSON.parse(String(s.calls[0].init?.body)), { enrollmentKey: id(101), clubId: id(1), seasonId: id(2), categoryId: id(3), groupId: id(4), team: { mode: "existing", teamId: id(5) } });
  const c = createRegistrationWorkspace(setup(() => response({}, 404)).api); await c.initialize();
  assert.equal(c.getSnapshot().formVisible, false);
  assert.doesNotMatch(renderToStaticMarkup(<TeamRegistrationWorkspaceView controller={c} />), /No se pudo confirmar la inscripción/); c.dispose();
});

test("POST pendiente bloquea edición y doble envío; la recuperación conserva el cuerpo exacto", async () => {
  let complete!: (value: Response) => void;
  const s = setup((path, init) => init?.method === "POST" ? new Promise<Response>(resolve => { complete = resolve; }) :
    response(path.includes("options") ? options : { items: [], nextAfter: null }));
  const c = createRegistrationWorkspace(s.api); await c.initialize();
  c.form.change("clubId", id(1)); await c.context(id(1), "");
  c.form.change("seasonId", id(2)); await c.context(id(1), id(2));
  c.form.change("teamId", id(5)); c.form.change("categoryId", id(3)); c.form.change("groupId", id(4));
  const pending = c.form.submit(); c.form.change("clubId", id(20)); await c.form.submit();
  while (!complete) await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.form.getSnapshot().draft.clubId, id(1));
  assert.equal(s.calls.filter(call => call.init?.method === "POST").length, 1);
  const html = renderToStaticMarkup(<TeamRegistrationWorkspaceView controller={c} />);
  assert.match(html, /Enviando inscripción/); assert.match(html, /aria-busy="true"/);
  complete(response({}, 503)); await pending;
  const recovery = c.form.retry(); await c.form.retry();
  while (s.calls.filter(call => call.init?.method === "POST").length < 2) await new Promise(resolve => setImmediate(resolve));
  const posts = s.calls.filter(call => call.init?.method === "POST");
  assert.equal(posts.length, 2); assert.equal(posts[0].init?.body, posts[1].init?.body);
  complete(response({ ...receipt, replayed: true })); await recovery;
  assert.equal(c.form.getSnapshot().outcome, "confirmed"); assert.equal(s.keys(), 1); c.dispose();
});

test("sesión diferente, ausente o restringida: nunca envía el pendiente ni lo elimina", async () => {
  for (const user of [null, { id: id(91) }, { id: id(90), mustChangePassword: true }]) {
    const store = memory(); const first = setup(() => response({}, 503), store); await first.api.submit(capture);
    const s = setup(() => response(receipt, 201), store); s.setSession(() => response({ user }));
    const c = createRegistrationWorkspace(s.api); await c.initialize();
    assert.equal(c.getSnapshot().formVisible, false); assert.equal(c.getSnapshot().blocked, true);
    assert.equal(c.form.getSnapshot().draft.clubId, "");
    await c.form.submit(); await c.form.retry();
    assert.equal(s.calls.length, 0); assert.ok(s.api.pending());
    await assert.rejects(s.api.submit(capture)); assert.equal(s.calls.length, 0); c.dispose();
  }
});

test("restauración espera opciones Y consulta autorizadas, sin mostrar previamente la captura", async () => {
  const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
  let finish!: (value: Response) => void;
  const s = setup(path => path.includes("options") ? response(options) : new Promise<Response>(resolve => { finish = resolve; }), store);
  const c = createRegistrationWorkspace(s.api); const restoring = c.initialize();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.getSnapshot().formVisible, false); assert.equal(c.form.getSnapshot().draft.clubId, "");
  finish(response({ items: [item], nextAfter: null })); await restoring;
  assert.equal(c.getSnapshot().formVisible, true); assert.equal(c.form.getSnapshot().draft.clubId, id(1)); c.dispose();
});

test("401/403 de opciones o listado retira captura y datos visibles; mantiene el pendiente", async () => {
  for (const status of [401, 403]) for (const failOptions of [true, false]) {
    const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
    const s = setup(path => (path.includes("options") === failOptions) ? response({ code: "FORBIDDEN" }, status) :
      response(path.includes("options") ? options : { items: [item], nextAfter: null }), store);
    const c = createRegistrationWorkspace(s.api); await c.initialize();
    assert.equal(c.getSnapshot().blocked, true); assert.equal(c.getSnapshot().formVisible, false);
    assert.deepEqual(c.getSnapshot().items, []); assert.equal(c.getSnapshot().clubId, "");
    assert.equal(c.form.getSnapshot().draft.teamId, ""); await c.form.retry();
    assert.equal(s.calls.filter(call => call.init?.method === "POST").length, 0); assert.ok(s.api.pending()); c.dispose();
  }
});

test("pérdida de acceso después de restaurar retira datos y bloquea recuperación", async () => {
  const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
  let denied = false;
  const s = setup((path, init) => denied ? response({ code: "FORBIDDEN" }, 403) :
    response(init?.method === "POST" ? { ...receipt, replayed: true } : path.includes("options") ? options : { items: [item], nextAfter: null }), store);
  const c = createRegistrationWorkspace(s.api); await c.initialize(); assert.equal(c.getSnapshot().formVisible, true);
  denied = true; await c.list(id(1), id(2));
  assert.equal(c.getSnapshot().formVisible, false); assert.deepEqual(c.getSnapshot().items, []);
  assert.equal(c.form.getSnapshot().draft.clubId, ""); await c.form.retry(); assert.ok(s.api.pending()); c.dispose();
});

test("dispose aborta lecturas e ignora incluso respuestas tardías que no respetan AbortSignal", async () => {
  let finish!: (value: Response) => void; let signal: AbortSignal | undefined;
  const s = setup((path, init) => { signal = init?.signal ?? undefined; return new Promise<Response>(resolve => { finish = resolve; }); });
  const c = createRegistrationWorkspace(s.api); const loading = c.initialize();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  c.dispose(); assert.equal(signal?.aborted, true); finish(response(options)); await loading;
  assert.equal(c.getSnapshot().formVisible, false); assert.equal(c.getSnapshot().clubId, "");
});

test("POST tardío del controlador destruido no elimina la clave ni actualiza su formulario", async () => {
  let finish!: (value: Response) => void;
  const s = setup((path, init) => init?.method === "POST" ? new Promise<Response>(resolve => { finish = resolve; }) :
    response(path.includes("options") ? options : { items: [], nextAfter: null }));
  const c = createRegistrationWorkspace(s.api); await c.initialize();
  c.form.change("clubId", id(1)); await c.context(id(1), ""); c.form.change("seasonId", id(2)); await c.context(id(1), id(2));
  c.form.change("teamId", id(5)); c.form.change("categoryId", id(3)); c.form.change("groupId", id(4));
  const sending = c.form.submit(); while (!finish) await new Promise(resolve => setImmediate(resolve));
  c.dispose(); finish(response(receipt, 201)); await sending;
  assert.ok(s.api.pending()); assert.equal(c.form.getSnapshot().draft.teamId, ""); assert.equal(c.form.getSnapshot().outcome, "unconfirmed");
});

test("cerrar conserva cuerpo y clave; recargar con listado vacío no habilita otra inscripción", async () => {
  const store = memory(); const first = setup(() => response({}, 503), store); await first.api.submit(capture);
  const stored = store.getItem("synthetic-user");
  const s = setup((path, init) => response(init?.method === "POST" ? { ...receipt, replayed: true } :
    path.includes("options") ? options : { items: [], nextAfter: null }), store);
  const c = createRegistrationWorkspace(s.api); await c.initialize();
  await c.confirmClose(); assert.equal(store.getItem("synthetic-user"), stored);
  c.requestClose(); assert.equal(c.getSnapshot().closeConfirm, true); c.cancelClose();
  assert.equal(c.getSnapshot().formVisible, true); assert.equal(store.getItem("synthetic-user"), stored);
  c.requestClose(); await c.confirmClose();
  assert.equal(store.getItem("synthetic-user"), stored); assert.equal(s.api.unresolved(), false);
  assert.equal(c.getSnapshot().formVisible, false); assert.equal(c.getSnapshot().blocked, true);
  assert.match(c.getSnapshot().optionsError, /Conservamos el cuerpo y la clave/);
  await c.form.submit(); await c.form.retry();
  assert.equal(s.calls.filter(call => call.init?.method === "POST").length, 0);
  c.dispose();
  const next = createRegistrationWorkspace(s.api); await next.initialize();
  assert.equal(next.form.getSnapshot().outcome, "unconfirmed"); assert.equal(next.form.getSnapshot().retryAvailable, true);
  assert.deepEqual(next.form.getSnapshot().draft.teamId, capture.team.kind === "existing" ? capture.team.id : "");
  await next.list(capture.clubId, capture.seasonId);
  assert.deepEqual(next.getSnapshot().items, []);
  await next.form.submit(); assert.equal(s.calls.filter(call => call.init?.method === "POST").length, 0);
  assert.equal(store.getItem("synthetic-user"), stored); assert.equal(s.keys(), 0);
  await next.form.retry();
  assert.equal(s.calls.find(call => call.init?.method === "POST")?.init?.body, first.calls[0].init?.body);
  assert.equal(s.keys(), 0); assert.equal(next.form.getSnapshot().outcome, "confirmed");
  assert.equal(s.api.pending(), null); next.dispose();
});

test("cerrar no escribe ni elimina almacenamiento; desmontar y retomar conserva el pendiente", async () => {
  const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
  const stored = store.getItem("synthetic-user");
  store.setItem = () => { throw new Error("Unexpected storage write"); };
  store.removeItem = () => { throw new Error("Unexpected storage removal"); };
  const s = setup(path => response(path.includes("options") ? options : { items: [], nextAfter: null }), store);
  const c = createRegistrationWorkspace(s.api); await c.initialize();
  c.requestClose(); await c.confirmClose();
  assert.equal(c.getSnapshot().formClosed, true); assert.equal(c.getSnapshot().closeError, "");
  assert.equal(store.getItem("synthetic-user"), stored);
  await c.initialize(); assert.equal(c.form.getSnapshot().outcome, "unconfirmed");
  c.dispose(); assert.equal(store.getItem("synthetic-user"), stored);
  assert.equal(s.calls.filter(call => call.init?.method === "POST").length, 0); assert.equal(s.keys(), 0);
});

test("fallo de lectura al cerrar conserva el pendiente y bloquea otra intención", async () => {
  const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
  const stored = store.getItem("synthetic-user"); const getItem = store.getItem;
  const s = setup(path => response(path.includes("options") ? options : { items: [], nextAfter: null }), store);
  const c = createRegistrationWorkspace(s.api); await c.initialize();
  store.getItem = () => { throw new Error("Synthetic storage denied"); };
  c.requestClose(); await c.confirmClose();
  assert.equal(c.getSnapshot().formVisible, false); assert.equal(c.getSnapshot().blocked, true);
  await c.form.retry(); await c.form.submit();
  store.getItem = getItem; assert.equal(store.getItem("synthetic-user"), stored);
  assert.equal(s.calls.filter(call => call.init?.method === "POST").length, 0); c.dispose();
});

test("cambio de identidad al cerrar conserva el pendiente y exige comprobar acceso al retomarlo", async () => {
  const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
  const stored = store.getItem("synthetic-user");
  let denied = false;
  const s = setup(path => response(path.includes("options") ? (denied ? { code: "FORBIDDEN" } : options) :
    { items: [], nextAfter: null }, denied ? 403 : 200), store);
  const c = createRegistrationWorkspace(s.api); await c.initialize();
  s.setSession(() => response({ user: { id: id(91) } }));
  c.requestClose(); await c.confirmClose();
  assert.equal(c.getSnapshot().formVisible, false); assert.equal(store.getItem("synthetic-user"), stored);
  s.setSession(() => response({ user: { id: id(90) } })); denied = true;
  await c.initialize();
  assert.equal(c.getSnapshot().formVisible, false); assert.equal(c.form.getSnapshot().draft.clubId, "");
  assert.equal(store.getItem("synthetic-user"), stored);
  await c.form.retry(); assert.equal(s.calls.filter(call => call.init?.method === "POST").length, 0); c.dispose();
});

test("una marca antigua sin cuerpo no se interpreta como permiso para generar otra clave", async () => {
  const store = memory(); store.setItem("synthetic-user:discarded", JSON.stringify({ enrollmentKey: id(101), unresolved: true }));
  const s = setup(() => response(receipt, 201), store);
  const c = createRegistrationWorkspace(s.api); await c.initialize();
  assert.equal(c.getSnapshot().blocked, true); assert.equal(c.getSnapshot().formVisible, false);
  await c.form.submit(); await c.form.retry();
  assert.equal((await s.api.submit(capture)).kind, "unconfirmed");
  assert.equal(s.calls.length, 0); assert.equal(s.keys(), 0); c.dispose();
});

test("401/403 del primer POST conserva la clave, oculta campos y exige nueva comprobación", async () => {
  for (const status of [401, 403]) {
    const s = setup((path, init) => init?.method === "POST" ? response({ code: "FORBIDDEN" }, status) :
      response(path.includes("options") ? options : { items: [], nextAfter: null }));
    const c = createRegistrationWorkspace(s.api); await c.initialize();
    c.form.change("clubId", id(1)); await c.context(id(1), ""); c.form.change("seasonId", id(2)); await c.context(id(1), id(2));
    c.form.change("teamId", id(5)); c.form.change("categoryId", id(3)); c.form.change("groupId", id(4));
    await c.form.submit(); assert.ok(s.api.pending()); assert.equal(c.getSnapshot().formVisible, false);
    assert.equal(c.form.getSnapshot().draft.teamId, ""); await c.form.retry();
    assert.equal(s.calls.filter(call => call.init?.method === "POST").length, 1); c.dispose();
  }
});


test("capacidades ausentes, false o de otro club nunca habilitan inscripción/creación", () => {
  for (const capabilities of [undefined, { clubId: id(11), canEnroll: true, canCreateTeam: true },
    { clubId: id(1), canEnroll: false, canCreateTeam: true }, { clubId: null, canEnroll: false, canCreateTeam: false }]) {
    const season = registrationOptions({ ...options, capabilities }, id(1), id(2)).clubs[0].seasons[0];
    assert.equal(season.canEnroll, false); assert.equal(season.canCreateTeam, false);
  }
  const season = registrationOptions({ ...options, capabilities: { clubId: id(1), canEnroll: true, canCreateTeam: false } }, id(1), id(2)).clubs[0].seasons[0];
  assert.equal(season.canEnroll, true); assert.equal(season.canCreateTeam, false);
});

test("catálogos autorizados cargan todas las páginas de clubes/temporadas y conservan CLOSED", async () => {
  const s = setup(() => response(options), memory(), path => {
    const query = new URL(path, "https://synthetic.test").searchParams;
    return response({ ...options, clubs: query.has("clubAfter") ? [{ id: id(11), name: "Otro club", leagueId: id(9) }] : options.clubs,
      seasons: query.has("seasonAfter") ? [{ id: id(12), name: "Temporada cerrada", status: "CLOSED" }] : options.seasons,
      teams: [], categories: [], groups: [], nextClubAfter: query.has("clubAfter") ? null : id(1),
      nextSeasonAfter: query.has("seasonAfter") ? null : id(2) });
  });
  const data = await s.api.catalogs(id(1));
  assert.equal(data.clubs.length, 2); assert.equal(data.seasons.length, 2);
  assert.equal(data.seasons[1].name, "Temporada cerrada");
  assert.ok(s.calls.every(call => call.path.startsWith("/api/team-enrollments/catalogs?")));
  assert.ok(s.calls.some(call => call.path.includes("clubAfter=")));
  assert.ok(s.calls.some(call => call.path.includes("seasonAfter=")));
});

test("paginación repetida o capacidades que cambian abortan la lectura", async () => {
  for (const change of [false, true]) {
    const s = setup(path => response({ ...options, nextTeamAfter: id(5),
      ...(change && path.includes("teamAfter") ? { capabilities: { clubId: id(11), canEnroll: true, canCreateTeam: true } } : {}) }));
    await assert.rejects(s.api.options(id(1), id(2)));
  }
});

test("historial usa seasonName del listado, nunca el nombre de opciones vigentes", async () => {
  const s = setup(() => response({ items: [{ ...item, seasonName: "Histórico oficial" }], nextAfter: null }));
  assert.equal((await s.api.list(id(1), "", "")).items[0].seasonName, "Histórico oficial");
  const invalid = setup(() => response({ items: [{ ...item, seasonName: undefined }], nextAfter: null }));
  await assert.rejects(invalid.api.list(id(1)));
});

const operation = (outcome: "UNRESOLVED" | "CONFIRMED" | "CANCELLED") => ({ enrollmentKey: id(101), clubId: id(1), outcome,
  enrollment: outcome === "CONFIRMED" ? { ...receipt, replayed: true } : null });

test("GET de operación no escribe: UNRESOLVED conserva JSON y clave; CONFIRMED resuelve", async () => {
  const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
  const stored = store.getItem("synthetic-user"); let outcome: "UNRESOLVED" | "CONFIRMED" = "UNRESOLVED";
  const s = setup(() => response(operation(outcome)), store);
  assert.equal((await s.api.check()).kind, "unconfirmed");
  assert.equal(store.getItem("synthetic-user"), stored); assert.equal(s.keys(), 0);
  assert.equal(s.calls[0].path, `/api/team-enrollments/operations/${id(101)}?clubId=${id(1)}`);
  assert.equal(s.calls[0].init?.method, "GET"); assert.equal(s.calls[0].init?.body, undefined);
  assert.equal(new Headers(s.calls[0].init?.headers).get("X-Expected-Actor-Id"), id(90));
  outcome = "CONFIRMED"; assert.equal((await s.api.check()).kind, "confirmed"); assert.equal(s.api.pending(), null);
});

test("cancelar usa POST con cuerpo/clave originales y actor esperado; CANCELLED/CONFIRMED son definitivos", async () => {
  for (const outcome of ["CANCELLED", "CONFIRMED"] as const) {
    const store = memory(); const first = setup(() => response({}, 503), store); await first.api.submit(capture);
    const s = setup(() => response(operation(outcome)), store); const result = await s.api.cancel();
    assert.equal(result.kind, outcome === "CANCELLED" ? "cancelled" : "confirmed");
    assert.equal(s.calls[0].path, `/api/team-enrollments/operations/${id(101)}/cancel`);
    assert.equal(s.calls[0].init?.method, "POST"); assert.equal(s.calls[0].init?.body, first.calls[0].init?.body);
    assert.equal(new Headers(s.calls[0].init?.headers).get("X-Expected-Actor-Id"), id(90));
    assert.equal(s.api.pending(), null); assert.equal(s.keys(), 0);
  }
});

test("respuestas desconocidas, 404/409/503 o red perdida en consulta/cancelación conservan el pendiente", async () => {
  for (const action of ["check", "cancel"] as const) for (const failure of ["network", "invalid", "wrong-club", "wrong-key", "bad-enrollment", 404, 409, 503]) {
    const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
    const stored = store.getItem("synthetic-user");
    const s = setup(() => {
      if (failure === "network") throw new Error("Synthetic offline");
      if (typeof failure === "number") return response({ code: "OPERATION_CANCELLED" }, failure);
      if (failure === "wrong-club") return response({ ...operation("CANCELLED"), clubId: id(11) });
      if (failure === "wrong-key") return response({ ...operation("CANCELLED"), enrollmentKey: id(111) });
      if (failure === "bad-enrollment") return response({ ...operation("CONFIRMED"), enrollment: { ...receipt, teamId: id(55), replayed: true } });
      return response({ ...operation("UNRESOLVED"), outcome: "UNKNOWN" });
    }, store);
    assert.equal((await s.api[action]()).kind, "unconfirmed"); assert.equal(store.getItem("synthetic-user"), stored); assert.equal(s.keys(), 0);
  }
});

test("401/403 o cambio de actor en operaciones conservan pendiente y no permiten enviarlo con otra identidad", async () => {
  for (const action of ["check", "cancel"] as const) {
    const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
    const stored = store.getItem("synthetic-user");
    const s = setup(() => response({ code: "FORBIDDEN" }, 403), store);
    await assert.rejects(s.api[action]()); assert.equal(store.getItem("synthetic-user"), stored);
    s.setSession(() => response({ user: { id: id(91) } }));
    const count = s.calls.length; await assert.rejects(s.api[action]()); assert.equal(s.calls.length, count);
    assert.equal(store.getItem("synthetic-user"), stored);
  }
});

test("respuesta tardía de consulta/cancelación tras stop no limpia cuerpo ni clave", async () => {
  for (const action of ["check", "cancel"] as const) {
    const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
    let done!: (value: Response) => void; let signal: AbortSignal | null | undefined;
    const s = setup((_path, init) => { signal = init?.signal; return new Promise(resolve => { done = resolve; }); }, store);
    const resolving = s.api[action](); while (!done) await new Promise(resolve => setImmediate(resolve));
    s.api.stop(); assert.equal(signal?.aborted, true); done(response(operation("CANCELLED")));
    assert.equal((await resolving).kind, "unconfirmed"); assert.ok(s.api.pending());
  }
});

test("workspace permite consulta/cancelación con READ aunque CREATE haya sido revocado", async () => {
  const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
  const s = setup((path, init) => response(path.includes("options") ? { ...options, capabilities: { clubId: id(1), canEnroll: false, canCreateTeam: false } } :
    path.includes("operations") ? operation(init?.method === "POST" ? "CANCELLED" : "UNRESOLVED") : { items: [], nextAfter: null }), store);
  const c = createRegistrationWorkspace(s.api); await c.initialize();
  await c.form.retry(); assert.equal(s.calls.filter(call => call.init?.method === "POST").length, 0);
  await c.checkOperation(); assert.ok(s.api.pending());
  await c.confirmCancellation(); assert.ok(s.api.pending());
  c.requestCancellation(); await c.confirmCancellation();
  assert.equal(c.form.getSnapshot().outcome, "cancelled"); assert.equal(s.api.pending(), null);
  assert.match(renderToStaticMarkup(<TeamRegistrationWorkspaceView controller={c} />), /Iniciar otra inscripción/); c.dispose();
});

test("acuse definitivo con fallo de limpieza mantiene bloqueo y solo nueva consulta permite limpiar", async () => {
  const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
  const remove = store.removeItem; store.removeItem = () => { throw new Error("Synthetic storage denied"); };
  const s = setup(path => response(path.includes("options") ? options : path.includes("operations") ? operation("CANCELLED") : { items: [], nextAfter: null }), store);
  const c = createRegistrationWorkspace(s.api); await c.initialize(); await c.checkOperation();
  assert.equal(c.form.getSnapshot().outcome, "cancelled"); assert.equal(c.form.getSnapshot().pendingCleanup, true);
  assert.ok(s.api.pending()); c.form.reset(); assert.equal(c.form.getSnapshot().outcome, "cancelled");
  assert.doesNotMatch(renderToStaticMarkup(<TeamRegistrationWorkspaceView controller={c} />), /Iniciar otra inscripción/);
  store.removeItem = remove; await c.checkOperation();
  assert.equal(c.form.getSnapshot().pendingCleanup, false); assert.equal(s.api.pending(), null); c.form.reset();
  assert.equal(c.form.getSnapshot().outcome, "idle"); c.dispose();
});


test("cambiar filtro cancela el listado anterior y oculta su respuesta tardía", async () => {
  let finish!: (value: Response) => void; let signal: AbortSignal | null | undefined;
  const s = setup((_path, init) => { signal = init?.signal; return new Promise(resolve => { finish = resolve; }); });
  const c = createRegistrationWorkspace(s.api);
  const old = c.list(id(1)); while (!finish) await new Promise(resolve => setImmediate(resolve));
  await c.queryCatalogs(id(1), id(2));
  assert.equal(signal?.aborted, true);
  finish(response({ items: [item], nextAfter: null })); await old;
  assert.deepEqual(c.getSnapshot().items, []); assert.equal(c.getSnapshot().listed, false);
  assert.equal(c.getSnapshot().querySeasonId, id(2)); c.dispose();
});

test("catálogo tardío no reemplaza el filtro nuevo y dispose aborta la lectura", async () => {
  let finish!: (value: Response) => void; let signal: AbortSignal | null | undefined;
  const s = setup(() => response(options), memory(), (path, init) => {
    if (path.includes(`clubId=${id(1)}`)) { signal = init?.signal; return new Promise(resolve => { finish = resolve; }); }
    return response({ ...options, clubs: [{ id: id(11), name: "Otro club", leagueId: id(9) }], seasons: [] });
  });
  const c = createRegistrationWorkspace(s.api); const old = c.queryCatalogs(id(1));
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await c.queryCatalogs(id(11)); assert.equal(signal?.aborted, true);
  finish(response(options)); await old;
  assert.equal(c.getSnapshot().queryClubId, id(11)); assert.equal(c.getSnapshot().queryClubs[0].name, "Otro club");
  const pendingRead = c.queryCatalogs(id(1));
  await new Promise(resolve => setImmediate(resolve)); c.dispose(); assert.equal(signal?.aborted, true);
  finish(response(options)); await pendingRead;
  assert.equal(c.getSnapshot().queryClubs.length, 0);
});

test("cancelación pendiente bloquea doble solicitud y una respuesta incierta conserva cuerpo", async () => {
  const store = memory(); await setup(() => response({}, 503), store).api.submit(capture);
  const stored = store.getItem("synthetic-user"); let finish!: (value: Response) => void;
  const s = setup((path, init) => path.includes("operations") && init?.method === "POST" ? new Promise(resolve => { finish = resolve; }) :
    response(path.includes("options") ? options : { items: [], nextAfter: null }), store);
  const c = createRegistrationWorkspace(s.api); await c.initialize(); c.requestCancellation();
  const cancelling = c.confirmCancellation(); await c.confirmCancellation(); await c.checkOperation(); await c.form.retry();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.calls.filter(call => call.path.endsWith("/cancel")).length, 1);
  finish(response({}, 503)); await cancelling;
  assert.equal(store.getItem("synthetic-user"), stored); assert.equal(c.form.getSnapshot().outcome, "unconfirmed");
  assert.equal(s.keys(), 0); c.dispose();
});
