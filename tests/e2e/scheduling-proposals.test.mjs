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
import { SchedulingWorkspace } from './src/features/scheduling/components/scheduling-workspace';
import { ProgressSteps } from './src/features/scheduling/components/progress-steps';
import { TeamSwapBoard } from './src/features/scheduling/components/team-swap-board';
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
  click('Cancelar', dialog());
  await wait(() => !dialog());
  mount(<GeneratedEncounterDraft key="pendiente" actorId="actor" proposalId="pending" version={1} encounterIndex={0}
    initialStart="" initialVenueId="" timeZone="UTC" context="Jornada 2 · Águilas vs. Tigres" venues={[{value:venue,label:'Unidad'}]} />);
  click('Ajustar encuentro');
  await wait(dialog);
  check(dialog().textContent.includes('Jornada 2 · Águilas vs. Tigres'), 'La ventana perdió el contexto del encuentro');
  check(dialog().querySelector('input[type=datetime-local]').value === '', 'El pendiente inventó un horario');
  edit(dialog().querySelector('input[type=datetime-local]'), '2026-11-18T18:00');
  click('Consultar canchas disponibles', dialog());
  check(requests.at(-1).path === '/api/scheduling/stored-venue-options', 'No se consultó la disponibilidad');
  respond({code:'VENUE_OPTIONS',venues:[{venueId:venue,name:'Unidad',preferred:true}]});
  await wait(() => !dialog().querySelector('fieldset').disabled);
  flushSync(() => dialog().querySelector('[role=combobox]').click());
  await wait(() => dialog().querySelector('[role=option]'));
  check(dialog().querySelector('[role=option]').textContent.includes('Horario preferente de local'), 'No se identificó la preferencia');
  await wait(() => dialog().querySelector('[role=option]'));
  flushSync(() => dialog().querySelector('[role=option]').click());
  edit(dialog().querySelector('textarea'), 'Asignar cancha al encuentro pendiente');
  click('Validar y guardar ajuste', dialog());
  check(requests.at(-1).body.venueId === venue && requests.at(-1).body.startsAt === '2026-11-18T18:00:00.000Z', 'La asignación pendiente perdió datos');
  respond({code:'ADJUSTMENT_SAVED',version:2});
  await wait(() => !dialog());
  const groupId='b96a34a0-cbea-4ab8-bca0-895986503873';
  const seasonId='72a9131f-43c0-4565-80cf-a509beed89b0';
  const categoryId='a08065e0-55c5-4f48-b896-47243baeb4b4';
  let presentation;
  window.fetch=async (path, request) => {
    if (String(path).startsWith('/api/scheduling/proposals')) return Response.json({proposals:[]});
    if (path === '/api/scheduling/generate') return Response.json({ok:true,proposalId:JSON.parse(request.body).operationId,proposal:presentation});
    throw Error('Solicitud inesperada: '+path);
  };
  mount(<SchedulingWorkspace workspace={{actorId:'presentation',seasons:[{id:seasonId,name:'Temporada',version:1,league:'Liga',timezone:'UTC',venueNames:{[venue]:'Unidad'},groups:[{id:groupId,name:'General',category:'Abierta',categoryId,teamNames:{a:'Águilas',b:'Tigres'}}]}]}} />);
  await wait(() => !document.querySelector('#schedule-season').disabled);
  check(document.querySelector('[aria-label="Tu recorrido"] [aria-current="step"]').textContent.includes('Elegir contexto'), 'Paso inicial incorrecto');
  for (const id of ['schedule-season','schedule-group']) {
    flushSync(() => document.getElementById(id).click());
    await wait(() => document.querySelector('[role=option]'));
    flushSync(() => document.querySelector('[role=option]').click());
  }
  check(document.querySelector('[aria-label="Tu recorrido"] [aria-current="step"]').textContent.includes('Preparar propuesta'), 'Paso de preparación incorrecto');
  check(document.querySelector('[aria-label="Tu recorrido"] li').textContent.includes('Completado'), 'No se marcó el contexto completado');
  const full={round:1,home:'a',away:'b',venueId:venue,start:'2026-11-18T18:00:00.000Z',end:'2026-11-18T19:30:00.000Z'};
  async function generate(match, optimal) {
    presentation={matches:[match],byes:[],timezone:'UTC',venueNames:{[venue]:'Unidad'},teamNames:{a:'Águilas',b:'Tigres'},partialOptimal:optimal};
    click('Generar propuesta'); await wait(dialog);
    edit(dialog().querySelector('textarea'),'Comprobar presentación');
    click('Generar',dialog());
    await wait(() => !dialog());
    const section=[...document.querySelectorAll('section')].find(el=>el.textContent.includes('Propuesta generada'));
    check(section,'No aparece la propuesta');
    const summary=section.querySelector('summary');
    if (!summary.parentElement.open) flushSync(() => summary.click());
    return section.textContent;
  }
  const complete=await generate(full,true);
  check(document.querySelector('[aria-label="Tu recorrido"] [aria-current="step"]').textContent.includes('Consultar calendario'), 'Paso de consulta incorrecto');
  check([...document.querySelectorAll('[aria-label="Tu recorrido"] li')].filter(el=>el.textContent.includes('Completado')).length===2, 'No se marcaron los pasos anteriores');
  check(complete.includes('Unidad') && complete.includes('Fecha y horario') && !complete.includes('Hay encuentros pendientes'), 'Presentación de propuesta completa incorrecta');
  const missing={...full,venueId:null,start:null,end:null,factors:['NO_OPENING','LOAN_WINDOW']};
  const pendingText=await generate(missing,true);
  check(pendingText.includes('Hay encuentros pendientes') && pendingText.includes('No se encontró disponibilidad suficiente') && pendingText.includes('No se encontró autorización de uso'), 'Faltan motivos del encuentro pendiente');
  check(!pendingText.includes('búsqueda alcanzó su límite'), 'Aviso de límite incorrecto');
  const limited=await generate(missing,false);
  check(limited.includes('búsqueda alcanzó su límite') && limited.includes('podría ser posible programar más encuentros'), 'Falta aviso de límite');
  const withoutReason=await generate({...missing,factors:undefined},true);
  check(withoutReason.includes('No se registró un motivo') && withoutReason.includes('Revisa la disponibilidad y la autorización'), 'Falta orientación para un pendiente sin motivo');
  check(!withoutReason.includes('Motivos detectados al generar'), 'Se mostró una lista de motivos vacía');
  const steps=[{label:'Borrador',detail:'Preparar'},{label:'En revisión',detail:'Esperar'},{label:'Aprobada',detail:'Lista'}];
  for (const index of [0,1,2,0]) {
    mount(<ProgressSteps label="Estado de la propuesta" steps={steps} current={index} />);
    const nav=document.querySelector('[aria-label="Estado de la propuesta"]');
    check(nav.querySelector('[aria-current="step"]').textContent.includes(steps[index].label), 'Estado actual incorrecto');
    check([...nav.querySelectorAll('li')].filter(el=>el.textContent.includes('Completado')).length===index, 'Pasos completados incorrectos');
  }
  const ids={a:'7ad37d56-9f1c-41e2-b190-df47b9f41304',b:'9c6e7ad6-3283-4f3f-a011-a58f337da107',c:'e37f479b-862d-4f47-9dda-6f5f5b8ca002',d:'267fa560-37de-4c7d-a236-12340ed2749e'};
  const rows=[[1,'a','d'],[1,'b','c'],[2,'c','a'],[2,'d','b'],[3,'a','b'],[3,'c','d']].map(([round,home,away],index)=>({
    encounterIndex:index,round,matchdayId:'day'+round,homeId:ids[home],awayId:ids[away],home:home.toUpperCase(),away:away.toUpperCase(),
    venueId:null,venue:'Cancha pendiente',start:null,end:null,reservedUntil:null,factors:[]}));
  let swapRequest;
  window.fetch=async (path,request)=>{check(path==='/api/scheduling/team-swap','Ruta de intercambio incorrecta');swapRequest=JSON.parse(request.body);return Response.json({code:'ADJUSTMENT_SAVED',version:2});};
  mount(<TeamSwapBoard matches={rows} byes={[]} actorId="actor" proposalId="proposal" version={1} canEdit={true} timeZone="UTC" venues={[]} />);
  const teamButton=(name,round=1)=>document.querySelector('[aria-label="Intercambiar '+name+', jornada '+round+'"]');
  flushSync(()=>teamButton('A').click());
  flushSync(()=>teamButton('B').click());
  check(!dialog() && !swapRequest, 'El intercambio no debe abrir un diálogo ni guardarse');
  check(document.body.textContent.includes('Jornadas actualizadas') && document.body.textContent.includes('quedarán pendientes'), 'Falta el aviso de cambios');
  const transfer=new DataTransfer();
  flushSync(()=>teamButton('B').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer})));
  flushSync(()=>teamButton('C').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer})));
  check(!swapRequest,'Se guardó antes de confirmar todos los cambios');
  click('Guardar cambios');
  await wait(()=>swapRequest);
  check(swapRequest.swaps.length===2 && swapRequest.swaps[0].first===ids.a && swapRequest.swaps[0].second===ids.b && swapRequest.swaps[1].first===ids.b && swapRequest.swaps[1].second===ids.c && swapRequest.expectedVersion===1,'Los intercambios no se guardaron juntos');
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
