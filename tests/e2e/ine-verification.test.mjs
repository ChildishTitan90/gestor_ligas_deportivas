import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Navegador real, todas las respuestas sintéticas; sin Next, base, Storage ni proveedor.
test('INE: solo lectura, envío explícito, doble envío e incertidumbre en navegador', {timeout:45000}, async () => {
  const bundle = await build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
    define:{'process.env.NODE_ENV':'"development"'},stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {IneVerificationPanel} from './src/features/players/components/ine-verification-panel';
      import {PlayerDossier} from './src/features/players/components/player-dossier';
      import {CurpVerificationPanel} from './src/features/players/components/curp-verification-panel';
      const nativeFetch=window.fetch.bind(window);
      const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
      const actor=id(1), registrationId=id(2);
      const initial={registrationId,applicable:true,canSubmit:false,identityVersion:1,attemptId:null,status:'NOT_STARTED',approvalAllowed:false};
      // Cámara exclusivamente sintética: ningún permiso ni dispositivo físico.
      const cameraRequests=[],cameraStreams=[];let denyCamera=true,lateCamera=false,resolveCamera;
      const syntheticCamera=()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;canvas.getContext('2d').fillRect(0,0,640,480);const stream=canvas.captureStream(5);cameraStreams.push(stream);return stream;};
      Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async options=>{
        cameraRequests.push(options);if(denyCamera)throw new DOMException('Synthetic denied','NotAllowedError');
        if(lateCamera)return new Promise(resolve=>{resolveCamera=resolve;});return syntheticCamera();
      }}});
      const root=createRoot(document.getElementById('root'));
      const check=(v,m)=>{if(!v)throw Error(m);};
      const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
      let posts=0,gets=0,late;
      window.fetch=async (url,options)=>{
        if(options?.method==='POST'){
          posts++;check(options.headers['X-Expected-Actor-Id']===actor,'Missing actor');
          const intent=JSON.parse(options.body.get('intent'));
          check(intent.acknowledgeCharge===true && intent.retryOf===null,'Wrong explicit intent');
          check(options.body.get('selfie') instanceof File,'Selfie missing');
          return new Promise((resolve,reject)=>{late=()=>reject(Error('Synthetic lost response'));});
        }
        gets++;return Response.json({...initial,canSubmit:true,attemptId:id(3),status:'UNCERTAIN'});
      };
      (async()=>{
        flushSync(()=>root.render(<IneVerificationPanel actorId={actor} initial={initial}/>));
        check(!document.querySelector('input[type=file]'),'Read-only account can capture');
        check(posts===0 && gets===0,'Render contacted provider');
        flushSync(()=>root.render(<IneVerificationPanel key="editable" actorId={actor} initial={{...initial,canSubmit:true}}/>));
        check(cameraRequests.length===0,'Camera started without explicit click');
        const activate=()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Activar cámara');
        flushSync(()=>activate().click());await wait(()=>document.body.textContent.includes('No se autorizó la cámara'));
        check(document.querySelector('[name=front]'),'Permission denial removed file fallback');
        denyCamera=false;flushSync(()=>activate().click());
        await wait(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Tomar esta foto' && !b.disabled));
        check(cameraRequests.at(-1).audio===false && cameraRequests.at(-1).video.facingMode.ideal==='environment','Wrong camera or microphone requested');
        flushSync(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Tomar esta foto').click());
        await wait(()=>document.querySelector('.ine-capture-preview img'));
        check(cameraStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')),'Capture left camera running');
        check(posts===0 && gets===0,'Taking a photo contacted a provider');
        const form=document.querySelector('form');check(form,'Capture missing');
        check(!document.querySelector('[name=charge]'),'Consent should appear at final review only');
        check(document.querySelectorAll('input[name=front]').length===1 && !document.querySelector('[name=back]'),'Capture did not start with front only');
        for(const [p,next] of [['front','Continuar al reverso'],['back','Continuar a la selfie'],['selfie','Revisar imágenes']]){
          const files=new DataTransfer();
          const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
          files.items.add(new File([png],p+'.png',{type:'image/png'}));
          const input=document.querySelector('[name='+p+']');input.files=files.files;
          flushSync(()=>input.dispatchEvent(new Event('change',{bubbles:true})));
          if(p==='back'){
            flushSync(()=>activate().click());await wait(()=>cameraStreams.length===2);
          }
          if(p==='selfie'){
            lateCamera=true;flushSync(()=>activate().click());await wait(()=>resolveCamera);
            check(cameraRequests.at(-1).video.facingMode.ideal==='user','Selfie did not request front camera');
          }
          const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===next);
          check(!button.disabled,'Selected photo did not enable next step');
          flushSync(()=>button.click());
          if(p==='back')check(cameraStreams[1].getTracks().every(t=>t.readyState==='ended'),'Changing step left camera running');
          if(p==='selfie'){
            const delayed=syntheticCamera();resolveCamera(delayed);await wait(()=>delayed.getTracks().every(t=>t.readyState==='ended'));
            check(!document.querySelector('.ine-device-camera'),'Final review kept camera mounted');
          }
          check(posts===0 && gets===0,'Capture step consumed credits');
        }
        check(document.querySelectorAll('.ine-capture-summary img').length===3,'Review did not preserve all photos');
        check(!form.checkValidity(),'Missing required final consent');
        const repeat=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Repetir reverso');
        flushSync(()=>repeat.click());check(document.querySelector('.ine-guide-card-back'),'Reverse guide did not flip');
        check(document.activeElement.textContent.includes('Reverso'),'Step did not receive accessible focus');
        flushSync(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Continuar a la selfie').click());
        flushSync(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Revisar imágenes').click());
        document.querySelector('[name=charge]').checked=true;
        check(form.checkValidity(),'Filled form invalid');
        flushSync(()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
        await wait(()=>posts===1);check(document.querySelector('fieldset').disabled,'Sending did not freeze capture');
        late();await wait(()=>document.body.textContent.includes('No se confirmó el resultado'));
        check(document.querySelector('fieldset').disabled,'Uncertain response allowed new expense');
        const consult=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Consultar acuse sin gastar créditos');
        flushSync(()=>consult.click());await wait(()=>gets===1 && document.body.textContent.includes('Acuse consultado'));
        check(posts===1,'Receipt retried paid call');
        check(document.querySelector('fieldset').disabled,'Uncertainty silently unlocked');
        check(!localStorage.length && !sessionStorage.length,'Images persisted in browser storage');
        flushSync(()=>root.render(<IneVerificationPanel key="verified" actorId={actor} initial={{...initial,canSubmit:true,attemptId:id(3),status:'IDENTITY_VERIFIED'}}/>));
        check(document.body.textContent.includes('Identidad verificada:'),'Missing automatic identity status');
        check(document.querySelector('fieldset').disabled && !document.querySelector('.ine-device-camera'),'Verified identity allows another capture');
        check(posts===1 && gets===1,'Showing verified identity contacted provider');
        const dossier={registrationId,configuration:'MISSING',configurationIssues:['MISSING_CURP_REQUIREMENT'],approvalAllowed:false,referenceDate:'2026-11-01',minorAtRegistration:false,canUpload:true,guardianConsent:'NOT_REQUIRED',requirements:[{id:id(20),typeId:id(21),quantity:1,required:false,recorded:0,approved:0,missing:0}],documentTypes:[{id:id(21),name:'Foto del jugador',code:'PHOTO'}],documents:[]};
        flushSync(()=>root.render(<PlayerDossier actorId={actor} initial={dossier} storageConfigured={true}/>));
        const choose=document.getElementById('document-requirement');choose.focus();
        flushSync(()=>choose.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})));
        flushSync(()=>choose.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
        await wait(()=>document.querySelector('.ine-device-camera'));
        check(document.querySelectorAll('input[type=file]').length===1,'Player photo has duplicate file selectors');
        check(document.getElementById('document-file').accept==='image/jpeg,image/png','Photo accepts non-images');
        check(!document.querySelector('input[capture]'),'Photo still uses redundant native camera selector');
        check(posts===1 && gets===1,'Selecting player photo contacted a provider');
        let curpPosts=0,refreshed=0;
        const curpState={registrationId,identityVersion:1,checkId:null,status:'NOT_PERFORMED',mismatchedFields:[],checkedAt:null,replayed:false,registrationStatus:'INELIGIBLE',identityReviewStatus:'NOT_REQUIRED'};
        const curpFetch=async(path,options)=>{if(options.method==='POST'){curpPosts++;check(JSON.parse(options.body).confirmCharge===true,'CURP did not require explicit cost confirmation');return Response.json({...curpState,checkId:id(32),status:'VERIFIED',registrationStatus:'ACTIVE'});}return Response.json(curpState);};
        flushSync(()=>root.render(<CurpVerificationPanel actorId={actor} registrationId={registrationId} providerConfigured={true} fetcher={curpFetch} onRegistrationChange={()=>refreshed++}/>));
        await wait(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Verificar CURP · 3 tokens' && !b.disabled));
        check(curpPosts===0,'CURP charged on opening panel');
        flushSync(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Verificar CURP · 3 tokens').click());
        await wait(()=>document.querySelector('dialog')?.open);
        flushSync(()=>Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent==='Consultar CURP · 3 tokens').click());
        await wait(()=>document.body.textContent.includes('Jugador activo. Puedes completar'));
        check(curpPosts===1 && refreshed===1,'Activation did not refresh list or duplicated query');
        await nativeFetch('/result',{method:'POST',body:JSON.stringify({ok:true,posts,gets})});
      })().catch(async error=>{await nativeFetch('/result',{method:'POST',body:JSON.stringify({ok:false,message:error.message})});});
    `}});
  let resolveResult;
  const result = new Promise(resolve=>{resolveResult=resolve;});
  const server=createServer(async(request,response)=>{
    if(request.url==='/bundle.js'){response.setHeader('Content-Type','text/javascript');response.end(bundle.outputFiles[0].contents);return;}
    if(request.url==='/result'){
      const chunks=[];for await(const chunk of request)chunks.push(chunk);
      resolveResult(JSON.parse(Buffer.concat(chunks).toString('utf8')));response.end('ok');return;
    }
    response.setHeader('Content-Type','text/html');response.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const profile=await mkdtemp(join(tmpdir(),'ine-synthetic-browser-'));
  const chrome=spawn(process.env.CHROME_BIN ?? (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'google-chrome'),[
    '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--window-size=375,812',`http://127.0.0.1:${server.address().port}`,
  ],{windowsHide:true,stdio:'ignore'});
  let timer;
  try {
    const failure=new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error('Synthetic browser timed out')),30000);
      chrome.once('error',reject);
    });
    assert.deepEqual(await Promise.race([result,failure]),{ok:true,posts:1,gets:1});
  } finally {clearTimeout(timer);chrome.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
