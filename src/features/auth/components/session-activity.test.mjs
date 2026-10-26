import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { isTeamRegistrationPreview, TEAM_REGISTRATION_PREVIEW_PATH } from '../../../lib/development-preview.ts';

// Ejecuta el efecto del componente real con hooks/eventos/red/reloj simulados.
// No monta React DOM ni abre navegador, conexiones o sesiones reales.
function harness(environment = 'development') {
  const source = readFileSync(new URL('./session-activity.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const timers = new Map();
  const calls = [];
  const messages = [];
  const pendingPaths = new Set();
  let timerId = 0;
  let now = 1000;
  function eventTarget() {
    const events = new Map();
    return {
      visibilityState: 'visible',
      addEventListener(name, handler) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(handler); },
      removeEventListener(name, handler) { events.get(name)?.delete(handler); },
      emit(name) { for (const handler of events.get(name) ?? []) handler({ isTrusted: true }); },
      count() { return [...events.values()].reduce((sum, handlers) => sum + handlers.size, 0); },
    };
  }
  const document = eventTarget();
  const window = { ...eventTarget(), location: { pathname: '/access', replace() { throw new Error('Unexpected redirect'); } } };
  let pathname = '/access';
  const router = { refresh() {} };
  const refs = [];
  let refIndex = 0;
  let nextEffect;
  let cleanup;
  let previousPath;
  const react = {
    useRef(value) { const index = refIndex++; return refs[index] ??= { current: value }; },
    useState() { return ['', value => messages.push(value)]; },
    useEffect(effect) { nextEffect = effect; },
  };
  const sandboxModule = { exports: {} };
  const context = {
    module: sandboxModule, exports: sandboxModule.exports, process: { env: { NODE_ENV: environment } },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: () => null };
      if (name === 'next/navigation') return { usePathname: () => pathname, useRouter: () => router };
      if (name === '@/lib/development-preview') return { isTeamRegistrationPreview };
      throw new Error(`Unexpected import: ${name}`);
    },
    document, window, AbortController,
    Date: class extends Date { static now() { return now; } },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(path, init) {
      calls.push({ path, init });
      if (pendingPaths.has(path)) return new Promise((resolve, reject) => {
        const call = calls.at(-1); call.resolve = resolve;
        init.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      });
      return Promise.resolve({ ok: true, json: async () => path.endsWith('/csrf') ? { csrfToken: 'synthetic-csrf' } :
        { user: { id: 'synthetic-user', mustChangePassword: false }, expires: new Date(now + 60_000).toISOString() } });
    },
  };
  vm.runInNewContext(code, context);
  return {
    calls, timers, messages, document, window, pendingPaths,
    render(path) {
      pathname = path; window.location.pathname = path; refIndex = 0; sandboxModule.exports.SessionActivity();
      // Orden del ciclo de efecto al cambiar dependencias: cleanup previo, setup nuevo.
      if (previousPath !== path) { cleanup?.(); cleanup = nextEffect(); previousPath = path; }
    },
    unmount() { cleanup?.(); },
    advance(ms) { now += ms; },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('guarda exacta: development permite solo la ruta de preview', () => {
  assert.equal(isTeamRegistrationPreview(TEAM_REGISTRATION_PREVIEW_PATH, 'development'), true);
  for (const environment of ['production', 'test', undefined]) {
    assert.equal(isTeamRegistrationPreview(TEAM_REGISTRATION_PREVIEW_PATH, environment), false);
  }
  for (const path of ['/access', '/', '/dev/team-registration/other', '/dev/team-registration/', null]) {
    assert.equal(isTeamRegistrationPreview(path, 'development'), false);
  }
});

test('entrar limpia listeners y ambos temporizadores; salir reinicia la consulta y listeners', async () => {
  const h = harness(); h.render('/access'); await flush();
  assert.equal(h.document.count(), 7); assert.equal(h.window.count(), 2);
  h.document.emit('pointerdown'); await flush();
  h.document.emit('click'); // Agrupación de actividad: deja un segundo timeout.
  assert.equal(h.timers.size, 2);
  const callsBeforePreview = h.calls.length;
  h.render(TEAM_REGISTRATION_PREVIEW_PATH); await flush();
  assert.equal(h.document.count(), 0); assert.equal(h.window.count(), 0); assert.equal(h.timers.size, 0);
  assert.ok(h.calls.every(call => call.init.signal.aborted));
  h.document.emit('click'); h.window.emit('focus'); h.window.emit('online'); await flush();
  assert.equal(h.calls.length, callsBeforePreview);
  h.render('/access'); await flush();
  assert.equal(h.calls.length, callsBeforePreview + 1);
  assert.equal(h.calls.at(-1).path, '/api/auth/session');
  assert.equal(h.calls.at(-1).init.signal.aborted, false);
  assert.equal(h.document.count(), 7); assert.equal(h.window.count(), 2);
  h.unmount(); assert.equal(h.document.count(), 0); assert.equal(h.timers.size, 0);
});

test('navegar con sesión pendiente la aborta y no programa reintentos en preview', async () => {
  const h = harness(); h.pendingPaths.add('/api/auth/session'); h.render('/access');
  assert.equal(h.calls.length, 1);
  h.render(TEAM_REGISTRATION_PREVIEW_PATH); await flush();
  assert.equal(h.calls[0].init.signal.aborted, true);
  assert.equal(h.timers.size, 0); assert.equal(h.document.count(), 0); assert.deepEqual(h.messages, []);
});

test('también cancela CSRF pendiente y no envía actividad después de navegar', async () => {
  const h = harness(); h.render('/access'); await flush();
  h.pendingPaths.add('/api/auth/csrf'); h.document.emit('click');
  const csrf = h.calls.at(-1); assert.equal(csrf.path, '/api/auth/csrf');
  h.render(TEAM_REGISTRATION_PREVIEW_PATH); await flush();
  assert.equal(csrf.init.signal.aborted, true);
  assert.equal(h.calls.filter(call => call.init.method === 'POST').length, 0);
  assert.equal(h.timers.size, 0); assert.equal(h.window.count(), 0);
});

test('producción y test no omiten el monitor al visitar la misma ruta', async () => {
  for (const environment of ['production', 'test']) {
    const h = harness(environment); h.render(TEAM_REGISTRATION_PREVIEW_PATH); await flush();
    assert.equal(h.calls[0].path, '/api/auth/session');
    assert.equal(h.document.count(), 7); h.unmount();
  }
});
