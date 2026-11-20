import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { compile } from '@tailwindcss/node';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchChrome, closeTestServer } from './chrome-session.mjs';

// UI real con DTO, sesión, navegación y transporte sintéticos. No usa base/API real.
test('disponibilidad propia: contexto, zona, motivo, incertidumbre y lectura sin permiso de escritura', { timeout: 90000 }, async t => {
  const files = ['src/features/referees/components/own-availability-workspace.tsx', 'src/features/referees/components/availability-dialog.tsx',
    'src/features/referees/components/operation-fields.tsx', 'src/components/ui/select-field.tsx', 'src/components/ui/form-dialog.tsx'];
  const source = (await Promise.all(files.map(f => readFile(f, 'utf8')))).join('\n');
  const compiler = await compile(await readFile('src/app/globals.css', 'utf8'), { base: resolve('src/app'), onDependency() {} });
  const css = compiler.build(source.split(/[\s"'`<>{}$]+/).concat(['p-5', 'bg-background', 'text-foreground']));
  const bundle = await build({ write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'fixture-navigation', setup(p) {
      p.onResolve({ filter: /^next\/navigation$/ }, a => ({ path: a.path, namespace: 'fixture' }));
      p.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export function useRouter(){return {push(url){window.route=url;window.renderScenario('empty')},refresh(){window.refreshes=(window.refreshes||0)+1}}}` }));
    } }], stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {OwnAvailabilityWorkspaceView} from './src/features/referees/components/own-availability-workspace';
      const id=()=>crypto.randomUUID(),actorId=id(),refereeId=id(),leagueId=id(),seasonId=id();
      window.fixtureContext={leagueId,league:'Liga SINTETICA',seasonId,season:'Temporada SINTETICA',clubId:id(),club:'Club SINTETICO',timezone:'America/Mexico_City'};
      window.posts=[];window.reply='pending';window.recovered=false;
      const receipt=()=>({id:refereeId,version:5,operationKey:window.posts.at(-1).operationKey});
      window.fetch=async(url,init)=>{if(init?.method==='POST'){window.posts.push(JSON.parse(init.body));if(window.reply==='pending')return await new Promise((resolve,reject)=>{window.failPost=()=>reject(Error('Respuesta incierta sintetica'));window.finishPost=()=>resolve(new Response(JSON.stringify(receipt())))});return new Response(JSON.stringify(receipt()))}return new Response(JSON.stringify({receipt:window.recovered?receipt():null}))};
      const root=createRoot(document.getElementById('root'));let serial=0;
      window.renderScenario=(mode='select')=>flushSync(()=>root.render(<OwnAvailabilityWorkspaceView key={++serial} workspace={{actorId,referee:mode==='unregistered'?null:{id:refereeId,version:4,active:mode!=='inactive'},contexts:mode==='unregistered'?[]:[window.fixtureContext],leagueId:mode==='select'?'':leagueId,seasonId:mode==='select'?'':seasonId,canUpdate:!['select','unregistered','readonly','inactive'].includes(mode),blockedCode:mode==='readonly'?'SHARED_AVAILABILITY_SCOPE':mode==='inactive'?'INACTIVE':null,intervals:mode==='expiring'?[{id:id(),refereeId,startsAt:new Date(Date.now()-10000).toISOString(),endsAt:new Date(Date.now()+1800).toISOString(),available:false}]:['list','readonly','inactive'].includes(mode)?[{id:id(),refereeId,startsAt:new Date(new Date(Date.now()+86400000).setUTCHours(14,0,0,0)).toISOString(),endsAt:new Date(new Date(Date.now()+86400000).setUTCHours(16,0,0,0)).toISOString(),available:true},{id:id(),refereeId,startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+90000000).toISOString(),available:false}]:[]}}/>));
      window.renderScenario();
    ` } });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].contents : `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="bg-background text-foreground p-5"><p>Validación UI · Datos sintéticos</p><div id="root"></div><script>window.addEventListener('error',e=>window.fixtureError=e.message)</script><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => closeTestServer(server));
  const browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, { signal: t.signal, waitForDocument: true }); t.after(() => browser.close());
  const ev = s => browser.evaluate(s);
  const wait = c => ev(`(async()=>{for(let n=0;n<200;n++){if(window.fixtureError)throw Error(window.fixtureError);if(${c})return;await new Promise(r=>setTimeout(r,15))}throw Error('Falta estado esperado')})()`);
  const click = async label => { await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Control no disponible');b.focus();b.click()})()`); await ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`); };
  async function input(selector, index, value) {
    await ev(`(()=>{const el=document.querySelectorAll(${JSON.stringify(selector)})[${index}];Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  }
  await wait(`document.getElementById('own-availability-context')`);
  assert.equal(await ev(`document.getElementById('own-availability-context').value`), '');
  assert.equal(await ev(`document.getElementById('own-availability-context').placeholder`), 'Selecciona una liga y temporada');
  await ev(`document.getElementById('own-availability-context').click()`); await wait(`document.querySelector('[role=option]')`);
  await ev(`document.querySelector('[role=option]').click()`); await wait(`document.body.textContent.includes('Sin intervalos vigentes ni próximos')`);
  assert.match(await ev('window.route'), /my-availability\?league=.*&season=/);
  await click('Añadir intervalo'); await wait(`document.querySelector('dialog[open]')`);
  assert.match(await ev(`document.querySelector('dialog textarea').placeholder`), /Disponibilidad confirmada/);
  assert.equal(await ev(`document.querySelector('dialog textarea').value`), '');
  await ev(`document.querySelector('dialog [role=combobox]').click()`); await wait(`document.querySelector('[role=option]')`);
  await ev(`[...document.querySelectorAll('[role=option]')].find(e=>e.textContent==='No disponible').click()`);
  assert.match(await ev(`document.querySelector('dialog textarea').placeholder`), /Compromiso de trabajo/);
  await input('dialog input[type=datetime-local]', 0, '2026-12-05T08:00');
  await input('dialog input[type=datetime-local]', 1, '2026-12-05T10:00');
  await input('dialog textarea', 0, 'Horario de trabajo sintético');
  await click('Confirmar intervalo'); await wait(`window.posts.length===1`);
  assert.equal(await ev(`document.querySelector('button[form="availability-form"]').disabled`), true);
  await ev(`document.getElementById('availability-form').requestSubmit()`);
  assert.equal(await ev('window.posts.length'), 1);
  assert.deepEqual(await ev(`({start:window.posts[0].startsAt,end:window.posts[0].endsAt,available:window.posts[0].available,league:window.posts[0].leagueId===window.fixtureContext.leagueId})`), { start: '2026-12-05T14:00:00.000Z', end: '2026-12-05T16:00:00.000Z', available: false, league: true });
  await ev('window.failPost()'); await wait(`document.body.textContent.includes('No se pudo confirmar')`);
  await click('Consultar resultado sin reenviar'); await wait(`document.body.textContent.includes('Todavía no existe un acuse')`);
  await ev(`window.reply='success'`); await click('Reintentar la misma solicitud'); await wait(`!document.querySelector('dialog[open]')`);
  assert.equal(await ev(`JSON.stringify(window.posts[0])===JSON.stringify(window.posts[1])`), true);
  assert.match(await ev('document.body.textContent'), /confirmado al consultar el acuse/);
  for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
    await browser.command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};window.renderScenario('list')`);
    assert.equal(await ev('document.querySelectorAll("article").length'), 2);
    assert.match(await ev('document.querySelector("article").textContent'), /08:00/);
    assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'), true);
    await click('Añadir intervalo'); await click('Cancelar'); await wait(`!document.querySelector('dialog[open]')`);
    assert.equal(await ev('document.activeElement.textContent'), 'Añadir intervalo');
  }
  await ev(`window.renderScenario('expiring')`); await wait(`document.querySelector('article')?.innerText.includes('No disponible')`);
  await wait(`!document.querySelector('article') && document.body.textContent.includes('Sin intervalos vigentes ni próximos')`);
  await ev(`window.renderScenario('readonly')`);
  assert.equal(await ev(`[...document.querySelectorAll('button')].filter(b=>b.textContent==='Añadir intervalo'||b.textContent==='Editar intervalo').every(b=>b.disabled)`), true);
  assert.match(await ev('document.body.textContent'), /Falta permiso propio/);
  await ev(`window.renderScenario('inactive')`); assert.match(await ev('document.body.textContent'), /Árbitro inactivo/);
  await ev(`window.renderScenario('unregistered')`); assert.match(await ev('document.body.textContent'), /Todavía no tienes una incorporación/);
});
