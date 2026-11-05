import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { launchChrome, closeTestServer } from './chrome-session.mjs';

test('Tutor: firma real en canvas, documento ligado al menor y recepción pendiente con transporte sintético', { timeout: 45000 }, async t => {
  const bundle = await build({ write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {PDFDocument,decodePDFRawStream,PDFRawStream} from 'pdf-lib';
      import {PlayerDossier} from './src/features/players/components/player-dossier';
      import {guardianSignatureSchema} from './src/features/players/guardian-signature';
      const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
      const root=createRoot(document.getElementById('root'));
      const calls=[];let upload,uploadMime,completed=false;
      const dossier=minor=>({player:{displayName:'Jugador Sintetico del Expediente',teamName:'Equipo',clubName:'Club',seasonName:'Temporada'},registrationId:id(2),registrationStatus:'INELIGIBLE',configuration:'CONFIGURED',configurationIssues:[],
        approvalAllowed:false,referenceDate:'2026-11-04',minorAtRegistration:minor,canUpload:true,guardianConsent:minor?'REQUIRES_ACCREDITATION':'NOT_REQUIRED',
        requirements:[{id:id(3),typeId:id(4),quantity:1,required:true,recorded:completed?1:0,approved:0,missing:completed?0:1}],
        documentTypes:[{id:id(4),code:'GUARDIAN_CONSENT',name:'Autorización del tutor'}],
        documents:completed?[{id:id(5),typeId:id(4),reviewStatus:'PENDING',superseded:false,requirementId:id(3),slot:1,storageConfirmation:'CONFIRMED'}]:[]});
      window.fetch=async(url,options)=>{
        calls.push({url,method:options?.method??'GET'});
        if(url==='/api/auth/session')return Response.json({user:{id:id(1)}});
        if(url==='/api/player-documents/uploads')return Response.json({uploadId:id(6),uploadPath:'/api/player-documents/uploads/'+id(6)});
        if(url==='/api/player-documents/uploads/'+id(6) && options?.method==='PUT'){upload=options.body;uploadMime=options.headers['Content-Type'];return Response.json({stored:true});}
        if(url==='/api/player-documents/uploads/'+id(6)+'/confirm'){completed=true;return Response.json({documentId:id(5)});}
        if(url==='/api/player-registrations/'+id(2)+'/documents')return Response.json(dossier(true));
        throw Error('Unexpected synthetic endpoint');
      };
      window.fixture={calls,render(minor=true){flushSync(()=>root.render(<PlayerDossier key={String(minor)} actorId={id(1)} initial={dossier(minor)} storageConfigured/>));},
        async received(){const pdf=await PDFDocument.load(await upload.arrayBuffer());return {type:uploadMime,pages:pdf.getPageCount(),title:pdf.getTitle(),hasPlayerName:pdf.context.enumerateIndirectObjects().some(([,object])=>object instanceof PDFRawStream && new TextDecoder().decode(decodePDFRawStream(object).decode()).includes('4A756761646F723A204A756761646F722053696E74657469636F2064656C20457870656469656E7465'))};},
        rejectsAuthority:!guardianSignatureSchema.safeParse({registrationId:id(2),guardianName:'Persona sintética',relationship:'MOTHER',acknowledgesRecord:true,approved:true}).success};
      window.fixture.render();
    ` }, plugins: [{ name: 'synthetic-next-image', setup(plugin) {
      plugin.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "import React from 'react';export default function Image({unoptimized,...props}){return React.createElement('img',props)}", resolveDir: process.cwd() }));
    } }],
  });
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type','text/javascript'); response.end(bundle.outputFiles[0].contents); }
    else { response.setHeader('Content-Type','text/html'); response.end('<!doctype html><style>#root{width:650px}canvas{display:block;width:100%}fieldset{min-width:0}</style><div id="root"></div><script src="/bundle.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => closeTestServer(server));
  const browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, { signal: t.signal, commandTimeoutMs: 15000, waitForDocument: true });
  t.after(() => browser.close());
  const evaluate = expression => browser.evaluate(expression);
  const wait = expression => evaluate(`(async()=>{const until=Date.now()+5000;while(!(${expression})){if(Date.now()>until)throw Error('Tutor: condición pendiente: '+${JSON.stringify(expression)});await new Promise(r=>setTimeout(r,20));}})()`);
  const click = text => evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Botón no disponible: '+${JSON.stringify(text)});b.click();})()`);
  await wait('window.fixture && document.getElementById("document-requirement")');
  async function select(id, text) {
    await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    await wait('document.querySelector("[role=option]")');
    await evaluate(`Array.from(document.querySelectorAll('[role=option]')).find(o=>o.textContent.includes(${JSON.stringify(text)})).click()`);
  }
  await select('document-requirement','Autorización del tutor');
  await wait('document.querySelector("canvas")');
  assert.equal(await evaluate('window.fixture.calls.length'),0,'Capturar no envía solicitudes');
  await evaluate(`(()=>{const n=document.getElementById('guardian-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'Ana Pérez Sintética');n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await select('guardian-relationship','Madre');
  const box = await evaluate(`(()=>{const b=document.querySelector('canvas').getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};})()`);
  // Bring the canvas into view before issuing real pointer events.
  await evaluate('document.querySelector("canvas").scrollIntoView()');
  const position = await evaluate(`(()=>{const b=document.querySelector('canvas').getBoundingClientRect();return {x:b.x,y:b.y};})()`);
  await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',x:position.x+30,y:position.y+30,button:'left',buttons:1,clickCount:1});
  for(let n=1;n<=10;n++)await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:position.x+30+box.w*.5*n/10,y:position.y+30+30*n/10,button:'left',buttons:1});
  await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:position.x+30+box.w*.5,y:position.y+60,button:'left',buttons:0,clickCount:1});
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await click('Ver vista previa');await wait('document.querySelector("img")');await click('Confirmar captura');
  await evaluate('document.querySelector("#guardian-capture-message").parentElement.querySelector("input[type=checkbox]").click()');
  await wait('!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Preparar documento con firma").disabled');
  await click('Preparar documento con firma');
  await wait('document.body.textContent.includes("Documento con firma preparado")');
  assert.equal(await evaluate('window.fixture.calls.length'),0,'Preparar conserva el PDF solo en memoria');
  // Editing the signer invalidates the prepared evidence.
  await evaluate(`(()=>{const n=document.getElementById('guardian-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'Ana Pérez Sintética Dos');n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Guardar documento").disabled');
  await click('Preparar documento con firma');await wait('document.body.textContent.includes("Documento con firma preparado")');
  await click('Guardar documento');await wait('document.body.textContent.includes("Archivo recibido y asociado")');
  assert.deepEqual(await evaluate('window.fixture.received()'),{type:'application/pdf',pages:1,title:'Firma de tutor pendiente de revision',hasPlayerName:true});
  assert.equal(await evaluate('window.fixture.calls.filter(c=>c.method==="PUT").length'),1);
  assert.equal(await evaluate('window.fixture.rejectsAuthority'),true);
  assert.equal(await evaluate('document.body.textContent.includes("Pendiente de revisión")'),true);
  await evaluate('window.fixture.render(false)');await select('document-requirement','Autorización del tutor');
  assert.equal(await evaluate('document.querySelector("canvas")===null'),true,'Un adulto no recibe captura del tutor');
});
