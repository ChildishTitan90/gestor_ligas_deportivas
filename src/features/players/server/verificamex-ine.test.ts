import assert from "node:assert/strict";
import test from "node:test";
import { createVerificamexIneAdapter, getVerificamexIneProvider, type IneImages } from "./verificamex-ine";

// Datos artificiales; el transporte siempre se inyecta. Ninguna consulta al proveedor.
const image = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" as const, sizeBytes: 3, sha256: "0".repeat(64) };
const images: IneImages = { front: image, back: image, selfie: image };
test("INE sintética: contrato V2, QR desactivado y una sola consulta", async () => {
  let calls = 0;
  const adapter = createVerificamexIneAdapter({ apiKey: "synthetic-key", transport: async (url, options) => {
    calls++; assert.equal(url, "https://api.verificamex.com/identity/v2/validations/basic");
    assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store");
    assert.deepEqual(JSON.parse(options!.body as string), { ine_front: "data:image/png;base64,AQID", ine_back: "data:image/png;base64,AQID", selfie: "data:image/png;base64,AQID", qr_validation: false });
    return Response.json({ data: { object: "ine_validations", status: true, reporte: "https://example.test/private", documentInformation: {documentData:[{type:"Name",source:"OCR",value:"Sintético"},{type:"PersonalNumber",source:"MRZ",value:"0000000000000"},{type:"PermanentAddress",source:"OCR",value:"private synthetic address"}]} } });
  } });
  const result=await adapter.verify(images);
  assert.equal(result.status, "PROVIDER_PASSED"); assert.equal(calls, 1);
  assert.deepEqual(result.readings,[{field:"firstName",value:"Sintético"}]);
});
test("INE sintética: HTTP 200 por sí solo y diferencias nunca aprueban ni rechazan al jugador", async () => {
  for (const body of [{ data: { object: "ine_validations", status: false } }, {}, { data: { object: "wrong", status: true } }, { data: { object: "ine_validations", status: "true" } }]) {
    const provider = createVerificamexIneAdapter({ apiKey: "synthetic", transport: async () => Response.json(body) });
    assert.equal((await provider.verify(images)).status, "ADMIN_REVIEW_REQUIRED");
  }
});
test("INE sintética: errores de proveedor sin reintentos ni exposición del mensaje", async () => {
  for (const [code, expected] of [[401, "INVALID_CREDENTIALS"], [403, "INVALID_CREDENTIALS"], [402, "INSUFFICIENT_BALANCE"], [429, "UNAVAILABLE"], [503, "UNAVAILABLE"], [422, "ADMIN_REVIEW_REQUIRED"]] as const) {
    let calls = 0;
    const provider = createVerificamexIneAdapter({ apiKey: "synthetic", transport: async () => { calls++; return new Response("private synthetic", { status: code }); } });
    assert.equal((await provider.verify(images)).status, expected); assert.equal(calls, 1);
  }
});
test("INE sintética: timeout y fallo de red mantienen resultado incierto sin reintentar", async () => {
  let calls = 0;
  const timeout = createVerificamexIneAdapter({ apiKey: "synthetic", timeoutMs: 5, transport: async () => { calls++; return new Promise<Response>(() => {}); } });
  assert.equal((await timeout.verify(images)).status, "UNCERTAIN"); assert.equal(calls, 1);
  const failed = createVerificamexIneAdapter({ apiKey: "synthetic", transport: async () => { throw new Error("synthetic offline"); } });
  assert.equal((await failed.verify(images)).status, "UNCERTAIN");
});
test("INE sintética: respuesta demasiado grande se cancela sin conservar datos", async () => {
  const provider = createVerificamexIneAdapter({ apiKey: "synthetic", transport: async () => new Response("x".repeat(262145), { headers: { "content-type": "application/json" } }) });
  assert.equal((await provider.verify(images)).status, "ADMIN_REVIEW_REQUIRED");
});
test("INE: las suites aisladas bloquean el cableado real aunque exista una credencial", () => {
  const prior = process.env.AUTH_TEST_RUN; process.env.AUTH_TEST_RUN = "1";
  try { assert.throws(() => getVerificamexIneProvider(), /SYNTHETIC_TRANSPORT_REQUIRED/); }
  finally { if (prior === undefined) delete process.env.AUTH_TEST_RUN; else process.env.AUTH_TEST_RUN = prior; }
});
test("INE sintética: subvalidaciones negativas o desconocidas nunca se ignoran por status global true",async()=>{
  for(const check of [{result:"Failed",resultCode:3},{result:"Unknown",resultCode:99}]){
    const provider=createVerificamexIneAdapter({apiKey:"synthetic",transport:async()=>Response.json({data:{object:"ine_validations",status:true,documentInformation:{documentData:[],documentVerifications:[check]}}})});
    assert.equal((await provider.verify(images)).status,"ADMIN_REVIEW_REQUIRED");
  }
});
