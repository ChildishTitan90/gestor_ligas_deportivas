import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("PDGLD-95: doble envío, acuse inválido, conflictos y descarte", { timeout: 45000 }, async () => {
 const bundle = await build({write:false,bundle:true,platform:"browser",format:"iife",define:{"process.env.NODE_ENV":'"development"'},
 plugins:[{name:"router-fixture",setup(p){p.onResolve({filter:/^next\/navigation$/},()=>({path:"router",namespace:"fixture"}));p.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export function useRouter(){return {refresh(){window.refreshes++;queueMicrotask(()=>window.afterRefresh?.())}}}"}));}}],
 stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';
 import {createRoot} from 'react-dom/client';
 import {flushSync} from 'react-dom';
 import {ConfigurationForm} from './src/features/competitions/components/configuration-form';
 import {RuleParameter} from './src/features/competitions/components/rule-parameter';
 import {PlayerPolicyFields} from './src/features/competitions/components/player-policy-fields';
 import {TieBreakerFields} from './src/features/competitions/components/tie-breaker-fields';
 const check=(v,m)=>{if(!v)throw Error(m)};
 const wait=async fn=>{for(let n=0;n<300;n++){if(fn())return;await new Promise(r=>setTimeout(r,10))}throw Error('timeout '+fn)};
 const set=(name,value)=>{const input=document.querySelector('dialog[open] [name="'+name+'"]')??document.querySelector('[name="'+name+'"]');const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;flushSync(()=>{Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});};
 window.refreshes=0;
 let root=createRoot(document.getElementById('root')),resolve,posts=[];
 window.fetch=(url,init)=>{posts.push({url,init});return new Promise(r=>resolve=r)};
 function fixture(modal=false){return <ConfigurationForm title="Guardar grupo" endpoint="/synthetic/groups" version={7} modal={modal}><label>Nombre<input name="name" required defaultValue="Grupo A"/></label></ConfigurationForm>}
 const mount=(element)=>{root.unmount();root=createRoot(document.getElementById('root'));flushSync(()=>root.render(element));};
 const send=()=>flushSync(()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 window.testDone=(async()=>{
 flushSync(()=>root.render(fixture()));set('reason','Prueba sintética');send();send();
 check(posts.length===1,'double submit sent two requests');check(document.querySelector('fieldset').disabled,'pending controls enabled');
 check(JSON.parse(posts[0].init.body).expectedSeasonVersion===7,'lost expected version');
 // Reenvío en el microtask del acuse, antes de que React confirme el render.
 // Esto reproduce la carrera sin depender de la velocidad de Windows o Linux.
 window.afterRefresh=()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 resolve(new Response(JSON.stringify({id:'synthetic-id'}),{status:200}));await wait(()=>window.refreshes===1);
 window.afterRefresh=null;
 send();check(posts.length===1,'acknowledged operation resent');
 mount(fixture());set('reason','Resultado inválido');send();resolve(new Response('{}',{status:200}));await wait(()=>document.body.textContent.includes('No se pudo confirmar'));
 send();check(posts.length===2,'invalid ack allowed retry');check(window.refreshes===1,'invalid ack treated as success');
 mount(fixture());set('reason','Conflicto');send();resolve(new Response(JSON.stringify({code:'SEASON_DATES_IN_USE'}),{status:409}));await wait(()=>document.body.textContent.includes('No se pueden cambiar las fechas'));
 check(document.querySelector('fieldset').disabled,'conflict did not freeze stale capture');
 mount(fixture(true));const trigger=document.querySelector('button');trigger.focus();flushSync(()=>trigger.click());await wait(()=>document.querySelector('dialog')?.open);
 await new Promise(r=>requestAnimationFrame(r));set('name','Descartar este nombre');
 flushSync(()=>Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent==='Cancelar').click());
 await wait(()=>document.body.textContent.includes('¿Descartar los cambios sin guardar?'));
 flushSync(()=>Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent==='Descartar cambios').click());
 await wait(()=>!document.querySelector('dialog')?.open);check(document.activeElement===trigger,'focus not restored');
 flushSync(()=>trigger.click());await wait(()=>document.querySelector('dialog')?.open);check(document.querySelector('[name=name]').value==='Grupo A','discard did not reset');
 mount(<RuleParameter parameter={{key:'points',value:{win:3,draw:1,loss:0},requiresValidation:true}}/>);
 check(document.body.textContent.includes('Victoria')&&document.body.textContent.includes('3 puntos'),'rule not readable');check(!document.querySelector('pre'),'raw JSON leaked');
 mount(<ConfigurationForm title="Guardar reglas" endpoint="/synthetic/player-policy" method="PATCH" version={8}><PlayerPolicyFields value={null} type="YOUTH" /></ConfigurationForm>);
 set('referenceYear','2026');set('minimumAge','14');set('maximumAge','16');set('exceptionMinimumAge','13');set('playersOnField','9');set('reason','Configurar categoría sintética');send();
 const request=posts[posts.length-1],policy=JSON.parse(request.init.body);
 check(request.init.method==='PATCH'&&policy.expectedSeasonVersion===8,'lost policy method or version');
 check(policy.policy.minimumAge===14&&policy.policy.maximumAge===16&&policy.policy.exceptionMinimumAge===13,'lost age ranges');
 check(policy.policy.maximumRoster===null&&policy.policy.maximumCalledUp===null,'empty maximum converted to zero');
 check(JSON.stringify(policy.policy.registrationDays)==='[1,2,3]'&&policy.policy.documents.includes('SCHOOL_CREDENTIAL'),'lost repeated checkbox values');
 check(!('minimumAge' in policy)&&policy.reason==='Configurar categoría sintética','policy envelope invalid');
 resolve(new Response(JSON.stringify({id:'synthetic-id'}),{status:200}));await wait(()=>window.refreshes===2);
 mount(<ConfigurationForm title="Cerrar temporada" endpoint="/synthetic/close" version={9}><input name="confirm" defaultValue="CERRAR" /></ConfigurationForm>);
 set('reason','Cierre sintético');send();resolve(new Response(JSON.stringify({code:'UNRESOLVED_MATCHES'}),{status:409}));await wait(()=>document.body.textContent.includes('El capturista debe completarlos'));
 mount(<ConfigurationForm title="Crear categoría" endpoint="/api/competitions/categories" version={9} fixed={{leagueId:'synthetic-league'}}><input name="name" defaultValue="Sub-15" /></ConfigurationForm>);
 set('reason','Categoría duplicada');send();resolve(new Response(JSON.stringify({code:'CATEGORY_ALREADY_EXISTS'}),{status:409}));
 await wait(()=>document.body.textContent.includes('Ese nombre ya existe en el catálogo'));
 check(!document.querySelector('fieldset').disabled,'duplicate catalog name blocked correction');
 const beforeRetry=posts.length;set('name','Sub-16');send();check(posts.length===beforeRetry+1,'corrected name could not be submitted');
 check(JSON.parse(posts[posts.length-1].init.body).name==='Sub-16','retry lost corrected name');
 resolve(new Response(JSON.stringify({id:'new-category'}),{status:201}));await wait(()=>document.querySelector('fieldset').disabled);
 mount(<ConfigurationForm title="Crear reglas" endpoint="/synthetic/configuration" version={10}><input name="announcement" defaultValue="Prueba"/><input name="win" defaultValue="3"/><input name="draw" defaultValue="1"/><input name="loss" defaultValue="0"/><input name="rounds" defaultValue="1"/><input name="matchDurationMinutes" defaultValue="60"/><TieBreakerFields /></ConfigurationForm>);
 const pick=async(index,label)=>{flushSync(()=>document.querySelectorAll('[role=combobox]')[index].click());await wait(()=>document.querySelectorAll('[role=option]').length>0);const option=Array.from(document.querySelectorAll('[role=option]')).find(el=>el.textContent.includes(label));check(option,'missing tie breaker option');flushSync(()=>option.click());};
 await pick(0,'Diferencia de goles');
 flushSync(()=>document.querySelectorAll('[role=combobox]')[1].click());await wait(()=>document.querySelectorAll('[role=option]').length>0);
 const duplicate=Array.from(document.querySelectorAll('[role=option]')).find(el=>el.textContent.includes('Diferencia de goles'));
 check(!duplicate||duplicate.getAttribute('aria-disabled')==='true','duplicate option is selectable');
 const red=Array.from(document.querySelectorAll('[role=option]')).find(el=>el.textContent.includes('Tarjetas rojas'));flushSync(()=>red.click());
 await pick(2,'Tarjetas amarillas');set('reason','Orden elegido por organizador');send();
 check(JSON.stringify(JSON.parse(posts[posts.length-1].init.body).tieBreakers)==='["GOAL_DIFFERENCE","RED_CARDS","YELLOW_CARDS"]','lost selected tie breaker order');
 resolve(new Response(JSON.stringify({id:'rules-with-order'}),{status:201}));await wait(()=>document.querySelector('form > fieldset').disabled);
 mount(<RuleParameter parameter={{key:'tieBreakers',value:['RED_CARDS','YELLOW_CARDS','Texto histórico'],requiresValidation:true}}/>);
 check(document.body.textContent.includes('menos es mejor')&&document.body.textContent.includes('Texto histórico'),'lost card meaning or historical rules');
 root.unmount();return true;
 })();
 `}});
  const controlsCss = await readFile(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
  const server = createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].contents); }
    else if (request.url === "/controls.css") { response.setHeader("Content-Type", "text/css"); response.end(controlsCss.replace(/^@import.*$/gm,'')); }
    else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><link rel="stylesheet" href="/controls.css"><div id="root"></div><script src="/bundle.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = await mkdtemp(join(tmpdir(), "pdgld63-browser-"));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const chrome = spawn(process.env.CHROME_BIN ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"), [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, origin,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let socket;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = "";
      chrome.once("error", reject); chrome.once("exit", code => reject(new Error(`Chrome exited: ${code}`)));
      chrome.stderr.on("data", chunk => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); });
    });
    const base = new URL(endpoint); const listUrl = `http://${base.host}/json/list`;
    let page;
    for (let n = 0; n < 100 && !page; n++) { page = (await (await fetch(listUrl)).json()).find(target => target.url.startsWith(origin)); if (!page) await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.ok(page, "Missing synthetic page");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let commandId = 0;
    const evaluate = () => new Promise((resolve, reject) => {
      const id = ++commandId;
      const listener = event => { const message = JSON.parse(event.data); if (message.id !== id) return;
        socket.removeEventListener("message", listener);
        if (message.result?.exceptionDetails || message.error) reject(new Error("Browser assertion failed: " + JSON.stringify(message.result?.exceptionDetails ?? message.error)));
        else resolve(message.result.result.value);
      };
      socket.addEventListener("message", listener);
      socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: "(async()=>{while(!window.testDone)await new Promise(r=>setTimeout(r,10));return await window.testDone})()", awaitPromise: true, returnByValue: true } }));
    });
    let result;
    for (let attempt = 0; attempt < 5; attempt++) {
      try { result = await evaluate(); break; }
      catch (error) { if (!error.message.includes("Execution context was destroyed") || attempt === 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.equal(result, true);
  } finally { socket?.close(); chrome.kill(); await new Promise(resolve => server.close(resolve)); }
});
