import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launchChrome,closeTestServer} from './chrome-session.mjs';

// Componentes reales, sesión/Storage/transporte sintéticos. Sin llamadas a Supabase.
test('cédula arbitral: carga, recuperación, vista previa privada y revisión explícita', {timeout:120000}, async t=>{
  const files=['src/features/referees/components/referee-presentations.tsx','src/features/referees/components/operation-fields.tsx','src/components/ui/private-document-preview.tsx','src/components/ui/form-dialog.tsx','src/components/ui/select-field.tsx'];
  const source=(await Promise.all(files.map(f=>readFile(f,'utf8')))).join('\n');
  const compiler=await compile(await readFile('src/app/globals.css','utf8'),{base:resolve('src/app'),onDependency(){}});
  const css=compiler.build(source.split(/[\s"'`<>{}$]+/).concat(['p-5','bg-background','text-foreground']));
  const bundle=await build({write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},plugins:[{name:'fixture-navigation',setup(p){
    p.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'fixture'}));
    p.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='next/navigation'?`export function useRouter(){return {refresh(){}}}`:`import React from 'react';export default function Link({children,...p}){return <a {...p}>{children}</a>}`}));
  }}],stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {RefereePresentations} from './src/features/referees/components/referee-presentations';
    const id=()=>crypto.randomUUID(),actorId=id(),clubId=id(),seasonId=id(),leagueId=id(),personId=id(),requestId=id();
    const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c=>c.charCodeAt(0));window.fixturePng=png;
    window.posts=[];window.failPreview=false;window.pending=false;window.uncertain=false;
    const receipt=()=>({id:requestId,version:1,operationKey:window.posts.at(-1).operationKey});
    window.fetch=async(url,init)=>{
      if(String(url).startsWith('https://storage.example.test/'))return new Response(png,{headers:{'content-type':'image/png'}});
      if(String(url).endsWith('/credential')){window.previewAuthorizations=(window.previewAuthorizations||0)+1;return window.failPreview?Response.json({code:'FORBIDDEN'},{status:403}):Response.json({downloadUrl:'https://storage.example.test/synthetic',expiresInSeconds:60,mimeType:'image/png'})}
      if(init?.method==='POST'){const payload=init.body instanceof FormData?JSON.parse(init.body.get('payload')):JSON.parse(init.body);window.posts.push(payload);window.uploadIsFile=init.body instanceof FormData&&init.body.get('credential') instanceof File;if(window.pending)return new Promise((ok,fail)=>{window.failPost=()=>fail(Error('Respuesta incierta sintética'))});return Response.json(receipt());}
      return Response.json({receipt:null});
    };
    const root=createRoot(document.getElementById('root'));let serial=0;
    window.renderScenario=(mode='delegate')=>{sessionStorage.clear();window.posts=[];window.pending=false;window.failPreview=false;flushSync(()=>root.render(<RefereePresentations key={++serial} workspace={{actorId,clubs:[{id:clubId,name:'Club SINTÉTICO',seasonId,season:'Periodo SINTÉTICO',leagueId,league:'Liga SINTÉTICA',timezone:'America/Mexico_City',canSubmit:mode==='delegate',canReview:mode!=='delegate',canProvisionAccess:false,closed:false,teams:4,presented:0,pending:mode==='delegate'?0:1}],rows:mode==='delegate'?[]:[{id:requestId,clubId,club:'Club SINTÉTICO',seasonId,season:'Periodo SINTÉTICO',status:'PENDING',version:1,name:'Persona SINTÉTICA',reason:'Presentación sintética',requester:'delegado_sintetico',createdAt:'2026-11-14T15:00:00Z',reviewer:null,reviewReason:null,personId,approvedPersonId:null,approvedName:null,refereeId:null,credential:mode==='legacy'?null:{mimeType:'image/png',sizeBytes:png.length,sha256:'a'.repeat(64)}}],people:[{id:personId,label:'Persona SINTÉTICA',clubContexts:[clubId+':'+seasonId],leagueIds:[leagueId],identityVersion:1}]}}/>));};window.renderScenario();
  `}});
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].contents:`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="bg-background text-foreground p-5"><div id="root"></div><script>window.addEventListener('error',e=>window.fixtureError=e.message)</script><script src="/bundle.js"></script></body></html>`);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>closeTestServer(server));
  const browser=await launchChrome(`http://127.0.0.1:${server.address().port}`,{signal:t.signal,waitForDocument:true});t.after(()=>browser.close());
  const ev=s=>browser.evaluate(s);
  const wait=c=>ev(`(async()=>{for(let n=0;n<250;n++){if(window.fixtureError)throw Error(window.fixtureError);if(${c})return;await new Promise(r=>setTimeout(r,15))}throw Error('Falta estado esperado')})()`);
  const frame=()=>ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const click=async label=>{await ev(`(()=>{const dialogs=[...document.querySelectorAll('dialog[open]')],scope=dialogs.at(-1)||document;const b=[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Control no disponible: '+${JSON.stringify(label)});b.focus();b.click()})()`);await frame();};
  const reason=async()=>{await ev(`(()=>{const e=document.querySelector('dialog textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Motivo sintético de revisión');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await frame();};
  await wait(`document.getElementById('presentation-scope')`);
  await ev(`document.getElementById('presentation-scope').click()`);await wait(`document.querySelector('[role=option]')`);await ev(`document.querySelector('[role=option]').click()`);await frame();
  await click('Presentar candidato');
  assert.equal(await ev(`document.querySelector('dialog input[type=file]').required`),true);
  await ev(`document.querySelectorAll('dialog [role=combobox]')[1].click()`);await wait(`document.querySelector('[role=option]')`);await ev(`document.querySelector('[role=option]').click()`);await frame();
  await ev(`(()=>{const d=new DataTransfer();d.items.add(new File([window.fixturePng],'acreditacion-sintetica.png',{type:'image/png'}));const input=document.querySelector('dialog input[type=file]');input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);await frame();await reason();
  await ev(`window.pending=true`);await click('Enviar a Comisión');await wait(`window.posts.length===1`);
  assert.equal(await ev('window.uploadIsFile'),true);assert.match(await ev('window.posts[0].credential.sha256'),/^[a-f0-9]{64}$/);
  assert.equal(await ev(`Object.values(sessionStorage).some(v=>v.includes('iVBOR')||v.includes('acreditacion-sintetica.png'))`),false);
  await ev(`window.failPost()`);await wait(`document.body.textContent.includes('No se pudo confirmar')`);await click('Consultar resultado sin reenviar');await wait(`document.body.textContent.includes('Todavía no existe un acuse')`);
  await ev(`window.pending=false`);await click('Reintentar la misma solicitud');await wait(`!document.querySelector('dialog[open]')`);assert.equal(await ev(`JSON.stringify(window.posts[0])===JSON.stringify(window.posts[1])`),true);
  for(const theme of ['light','dark'])for(const width of [390,1440]){
    await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};window.renderScenario('review')`);
    await click('Revisar a Persona SINTÉTICA');assert.equal(await ev(`[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Incorporar al padrón').disabled`),true);
    await click('Ver cédula arbitral');await wait(`document.querySelector('dialog img')`);assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true);
    await click('Cerrar vista previa');
    assert.equal(await ev('document.activeElement.textContent'),'Ver cédula arbitral');
    await ev(`document.querySelector('dialog input[type=checkbox]').click()`);await frame();assert.equal(await ev(`[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Incorporar al padrón').disabled`),false);
    await reason();await click('Incorporar al padrón');await wait(`!document.querySelector('dialog[open]')`);assert.equal(await ev('window.posts[0].reviewedCredentialSha256'),'a'.repeat(64));
  }
  await ev(`window.renderScenario('legacy')`);await click('Revisar a Persona SINTÉTICA');assert.match(await ev(`document.querySelector('dialog').textContent`),/Falta la cédula/);assert.equal(await ev(`[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Incorporar al padrón').disabled`),true);
  await ev(`window.renderScenario('review');window.failPreview=true`);await click('Revisar a Persona SINTÉTICA');await click('Ver cédula arbitral');await wait(`document.querySelector('dialog:last-of-type [role=alert]')`);assert.match(await ev('document.querySelector("dialog:last-of-type").textContent'),/acceso ya no está disponible/);
});
