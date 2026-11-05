import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
export function assertChromeEndpoint(endpoint) {
  const url = new URL(endpoint);
  assert.equal(url.protocol, 'ws:');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /^\/devtools\/browser\/[a-zA-Z0-9-]+$/);
  assert.equal(url.username + url.password + url.search + url.hash, '');
  assert.ok(Number(url.port) > 0 && Number(url.port) <= 65535);
  return url;
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
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, origin,
  ], { windowsHide: true, detached: process.platform !== 'win32',
    env: Object.fromEntries(['PATH', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP'].flatMap(key =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]])), stdio: ['ignore', 'ignore', 'pipe'] });
  // exit belongs to our process; close can wait on inherited child pipes indefinitely.
  let exited = false;
  const exit = new Promise(resolve => {
    const done = () => { exited = true; resolve(); };
    chrome.once('exit', done); chrome.once('error', done);
  });
  let socket, closing, sequence = 0;
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
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  };
  const close = () => closing ??= (async () => {
    signal?.removeEventListener('abort', cancel);
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
  const cancel = () => { void close().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
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
    }), 10000, 'Chrome: arranque', signal);
    const base = assertChromeEndpoint(endpoint);
    let page;
    const deadline = Date.now() + 5000;
    while (!page && Date.now() < deadline) {
      const requestSignal = AbortSignal.any([AbortSignal.timeout(1000), ...(signal ? [signal] : [])]);
      let targets;
      try {
        const response = await fetch(`http://${base.host}/json/list`, { signal: requestSignal });
        targets = await response.json();
      } catch (error) {
        if (signal?.aborted || error.name !== "TimeoutError") throw error;
        continue; // Solo descubrimiento de lectura, dentro del plazo total de 5 s.
      }
      page = targets.find(target => {
        try { return target.type === 'page' && new URL(target.url).origin === new URL(origin).origin; } catch { return false; }
      });
      if (!page) await bounded(new Promise(resolve => setTimeout(resolve, 50)), 1000, 'CDP: búsqueda de página', signal);
    }
    assert.ok(page, 'CDP: no apareció la página sintética en 5 s');
    const pageUrl = new URL(page.webSocketDebuggerUrl);
    assert.equal(pageUrl.host, base.host); assert.equal(pageUrl.protocol, 'ws:');
    socket = new WebSocket(pageUrl);
    await bounded(new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP: falló la conexión')), { once: true });
    }), 3000, 'CDP: conexión', signal);
    socket.addEventListener('close', () => rejectPending(new Error('CDP: conexión cerrada durante una orden')));
    socket.addEventListener('error', () => rejectPending(new Error('CDP: error de transporte')));
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), entry = pending.get(message.id);
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
    // Standalone fixtures opt in; backend suites retain their own loading contract.
    // /json/list can expose the page before its first navigation commits.
    // Retry only this read, never an assertion or a user action from the scenario.
    let ready = !waitForDocument;
    const readyDeadline = Date.now() + 5000;
    while (!ready && Date.now() < readyDeadline) {
      try { ready = await evaluate(`location.origin === ${JSON.stringify(new URL(origin).origin)} && document.readyState === 'complete'`); }
      catch (error) { if (!error.message.includes('Execution context was destroyed')) throw error; }
      if (!ready) await bounded(new Promise(resolve => setTimeout(resolve, 30)), 1000, 'Chrome: documento inicial', signal);
    }
    assert.ok(ready, 'Chrome: el documento inicial no terminó de cargar en 5 s');
    return { socket, command, evaluate, close };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Chrome: falló la prueba y su limpieza'); }
    throw error;
  }
}

export function waitForTestDone(browser) {
  return browser.evaluate("(async()=>{const deadline=Date.now()+5000;while(!window.testDone){if(window.testFailure)throw Error(window.testFailure);if(Date.now()>deadline)throw Error('El bundle no inició window.testDone en 5 s');await new Promise(r=>setTimeout(r,10));}return await window.testDone})()");
}
