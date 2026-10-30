import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function assertChromeEndpoint(endpoint) {
  const url = new URL(endpoint);
  assert.equal(url.protocol, 'ws:');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /^\/devtools\/browser\/[a-zA-Z0-9-]+$/);
  assert.equal(url.username + url.password + url.search + url.hash, '');
  assert.ok(Number(url.port) > 0 && Number(url.port) <= 65535);
  return url;
}

/** Shared CDP transport: a new owned profile, never an existing browser session. */
export async function launchChrome(origin, { profileDirectory } = {}) {
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  if (profileDirectory) {
    assert.match(profileDirectory, /^\/private\/tmp\/pdgld106-[a-f0-9-]{36}\/chrome-pg(?:15|17)$/);
    await mkdir(profileDirectory, { mode: 0o700 });
  }
  const profile = profileDirectory ?? await mkdtemp(join(tmpdir(), 'pdgld-browser-'));
  const chrome = spawn(process.env.CHROME_BIN ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome'), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, origin,
  ], { env: Object.fromEntries(['PATH', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP'].flatMap(key =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]])), stdio: ['ignore', 'ignore', 'pipe'] });
  const closed = new Promise(resolve => chrome.once('close', resolve));
  let socket; let closing;
  const pending = new Map();
  const close = async () => {
    closing ??= (async () => {
      for (const entry of pending.values()) entry.reject(new Error('CDP_CLOSED'));
      pending.clear(); socket?.close(); chrome.kill('SIGTERM');
      let timer;
      await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, 2_000); })]);
      clearTimeout(timer);
      if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill('SIGKILL');
      await closed; await rm(profile, { recursive: true, force: true });
    })();
    return closing;
  };
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CHROME_START_TIMEOUT')), 20_000);
      chrome.once('error', () => { clearTimeout(timer); reject(new Error('CHROME_UNAVAILABLE')); });
      chrome.once('exit', () => { clearTimeout(timer); reject(new Error('CHROME_EARLY_EXIT')); });
      let tail = '';
      chrome.stderr.on('data', chunk => {
        tail = (tail + chunk.toString()).slice(-4096);
        const match = tail.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    const base = assertChromeEndpoint(endpoint);
    let page;
    for (let attempt = 0; attempt < 100 && !page; attempt++) {
      page = (await (await fetch(`http://${base.host}/json/list`)).json()).find(target => {
        try { return target.type === 'page' && new URL(target.url).origin === new URL(origin).origin; } catch { return false; }
      });
      if (!page) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(page, 'CHROME_PAGE_MISSING');
    assert.equal(new URL(page.webSocketDebuggerUrl).host, base.host);
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP_CONNECTION_FAILED')), { once: true });
    });
    let sequence = 0;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data); const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error('CDP_COMMAND_FAILED'));
      else entry.resolve(message.result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP_TIMEOUT')); }, 45_000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error('BROWSER_ASSERTION_FAILED');
      return result.result.value;
    };
    return { socket, command, evaluate, close };
  } catch (error) { await close(); throw error; }
}
