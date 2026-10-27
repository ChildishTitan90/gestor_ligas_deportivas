import assert from "node:assert/strict";
import test from "node:test";
import { submitAffiliationRequest } from "./submit-affiliation.client";

function validSubmission() {
  const person = () => ({
    firstName: "Persona ficticia",
    paternalSurname: "Prueba",
    maternalSurname: "",
    signatureFileId: "550e8400-e29b-41d4-a716-446655440004",
  });

  return {
    submissionKey: "550e8400-e29b-41d4-a716-446655440000",
    clubId: "550e8400-e29b-41d4-a716-446655440001",
    seasonId: "550e8400-e29b-41d4-a716-446655440002",
    clubName: "Club sintético",
    uniformColors: "Azul y blanco",
    categoryIds: ["550e8400-e29b-41d4-a716-446655440003"],
    officers: {
      PRESIDENT: person(),
      SECRETARY: person(),
      TREASURER: person(),
    },
  };
}

function confirmedResponse(replayed = false) {
  return Response.json(
    {
      id: "550e8400-e29b-41d4-a716-446655440005",
      referenceNumber: "AFL-sintetico",
      status: "PENDING",
      replayed,
    },
    { status: replayed ? 200 : 201 },
  );
}

test("datos incompletos no provocan una petición", async () => {
  let requests = 0;

  const fetcher: typeof fetch = async () => {
    requests++;
    return confirmedResponse();
  };

  const outcome = await submitAffiliationRequest({}, fetcher);

  assert.equal(outcome.kind, "rejected");
  assert.equal(requests, 0);
});

test("envía al endpoint existente y reconoce una confirmación", async () => {
  const input = validSubmission();

  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(url, "/api/affiliations");
    assert.equal(options?.method, "POST");
    assert.equal(options?.credentials, "same-origin");
    assert.equal(options?.cache, "no-store");
    assert.equal(
      new Headers(options?.headers).get("content-type"),
      "application/json",
    );
    assert.deepEqual(JSON.parse(String(options?.body)), input);

    return confirmedResponse();
  };

  const outcome = await submitAffiliationRequest(input, fetcher);

  assert.equal(outcome.kind, "confirmed");

  if (outcome.kind === "confirmed") {
    assert.equal(outcome.result.referenceNumber, "AFL-sintetico");
    assert.equal(outcome.result.replayed, false);
  }
});

test("un rechazo de firmas devuelve un mensaje seguro", async () => {
  const fetcher: typeof fetch = async () =>
    Response.json(
      { code: "INVALID_SIGNATURE", internal: "Detalle privado" },
      { status: 400 },
    );

  const outcome = await submitAffiliationRequest(
    validSubmission(),
    fetcher,
  );

  assert.equal(outcome.kind, "rejected");

  if (outcome.kind === "rejected") {
    assert.match(outcome.message, /firma/i);
    assert.ok(!outcome.message.includes("Detalle privado"));
  }
});

test("un reintento conserva el cuerpo y recupera el mismo envío", async () => {
  const bodies: string[] = [];
  const input = validSubmission();

  const fetcher: typeof fetch = async (_url, options) => {
    bodies.push(String(options?.body));

    if (bodies.length === 1) {
      throw new TypeError("Respuesta perdida");
    }

    return confirmedResponse(true);
  };

  const first = await submitAffiliationRequest(input, fetcher);
  const second = await submitAffiliationRequest(input, fetcher);

  assert.equal(first.kind, "unconfirmed");
  assert.equal(second.kind, "confirmed");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);

  if (second.kind === "confirmed") {
    assert.equal(second.result.replayed, true);
  }
});

test("una respuesta inválida o un fallo del servidor no confirma éxito", async () => {
  const responses = [
    Response.json({ unexpected: true }, { status: 201 }),
    new Response("Respuesta no JSON", { status: 200 }),
    Response.json(
      { code: "SERVICE_UNAVAILABLE" },
      { status: 503 },
    ),
  ];

  for (const response of responses) {
    const fetcher: typeof fetch = async () => response;

    const outcome = await submitAffiliationRequest(
      validSubmission(),
      fetcher,
    );

    assert.equal(outcome.kind, "unconfirmed");
  }
});