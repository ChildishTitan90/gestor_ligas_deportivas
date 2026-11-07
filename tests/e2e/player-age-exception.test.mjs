import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { launchChrome, closeTestServer } from './chrome-session.mjs';

test('PDGLD-104: petición y decisión de excepción en Chrome, transporte sintético', { timeout: 60000 }, async t => {
  const bundle = await build({ write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {AgeExceptionPanel} from './src/features/players/components/age-exception-panel';
    const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),root=createRoot(document.getElementById('root'));
    const initial={registrationId:id(1),applicable:true,status:'DRAFT',fingerprint:'a'.repeat(64),requestId:null,documentId:id(3),requestReason:null,decisionReason:null,canRequest:true,canReview:false,rule:{referenceYear:2026,minimumAge:14,maximumAge:16,exceptionMinimumAge:13,registrationDays:[1,2,3],timezone:'America/Mexico_City'}};
    let state={...initial},receipt=null,mode='delegate',calls=[],failOnce=true,releaseInitial=null;
    const fake=async(url,options={})=>{
      const method=options.method??'GET';calls.push({url,method,body:options.body,actor:options.headers?.['X-Expected-Actor-Id']});
      if(method==='GET'){
        if(mode==='loading')return new Promise(resolve=>{releaseInitial=()=>resolve(Response.json(state));});
        if(mode==='denied')return Response.json({code:'FORBIDDEN'},{status:403});
        if(url.includes('?operationKey='))return Response.json(receipt??{confirmed:false,registrationId:id(1),operationKey:url.split('=')[1]});
        return Response.json(state);
      }
      const body=JSON.parse(options.body);
      receipt={confirmed:true,registrationId:id(1),operationKey:body.operationKey,requestId:body.action==='REQUEST'?id(8):state.requestId,action:body.action};
      state={...state,status:body.action==='REQUEST'?'PENDING':body.decision==='APPROVE'?'APPROVED':'REJECTED',requestId:receipt.requestId,canRequest:false,canReview:false};
      if(failOnce){failOnce=false;throw Error('Synthetic lost response');}return Response.json(receipt);
    };
    window.fixture={get calls(){return calls},render(next){mode=next;receipt=null;calls=[];failOnce=true;
      state=next==='secretary'?{...initial,status:'PENDING',requestId:id(8),canRequest:false,canReview:true,requestReason:'Carta presentada por el delegado'}:next==='none'?{...initial,applicable:false,status:'NOT_REQUIRED',canRequest:false}:next==='stale'?{...initial,status:'STALE'}:{...initial};
      flushSync(()=>root.render(<AgeExceptionPanel key={next} actorId={id(next==='secretary'?20:10)} registrationId={id(1)} fetcher={fake}/>));},setDenied(){mode='denied';},releaseInitial(){mode='delegate';releaseInitial();}};
    window.fixture.render('delegate');
  `} });
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].contents:'<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script></html>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>closeTestServer(server));
  const browser=await launchChrome(`http://127.0.0.1:${server.address().port}`,{signal:t.signal,commandTimeoutMs:10000,waitForDocument:true});t.after(()=>browser.close());
  const ev=expression=>browser.evaluate(expression);
  const wait=expression=>ev(`(async()=>{const until=Date.now()+5000;while(!(${expression})){if(Date.now()>until)throw Error('Condición no alcanzada: '+${JSON.stringify(expression)});await new Promise(r=>setTimeout(r,20));}})()`);
  const click=label=>ev(`(()=>{const n=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(label)}&&!n.disabled);if(!n)throw Error('Botón no disponible: '+${JSON.stringify(label)});n.click();})()`);
  const reason=value=>ev(`(()=>{const n=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait('document.querySelector("textarea")');
  await t.test('motivo vacío enfoca su campo y no envía',async()=>{
    await click('Solicitar revisión a Secretaría');assert.equal(await ev('document.activeElement===document.querySelector("textarea")'),true);
    assert.equal(await ev('window.fixture.calls.filter(c=>c.method==="POST").length'),0);
  });
  await t.test('respuesta perdida conserva el envío; reintento usa el mismo cuerpo',async()=>{
    await reason('Carta sintética para que Secretaría revise la excepción');await click('Solicitar revisión a Secretaría');await wait('document.body.textContent.includes("No se confirmó")');
    assert.equal(await ev('document.querySelector("textarea").disabled'),true);
    await click('Reintentar el mismo envío');await wait('document.body.textContent.includes("Petición enviada")');
    const calls=await ev('window.fixture.calls.filter(c=>c.method==="POST")');assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);
    assert.equal(await ev('[...document.querySelectorAll("button")].some(n=>n.textContent==="Aceptar excepción")'),false);
  });
  await t.test('Secretaría confirma una decisión y recupera su acuse sin otro POST',async()=>{
    await ev('window.fixture.render("secretary")');await wait('document.querySelector("textarea")');await reason('Carta revisada por Secretaría');await click('Aceptar excepción');
    await wait('document.querySelector("dialog[open]")');assert.equal(await ev('window.fixture.calls.filter(c=>c.method==="POST").length'),0);
    await click('Confirmar decisión');await wait('document.body.textContent.includes("No se confirmó")');await click('Consultar resultado del envío');
    await wait('document.body.textContent.includes("El servidor confirmó")');assert.equal(await ev('window.fixture.calls.filter(c=>c.method==="POST").length'),1);
    assert.equal(await ev('document.body.textContent.includes("Excepción de edad aceptada")'),true);
    assert.equal(await ev('document.body.textContent.includes("no habilita automáticamente")'),true);
  });
  await t.test('pérdida de acceso retira motivos privados y acciones',async()=>{
    await ev('window.fixture.setDenied()');await click('Actualizar estado');await wait('!document.querySelector("textarea")');
    assert.equal(await ev('document.body.textContent.includes("Carta presentada por el delegado")'),false);
    assert.equal(await ev('[...document.querySelectorAll("button")].some(n=>n.textContent==="Aceptar excepción")'),false);
  });
  await t.test('la consulta inicial bloquea otro refresco y permite continuar al recibir el estado',async()=>{
    await ev('window.fixture.render("loading")');
    await wait('window.fixture.calls.length===1');
    assert.equal(await ev('[...document.querySelectorAll("button")].filter(n=>n.textContent.includes("estado")||n.textContent.includes("Consultando")).every(n=>n.disabled)'),true);
    await ev('window.fixture.releaseInitial()');await wait('document.querySelector("textarea")');
    assert.equal(await ev('[...document.querySelectorAll("button")].find(n=>n.textContent==="Actualizar estado").disabled'),false);
    assert.equal(await ev('window.fixture.calls.length'),1);
  });
  await t.test('cambiar a un registro sin excepción retira el panel anterior',async()=>{
    await ev('window.fixture.render("none")');await wait('document.querySelector("section")==null');
  });
});
