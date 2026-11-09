import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { createMaintenanceController, type MaintenanceApi } from "./maintenance-controller";
import { createMaintenanceApi } from "./maintenance-api.client";
import { MaintenanceClientError, deliveryMessage, type MaintenanceAccount } from "./maintenance-ui";
import { AccountMaintenanceWorkspaceView } from "./components/maintenance-workspace";
import type { EmailChangeResult } from "./email-change-contract";

const actorId = randomUUID(), account: MaintenanceAccount = { id: randomUUID(), username: "sintetico", isActive: true, revision: 3 };
const identifiers = { id: account.id, username: account.username, email: "actual@example.test", revision: 3 };
const receipt: EmailChangeResult = { id: randomUUID(), status: "PENDING", revision: 4, expiresAt: "2026-11-06T20:00:00.000Z",
  confirmationDelivery: "NOT_CONFIGURED", previousNoticeDelivery: "NOT_CONFIGURED", completionNoticeDelivery: "NOT_CONFIGURED" };
const input = { value: "nuevo", reason: "Motivo sintético de prueba", confirmed: true };
function fixture(patch: Partial<MaintenanceApi> = {}, canUpdate = true, self = false) {
  const writes: { id: string; kind: string; payload: unknown }[] = [], keys: string[] = [];
  const api: MaintenanceApi = { detail: async (_id, editable) => ({ account, ...(editable ? { identifiers } : {}) }),
    write: async (id, kind, payload) => { writes.push({ id, kind, payload }); return kind === "email" ? receipt : { ...account, username: "nuevo", revision: 4 }; },
    emailStatus: async (_id, key) => { keys.push(key); return receipt; }, ...patch };
  let uuidCalls = 0;
  const controller = createMaintenanceController(api, { actorId: self ? account.id : actorId, canUpdate, uuid: () => { uuidCalls++; return randomUUID(); } });
  return { controller, writes, keys, uuidCalls: () => uuidCalls };
}
test("username manda solo changes.username con motivo, confirmación y revisión; no correo directo", async () => {
  const { controller, writes } = fixture(); await controller.open(account.id);
  await controller.submit("username", { ...input, value: " NUEVO " });
  assert.deepEqual(writes[0].payload, { changes: { username: "nuevo" }, expectedRevision: 3, reason: input.reason, confirmed: true });
  assert.equal(controller.getSnapshot().reviewRequired, true);
  await controller.submit("username", input); assert.equal(writes.length, 1);
});
test("sin permiso, motivo válido o confirmación no se emite una escritura", async () => {
  for (const canUpdate of [false, true]) {
    const { controller, writes } = fixture({}, canUpdate); await controller.open(account.id);
    await controller.submit("username", { ...input, reason: "corto" });
    await controller.submit("status", { ...input, confirmed: false });
    assert.equal(writes.length, 0);
  }
});
test("baja/reactivación se deriva del estado consultado, conserva revisión y no acepta un ID del formulario", async () => {
  for (const active of [true, false]) {
    const { controller, writes } = fixture({ detail: async () => ({ account: { ...account, isActive: active }, identifiers }) });
    await controller.open(account.id); await controller.submit("status", input);
    assert.deepEqual(writes[0], { id: account.id, kind: "status", payload: { isActive: !active, expectedRevision: 3, reason: input.reason, confirmed: true } });
  }
});
test("doble envío queda bloqueado hasta que la respuesta oficial resuelva", async () => {
  let release!: (value: MaintenanceAccount) => void; let calls = 0;
  const { controller } = fixture({ write: async () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  await controller.open(account.id); const pending = controller.submit("username", input);
  await controller.submit("username", input); assert.equal(calls, 1);
  release({ ...account, revision: 4 }); await pending;
});
test("409 exige consultar versión actual y no modifica ni reenvía automáticamente la captura", async () => {
  let calls = 0;
  const { controller } = fixture({ write: async () => { calls++; throw new MaintenanceClientError("ACCOUNT_CHANGED", 409); } });
  await controller.open(account.id); await controller.submit("status", input);
  assert.match(controller.getSnapshot().error, /versión actual/);
  assert.equal(controller.getSnapshot().uncertain, false);
  await controller.submit("status", input); assert.equal(calls, 1);
  await controller.refresh(); assert.equal(controller.getSnapshot().detail?.account.revision, 3);
});
test("respuesta perdida en username se consulta sin reenviar y no se atribuye un resultado no probado", async () => {
  let calls = 0;
  const { controller } = fixture({ write: async () => { calls++; throw new MaintenanceClientError("NETWORK"); } });
  await controller.open(account.id); await controller.submit("username", input);
  controller.close(); assert.equal(controller.getSnapshot().uncertain, true);
  assert.equal(controller.getSnapshot().pending?.kind, "username");
  controller.reopen(); await controller.submit("status", input); assert.equal(calls, 1);
  await controller.refresh(); assert.equal(calls, 1);
  assert.match(controller.getSnapshot().notice, /No acredita/);
  assert.equal(controller.getSnapshot().reviewRequired, true);
});
test("correo incierto conserva payload y clave en reintento; consulta 404 no simula fracaso ni entrega", async () => {
  const payloads: unknown[] = []; let calls = 0;
  const { controller, uuidCalls } = fixture({ write: async (_id, _kind, payload) => { payloads.push(payload); if (!calls++) throw new MaintenanceClientError("NETWORK"); return receipt; },
    emailStatus: async () => { throw new MaintenanceClientError("EMAIL_CHANGE_NOT_FOUND", 404); } });
  await controller.open(account.id); await controller.submit("email", { ...input, value: "NUEVO@example.test" });
  await controller.refresh(); assert.equal(controller.getSnapshot().uncertain, true);
  assert.match(controller.getSnapshot().error, /no confirma/);
  await controller.retryEmail(); assert.equal(uuidCalls(), 1); assert.deepEqual(payloads[0], payloads[1]);
  assert.equal(controller.getSnapshot().detail?.identifiers?.email, "actual@example.test");
  assert.match(deliveryMessage(controller.getSnapshot().email!.confirmationDelivery), /NOT_CONFIGURED.*no se envió/);
});
test("consulta del correo perdido resuelve por clave sin otro POST", async () => {
  let writes = 0; const keys: string[] = [];
  const { controller } = fixture({ write: async () => { writes++; throw new MaintenanceClientError("NETWORK"); }, emailStatus: async (_id, key) => { keys.push(key); return receipt; } });
  await controller.open(account.id); await controller.submit("email", { ...input, value: "nuevo@example.test" });
  const key = controller.getSnapshot().pending?.payload.operationKey;
  await controller.refresh(); assert.deepEqual(keys, [key]); assert.equal(writes, 1);
  assert.equal(controller.getSnapshot().email?.status, "PENDING");
});
test("una confirmación consultada no sigue presentando como actual el correo anterior", async () => {
  const { controller } = fixture({ emailStatus: async () => ({ ...receipt, status: "CONFIRMED", revision: 5 }) });
  await controller.open(account.id); await controller.submit("email", { ...input, value: "nuevo@example.test" });
  await controller.pollEmail();
  assert.equal(controller.getSnapshot().email?.status, "CONFIRMED");
  assert.equal(controller.getSnapshot().detail?.identifiers, undefined);
  assert.equal(controller.getSnapshot().reviewRequired, true);
});
test("sesión revocada o pérdida de permisos borra detalle, correo y operaciones pendientes", async () => {
  for (const code of ["UNAUTHENTICATED", "FORBIDDEN", "PASSWORD_CHANGE_REQUIRED"]) {
    const { controller } = fixture({ write: async () => { throw new MaintenanceClientError(code, code === "UNAUTHENTICATED" ? 401 : 403); } });
    await controller.open(account.id); await controller.submit("status", input);
    const state = controller.getSnapshot(); assert.equal(state.blocked, code); assert.equal(state.detail, null); assert.equal(state.pending, null); assert.equal(state.visible, false);
  }
});
test("modificación propia reconoce el éxito y pide login sin consultar usando la sesión revocada", async () => {
  const { controller } = fixture({}, true, true); await controller.open(account.id); await controller.submit("status", input);
  assert.equal(controller.getSnapshot().blocked, "UNAUTHENTICATED"); assert.equal(controller.getSnapshot().detail, null);
  assert.match(controller.getSnapshot().notice, /Cambio guardado.*sesiones/);
});
test("respuesta tardía tras salir no repuebla datos, incluso al reiniciar el controlador en StrictMode", async () => {
  let resolve!: (value: { account: MaintenanceAccount }) => void;
  const { controller } = fixture({ detail: async () => new Promise(r => { resolve = r; }) });
  const reading = controller.open(account.id); controller.dispose(); controller.start(); resolve({ account }); await reading;
  assert.equal(controller.getSnapshot().detail, null);
  assert.equal(controller.getSnapshot().busy, false);
});
test("consulta de correo tardía no sustituye el estado tras cerrar el ciclo de vida", async () => {
  let resolve!: (value: EmailChangeResult) => void;
  const { controller } = fixture({ emailStatus: async () => new Promise(r => { resolve = r; }) });
  await controller.open(account.id); await controller.submit("email", { ...input, value: "nuevo@example.test" });
  const reading = controller.pollEmail(); controller.dispose(); controller.start();
  resolve({ ...receipt, status: "CONFIRMED", revision: 5 }); await reading;
  assert.equal(controller.getSnapshot().email?.status, "PENDING");
});
test("adaptador read-only no pide identificadores; DTO elimina campos y secretos inesperados", async () => {
  const paths: string[] = [];
  const api = createMaintenanceApi(async (path, options) => {
    paths.push(String(path)); assert.equal(options?.cache, "no-store"); assert.equal(options?.credentials, "same-origin");
    return Response.json({ ...account, password_hash: "synthetic-secret", token: "synthetic-secret" });
  });
  const result = await api.detail(account.id, false); assert.equal(paths.length, 1);
  assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
});
test("adaptador detecta conflicto entre lecturas y preserva 401 aunque falte código", async () => {
  const mismatch = createMaintenanceApi(async path => Response.json(String(path).endsWith("/identifiers") ? { ...identifiers, revision: 4 } : account));
  await assert.rejects(mismatch.detail(account.id, true), (e: unknown) => e instanceof MaintenanceClientError && e.code === "ACCOUNT_CHANGED");
  const revoked = createMaintenanceApi(async () => Response.json({}, { status: 401 }));
  await assert.rejects(revoked.detail(account.id, false), (e: unknown) => e instanceof MaintenanceClientError && e.code === "UNAUTHENTICATED");
  const html = createMaintenanceApi(async () => new Response("Página de acceso", { status: 401 }));
  await assert.rejects(html.detail(account.id, false), (e: unknown) => e instanceof MaintenanceClientError && e.code === "UNAUTHENTICATED");
});
test("sin conexión no envía ni marca éxito; un 5xx conserva la operación incierta", async () => {
  let writes = 0;
  const api: MaintenanceApi = { detail: async () => ({ account, identifiers }), emailStatus: async () => receipt,
    write: async () => { writes++; throw new MaintenanceClientError("SERVICE_UNAVAILABLE", 503); } };
  const offline = createMaintenanceController(api, { actorId, canUpdate: true, uuid: randomUUID, online: () => false });
  await offline.open(account.id); await offline.submit("status", input); assert.equal(writes, 0);
  assert.match(offline.getSnapshot().error, /No se envió/); assert.equal(offline.getSnapshot().uncertain, false);
  const online = createMaintenanceController(api, { actorId, canUpdate: true, uuid: randomUUID });
  await online.open(account.id); await online.submit("status", input); assert.equal(writes, 1);
  assert.equal(online.getSnapshot().uncertain, true);
});
test("una respuesta de lectura para otra cuenta y un acuse incompleto no se aceptan", async () => {
  const wrong = createMaintenanceApi(async () => Response.json({ ...account, id: randomUUID() }));
  await assert.rejects(wrong.detail(account.id, false), (e: unknown) => e instanceof MaintenanceClientError && e.code === "INVALID_RESPONSE");
  const malformed = createMaintenanceApi(async () => Response.json({ accepted: true }));
  await assert.rejects(malformed.write(account.id, "email", {}), (e: unknown) => e instanceof MaintenanceClientError && e.code === "INVALID_RESPONSE");
});
test("límite de correo y protección SUPERADMIN no se presentan como escritura guardada", async () => {
  for (const [code, status] of [["EMAIL_CHANGE_RATE_LIMITED", 429], ["LAST_OPERATIONAL_SUPERADMIN", 409]] as const) {
    const { controller } = fixture({ write: async () => { throw new MaintenanceClientError(code, status); } });
    await controller.open(account.id); await controller.submit("status", input);
    assert.equal(controller.getSnapshot().notice, ""); assert.equal(controller.getSnapshot().pending, null);
    assert.equal(controller.getSnapshot().uncertain, false);
    assert.match(controller.getSnapshot().error, code === "EMAIL_CHANGE_RATE_LIMITED" ? /límite/ : /pueda operar/);
  }
});
test("vista de consulta, vacío y sesión revocada no muestra correo privado ni otro shell", async () => {
  const { controller } = fixture({}, false); await controller.open(account.id);
  const props = { list: { items: [account], page: 1, pageSize: 20, total: 1 }, actorId, canUpdate: false, controller };
  const html = renderToStaticMarkup(<AccountMaintenanceWorkspaceView {...props} />);
  assert.match(html, /Detalle de cuenta/); assert.match(html, /Tu permiso permite consultar/);
  assert.doesNotMatch(html, /actual@example.test|Editar username|Solicitar cambio de correo|<main|<select/);
  assert.match(renderToStaticMarkup(<AccountMaintenanceWorkspaceView {...props} list={{ ...props.list, items: [], total: 0 }} />), /No hay cuentas/);
  const denied = fixture({ detail: async () => { throw new MaintenanceClientError("UNAUTHENTICATED", 401); } }); await denied.controller.open(account.id);
  const blocked = renderToStaticMarkup(<AccountMaintenanceWorkspaceView {...props} controller={denied.controller} />);
  assert.match(blocked, /Iniciar sesión/); assert.doesNotMatch(blocked, /sintetico|actual@example.test|Paginación de cuentas|Buscar cuentas/);
});
test("búsqueda y paginación conservan filtros codificados y ocultan navegación durante incertidumbre", async () => {
  const { controller } = fixture({ write: async () => { throw new MaintenanceClientError("NETWORK"); } });
  const props = { list: { items: [account], page: 2, pageSize: 10, total: 35 }, actorId, canUpdate: true, search: "a&b", controller };
  const html = renderToStaticMarkup(<AccountMaintenanceWorkspaceView {...props} />);
  assert.match(html, /search=a%26b.*page=3.*pageSize=10/); assert.match(html, /Página anterior/); assert.match(html, /Página siguiente/);
  assert.match(html, /value="10"/);
  await controller.open(account.id); await controller.submit("status", input); controller.close();
  const uncertain = renderToStaticMarkup(<AccountMaintenanceWorkspaceView {...props} />);
  assert.match(uncertain, /Reabrir operación pendiente/); assert.doesNotMatch(uncertain, /Página siguiente/);
});
test("vista NOT_CONFIGURED mantiene correo anterior y no acredita entrega ni divulga tokens", async () => {
  const { controller } = fixture(); await controller.open(account.id); await controller.submit("email", { ...input, value: "nuevo@example.test" });
  const html = renderToStaticMarkup(<AccountMaintenanceWorkspaceView list={{ items: [account], page: 1, pageSize: 20, total: 1 }} actorId={actorId} canUpdate controller={controller} />);
  assert.match(html, /actual@example.test/); assert.match(html, /NOT_CONFIGURED/); assert.match(html, /anterior conserva el acceso/);
  assert.doesNotMatch(html, /ec1_|password_hash|entregado correctamente/);
});

test("reset exige atestación y distingue proveedor ausente de resultado incierto", async () => {
  let calls = 0;
  const { controller } = fixture({ write: async (_id, kind, payload) => {
    calls++;
    assert.equal(kind, "reset");
    assert.deepEqual(payload, { expectedRevision: 3, reason: input.reason, confirmed: true,
      identityVerified: true, verificationMethod: "IN_PERSON" });
    throw new MaintenanceClientError("NOT_CONFIGURED", 503);
  } });
  await controller.open(account.id);
  await controller.submit("reset", input);
  assert.equal(calls, 0);
  await controller.submit("reset", { ...input, identityVerified: true, verificationMethod: "IN_PERSON" });
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot().uncertain, false);
  assert.match(controller.getSnapshot().error, /No se restableció/);
});
