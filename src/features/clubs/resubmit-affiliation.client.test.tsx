import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { resubmitAffiliationRequest } from "./resubmit-affiliation.client";
import { AffiliationForm } from "./components/affiliation-form";

const id = "62000000-0000-4000-8000-000000000001";
const signatureFileId = "62000000-0000-4000-8000-000000000002";
const person = { firstName: "Persona sintética", paternalSurname: "Prueba", maternalSurname: "", signatureFileId };
const input = { clubId: "62000000-0000-4000-8000-000000000003", seasonId: "62000000-0000-4000-8000-000000000004",
  submissionKey: "62000000-0000-4000-8000-000000000005", expectedVersion: 1,
  clubName: "Club sintético", uniformColors: "Blanco", categoryIds: ["62000000-0000-4000-8000-000000000006"],
  officers: { PRESIDENT: person, SECRETARY: person, TREASURER: person } };
const saved = { id, referenceNumber: "AFL-SINTETICO", status: "PENDING", replayed: false, version: 2, reviewPhase: "AWAITING_REVIEW" };

test("corregir usa PATCH y conserva folio, contexto, clave y versión en reintentos", async () => {
  const bodies: unknown[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, `/api/affiliations/${id}/resubmit`);
    assert.equal(init?.method, "PATCH"); assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "same-origin");
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) throw new Error("SYNTHETIC_NETWORK_FAILURE");
    return Response.json(saved);
  };
  assert.equal((await resubmitAffiliationRequest(id, input, request)).kind, "unconfirmed");
  const outcome = await resubmitAffiliationRequest(id, input, request);
  assert.equal(outcome.kind, "confirmed"); assert.deepEqual(bodies, [input, input]);
});

test("conflicto no reintenta ni cambia versión; 401/403 requieren volver a consultar", async () => {
  for (const status of [409, 401, 403]) {
    let writes = 0;
    const outcome = await resubmitAffiliationRequest(id, input, async () => { writes++; return Response.json({}, { status }); });
    assert.equal(outcome.kind, status === 409 ? "conflict" : "access-denied"); assert.equal(writes, 1);
  }
});

test("un acuse incompleto, de otra solicitud o sin la nueva versión no anuncia éxito", async () => {
  for (const body of [{}, { ...saved, id: signatureFileId }, { ...saved, version: 1 }, { ...saved, status: "APPROVED" }]) {
    assert.equal((await resubmitAffiliationRequest(id, input, async () => Response.json(body))).kind, "unconfirmed");
  }
  let requests = 0;
  assert.equal((await resubmitAffiliationRequest(id, {}, async () => { requests++; return Response.json(saved); })).kind, "rejected");
  assert.equal(requests, 0);
});

test("captura de corrección presenta los datos, observaciones y firmas registradas", () => {
  const markup = renderToStaticMarkup(<AffiliationForm categories={[{ id: input.categoryIds[0], name: "Categoría sintética" }]}
    initialValues={{ ...input, officers: { PRESIDENT: person, SECRETARY: person, TREASURER: person } }}
    submissionContext={{ actorId: id, clubId: input.clubId, seasonId: input.seasonId, storageOrigin: "https://storage.example.test" }}
    correction={{ id, expectedVersion: 1, submissionKey: input.submissionKey, referenceNumber: saved.referenceNumber,
      observations: "Precisar colores <script>no ejecutar</script>",
      signatureFileIds: { PRESIDENT: signatureFileId, SECRETARY: signatureFileId, TREASURER: signatureFileId } }} />);
  assert.match(markup, /AFL-SINTETICO/); assert.match(markup, /value="Club sintético"/);
  assert.match(markup, /Precisar colores &lt;script&gt;/); assert.doesNotMatch(markup, /<script>/);
  assert.equal((markup.match(/Firma registrada/g) ?? []).length, 3);
  assert.match(markup, /Reenviar correcciones/); assert.doesNotMatch(markup, /Solicitud registrada/);
});
