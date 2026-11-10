import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertChromeEndpoint, discoverChromePage } from './chrome-page-discovery.mjs';
export { assertChromeEndpoint } from './chrome-page-discovery.mjs';

export function bounded(promise, ms, phase, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => finish(reject, new Error(`${phase}: cancelado`));
    const timer = setTimeout(() => finish(reject, new Error(`${phase}: sin respuesta en ${ms} ms`)), ms);
    function finish(callback, value) { clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value); }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
  });
}
/** Only servers opened by the fixture, including its active/keepalive connections. */
export async function closeTestServer(server) {
  const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await bounded(closed, 2000, 'Servidor sintético: cierre');
}
/** Owned profile/process group; never terminates another browser session. */
export async function launchChrome(origin, { profileDirectory, signal, commandTimeoutMs = 45000, waitForDocument = false } = {}) {
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  assert.equal(new URL(origin).protocol, 'http:');
  assert.equal(new URL(origin).username + new URL(origin).password, '');
  assert.ok(Number.isInteger(commandTimeoutMs) && commandTimeoutMs > 0 && commandTimeoutMs <= 45000);
  if (profileDirectory) {
    assert.match(profileDirectory, /^\/private\/tmp\/pdgld106-[a-f0-9-]{36}\/chrome-pg(?:15|17)$/);
    await mkdir(profileDirectory, { mode: 0o700 });
  }
  const profile = profileDirectory ?? await mkdtemp(join(tmpdir(), 'pdgld-browser-'));
  const chrome = spawn(process.env.CHROME_BIN ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome'), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--no-sandbox', '--disable-dev-shm-usage', // <--- Añadido para estabilidad en CI (Linux/Docker)
    // Una página local permite conectar CDP antes de navegar/compilar la app.
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], {
    windowsHide: true, detached: process.platform !== 'win32',
    env: Object.fromEntries(['PATH', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP'].flatMap(key =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]])), stdio: ['ignore', 'ignore', 'pipe']
  });
  // exit belongs to our process; close can wait on inherited child pipes indefinitely.
  let exited = false;
  const exit = new Promise(resolve => {
    const done = () => { exited = true; resolve(); };
    chrome.once('exit', done); chrome.once('error', done);
  });
  let socket, closing, sequence = 0;
  const startedAt = Date.now();
  let startupPhase = 'process-start', cdpPublishedMs = null, pageConnectedMs = null, pageActivatedMs = null, initialNavigationMs = null;
  let navigationRequestedMs = null, documentLoadedMs = null, documentReadyMs = null;
  const loadedDocuments = new Map(), loadListeners = new Set();
  const pending = new Map();
  const rejectPending = error => { for (const entry of pending.values()) entry.reject(error); pending.clear(); };
  const stop = async force => {
    if (!chrome.pid) return;
    if (process.platform === 'win32') {
      if (exited) return;
      const killer = spawn('taskkill', ['/PID', String(chrome.pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true, stdio: 'ignore' });
      await bounded(new Promise(resolve => { killer.once('exit', resolve); killer.once('error', resolve); }), 2000, 'Chrome: taskkill');
    } else {
      try { process.kill(-chrome.pid, force ? 'SIGKILL' : 'SIGTERM'); }
      catch (error) { if (error.code !== 'ESRCH' && !(exited && error.code === 'EPERM')) throw error; }
    }
  };
  const close = () => closing ??= (async () => {
    signal?.removeEventListener('abort', cancel);
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    rejectPending(new Error('CDP: navegador cerrado')); socket?.close();
    try {
      try { await stop(false); await bounded(exit, 1500, 'Chrome: salida'); }
      catch { await stop(true); await bounded(exit, 2000, 'Chrome: salida forzada'); }
      // The parent may exit while a descendant still holds its stderr/profile.
      if (process.platform !== 'win32') await stop(true);
    } finally {
      chrome.stderr.destroy();
      await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  })();
  const cancel = () => { void close().catch(() => { }); };
  signal?.addEventListener('abort', cancel, { once: true });
  // The isolated supervisor gives suite processes time to close their own Chrome
  // groups before escalation. A detached browser must not outlive its test worker.
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const endpoint = await bounded(new Promise((resolve, reject) => {
      chrome.once('error', () => reject(new Error('Chrome: ejecutable no disponible')));
      chrome.once('exit', () => reject(new Error('Chrome: terminó antes de publicar CDP')));
      let tail = '';
      chrome.stderr.on('data', chunk => {
        tail = (tail + chunk.toString()).slice(-4096);
        const match = tail.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) resolve(match[1]);
      });
    }), 30000, 'Chrome: arranque', signal);
    const base = assertChromeEndpoint(endpoint);
    cdpPublishedMs = Date.now() - startedAt;
    startupPhase = 'page-discovery';
    const page = await discoverChromePage({ browserEndpoint: endpoint, startUrl: origin, signal,
      async readTargets(timeoutMs, abort) {
        const requestSignal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(abort ? [abort] : [])]);
        const response = await fetch(`http://${base.host}/json/list`, { signal: requestSignal });
        return { status: response.status, targets: response.ok ? await response.json() : null };
      } });
    const pageUrl = new URL(page.webSocketDebuggerUrl);
    assert.equal(pageUrl.host, base.host); assert.equal(pageUrl.protocol, 'ws:');
    startupPhase = 'page-connection';
    socket = new WebSocket(pageUrl);
    await bounded(new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP: falló la conexión')), { once: true });
    }), 3000, 'CDP: conexión', signal);
    pageConnectedMs = Date.now() - startedAt;
    socket.addEventListener('close', () => rejectPending(new Error('CDP: conexión cerrada durante una orden')));
    socket.addEventListener('error', () => rejectPending(new Error('CDP: error de transporte')));
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Page.lifecycleEvent' && message.params.name === 'load') {
        const key = `${message.params.frameId}:${message.params.loaderId}`;
        loadedDocuments.set(key, Date.now() - startedAt);
        for (const listener of loadListeners) listener(key);
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      if (message.error) entry.reject(new Error(`CDP_COMMAND_FAILED (${message.error.code}): ${message.error.message}`));
      else entry.resolve(message.result);
    });
    const command = async (method, params = {}, timeoutMs = commandTimeoutMs) => {
      const id = ++sequence;
      try {
        return await bounded(new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          if (socket.readyState !== WebSocket.OPEN) reject(new Error('CDP: conexión no disponible'));
          else socket.send(JSON.stringify({ id, method, params }));
        }), timeoutMs, `CDP: ${method}`, signal);
      } finally { pending.delete(id); }
    };
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(`BROWSER_ASSERTION_FAILED: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
      return result.result.value;
    };
    // A CDP connection does not activate its target. Do this before navigation:
    // fixtures can start exercising focus synchronously while their scripts load.
    // Activate only our verified tab; never focus a field or emulate focus events.
    startupPhase = 'page-activation';
    await command('Page.bringToFront');
    // CDP acknowledges the request before the renderer necessarily receives focus.
    // Observe the real focus event, with a deadline; do not emulate focus or inputs.
    assert.equal(await evaluate(`new Promise(resolve => {
      let timer;
      const finish = () => { clearTimeout(timer); window.removeEventListener('focus', focused); resolve(document.hasFocus()); };
      const focused = () => { if (document.hasFocus()) finish(); };
      window.addEventListener('focus', focused);
      timer = setTimeout(finish, 3000);
      focused();
    })`), true, 'Chrome: la página propia no está activa');
    pageActivatedMs = Date.now() - startedAt;
    if (waitForDocument) {
      await command('Page.enable');
      await command('Page.setLifecycleEventsEnabled', { enabled: true });
    }
    startupPhase = 'initial-navigation';
    navigationRequestedMs = Date.now() - startedAt;
    const navigation = await command('Page.navigate', { url: origin });
    if (navigation.errorText) throw new Error('CDP_INITIAL_NAVIGATION_FAILED');
    initialNavigationMs = Date.now() - startedAt;
    // Standalone fixtures opt in; backend suites retain their own loading contract.
    // Match this navigation's loader, including events arriving before its reply.
    // A complete about:blank or a previous same-origin document cannot satisfy it.
    startupPhase = 'initial-document';
    if (waitForDocument) {
      assert.ok(navigation.frameId && navigation.loaderId, 'Chrome: falta identidad de navegación inicial');
      const key = `${navigation.frameId}:${navigation.loaderId}`;
      let listener;
      try {
        await bounded(new Promise(resolve => {
          listener = loaded => { if (loaded === key) resolve(); };
          loadListeners.add(listener);
          if (loadedDocuments.has(key)) resolve();
        }), 5000, 'Chrome: carga del documento inicial', signal);
      } finally { loadListeners.delete(listener); }
      documentLoadedMs = loadedDocuments.get(key);
      assert.equal(await evaluate(`location.href === ${JSON.stringify(new URL(origin).href)} && document.readyState === 'complete'`),
        true, 'Chrome: el documento cargado no corresponde a la navegación inicial');
      assert.equal(await evaluate('document.hasFocus()'), true, 'Chrome: el documento cargado no está activo');
      documentReadyMs = Date.now() - startedAt;
    }
    return { socket, command, evaluate, close, startup: { cdpPublishedMs, pageConnectedMs, pageActivatedMs, navigationRequestedMs,
      initialNavigationMs, documentLoadedMs, documentReadyMs } };
  } catch (error) {
    error.chromeStartup = { phase: startupPhase, elapsedMs: Date.now() - startedAt,
      cdpPublishedMs, pageConnectedMs, pageActivatedMs, navigationRequestedMs, initialNavigationMs, documentLoadedMs, documentReadyMs, processExited: exited,
      processExitCode: typeof chrome.exitCode === 'number' ? chrome.exitCode : null };
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Chrome: falló la prueba y su limpieza'); }
    throw error;
  }
}

export function waitForTestDone(browser) {
  return browser.evaluate("(async()=>{const deadline=Date.now()+5000;while(!window.testDone){if(window.testFailure)throw Error(window.testFailure);if(Date.now()>deadline)throw Error('El bundle no inició window.testDone en 5 s');await new Promise(r=>setTimeout(r,10));}return await window.testDone})()");
}
