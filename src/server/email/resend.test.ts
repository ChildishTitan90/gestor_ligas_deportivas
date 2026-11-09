import assert from "node:assert/strict";
import test from "node:test";
import { createResendEmailTransport, resendConfiguration } from "./resend";
import type { AccountEmail } from "./transport";

const config = { apiKey: "synthetic-not-a-provider-key", from: "ligas@example.test", origin: "https://ligas.example.test" };
const message: AccountEmail = { kind: "ADMINISTRATIVE_RESET", to: "person@example.test", temporaryPassword: "synthetic-secret", expiresAt: new Date("2026-11-09T12:00:00Z"), idempotencyKey: "operation-1" };
test("sin activación/configuración completa no hay transporte; rechaza origen o remitente inseguros", () => {
  const env = { ACCOUNT_EMAIL_ENABLED: "true", ACCOUNT_EMAIL_PROVIDER: "resend", RESEND_API_KEY: config.apiKey, ACCOUNT_EMAIL_FROM: config.from, NEXTAUTH_URL: config.origin };
  assert.deepEqual(resendConfiguration(env), config);
  for (const field of Object.keys(env)) assert.equal(resendConfiguration({ ...env, [field]: undefined }), null);
  for (const origin of ["http://example.test", "https://user:pass@example.test", "https://example.test/path", "https://example.test/?token=secret"]) assert.equal(resendConfiguration({ ...env, NEXTAUTH_URL: origin }), null);
  assert.equal(resendConfiguration({ ...env, ACCOUNT_EMAIL_FROM: "a@example.test\r\nBcc:b@example.test" }), null);
});
test("contrato HTTP fijo, secreto solo en cuerpo, idempotencia estable y aceptación sin acreditar recepción", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const request: typeof fetch = async (url, init) => { calls.push({ url: String(url), init: init! }); return Response.json({ id: "synthetic-id" }); };
  const transport = createResendEmailTransport(config, request);
  assert.equal(await transport.send(message), "ACCEPTED");
  const { url, init } = calls[0], body = JSON.parse(String(init.body));
  assert.equal(url, "https://api.resend.com/emails"); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
  assert.equal(new Headers(init.headers).get("Idempotency-Key"), message.idempotencyKey);
  assert.deepEqual(body.to, [message.to]); assert.equal(body.from, config.from);
  assert.ok(body.text.includes(message.temporaryPassword)); assert.equal(url.includes(message.temporaryPassword), false);
  assert.equal(calls.length, 1);
});
test("rechazos, rate limit, error, respuesta ambigua, timeout y red no reenvían ni filtran excepciones", async () => {
  for (const status of [400,401,403,422,408,409,429,500,503]) {
    let calls=0; const t=createResendEmailTransport(config,async()=>{calls++;return Response.json({name:"synthetic-error"},{status});});
    assert.equal(await t.send(message),[400,401,403,422].includes(status)?"FAILED":"UNKNOWN"); assert.equal(calls,1);
  }
  for (const response of [Response.json({}),new Response("bad-json",{status:200})]) assert.equal(await createResendEmailTransport(config,async()=>response).send(message),"UNKNOWN");
  for (const name of ["TimeoutError","TypeError"]) {
    let calls=0; assert.equal(await createResendEmailTransport(config,async()=>{calls++;throw new DOMException(message.temporaryPassword,name);}).send(message),"UNKNOWN");assert.equal(calls,1);
  }
});
test("confirmación lleva token solo en fragmento; avisos no incluyen credenciales", async () => {
  const bodies: {text:string}[]=[];
  const t=createResendEmailTransport(config,async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return Response.json({id:"synthetic-id"});});
  await t.send({kind:"EMAIL_CHANGE_CONFIRMATION",to:message.to,token:"synthetic/token",expiresAt:message.expiresAt,idempotencyKey:"change:confirm"});
  const link=bodies[0].text.match(/https:\/\/\S+/)![0],url=new URL(link);
  assert.equal(url.search,"");assert.equal(new URLSearchParams(url.hash.slice(1)).get("token"),"synthetic/token");
  for(const kind of ["EMAIL_CHANGE_REQUESTED","EMAIL_CHANGE_COMPLETED"] as const)await t.send({kind,to:message.to,idempotencyKey:kind});
  assert.ok(bodies.slice(1).every(b=>!b.text.includes(message.temporaryPassword)&&!b.text.includes("synthetic/token")));
});

test("destino inválido o clave de operación inválida no realizan ninguna petición", async () => {
  let calls = 0;
  const transport = createResendEmailTransport(config, async () => { calls++; return Response.json({ id: "synthetic-id" }); });
  for (const to of ["", "not-an-address", "user@example.test\r\nBcc:other@example.test", "Other <other@example.test>"])
    assert.equal(await transport.send({ ...message, to }), "FAILED");
  for (const idempotencyKey of ["", "x".repeat(257), "operation\r\ninjected"])
    assert.equal(await transport.send({ ...message, idempotencyKey }), "FAILED");
  assert.equal(calls, 0);
});

test("desactivación explícita, proveedor ajeno y rechazos HTTP restantes no activan ni reintentan", async () => {
  const env = { ACCOUNT_EMAIL_ENABLED: "true", ACCOUNT_EMAIL_PROVIDER: "resend", RESEND_API_KEY: config.apiKey, ACCOUNT_EMAIL_FROM: config.from, NEXTAUTH_URL: config.origin };
  for (const patch of [{ ACCOUNT_EMAIL_ENABLED: "false" }, { ACCOUNT_EMAIL_PROVIDER: "other" }, { RESEND_API_KEY: "  " }, { NEXTAUTH_URL: config.origin + "/#fragment" }])
    assert.equal(resendConfiguration({ ...env, ...patch }), null);
  for (const status of [404, 405, 413]) {
    let calls = 0;
    const transport = createResendEmailTransport(config, async () => { calls++; return Response.json({ name: "synthetic-error" }, { status }); });
    assert.equal(await transport.send(message), "FAILED");
    assert.equal(calls, 1);
  }
});
