import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createReviewApi } from "./affiliation-review-adapter";
import { createReviewController } from "./affiliation-review-controller";
import { ReviewApiError, type ReviewApi, type ReviewDetail } from "./affiliation-review-model";
import { AffiliationReviewView } from "./components/affiliation-review-workspace";

// Exclusivamente fixtures de pruebas: nunca importadas por la página real.
const leagueId = "61000000-0000-4000-8000-000000000001";
const categoryId = "61000000-0000-4000-8000-000000000040";
const fixture: ReviewDetail = {
  id: "61000000-0000-4000-8000-000000000002", leagueId,
  referenceNumber: "TEST-61", clubName: "Club sintético", seasonName: "Temporada de prueba",
  status: "PENDING", reviewPhase: "AWAITING_REVIEW", uniformColors: "Azul sintético", version: 0,
  categories: ["Categoría de prueba"], observations: null, allowedActions: ["APPROVE", "REQUEST_CORRECTIONS"],
  categoryOptions: [{ id: categoryId, name: "Categoría de prueba", authorized: false }],
  history: [],
  officers: [{ office: "PRESIDENT", firstName: "Persona sintética", paternalSurname: "Prueba", maternalSurname: "",
    signatureFileId: "61000000-0000-4000-8000-000000000030" }],
};
function setup(overrides: Partial<ReviewApi> = {}) {
  const calls: string[] = [];
  const api: ReviewApi = {
    list: async () => { calls.push("list"); return [fixture]; },
    detail: async () => { calls.push("detail"); return fixture; },
    signature: async () => ({ downloadUrl: "https://storage.example.test/storage/v1/object/sign/firmas-afiliacion/fixture?token=synthetic", expiresInSeconds: 60 }),
    review: async (_id, action, observations) => {
      calls.push(`${action}:${observations}`);
      return { ...fixture, status: action === "APPROVE" ? "APPROVED" : "PENDING",
        reviewPhase: action === "APPROVE" ? null : "CORRECTIONS_REQUESTED" };
    }, ...overrides,
  };
  return { controller: createReviewController(api), calls };
}
function html(controller: ReturnType<typeof createReviewController>) {
  return renderToStaticMarkup(<AffiliationReviewView controller={controller} leagues={[{ id: leagueId, name: "Liga sintética" }]} />);
}

test("Secretaría vuelve a consultar aprobadas y abre su detalle sin ofrecer otra aprobación", async () => {
  const approved: ReviewDetail = { ...fixture, status: "APPROVED", reviewPhase: null, allowedActions: [] };
  const paths: string[] = [];
  const api = createReviewApi(async path => {
    paths.push(String(path));
    return Response.json(String(path).includes("?") ? { items: [approved], page: 1, pageSize: 100, hasMore: false } : approved);
  });
  const controller = createReviewController(api);
  await controller.load(leagueId, "APPROVED");
  assert.match(paths[0], /status=APPROVED/);
  assert.equal(controller.getSnapshot().status, "APPROVED");
  assert.match(html(controller), /Afiliaciones aprobadas/);
  await controller.open(fixture.id);
  assert.match(html(controller), /Categorías autorizadas/);
  assert.doesNotMatch(html(controller), />Aprobar solicitud</);
  const mixed = createReviewApi(async () => Response.json({ items: [fixture], page: 1, pageSize: 100, hasMore: false }));
  await assert.rejects(mixed.list(leagueId, "APPROVED"), /invalid-response/);
});
test("historial conserva correcciones, reenvío y aprobación, escapa observaciones y se retira al perder acceso", async () => {
  const history: ReviewDetail["history"] = [
    { id: "61000000-0000-4000-8000-000000000010", action: "AFFILIATION_REQUEST_CORRECTIONS",
      occurredAt: "2026-10-24T18:00:00.000Z", observations: "Aclarar colores <script>alert(1)</script>" },
    { id: "61000000-0000-4000-8000-000000000011", action: "AFFILIATION_RESUBMIT",
      occurredAt: "2026-10-24T18:01:00.000Z", observations: null },
    { id: "61000000-0000-4000-8000-000000000012", action: "AFFILIATION_APPROVE",
      occurredAt: "2026-10-24T18:02:00.000Z", observations: null },
  ];
  for (const kind of ["unauthenticated", "forbidden"] as const) {
    let reads = 0;
    const { controller } = await selected({ detail: async () => {
      if (++reads > 1) throw new ReviewApiError(kind);
      return { ...fixture, status: "APPROVED", reviewPhase: null, allowedActions: [], history };
    } });
    const markup = html(controller);
    assert.match(markup, /Historial de revisión/);
    assert.ok(markup.indexOf("Correcciones solicitadas") < markup.indexOf("Solicitud reenviada"));
    assert.ok(markup.indexOf("Solicitud reenviada") < markup.indexOf("Afiliación aprobada"));
    assert.match(markup, /datetime="2026-10-24T18:00:00.000Z"/i);
    assert.match(markup, /Ciudad de México/);
    assert.match(markup, /Aclarar colores &lt;script&gt;/);
    assert.doesNotMatch(markup, /<script>/);
    await controller.open(fixture.id);
    assert.doesNotMatch(html(controller), /Aclarar colores|Solicitud reenviada|Historial de revisión/);
  }
  assert.match(html((await selected()).controller), /Sin revisiones registradas/);
});

