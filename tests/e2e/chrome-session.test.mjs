import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { bounded, closeTestServer, launchChrome, waitForTestDone } from './chrome-session.mjs';

async function fixture(t, html, options = {}) {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => closeTestServer(server));
  const browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, { signal: t.signal, commandTimeoutMs: 15000, waitForDocument: true, ...options });
  t.after(() => browser.close());
  return browser;
}
test('Chrome: arranque JS roto se informa sin esperar indefinidamente testDone', { timeout: 45000 }, async t => {
  const browser = await fixture(t, '<script>window.testFailure="Uncaught ReferenceError: process is not defined"</script>');
  await assert.rejects(waitForTestDone(browser), /process is not defined/);
});
test('Chrome: CDP sin respuesta vence, retira la orden y permite cerrar', { timeout: 45000 }, async t => {
  const browser = await fixture(t, '<p>fixture</p>');
  // Wait for this page before creating a deliberately unresolved browser promise.
  await browser.evaluate('document.readyState');
  await assert.rejects(browser.command('Runtime.evaluate', { expression:'new Promise(()=>{})', awaitPromise:true }, 300), /Runtime.evaluate.*300 ms/);
  assert.equal(await browser.evaluate('1+1'), 2);
  await browser.close(); await browser.close();
  await assert.rejects(browser.evaluate('1+1'), /conexión no disponible/);
});
test('Chrome: cancelar una prueba interrumpe la espera y cierra solo su navegador', { timeout: 45000 }, async t => {
  const controller = new AbortController();
  const browser = await fixture(t, '<p>fixture</p>', { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 150);
  try { await assert.rejects(browser.evaluate('new Promise(()=>{})'), /cancelado|cerrado/); }
  finally { clearTimeout(timer); await browser.close(); }
});
test('Chrome: devuelve el documento activo tras navegar y Tab conserva eventos nativos', { timeout: 45000 }, async t => {
  const browser = await fixture(t, '<input id="first"><input id="second"><script>window.activeAtScript=document.hasFocus();window.focusEvents=[];for(const type of ["keydown","blur","focusin"])document.addEventListener(type,event=>window.focusEvents.push({type:event.type,id:event.target.id,key:event.key??null,trusted:event.isTrusted,prevented:event.defaultPrevented}),true)</script>');
  assert.equal(await browser.evaluate('document.contentType'), 'text/html');
  const documentFocused = await browser.evaluate('document.hasFocus()');
  t.diagnostic(JSON.stringify({ focusedAtScript: await browser.evaluate('window.activeAtScript'), focusedWhenReady: documentFocused }));
  assert.equal(documentFocused, true, 'La página no está activa al comenzar las interacciones');
  assert.ok(browser.startup.pageConnectedMs <= browser.startup.pageActivatedMs);
  assert.ok(browser.startup.pageActivatedMs <= browser.startup.navigationRequestedMs);
  const { x, y } = await browser.evaluate('(()=>{const r=document.getElementById("first").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
  await browser.command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await browser.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  assert.equal(await browser.evaluate('document.activeElement.id'), 'first');
  for (const type of ['rawKeyDown', 'keyUp'])
    await browser.command('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await browser.evaluate('document.activeElement.id'), 'second');
  const events = await browser.evaluate('window.focusEvents');
  assert.ok(events.some(event => event.type === 'keydown' && event.id === 'first' && event.key === 'Tab' && event.trusted && !event.prevented));
  assert.ok(events.some(event => event.type === 'blur' && event.id === 'first' && event.trusted));
  assert.ok(events.some(event => event.type === 'focusin' && event.id === 'second' && event.trusted));
});
test('Chrome: conecta su página en blanco antes de una respuesta HTTP inicial lenta', { timeout: 45000 }, async t => {
  const events = [];
  const server = createServer((_request, response) => {
    events.push('http-request');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const timer = setTimeout(() => {
      events.push('http-response');
      response.end('<p>Documento sintético lento</p><script>window.syntheticExecuted=true</script>');
    }, 6500);
    response.once('close', () => clearTimeout(timer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => closeTestServer(server));
  const browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, {
    signal: t.signal, commandTimeoutMs: 15000, waitForDocument: true,
  });
  t.after(() => browser.close());
  assert.ok(browser.startup.initialNavigationMs - browser.startup.pageConnectedMs >= 5000,
    'La selección/conexión CDP debe haber terminado antes de esperar la respuesta HTTP.');
  assert.equal(await browser.evaluate("document.body.innerText.includes('Documento sintético lento')"), true);
  assert.equal(await browser.evaluate('document.characterSet'), 'UTF-8');
  assert.equal(await browser.evaluate('window.syntheticExecuted'), true);
  assert.ok(events.indexOf('http-request') < events.indexOf('http-response'));
  assert.ok(browser.startup.pageConnectedMs <= browser.startup.navigationRequestedMs);
  assert.ok(browser.startup.documentLoadedMs >= browser.startup.navigationRequestedMs + 6500);
  assert.ok(browser.startup.documentReadyMs >= browser.startup.documentLoadedMs);
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
