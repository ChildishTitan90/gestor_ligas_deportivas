import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { launchChrome, closeTestServer } from './chrome-session.mjs';

test('PDGLD-117: teclado, barrera histórica y doble envío ante respuesta incierta', { timeout: 60000 }, async t => {
  const bundle = await build({ write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' }, stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {IdentityCorrectionWorkspace} from './src/features/players/components/identity-correction-workspace';
      const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
      const identity={curp:'SIAA900101HMNLRR00',firstName:'Alvaro',paternalSurname:'Sierra',maternalSurname:'Lara',birthDate:'1990-01-01'};
      window.fixture={calls:[],resolve:null};
      window.fetch=async(path,options)=>{window.fixture.calls.push({path,body:options.body});return new Promise(resolve=>{window.fixture.resolve=resolve;});};
      createRoot(document.getElementById('root')).render(<IdentityCorrectionWorkspace actorId={id(1)} data={{registrationId:id(2),identity,identityVersion:1,canRequest:true,canReview:true,applyBlockedCode:'HISTORICAL_IDENTITY_UNAVAILABLE',requests:[{id:id(3),status:'PENDING',own:false,identity,reason:'Motivo privado sintético',observations:null,createdAt:'2026-11-08T12:00:00Z',reviewedAt:null,evidence:[]}]}}/>);
    ` }, plugins: [{ name: 'synthetic-link', setup(p) {
      p.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }));
      p.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "import React from 'react';export default function Link(props){return React.createElement('a',props)}", resolveDir: process.cwd() }));
    } }] });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].contents : '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => closeTestServer(server));
  const browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, { signal: t.signal, waitForDocument: true });
  t.after(() => browser.close());
  const ev = expression => browser.evaluate(expression);
  const wait = expression => ev(`(async()=>{const until=Date.now()+5000;while(!(${expression})){if(Date.now()>until)throw Error('CORRECTION_UI_TIMEOUT');await new Promise(r=>setTimeout(r,20));}})()`);
  const key = async (name, code) => {
    await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: name === 'Escape' ? 27 : name === 'Tab' ? 9 : 40 });
    await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code });
  };
  await wait('document.querySelector("[role=combobox]")');
  assert.equal(await ev('document.querySelectorAll("[role=option]").length'), 0);
  assert.equal(await ev('(()=>{const e=document.querySelector("[role=combobox]");return [...document.querySelectorAll("label")].some(l=>l.htmlFor===e.id && l.textContent==="Decisión");})()'), true);
  await ev('document.querySelector("[role=combobox]").focus()');
  await key('ArrowDown', 'ArrowDown');
  await wait('document.querySelector("[role=option]")');
  assert.equal(await ev('[...document.querySelectorAll("[role=option]")].find(e=>e.textContent.includes("Aplicar corrección")).getAttribute("aria-disabled")'), 'true');
  await key('Escape', 'Escape');
  await wait('!document.querySelector("[role=option]")');
  assert.equal(await ev('document.activeElement.getAttribute("role")'), 'combobox');
  await key('Tab', 'Tab');
  assert.equal(await ev('document.activeElement.name'), 'observations');
  await ev(`(()=>{const e=document.querySelector('textarea[name=observations]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Evidencia sintética incompleta; devolver sin cambios');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirmar decisión');b.click();b.click();})()`);
  await wait('window.fixture.calls.length===1');
  const call = await ev('window.fixture.calls[0]');
  assert.equal(JSON.parse(call.body).decision, 'RETURN');
  assert.equal(await ev('[...document.querySelectorAll("button")].find(b=>b.textContent==="Confirmar decisión").matches(":disabled")'), true);
  await ev('window.fixture.resolve(new Response(null,{status:503}))');
  await wait('document.body.textContent.includes("No se pudo confirmar el resultado")');
  assert.equal(await ev('window.fixture.calls.length'), 1);
  assert.equal(await ev('document.activeElement.getAttribute("role")'), 'status');
  assert.equal(await ev('document.querySelector("textarea[name=observations]").value'), 'Evidencia sintética incompleta; devolver sin cambios');
  assert.equal(await ev('[...document.querySelectorAll("button")].find(b=>b.textContent==="Confirmar decisión").matches(":disabled")'), true);
});
