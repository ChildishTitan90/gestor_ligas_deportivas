import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function sessionExit(csrf, fetch) {
  const source = readFileSync(new URL("./sign-out.client.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(code, { module: sandboxModule, exports: sandboxModule.exports, URLSearchParams, fetch,
    require(name) {
      assert.equal(name, "next-auth/react");
      return { getCsrfToken: csrf };
    },
  });
  return sandboxModule.exports.signOutCurrentSession;
}

test("sidebar y menú comparten el cierre pendiente sin duplicar CSRF ni POST", async () => {
  let release;
  let csrfReads = 0;
  const requests = [];
  const csrf = new Promise(resolve => { release = resolve; });
  const exit = sessionExit(() => { csrfReads++; return csrf; }, async (url, init) => {
    requests.push({ url, init });
    return { ok: true };
  });
  const sidebar = exit();
  const menu = exit();
  assert.equal(sidebar, menu);
  assert.equal(csrfReads, 1);
  release("synthetic-csrf");
  await Promise.all([sidebar, menu]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/auth/signout");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.credentials, "same-origin");
  assert.equal(requests[0].init.body.get("csrfToken"), "synthetic-csrf");
  assert.equal(requests[0].init.body.get("callbackUrl"), "/login");
});

test("un rechazo permite reintentar desde cualquiera de los dos accesos", async () => {
  let requests = 0;
  const exit = sessionExit(async () => "synthetic-csrf", async () => ({ ok: ++requests > 1 }));
  const first = exit();
  const second = exit();
  assert.equal(first, second);
  const failed = await Promise.allSettled([first, second]);
  assert.ok(failed.every(result => result.status === "rejected"));
  assert.equal(requests, 1);
  await exit();
  assert.equal(requests, 2);
});

test("sin CSRF no se envía el cierre y un nuevo intento puede recuperarse", async () => {
  let csrfReads = 0;
  let requests = 0;
  const exit = sessionExit(async () => ++csrfReads === 1 ? null : "synthetic-csrf", async () => {
    requests++;
    return { ok: true };
  });
  await assert.rejects(exit(), /SIGNOUT_FAILED/);
  assert.equal(requests, 0);
  await exit();
  assert.equal(requests, 1);
});
