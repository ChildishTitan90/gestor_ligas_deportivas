import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

export const CHROME_PAGE_DISCOVERY_MS = 5000;

export function assertChromeEndpoint(endpoint) {
  const url = new URL(endpoint);
  assert.equal(url.protocol, 'ws:');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /^\/devtools\/browser\/[a-zA-Z0-9-]+$/);
  assert.equal(url.username + url.password + url.search + url.hash, '');
  assert.ok(Number(url.port) > 0 && Number(url.port) <= 65535);
  return url;
}

// Los errores contienen solo contadores/estados. Nunca URLs, títulos, cuerpos,
// mensajes de transporte o secretos del escenario autenticado.
function failure(code, diagnostic) {
  const error = new Error(`${code}: ${JSON.stringify(diagnostic)}`);
  error.code = code;
  error.diagnostic = diagnostic;
  return error;
}
function pageEndpoint(page, browser) {
  let endpoint;
  try { endpoint = new URL(page.webSocketDebuggerUrl); } catch { throw failure('CDP_PAGE_ENDPOINT_INVALID', {}); }
  if (typeof page.id !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(page.id) ||
      endpoint.protocol !== 'ws:' || endpoint.host !== browser.host ||
      endpoint.username + endpoint.password + endpoint.search + endpoint.hash !== '' ||
      endpoint.pathname !== `/devtools/page/${page.id}`)
    throw failure('CDP_PAGE_ENDPOINT_INVALID', {});
  return page;
}

/** El proceso propio arranca about:blank; su identidad no depende de que Next
 * termine la navegación. readTargets usa el presupuesto recibido para fetch. */
export async function discoverChromePage({ browserEndpoint, startUrl, readTargets, signal,
  now = Date.now, pause = (ms, abort) => sleep(ms, undefined, { signal: abort }) }) {
  const browser = assertChromeEndpoint(browserEndpoint), expectedOrigin = new URL(startUrl).origin;
  const started = now(), deadline = started + CHROME_PAGE_DISCOVERY_MS;
  const diagnostic = { attempts: 0, readTimeouts: 0, readFailures: 0, invalidLists: 0,
    lastHttpStatus: null, lastTargets: { pages: 0, blank: 0, startingOrigin: 0, other: 0 } };
  while (now() < deadline) {
    if (signal?.aborted) throw failure('CDP_PAGE_DISCOVERY_CANCELLED', diagnostic);
    const budget = Math.min(1000, deadline - now());
    if (budget <= 0) break;
    diagnostic.attempts++;
    let response;
    try {
      response = await readTargets(budget, signal);
    } catch (error) {
      if (signal?.aborted) throw failure('CDP_PAGE_DISCOVERY_CANCELLED', diagnostic);
      if (error?.name === 'TimeoutError') diagnostic.readTimeouts++;
      else diagnostic.readFailures++;
    }
    if (response) {
      diagnostic.lastHttpStatus = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
      if (response.status !== 200 || !Array.isArray(response.targets)) diagnostic.invalidLists++;
      else {
        const pages = response.targets.filter(target => target?.type === 'page');
        const blank = pages.filter(target => target.url === 'about:blank');
        let startingOrigin = 0;
        for (const target of pages) {
          try { if (new URL(target.url).origin === expectedOrigin) startingOrigin++; } catch { /* Solo clasificar, no imprimir. */ }
        }
        diagnostic.lastTargets = { pages: pages.length, blank: blank.length, startingOrigin,
          other: pages.length - blank.length - startingOrigin };
        if (blank.length > 1) throw failure('CDP_BOOTSTRAP_PAGE_AMBIGUOUS', diagnostic);
        if (blank.length === 1) return pageEndpoint(blank[0], browser);
      }
    }
    const remaining = deadline - now();
    if (remaining > 0) {
      try { await pause(Math.min(50, remaining), signal); }
      catch { throw failure('CDP_PAGE_DISCOVERY_CANCELLED', diagnostic); }
    }
  }
  throw failure('CDP_PAGE_DISCOVERY_TIMEOUT', { ...diagnostic, elapsedMs: now() - started });
}
