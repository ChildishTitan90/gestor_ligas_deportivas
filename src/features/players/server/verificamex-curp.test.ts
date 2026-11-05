import assert from "node:assert/strict";
import test from "node:test";
import { createVerificamexCurpAdapter } from "./verificamex-curp";
import { curpVerificationRequestSchema } from "../curp-verification";
import { readCurpVerificationBody } from "./curp-verification-http";

// Todo el transporte es sintético. Ninguna prueba importa o utiliza credenciales reales.
const identity = { curp: "GARA000229HMNRZLA6", firstName: "Álvaro", paternalSurname: "García",
  maternalSurname: "Ruiz", birthDate: "2000-02-29" };
const citizen = { curp: identity.curp, nombres: "ALVARO", primerApellido: "GARCIA", segundoApellido: "RUIZ",
  fechaNacimiento: "2000-02-29", datosDocProbatorio: { numActa: "SYNTHETIC-DO-NOT-PERSIST" } };
const payload = (records: unknown[] = [citizen], status = true, codigo = 0) => ({ data: {
  object: "citizeninformations", citizen: { status, codigo, registros: records }, pdf: "SYNTHETIC-UNREQUESTED-PDF" } });
const adapter = (transport: typeof fetch, timeoutMs?: number) => createVerificamexCurpAdapter({
  apiKey: "synthetic-key-not-a-real-secret", transport, timeoutMs });

test("VMX sintético: POST exacto, sin PDF/webhook y resultado mínimo", async () => {
  let calls = 0;
  const client = adapter(async (url, init) => {
    calls++;
    assert.equal(url, "https://api.verificamex.com/identity/v1/scraping/renapo");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-key-not-a-real-secret");
    assert.deepEqual(JSON.parse(String(init?.body)), { curp: identity.curp, pdf_required: false });
    return Response.json(payload());
  });
  assert.deepEqual(await client.verify(identity), { status: "VERIFIED", mismatchedFields: [] });
  assert.equal(calls, 1);
});

test("VMX sintético: sin configuración no envía solicitudes ni simula éxito", async () => {
  let calls = 0;
  const client = createVerificamexCurpAdapter({ apiKey: undefined, transport: async () => { calls++; throw Error("No network"); } });
  assert.equal(client.configured, false);
  await assert.rejects(client.verify(identity), { message: "VMX_NOT_CONFIGURED" });
  assert.equal(calls, 0);
});

test("VMX sintético: una persona sin segundo apellido puede contrastarse", async () => {
  const singleSurname = { ...identity, maternalSurname: null };
  assert.equal((await adapter(async () => Response.json(payload([{ ...citizen, segundoApellido: "" }]))).verify(singleSurname)).status, "VERIFIED");
});

test("VMX sintético: HTTP 200 no basta; conserva errores y discrepancias distintos", async () => {
  const cases: [unknown, string][] = [
    [payload([]), "NOT_FOUND"], [payload([], false, 1), "UNEXPECTED_RESPONSE"],
    [payload([citizen], true, 5), "UNEXPECTED_RESPONSE"],
    [payload([citizen, citizen]), "UNEXPECTED_RESPONSE"], [{ verified: true }, "UNEXPECTED_RESPONSE"],
    [payload([{ ...citizen, fechaNacimiento: "2000-02-30" }]), "UNEXPECTED_RESPONSE"],
    [payload([{ ...citizen, nombres: "OTRA PERSONA" }]), "DISCREPANCY"],
  ];
  for (const [body, expected] of cases)
    assert.equal((await adapter(async () => Response.json(body)).verify(identity)).status, expected);
  const mismatched = await adapter(async () => Response.json(payload([{ ...citizen,
    nombres: "OTRO", primerApellido: "APELLIDO", segundoApellido: "DISTINTO", fechaNacimiento: "2000-03-01" }]))).verify(identity);
  assert.deepEqual(mismatched.mismatchedFields, ["firstName", "paternalSurname", "maternalSurname", "birthDate"]);
  assert.equal(JSON.stringify(mismatched).includes("OTRO"), false);
});

test("VMX sintético: credenciales, saldo, indisponibilidad y JSON inesperado", async () => {
  for (const [status, expected] of [[401, "INVALID_CREDENTIALS"], [403, "INVALID_CREDENTIALS"],
    [402, "INSUFFICIENT_BALANCE"], [429, "UNAVAILABLE"], [503, "UNAVAILABLE"], [422, "UNEXPECTED_RESPONSE"]] as const)
    assert.equal((await adapter(async () => Response.json({ message: "SYNTHETIC-PRIVATE-DETAIL" }, { status })).verify(identity)).status, expected);
  for (const response of [new Response("<html>not JSON</html>"),
    new Response("{broken", { headers: { "Content-Type": "application/json" } }),
    new Response(JSON.stringify({ unwanted: "x".repeat(140_000) }), { headers: { "Content-Type": "application/json" } })])
    assert.equal((await adapter(async () => response).verify(identity)).status, "UNEXPECTED_RESPONSE");
});

test("VMX sintético: red y tiempo de espera son inciertos y no disparan reintentos", async () => {
  let calls = 0;
  const failed = adapter(async () => { calls++; throw Error("SYNTHETIC secret and identity must not escape"); });
  assert.deepEqual(await failed.verify(identity), { status: "UNCERTAIN", mismatchedFields: [] });
  assert.equal(calls, 1);
  let signal: AbortSignal | null | undefined;
  const timedOut = adapter(async (_url, init) => { calls++; signal = init?.signal; return new Promise<Response>(() => {}); }, 15);
  assert.equal((await timedOut.verify(identity)).status, "UNCERTAIN");
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 2);
});

test("contrato de intención rechaza verificado, actor, CURP y cambios de autoridad", () => {
  const valid = { operationKey: "00000000-0000-4000-8000-000000000001", identityVersion: 1, confirmCharge: true };
  assert.equal(curpVerificationRequestSchema.safeParse(valid).success, true);
  for (const field of ["curp", "verified", "actorId", "clubId", "status", "apiKey"])
    assert.equal(curpVerificationRequestSchema.safeParse({ ...valid, [field]: "forged" }).success, false);
  assert.equal(curpVerificationRequestSchema.safeParse({ ...valid, confirmCharge: false }).success, false);
});

test("HTTP local: origen, tipo y tamaño antes de admitir una consulta con costo", async () => {
  const origin = new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000").origin;
  const request = (headers: Record<string, string>, body = "{}") => new Request(`${origin}/api/example`, { method: "POST", headers, body });
  const denied = await readCurpVerificationBody(request({ "Content-Type": "application/json", Origin: "https://foreign.example.test" }));
  assert.ok(denied instanceof Response); assert.equal(denied.status, 403);
  const oversized = await readCurpVerificationBody(request({ "Content-Type": "application/json", Origin: origin }, "x".repeat(2049)));
  assert.ok(oversized instanceof Response); assert.equal(oversized.status, 413);
  assert.deepEqual(await readCurpVerificationBody(request({ "Content-Type": "application/json", Origin: origin })), {});
});