test("adaptador exige un historial válido y conserva solo sus campos de presentación", async () => {
  const entry = { id: "61000000-0000-4000-8000-000000000010", action: "AFFILIATION_REQUEST_CORRECTIONS",
    occurredAt: "2026-10-24T18:00:00.000Z", observations: "Precisar uniforme." };
  const api = createReviewApi(async () => Response.json({ ...fixture, history: [{ ...entry, actorId: leagueId }] }));
  assert.deepEqual((await api.detail(fixture.id)).history, [entry]);
  for (const history of [null, [{ ...entry, occurredAt: "fecha inválida" }], [{ ...entry, action: "DELETE" }]]) {
    const invalid = createReviewApi(async () => Response.json({ ...fixture, history }));
    await assert.rejects(invalid.detail(fixture.id), /invalid-response/);
  }
});

test("firmas: consulta explícita, enlace temporal privado y limpieza al perder permiso", async () => {
  let requests = 0;
  const { controller } = await selected({ signature: async () => {
    if (++requests > 1) throw new ReviewApiError("forbidden");
    return { downloadUrl: "https://storage.example.test/storage/v1/object/sign/firmas-afiliacion/fixture?token=synthetic", expiresInSeconds: 60 };
  } });
  assert.match(html(controller), /Directivos y firmas privadas/);
  assert.doesNotMatch(html(controller), /token=synthetic/);
  await controller.signature(leagueId); assert.equal(requests, 0);
  await controller.signature(fixture.officers[0].signatureFileId!);
  assert.match(html(controller), /Descargar firma de presidente/);
  assert.match(html(controller), /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/);
  controller.clearDownload(); assert.doesNotMatch(html(controller), /token=synthetic/);
  await controller.signature(fixture.officers[0].signatureFileId!);
  assert.equal(controller.getSnapshot().detail, null);
  assert.doesNotMatch(html(controller), /Persona sintética|token=synthetic/);
});

test("un enlace atrasado no reaparece tras cambiar la consulta", async () => {
  let finish!: (value: { downloadUrl: string; expiresInSeconds: number }) => void;
  const { controller } = await selected({ signature: () => new Promise(resolve => { finish = resolve; }) });
  const pending = controller.signature(fixture.officers[0].signatureFileId!);
  await controller.load(leagueId);
  finish({ downloadUrl: "https://storage.example.test/storage/v1/object/sign/firmas-afiliacion/stale", expiresInSeconds: 60 });
  await pending; assert.equal(controller.getSnapshot().download, null);
});

test("adaptador de firmas usa el endpoint privado y rechaza enlaces o vigencias inválidos", async () => {
  const id = fixture.officers[0].signatureFileId!;
  const api = createReviewApi(async (path, init) => {
    assert.equal(path, "/api/affiliations/signatures/download");
    assert.equal(init?.method, "POST"); assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(init?.body)), { signatureFileId: id });
    return Response.json({ downloadUrl: "https://storage.example.test/storage/v1/object/sign/firmas-afiliacion/file?token=synthetic", expiresInSeconds: 60 });
  });
  assert.equal((await api.signature(id)).expiresInSeconds, 60);
  for (const body of [{ downloadUrl: "javascript:alert(1)", expiresInSeconds: 60 },
    { downloadUrl: "https://storage.example.test/public/file", expiresInSeconds: 60 },
    { downloadUrl: "https://storage.example.test/storage/v1/object/sign/firmas-afiliacion/file", expiresInSeconds: 120 }]) {
    await assert.rejects(createReviewApi(async () => Response.json(body)).signature(id), /invalid-response/);
  }
});

async function selected(overrides: Partial<ReviewApi> = {}) {
  const value = setup(overrides);
  await value.controller.load(leagueId); await value.controller.open(fixture.id);
  value.controller.category(categoryId, true);
  return value;
}

