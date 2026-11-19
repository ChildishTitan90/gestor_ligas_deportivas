import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { build } from "esbuild";
import { closeTestServer, launchChrome, waitForTestDone } from "./chrome-session.mjs";

for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
test(`PDGLD-139: ajuste recuperable y revisión · ${width}px · ${theme}`, { timeout: 60_000 }, async t => {
  const bundle = await build({
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AdjustmentPreview } from './src/features/scheduling/components/adjustment-preview';
import { ProposalReview } from './src/features/scheduling/components/proposal-review';
import { GeneratedEncounterDraft } from './src/features/scheduling/components/generated-encounter-draft';
const root = createRoot(document.getElementById('root'));
const mount = element => flushSync(() => root.render(element));
const check = (value, message) => { if (!value) throw Error(message); };
const wait = async fn => {
  for (let n=0; n<200; n++) {
    if (fn()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Tiempo de espera: '+fn);
};
const button = (label, scope = document) => [...scope.querySelectorAll('button')].find(item => item.textContent.trim() === label);
const click = (label, scope) => flushSync(() => button(label, scope).click());
const dialog = () => document.querySelector('dialog[open]');
const edit = (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set;
  flushSync(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const requests = [];
let respond;
window.refreshes = 0;
window.fetch = (path, request) => {
  requests.push({ path, request, body: JSON.parse(request.body) });
  return new Promise((resolve, reject) => {
    respond = (payload, status = 200) => payload ? resolve(Response.json(payload, { status })) : reject(Error('Respuesta perdida'));
  });
};
window.runTest = async () => {
  mount(<AdjustmentPreview proposalId="proposal" matchId="match" expectedVersion={3}
    actorId="actor" timeZone="America/Mexico_City" initialStart="2026-11-18T17:00" />);
  click('Ajustar horario y cancha');
  await wait(dialog);
  click('Consultar canchas', dialog());
  respond({ code: 'VENUE_OPTIONS', venues: [{ venueId: 'venue', name: 'Unidad deportiva' }] });
  await wait(() => dialog().querySelector('[role=combobox]'));
  flushSync(() => dialog().querySelector('[role=combobox]').click());
  await wait(() => dialog().querySelector('[role=option]'));
  flushSync(() => dialog().querySelector('[role=option]').click());
  edit(dialog().querySelector('textarea'), 'Cambio de horario de prueba');
  click('Guardar ajuste', dialog());
  check(requests[1].path.endsWith('/adjustments'), 'No se llamó a guardar');
  check(requests[1].body.venueId === 'venue' && requests[1].body.expectedVersion === 3 &&
    requests[1].body.startsAt === '2026-11-18T17:00' && requests[1].body.reason === 'Cambio de horario de prueba', 'El ajuste perdió datos');
  respond(null);
  await wait(() => button('Reintentar ajuste', dialog()));
  click('Cerrar y conservar pendiente', dialog());
  await wait(() => !dialog());
  click('Recuperar ajuste');
  await wait(dialog);
  click('Reintentar ajuste', dialog());
  check(JSON.stringify(requests[1].body) === JSON.stringify(requests[2].body), 'El reintento cambió el ajuste');
  respond({ code: 'ADJUSTMENT_SAVED', version: 4 });
  await wait(() => !dialog() && window.refreshes === 1);

  mount(<ProposalReview actorId="actor" proposalId="proposal" version={4} operations={['submit']} matches={{ match: '001' }} />);
  check(!button('Aprobar propuesta'), 'El programador recibió una acción de Presidencia');
  click('Enviar a revisión');
  await wait(dialog);
  edit(dialog().querySelector('textarea'), 'Enviar propuesta de prueba');
  click('Enviar a revisión', dialog());
  check(requests[3].body.operation === 'submit' && requests[3].body.expectedVersion === 4, 'Envío sin versión');
  respond({ code: 'INCOMPLETE_PROPOSAL_MATCH', matchId: 'match' }, 409);
  await wait(() => dialog().textContent.includes('Partido 001.'));
  check(window.refreshes === 1, 'Se confirmó un conflicto');
  click('Enviar a revisión', dialog());
  respond({ code: 'PROPOSAL_UPDATED', status: 'IN_REVIEW', version: 5 });
  await wait(() => !dialog() && window.refreshes === 2);

  mount(<ProposalReview key="reviewer" actorId="reviewer" proposalId="proposal" version={5} operations={['approve','return']} matches={{}} />);
  check(!button('Enviar a revisión') && button('Devolver a borrador'), 'Controles de revisión incorrectos');
  click('Aprobar propuesta');
  await wait(dialog);
  edit(dialog().querySelector('textarea'), 'Aprobación operativa de prueba');
  click('Aprobar propuesta', dialog());
  check(requests.at(-1).body.operation === 'approve' && requests.at(-1).request.headers['X-Expected-Actor-Id'] === 'reviewer', 'Decisión sin contexto');
  respond({ code: 'PROPOSAL_UPDATED', status: 'APPROVED', version: 6 });
  await wait(() => !dialog() && window.refreshes === 3);
  const venue = 'f887cbaf-9511-4ea7-9772-ae98463d3c11';
  const draft = (actor, version) => <GeneratedEncounterDraft key={actor+version}
    actorId={actor} proposalId="stored-proposal" version={version} encounterIndex={0}
    initialStart="2026-11-18T17:00" initialVenueId={venue} timeZone="UTC"
    venues={[{ value: venue, label: 'Unidad' }]} />;
  const requestCount = requests.length;
  mount(draft('actor', 1));
  click('Ajustar encuentro');
  await wait(dialog);
  edit(dialog().querySelector('input[type=datetime-local]'), '2026-11-18T18:00');
  edit(dialog().querySelector('textarea'), 'Cambio en encuentro generado');
  click('Validar y guardar ajuste', dialog());
  const original = requests.at(-1).body;
  check(original.startsAt === '2026-11-18T18:00:00.000Z' && original.expectedVersion === 1, 'No se envió UTC y versión');
  respond(null);
  await wait(() => button('Reintentar el mismo ajuste', dialog()));
  click('Cerrar y conservar pendiente', dialog());
  await wait(() => !dialog());
  mount(<div />);
  mount(draft('actor', 1));
  click('Ajustar encuentro');
  await wait(dialog);
  check(dialog().querySelector('input[type=datetime-local]').value === '2026-11-18T18:00', 'Horario perdido al recuperar');
  check(dialog().querySelector('textarea').value === 'Cambio en encuentro generado', 'Motivo perdido');
  click('Reintentar el mismo ajuste', dialog());
  check(JSON.stringify(requests.at(-1).body) === JSON.stringify(original), 'El reintento cambió la solicitud');
  respond({code:'ADJUSTMENT_SAVED',version:2});
  await wait(() => !dialog());
  mount(draft('actor', 2));
  click('Ajustar encuentro');
  await wait(dialog);
  check(dialog().querySelector('textarea').value === '', 'Se recuperó un borrador de versión obsoleta');
  click('Cancelar', dialog());
  await wait(() => !dialog());
  mount(draft('otro', 1));
  click('Ajustar encuentro');
  await wait(dialog);
  check(dialog().querySelector('textarea').value === '', 'Se filtró el borrador de otra cuenta');
  check(requests.length === requestCount+2, 'Se enviaron solicitudes adicionales');
  return true;
};
    ` },
    plugins: [{
      name: "router-fixture",
      setup(plugin) {
        plugin.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "fixture" }));
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: "export const useRouter = () => ({ refresh() { window.refreshes++ } });",
        }));
      },
    }],
  });
  const server = createServer((request, response) => {
    if (request.url === "/bundle.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle.outputFiles[0].contents);
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  t.after(() => closeTestServer(server));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, {
    signal: t.signal, waitForDocument: true, commandTimeoutMs: 15_000,
  });
  t.after(() => browser.close());
  await browser.command("Emulation.setDeviceMetricsOverride", {
    width, height: 900, deviceScaleFactor: 1, mobile: width < 600,
  });
  await browser.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await browser.evaluate(`document.documentElement.dataset.theme = "${theme}";
    window.testDone = window.runTest(); true`);
  assert.equal(await waitForTestDone(browser), true);
});
}
