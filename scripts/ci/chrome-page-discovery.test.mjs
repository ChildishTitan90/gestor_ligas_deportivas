import assert from 'node:assert/strict';
import test from 'node:test';
import { assertChromeEndpoint, CHROME_PAGE_DISCOVERY_MS, discoverChromePage } from '../../tests/e2e/chrome-page-discovery.mjs';

const browserEndpoint = 'ws://127.0.0.1:9222/devtools/browser/owned-browser';
const startUrl = 'http://127.0.0.1:3000';
const blank = { id: 'owned-page', type: 'page', url: 'about:blank',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/owned-page' };
function run(read, options = {}) {
  let clock = 0;
  const budgets = [];
  const promise = discoverChromePage({ browserEndpoint, startUrl, now: () => clock,
    pause: async ms => { clock += ms; },
    readTargets: async (budget, signal) => {
      budgets.push(budget);
      return read({ budget, signal, advance: ms => { clock += ms; } });
    }, ...options });
  return { promise, budgets, elapsed: () => clock };
}
test('CDP: about:blank propio se selecciona sin esperar el origen de la aplicación', async () => {
  assert.equal(CHROME_PAGE_DISCOVERY_MS, 5000);
  // Reproducción determinista del filtro anterior: el target existe pero aún no
  // tiene el origen HTTP. No hay servidor ni navegador en este control.
  assert.equal(new URL(blank.url).origin === new URL(startUrl).origin, false);
  const r = run(() => ({ status: 200, targets: [blank] }));
  assert.equal((await r.promise).id, blank.id); assert.equal(r.elapsed(), 0);
});
test('CDP: ignora workers y páginas ya navegadas; exige el bootstrap propio', async () => {
  const r = run(() => ({ status: 200, targets: [
    { ...blank, id: 'worker', type: 'service_worker' },
    { ...blank, id: 'previous-page', url: startUrl }, blank,
  ] }));
  assert.equal((await r.promise).id, blank.id);
});
test('CDP: HTTP/lista aún no listos y errores transitorios solo reintentan descubrimiento', async () => {
  let attempt = 0;
  const r = run(() => {
    attempt++;
    if (attempt === 1) throw new TypeError('synthetic network failure');
    if (attempt === 2) return { status: 503, targets: [blank] };
    if (attempt === 3) return { status: 200, targets: {} };
    return { status: 200, targets: [blank] };
  });
  assert.equal((await r.promise).id, blank.id); assert.equal(attempt, 4);
});
test('CDP: plazos de lectura y pausa respetan el límite total original de cinco segundos', async () => {
  const r = run(({ budget, advance }) => { advance(budget); throw Object.assign(new Error(), { name: 'TimeoutError' }); });
  await assert.rejects(r.promise, error => error.code === 'CDP_PAGE_DISCOVERY_TIMEOUT' &&
    error.diagnostic.elapsedMs === 5000 && error.diagnostic.readTimeouts === 5);
  assert.equal(r.elapsed(), 5000); assert.deepEqual(r.budgets, [1000, 1000, 1000, 1000, 800]);
});
test('CDP: el diagnóstico de ausencia distingue páginas y nunca publica URLs, títulos o errores originales', async () => {
  const secret = 'synthetic-private-value';
  const r = run(() => ({ status: 200, targets: [
    { ...blank, url: `${startUrl}/login?code=${secret}`, title: secret },
    { ...blank, id: 'outside', url: `https://example.test/${secret}` },
  ] }));
  await assert.rejects(r.promise, error => {
    assert.equal(error.code, 'CDP_PAGE_DISCOVERY_TIMEOUT');
    assert.deepEqual(error.diagnostic.lastTargets, { pages: 2, blank: 0, startingOrigin: 1, other: 1 });
    assert.ok(!JSON.stringify(error.diagnostic).includes(secret)); assert.ok(!error.message.includes(secret));
    return true;
  });
});
test('CDP: no elige arbitrariamente entre dos páginas bootstrap', async () => {
  const r = run(() => ({ status: 200, targets: [blank, { ...blank, id: 'second' }] }));
  await assert.rejects(r.promise, error => error.code === 'CDP_BOOTSTRAP_PAGE_AMBIGUOUS');
});
test('CDP: endpoint de página exige el mismo proceso/puerto y el id exacto, sin credenciales ni parámetros', async () => {
  for (const url of ['ws://example.test:9222/devtools/page/owned-page',
    'ws://127.0.0.1:9999/devtools/page/owned-page', 'ws://127.0.0.1:9222/devtools/page/another',
    'wss://127.0.0.1:9222/devtools/page/owned-page', 'ws://user:private@127.0.0.1:9222/devtools/page/owned-page',
    'ws://127.0.0.1:9222/devtools/page/owned-page?token=private', 'not-a-url']) {
    await assert.rejects(run(() => ({ status: 200, targets: [{ ...blank, webSocketDebuggerUrl: url }] })).promise,
      error => error.code === 'CDP_PAGE_ENDPOINT_INVALID' && !error.message.includes('private'));
  }
});
test('CDP: mantiene las restricciones del endpoint browser y rechaza cancelación antes de leer', async () => {
  for (const endpoint of ['ws://example.test:9222/devtools/browser/owned',
    'http://127.0.0.1:9222/devtools/browser/owned', 'ws://127.0.0.1:9222/devtools/page/owned'])
    assert.throws(() => assertChromeEndpoint(endpoint));
  const controller = new AbortController(); controller.abort(); let reads = 0;
  await assert.rejects(run(() => { reads++; return { status: 200, targets: [blank] }; }, { signal: controller.signal }).promise,
    error => error.code === 'CDP_PAGE_DISCOVERY_CANCELLED');
  assert.equal(reads, 0);
});
test('CDP: una cancelación durante lectura no se convierte en reintento', async () => {
  const controller = new AbortController();
  const r = run(() => { controller.abort(); throw new Error('synthetic'); }, { signal: controller.signal });
  await assert.rejects(r.promise, error => error.code === 'CDP_PAGE_DISCOVERY_CANCELLED');
  assert.equal(r.budgets.length, 1);
});