test("autorización exige selección explícita, congela confirmación y limpia al cambiar de detalle", async () => {
  const { controller } = setup();
  await controller.load(leagueId); await controller.open(fixture.id);
  assert.deepEqual(controller.getSnapshot().selectedCategoryIds, []);
  controller.category(leagueId, true);
  await controller.submit("APPROVE");
  assert.equal(controller.getSnapshot().confirming, false);
  assert.match(html(controller), /Selecciona al menos una categoría/);
  controller.category(categoryId, true);
  await controller.submit("APPROVE");
  assert.match(html(controller), /Se autorizarán estas categorías: Categoría de prueba/);
  controller.category(categoryId, false);
  assert.deepEqual(controller.getSnapshot().selectedCategoryIds, [categoryId]);
  controller.cancel(); controller.category(categoryId, false);
  assert.deepEqual(controller.getSnapshot().selectedCategoryIds, []);
  controller.category(categoryId, true);
  await controller.open(fixture.id);
  assert.deepEqual(controller.getSnapshot().selectedCategoryIds, []);
});

test("consulta: carga, vacío, error y acceso denegado con datos privados retirados", async () => {
  let finish!: (items: []) => void;
  const { controller } = setup({ list: () => new Promise(resolve => { finish = resolve; }) });
  const pending = controller.load(leagueId);
  assert.match(html(controller), /Cargando solicitudes/); finish([]); await pending;
  assert.match(html(controller), /No hay solicitudes pendientes/);
  const denied = await selected({ review: async () => { throw new ReviewApiError("forbidden"); } });
  await denied.controller.submit("APPROVE"); await denied.controller.confirmApproval();
  assert.match(html(denied.controller), /Acceso denegado/);
  assert.doesNotMatch(html(denied.controller), /Club sintético|Azul sintético/);
  const unavailable = setup({ list: async () => { throw new Error(); } });
  await unavailable.controller.load(leagueId); assert.match(html(unavailable.controller), /No se pudieron cargar las solicitudes. Intenta consultar nuevamente./);
  assert.doesNotMatch(html(unavailable.controller), /antes de reenviarla/);
});

test("detalle distingue estado PENDING, fase y observaciones; correcciones requieren texto", async () => {
  const { controller, calls } = await selected();
  assert.match(html(controller), /Estado de aprobación/); assert.match(html(controller), /Fase de revisión/);
  await controller.submit("REQUEST_CORRECTIONS");
  assert.match(html(controller), /Escribe las observaciones/); assert.equal(calls.length, 2);
  controller.observations("Corregir categoría sintética"); await controller.submit("REQUEST_CORRECTIONS");
  assert.equal(controller.getSnapshot().detail?.status, "PENDING");
  assert.equal(controller.getSnapshot().detail?.reviewPhase, "CORRECTIONS_REQUESTED");
  assert.match(controller.getSnapshot().message, /confirmada por el servidor/);
});

test("aprobar exige confirmación, permite cancelar y bloquea envíos duplicados", async () => {
  let finish!: (value: ReviewDetail) => void;
  let writes = 0;
  const { controller } = await selected({ review: () => { writes++; return new Promise(resolve => { finish = resolve; }); } });
  await controller.submit("APPROVE"); assert.equal(writes, 0);
  assert.match(html(controller), /Confirmar aprobación/);
  controller.cancel(); assert.equal(controller.getSnapshot().confirming, false);
  await controller.submit("APPROVE"); const pending = controller.confirmApproval();
  assert.equal(writes, 1); assert.equal(controller.getSnapshot().submitting, true);
  await controller.submit("APPROVE"); await controller.submit("REQUEST_CORRECTIONS");
  await controller.load(leagueId); await controller.open(fixture.id); assert.equal(writes, 1);
  assert.doesNotMatch(controller.getSnapshot().message, /confirmada/);
  finish({ ...fixture, status: "APPROVED", reviewPhase: null }); await pending;
  assert.equal(controller.getSnapshot().submitting, false);
  assert.match(html(controller), /Aprobación confirmada por el servidor/);
  assert.doesNotMatch(html(controller), />Aprobar solicitud</);
});

test("409 vuelve a consultar detalle y bandeja y muestra el resultado de otra persona", async () => {
  let reads = 0; let lists = 0;
  const { controller } = await selected({
    list: async () => { lists++; return lists === 1 ? [fixture] : []; },
    detail: async () => { reads++; return reads === 1 ? fixture : { ...fixture, status: "APPROVED", reviewPhase: null }; },
    review: async () => { throw new ReviewApiError("conflict"); },
  });
  await controller.submit("APPROVE"); await controller.confirmApproval();
  assert.equal(reads, 2); assert.equal(lists, 2);
  assert.equal(controller.getSnapshot().detail?.status, "APPROVED");
  assert.match(html(controller), /Otra persona ya revisó/);
  assert.doesNotMatch(html(controller), /Aprobación confirmada por el servidor/);
});

