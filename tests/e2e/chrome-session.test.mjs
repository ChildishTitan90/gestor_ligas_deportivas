import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { bounded, closeTestServer, launchChrome, waitForTestDone } from './chrome-session.mjs';

async function fixture(t, html, options = {}) {
  const server = createServer((request, response) => response.end(html));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => closeTestServer(server));
  const browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, { signal: t.signal, commandTimeoutMs: 15000, waitForDocument: true, ...options });
  t.after(() => browser.close());
  return browser;
}
test('Chrome: arranque JS roto se informa sin esperar indefinidamente testDone', { timeout: 15000 }, async t => {
  const browser = await fixture(t, '<script>window.testFailure="Uncaught ReferenceError: process is not defined"</script>');
  await assert.rejects(waitForTestDone(browser), /process is not defined/);
});
test('Chrome: CDP sin respuesta vence, retira la orden y permite cerrar', { timeout: 15000 }, async t => {
  const browser = await fixture(t, '<p>fixture</p>', { commandTimeoutMs: 300 });
  // Wait for this page before creating a deliberately unresolved browser promise.
  await browser.evaluate('document.readyState');
  await assert.rejects(browser.evaluate('new Promise(()=>{})'), /Runtime.evaluate.*300 ms/);
  assert.equal(await browser.evaluate('1+1'), 2);
  await browser.close(); await browser.close();
  await assert.rejects(browser.evaluate('1+1'), /conexión no disponible/);
});
test('Chrome: cancelar una prueba interrumpe la espera y cierra solo su navegador', { timeout: 15000 }, async t => {
  const controller = new AbortController();
  const browser = await fixture(t, '<p>fixture</p>', { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 150);
  try { await assert.rejects(browser.evaluate('new Promise(()=>{})'), /cancelado|cerrado/); }
  finally { clearTimeout(timer); await browser.close(); }
});
test('Servidor sintético: cierra conexiones activas incluso si una respuesta no termina', { timeout: 5000 }, async () => {
  let received;
  const started = new Promise(resolve => { received = resolve; });
  const server = createServer(() => received());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const response = fetch(`http://127.0.0.1:${server.address().port}`, { signal: AbortSignal.timeout(2000) });
  const failed = assert.rejects(response);
  try { await bounded(started, 1000, 'Servidor: petición recibida'); }
  finally { await closeTestServer(server); }
  await failed;
});
