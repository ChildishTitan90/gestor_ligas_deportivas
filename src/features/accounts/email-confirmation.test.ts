import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { confirmEmailToken, readEmailConfirmationFragment } from "./email-confirmation.client";

const token = `ec1_${randomBytes(32).toString("base64url")}`;
test("solo acepta un token válido en fragmento; rechaza ausente, ambiguo y propósito ajeno", () => {
  assert.equal(readEmailConfirmationFragment(`#token=${encodeURIComponent(token)}`) === token, true);
  for (const fragment of ["", "#", "#token=incorrecto", `#token=${token}&token=${token}`, `#token=${token}&email=other`, "#token=sid_synthetic"])
    assert.equal(readEmailConfirmationFragment(fragment), null);
});
test("confirmación usa POST explícito sin token en URL/referrer ni cookies", async () => {
  let calls = 0;
  const outcome = await confirmEmailToken(token, async (url, init) => {
    calls++; assert.equal(url, "/api/account-maintenance/email-change/confirm");
    assert.equal(init?.method, "POST"); assert.equal(init?.credentials, "omit");
    assert.equal(init?.referrerPolicy, "no-referrer"); assert.equal(init?.cache, "no-store");
    assert.equal(JSON.parse(String(init?.body)).token === token, true);
    return Response.json({ status: "CONFIRMED", sessionsRevoked: true });
  });
  assert.equal(outcome, "confirmed"); assert.equal(calls, 1);
});
test("inválido, vencido, reemplazado o sin autoridad usa un resultado genérico", async () => {
  for (const status of [400, 403, 409]) assert.equal(await confirmEmailToken(token, async () => new Response("", { status })), "invalid");
});
test("red/5xx o acuse inválido no afirman éxito ni reintentan", async () => {
  for (const response of [() => { throw new Error("synthetic transport error"); }, () => new Response("", { status: 503 }),
    () => Response.json({ status: "CONFIRMED" }), () => new Response("not json")]) {
    let calls = 0;
    assert.equal(await confirmEmailToken(token, async () => { calls++; return response(); }), "uncertain");
    assert.equal(calls, 1);
  }
});
