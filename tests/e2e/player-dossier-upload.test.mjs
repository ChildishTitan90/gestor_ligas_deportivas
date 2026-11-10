import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchChrome,closeTestServer} from './chrome-session.mjs';

test('Expediente: selector único, cámara alternativa, vista previa y sustitución sin duplicar envíos', {timeout:45000},async t=>{
  const css=process.env.PLAYER_DOSSIER_VISUAL_CSS?await readFile(process.env.PLAYER_DOSSIER_VISUAL_CSS,'utf8'):'';
  const shots=css?await mkdtemp(join(tmpdir(),'pdgld-document-ui-')):null;
  const bundle=await build({write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {PDFDocument} from 'pdf-lib';import {PlayerDossier} from './src/features/players/components/player-dossier';
    const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    const documents=[{id:id(9),typeId:id(4),reviewStatus:'PENDING',superseded:false,requirementId:id(3),slot:1,storageConfirmation:'CONFIRMED'}];
    const dossier=()=>({registrationId:id(2),configuration:'CONFIGURED',configurationIssues:[],approvalAllowed:false,referenceDate:'2026-11-04',minorAtRegistration:false,canUpload:true,guardianConsent:'NOT_REQUIRED',
      requirements:[{id:id(3),typeId:id(4),quantity:1,required:true,recorded:1,approved:0,missing:0},{id:id(5),typeId:id(6),quantity:1,required:false,recorded:0,approved:0,missing:0},{id:id(7),typeId:id(8),quantity:2,required:true,recorded:0,approved:0,missing:2}],
      documentTypes:[{id:id(4),code:'CURP',name:'CURP'},{id:id(6),code:'PHOTO',name:'Foto del jugador'},{id:id(8),code:'INE',name:'INE'}],documents});
    const calls=[],intents=new Map();let counter=30,pickerClicks=0,failConfirmation=false;const root=createRoot(document.getElementById('root'));
    const nativeInputClick=HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click=function(){if(this.type==='file'){pickerClicks++;return;}return nativeInputClick.call(this);};
    Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{throw new DOMException('synthetic denied','NotAllowedError');}}});
    window.fetch=async(url,options)=>{
      const method=options?.method??'GET';calls.push({url,method,body:method==='POST'?JSON.parse(options.body):null});
      if(url==='/api/auth/session')return Response.json({user:{id:id(1)}});
      if(url==='/api/player-documents/uploads'){const uploadId=id(counter++);intents.set(uploadId,JSON.parse(options.body));return Response.json({uploadId,uploadPath:'/api/player-documents/uploads/'+uploadId});}
      if(method==='PUT')return Response.json({stored:true});
      if(url.endsWith('/confirm')){
        if(failConfirmation){failConfirmation=false;return Response.json({code:'STORAGE_UNCONFIRMED'},{status:503});}
        const body=intents.get(url.split('/').at(-2)),typeId=body.requirementId===id(3)?id(4):body.requirementId===id(5)?id(6):id(8),documentId=id(counter++);
        if(body.replacesDocumentId)documents.find(d=>d.id===body.replacesDocumentId).superseded=true;
        documents.push({id:documentId,typeId,reviewStatus:'PENDING',superseded:false,requirementId:body.requirementId,slot:body.slot,storageConfirmation:'CONFIRMED'});
        return Response.json({documentId});
      }
      if(url==='/api/player-registrations/'+id(2)+'/documents')return Response.json(dossier());
      throw Error('Unexpected synthetic endpoint');
    };
    window.fixture={calls,get pickerClicks(){return pickerClicks;},fail(){failConfirmation=true;},async choose(kind){
      let file;if(kind==='pdf'){const p=await PDFDocument.create();p.addPage();file=new File([await p.save()],'constancia.pdf',{type:'application/pdf'});}
      else if(kind==='invalid')file=new File(['invalid'],'archivo.txt',{type:'text/plain'});
      else file=new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'foto.png',{type:'image/png'});
      const input=document.getElementById('document-file'),data=new DataTransfer();data.items.add(file);input.files=data.files;flushSync(()=>input.dispatchEvent(new Event('change',{bubbles:true})));
    }};
    flushSync(()=>root.render(<PlayerDossier actorId={id(1)} initial={dossier()} storageConfigured/>));
  `},plugins:[{name:'synthetic-next-image',setup(plugin){
    plugin.onResolve({filter:/^next\/image$/},()=>({path:'image',namespace:'fixture'}));
    plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"import React from 'react';export default function Image({unoptimized,...props}){return React.createElement('img',props)}",resolveDir:process.cwd()}));
  }}]});
  const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/bundle.js'?'text/javascript':'text/html');response.end(request.url==='/bundle.js'?bundle.outputFiles[0].contents:`<!doctype html><html lang="es" data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root" class="mx-auto w-full max-w-5xl p-5"></div><script src="/bundle.js"></script></html>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>closeTestServer(server));
  const browser=await launchChrome(`http://127.0.0.1:${server.address().port}`,{signal:t.signal,commandTimeoutMs:15000,waitForDocument:true});t.after(()=>browser.close());
  const evaluate=expression=>browser.evaluate(expression);
  const wait=expression=>evaluate(`(async()=>{const until=Date.now()+5000;while(!(${expression})){if(Date.now()>until)throw Error('Expediente: condición pendiente: '+${JSON.stringify(expression)});await new Promise(r=>setTimeout(r,20));}})()`);
  const click=text=>evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Botón no disponible: '+${JSON.stringify(text)});b.focus();b.click();})()`);
  async function screenshot(name,width,height,theme){
    if(!shots)return;
    await browser.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.getElementById('dossier-upload-form').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Sin desbordamiento con estilos reales');
    assert.equal(await evaluate('document.querySelector("button[aria-controls=document-file]").getBoundingClientRect().height>=48'),true);
    const result=await browser.command('Page.captureScreenshot',{format:'png'}),path=join(shots,name+'.png');
    await writeFile(path,Buffer.from(result.data,'base64'));console.log(`Captura sintética: ${path}`);
  }
  await wait('window.fixture');await click('Sustituir CURP');
  await wait('document.getElementById("document-file")');
  assert.equal(await evaluate('document.getElementById("document-slot")===null'),true,'Un documento individual no pide posición');
  assert.equal(await evaluate('document.querySelectorAll("input[type=file]").length'),1);
  assert.equal(await evaluate('document.getElementById("document-file").multiple'),false);
  await click('Elegir archivo');assert.equal(await evaluate('window.fixture.pickerClicks'),1,'El botón abre el selector nativo');
  await click('Tomar foto');await wait('document.body.textContent.includes("No se autorizó la cámara")');
  assert.equal(await evaluate('!document.querySelector("input[capture]")'),true,'La alternativa de cámara no agrega otro selector');
  await evaluate('window.fixture.choose("pdf")');await wait('document.querySelector("a[href^=blob]")');
  await screenshot('documento-escritorio-oscuro',1280,900,'dark');
  assert.equal(await evaluate('window.fixture.calls.length'),0,'Elegir y previsualizar no envía el archivo');
  await click('Quitar archivo');await wait('!document.querySelector("a[href^=blob]")');
  assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Sustituir documento").disabled'),true);
  await evaluate('window.fixture.choose("invalid")');await wait('document.body.textContent.includes("Elige un archivo PNG")');
  await evaluate('window.fixture.choose("pdf")');await wait('document.querySelector("a[href^=blob]")');await click('Sustituir documento');
  await wait('document.body.textContent.includes("Archivo recibido y asociado")');
  const body=await evaluate('window.fixture.calls.find(c=>c.url==="/api/player-documents/uploads").body');
  assert.equal(body.slot,1);assert.equal(body.replacesDocumentId,'00000000-0000-4000-8000-000000000009');
  await click('Adjuntar otro documento');await click('Adjuntar Foto del jugador');await wait('document.getElementById("document-file")');
  assert.equal(await evaluate('document.getElementById("document-file").accept'),'image/jpeg,image/png');
  await click('Elegir foto');assert.equal(await evaluate('window.fixture.pickerClicks'),2);
  await evaluate('window.fixture.choose("pdf")');await wait('document.body.textContent.includes("Elige una foto PNG")');
  await evaluate('window.fixture.choose("png")');await wait('document.querySelector("img")');
  await screenshot('foto-movil-claro',375,812,'light');
  await click('Guardar foto');await wait('document.body.textContent.includes("Archivo recibido y asociado")');
  await click('Adjuntar otro documento');await click('Adjuntar INE');await wait('document.getElementById("document-slot")');
  await wait('document.activeElement.id==="document-requirement"');
  await evaluate('document.getElementById("document-slot").click()');await wait('document.querySelector("[role=option]")');
  await evaluate('Array.from(document.querySelectorAll("[role=option]")).find(o=>o.textContent.includes("Archivo 2 de 2")).click()');
  await evaluate('window.fixture.choose("png");window.fixture.fail()');await wait('document.querySelector("img")');
  await click('Guardar documento');await wait('document.body.textContent.includes("No se pudo confirmar el resultado")');
  assert.equal(await evaluate('document.getElementById("document-file").disabled'),true,'La incertidumbre no permite cambiar el archivo');
  await click('Reintentar este envío');await wait('document.body.textContent.includes("Archivo recibido y asociado")');
  const operations=await evaluate('window.fixture.calls.filter(c=>c.url==="/api/player-documents/uploads").map(c=>c.body)');
  assert.equal(operations.length,3);assert.equal(operations[2].slot,2);
  assert.equal(await evaluate('window.fixture.calls.filter(c=>c.method==="PUT").length'),3,'El reintento de confirmación no vuelve a subir los bytes');
});
