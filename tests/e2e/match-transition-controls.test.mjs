import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { launchChrome, closeTestServer } from './chrome-session.mjs';

test('PDGLD-133: acción autorizada, confirmación, foco y envío sintético', { timeout: 60000 }, async t => {
  const bundle = await build({ write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' }, stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {MatchTransitionControls} from './src/features/matches/components/match-transition-controls';
      createRoot(document.getElementById('root')).render(<MatchTransitionControls id="fixture" version={1} status="CONFIRMED" canRecordMatch={true}/>);
    ` }, plugins: [{ name: 'fixture', setup(plugin) {
      plugin.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
      plugin.onResolve({ filter: /transition-actions$/ }, () => ({ path: 'actions', namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'navigation'
        ? 'export function useRouter(){return {refresh(){window.refreshed=true}}}'
        : 'export async function transitionMatchAction(input){window.sent=input;(window.requests ??= []).push(input);if(window.failOnce){window.failOnce=false;return {ok:false,code:"UNAVAILABLE"}}return {ok:true}}', loader: 'js' }));
    } }] });
  const css = await readFile('src/styles/tokens.css', 'utf8');
  const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].contents : `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script></html>`); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => closeTestServer(server));
  const browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, { signal: t.signal, waitForDocument: true }); t.after(() => browser.close());
  const ev = expression => browser.evaluate(expression);
  await ev(`(async()=>{for(let i=0;i<100;i++){if(document.body.innerText.includes('Iniciar partido'))return;await new Promise(r=>setTimeout(r,20));}throw Error('No se mostró la acción');})()`);
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
    await browser.command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await ev("[...document.querySelectorAll('button')].find(b=>b.textContent==='Iniciar partido').click()");
    await ev(`(async()=>{for(let i=0;i<100;i++){if(document.querySelector('dialog[open]'))return;await new Promise(r=>setTimeout(r,20));}throw Error('No se abrió el diálogo');})()`);
    assert.equal(await ev("document.documentElement.scrollWidth <= innerWidth + 1"), true);
    assert.equal(await ev("document.querySelector('dialog').contains(document.activeElement)"), true);
    await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await ev(`(async()=>{for(let i=0;i<100;i++){if(!document.querySelector('dialog[open]'))return;await new Promise(r=>setTimeout(r,20));}throw Error('No se cerró el diálogo');})()`);
  }
  await ev("[...document.querySelectorAll('button')].find(b=>b.textContent==='Iniciar partido').click()");
  await ev(`(async()=>{for(let i=0;i<100;i++){if(document.querySelector('dialog[open]'))return;await new Promise(r=>setTimeout(r,20));}throw Error('No se abrió');})()`);
  await ev("(()=>{const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Inicio observado');t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('dialog input[type=checkbox]').click()})()");
  await ev("document.querySelector('dialog form').requestSubmit()");
  await ev(`(async()=>{for(let i=0;i<100;i++){if(window.sent)return;await new Promise(r=>setTimeout(r,20));}throw Error('No se envió');})()`);
  assert.equal(await ev('window.sent.toStatus'), 'IN_PROGRESS');
  assert.equal(await ev('window.sent.reason'), 'Inicio observado');
  await ev("window.failOnce=true; [...document.querySelectorAll('button')].find(b=>b.textContent==='Iniciar partido').click()");
  await ev(`(async()=>{for(let i=0;i<100;i++){if(document.querySelector('dialog[open]'))return;await new Promise(r=>setTimeout(r,20));}throw Error('No se abrió el diálogo de reintento');})()`);
  await ev("(()=>{const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Cambio incierto');t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('dialog input[type=checkbox]').click()})()");
  await ev("document.querySelector('dialog form').requestSubmit()");
  await ev(`(async()=>{for(let i=0;i<100;i++){if(document.body.innerText.includes('Reintentar la misma solicitud'))return;await new Promise(r=>setTimeout(r,20));}throw Error('No se mostró recuperación');})()`);
  const firstAttempt = await ev('window.requests.at(-1)');
  await ev("[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Cerrar y conservar pendiente').click()");
  await ev(`(async()=>{for(let i=0;i<100;i++){if(document.body.innerText.includes('Continuar solicitud pendiente'))return;await new Promise(r=>setTimeout(r,20));}throw Error('Se perdió la solicitud pendiente');})()`);
  await ev("[...document.querySelectorAll('button')].find(b=>b.textContent==='Continuar solicitud pendiente').click()");
  await ev(`(async()=>{for(let i=0;i<100;i++){if(document.querySelector('dialog[open]'))return;await new Promise(r=>setTimeout(r,20));}throw Error('No se recuperó el diálogo');})()`);
  await ev("[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Reintentar la misma solicitud').click()");
  await ev(`(async()=>{for(let i=0;i<100;i++){if(window.requests.length===3)return;await new Promise(r=>setTimeout(r,20));}throw Error('No se reenvió la solicitud');})()`);
  assert.deepEqual(await ev('window.requests.at(-1)'), firstAttempt);
});