test("401 tras envío retira detalle y ofrece login; un fallo de red no anuncia éxito", async () => {
  for (const kind of ["unauthenticated", "unavailable"] as const) {
    const { controller } = await selected({ review: async () => { throw new ReviewApiError(kind); } });
    await controller.submit("APPROVE"); await controller.confirmApproval();
    assert.doesNotMatch(controller.getSnapshot().message, /confirmada/);
    assert.equal(controller.getSnapshot().error, kind);
    if (kind === "unauthenticated") assert.match(html(controller), /href="\/login"/);
  }
});

test("una respuesta atrasada de otra liga no reemplaza la consulta actual", async () => {
  let finish!: (items: ReviewDetail[]) => void;
  const { controller } = setup({ list: id => id === leagueId ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([]) });
  const first = controller.load(leagueId);
  await controller.load("61000000-0000-4000-8000-000000000003");
  finish([fixture]); await first;
  assert.deepEqual(controller.getSnapshot().items, []);
});

test("sin capacidades del servidor no permite acciones", async () => {
  let writes = 0;
  const { controller } = await selected({ detail: async () => ({ ...fixture, allowedActions: [] }),
    review: async () => { writes++; return fixture; } });
  await controller.submit("APPROVE"); await controller.submit("REQUEST_CORRECTIONS");
  assert.equal(writes, 0); assert.match(html(controller), /No hay acciones/);
});

test("adaptador usa rutas acordadas, PATCH JSON, cookies del origen y no-store", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  let approved = false;
  const request: typeof fetch = async (path, init) => {
    calls.push({ path: String(path), init });
    if (init?.method === "PATCH") approved = true;
    return Response.json(String(path).includes("?") ? { items: [fixture], page: 1, pageSize: 100, hasMore: false } :
      approved ? { ...fixture, status: "APPROVED", reviewPhase: null, version: 1 } : fixture);
  };
  const api = createReviewApi(request);
  await api.list(leagueId); await api.detail(fixture.id); await api.review(fixture.id, "APPROVE", "  Nota  ", 0, [categoryId]);
  assert.equal(calls[0].path, `/api/affiliations?status=PENDING&leagueId=${leagueId}&page=1&pageSize=100`);
  assert.equal(calls[1].path, `/api/affiliations/${fixture.id}`);
  assert.equal(calls[2].path, `/api/affiliations/${fixture.id}/review`);
  assert.equal(calls[2].init?.method, "PATCH");
  assert.equal(calls[2].init?.body, JSON.stringify({ decision: "APPROVE", expectedVersion: 0, authorizedCategoryIds: [categoryId] }));
  assert.equal(calls[3].path, `/api/affiliations/${fixture.id}`);
  for (const call of calls) { assert.equal(call.init?.cache, "no-store"); assert.equal(call.init?.credentials, "same-origin"); }
});

test("PATCH de correcciones envía versión y observaciones recortadas", async () => {
  let body: RequestInit["body"];
  const api = createReviewApi(async (_path, init) => {
    if (init?.method === "PATCH") body = init.body;
    return Response.json({ ...fixture, reviewPhase: "CORRECTIONS_REQUESTED", version: 1 });
  });
  await api.review(fixture.id, "REQUEST_CORRECTIONS", "  Corregir categoría sintética  ", 0);
  assert.equal(body, JSON.stringify({ decision: "REQUEST_CORRECTIONS", observations: "Corregir categoría sintética", expectedVersion: 0 }));
});

test("adaptador rechaza respuestas incompletas, otra liga y éxito sin resultado confirmado", async () => {
  for (const value of [{}, { items: [{ ...fixture, leagueId: "61000000-0000-4000-8000-000000000003" }] }, { items: [{ ...fixture, reviewPhase: null }] }]) {
    const api = createReviewApi(async () => Response.json(value));
    await assert.rejects(api.list(leagueId), (e: unknown) => e instanceof ReviewApiError && e.kind === "invalid-response");
  }
  const api = createReviewApi(async () => Response.json(fixture));
  await assert.rejects(api.review(fixture.id, "APPROVE", "", 0), /invalid-response/);
});

