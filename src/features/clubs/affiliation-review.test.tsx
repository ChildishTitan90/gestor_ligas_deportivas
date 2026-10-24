import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createReviewApi } from "./affiliation-review-adapter";
import { createReviewController } from "./affiliation-review-controller";
import { ReviewApiError, type ReviewApi, type ReviewDetail } from "./affiliation-review-model";
import { AffiliationReviewView } from "./components/affiliation-review-workspace";

// Exclusivamente fixtures de pruebas: nunca importadas por la página real.
const leagueId = "61000000-0000-4000-8000-000000000001";
const fixture: ReviewDetail = {
  id: "61000000-0000-4000-8000-000000000002", leagueId,
  referenceNumber: "TEST-61", clubName: "Club sintético", seasonName: "Temporada de prueba",
  status: "PENDING", reviewPhase: "AWAITING_REVIEW", uniformColors: "Azul sintético",
  categories: ["Categoría de prueba"], observations: null, allowedActions: ["APPROVE", "REQUEST_CORRECTIONS"],
};
function setup(overrides: Partial<ReviewApi> = {}) {
  const calls: string[] = [];
  const api: ReviewApi = {
    list: async () => { calls.push("list"); return [fixture]; },
    detail: async () => { calls.push("detail"); return fixture; },
    review: async (_id, action, observations) => {
      calls.push(`${action}:${observations}`);
      return { ...fixture, status: action === "APPROVE" ? "APPROVED" : "PENDING",
        reviewPhase: action === "APPROVE" ? null : "CORRECTIONS_REQUESTED" };
    }, ...overrides,
  };
  return { controller: createReviewController(api), calls };
}
function html(controller: ReturnType<typeof createReviewController>) {
  return renderToStaticMarkup(<AffiliationReviewView controller={controller} />);
}
async function selected(overrides: Partial<ReviewApi> = {}) {
  const value = setup(overrides);
  await value.controller.load(leagueId); await value.controller.open(fixture.id); return value;
}

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
  const request: typeof fetch = async (path, init) => {
    calls.push({ path: String(path), init });
    return Response.json(init?.method === "PATCH" ? { ...fixture, status: "APPROVED", reviewPhase: null } :
      String(path).includes("?") ? { items: [fixture] } : fixture);
  };
  const api = createReviewApi(request);
  await api.list(leagueId); await api.detail(fixture.id); await api.review(fixture.id, "APPROVE", "  Nota  ");
  assert.equal(calls[0].path, `/api/affiliations?status=PENDING&leagueId=${leagueId}`);
  assert.equal(calls[1].path, `/api/affiliations/${fixture.id}`);
  assert.equal(calls[2].path, `/api/affiliations/${fixture.id}/review`);
  assert.equal(calls[2].init?.method, "PATCH");
  assert.equal(calls[2].init?.body, JSON.stringify({ decision: "APPROVE" }));
  for (const call of calls) { assert.equal(call.init?.cache, "no-store"); assert.equal(call.init?.credentials, "same-origin"); }
});

test("PATCH de correcciones envía exactamente decision y observaciones recortadas", async () => {
  let body: RequestInit["body"];
  const api = createReviewApi(async (_path, init) => {
    body = init?.body;
    return Response.json({ ...fixture, reviewPhase: "CORRECTIONS_REQUESTED" });
  });
  await api.review(fixture.id, "REQUEST_CORRECTIONS", "  Corregir categoría sintética  ");
  assert.equal(body, JSON.stringify({ decision: "REQUEST_CORRECTIONS", observations: "Corregir categoría sintética" }));
});

test("adaptador rechaza respuestas incompletas, otra liga y éxito sin resultado confirmado", async () => {
  for (const value of [{}, { items: [{ ...fixture, leagueId: "61000000-0000-4000-8000-000000000003" }] }, { items: [{ ...fixture, reviewPhase: null }] }]) {
    const api = createReviewApi(async () => Response.json(value));
    await assert.rejects(api.list(leagueId), (e: unknown) => e instanceof ReviewApiError && e.kind === "invalid-response");
  }
  const api = createReviewApi(async () => Response.json(fixture));
  await assert.rejects(api.review(fixture.id, "APPROVE", ""), /invalid-response/);
});

test("adaptador reconoce 401, 403 y el código exacto de conflicto", async () => {
  for (const [status, code, kind] of [[401, "UNAUTHENTICATED", "unauthenticated"], [403, "FORBIDDEN", "forbidden"],
    [409, "AFFILIATION_ALREADY_REVIEWED", "conflict"], [409, "OTHER", "unavailable"]] as const) {
    const api = createReviewApi(async () => Response.json({ code }, { status }));
    await assert.rejects(api.detail(fixture.id), (e: unknown) => e instanceof ReviewApiError && e.kind === kind);
  }
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