test("adaptador reconoce 401, 403 y el código exacto de conflicto", async () => {
  for (const [status, code, kind] of [[401, "UNAUTHENTICATED", "unauthenticated"], [403, "FORBIDDEN", "forbidden"],
    [409, "AFFILIATION_ALREADY_REVIEWED", "conflict"], [409, "OTHER", "unavailable"]] as const) {
    const api = createReviewApi(async () => Response.json({ code }, { status }));
    await assert.rejects(api.detail(fixture.id), (e: unknown) => e instanceof ReviewApiError && e.kind === kind);
  }
});

test("el controlador envía la versión leída y un conflicto exige consultar otra vez", async () => {
  let expected: number | undefined;
  const { controller } = await selected({ detail: async () => ({ ...fixture, version: 7 }),
    review: async (_id, _action, _observations, version) => { expected = version; throw new ReviewApiError("conflict"); } });
  await controller.submit("APPROVE"); await controller.confirmApproval();
  assert.equal(expected, 7);
  for (const code of ["STALE_AFFILIATION", "CORRECTIONS_PENDING", "SEASON_CLOSED"]) {
    const api = createReviewApi(async () => Response.json({ code }, { status: 409 }));
    await assert.rejects(api.review(fixture.id, "APPROVE", "", 7), /conflict/);
  }
});

test("la bandeja consulta todas las páginas y rechaza resultados repetidos", async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ ...fixture,
    id: `61000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}` }));
  const pages: number[] = [];
  const api = createReviewApi(async (path) => {
    const page = Number(new URL(String(path), "http://localhost").searchParams.get("page")); pages.push(page);
    return Response.json({ items: page === 1 ? items : [fixture], page, pageSize: 100, hasMore: page === 1 });
  });
  assert.equal((await api.list(leagueId)).length, 101);
  assert.deepEqual(pages, [1, 2]);
  const duplicated = createReviewApi(async () => Response.json({ items: [fixture, fixture], page: 1, pageSize: 100, hasMore: false }));
  await assert.rejects(duplicated.list(leagueId), /invalid-response/);
});


test("405 o formato inesperado del listado muestran solo error de lectura", async () => {
  for (const response of [() => new Response(null, { status: 405 }), () => Response.json({ unexpected: true })]) {
    const controller = createReviewController(createReviewApi(async () => response()));
    await controller.load(leagueId);
    assert.match(html(controller), /No se pudieron cargar las solicitudes. Intenta consultar nuevamente./);
    assert.doesNotMatch(html(controller), /antes de reenviarla/);
  }
});

test("solo un PATCH no confirmado muestra la advertencia de verificar antes de reenviar", async () => {
  for (const kind of ["unavailable", "invalid-response"] as const) {
    const { controller } = await selected({ review: async () => { throw new ReviewApiError(kind); } });
    await controller.submit("APPROVE");
    assert.doesNotMatch(html(controller), /antes de reenviarla/);
    await controller.confirmApproval();
    assert.match(html(controller), /Verifica el estado de la solicitud antes de reenviarla/);
    assert.doesNotMatch(html(controller), /Aprobación confirmada/);
    await controller.load(leagueId);
    assert.doesNotMatch(html(controller), /antes de reenviarla/);
  }
});

test("fallo de detalle sin PATCH no advierte sobre un envío incierto", async () => {
  const { controller } = setup({ detail: async () => { throw new ReviewApiError("unavailable"); } });
  await controller.load(leagueId); await controller.open(fixture.id);
  assert.match(html(controller), /No se pudo cargar el detalle/);
  assert.doesNotMatch(html(controller), /antes de reenviarla/);
});

test("fallo al refrescar tras PATCH confirmado conserva confirmación y muestra error de listado", async () => {
  let lists = 0;
  const { controller } = await selected({ list: async () => {
    if (++lists > 1) throw new ReviewApiError("unavailable");
    return [fixture];
  } });
  await controller.submit("APPROVE"); await controller.confirmApproval();
  assert.match(html(controller), /Aprobación confirmada por el servidor/);
  assert.match(html(controller), /No se pudieron cargar las solicitudes. Intenta consultar nuevamente./);
  assert.doesNotMatch(html(controller), /antes de reenviarla/);
});

test("fallo al reconsultar tras 409 es de lectura y no un PATCH incierto", async () => {
  let reads = 0;
  const { controller } = await selected({
    detail: async () => { if (++reads > 1) throw new ReviewApiError("unavailable"); return fixture; },
    review: async () => { throw new ReviewApiError("conflict"); },
  });
  await controller.submit("APPROVE"); await controller.confirmApproval();
  assert.match(html(controller), /No se pudo cargar el detalle/);
  assert.doesNotMatch(html(controller), /antes de reenviarla/);
});
