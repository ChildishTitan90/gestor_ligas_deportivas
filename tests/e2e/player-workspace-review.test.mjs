import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {launchChrome,closeTestServer} from './chrome-session.mjs';

test('Jugadores: lista persistente, acceso al expediente, alta con CURP integrada y revisión de tutor recuperable', {timeout:45000},async t=>{
  const bundle=await build({write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {PlayerRegistrationWorkspace} from './src/features/players/components/player-registration-workspace';
    import {DocumentReviewForm} from './src/features/players/components/document-review-form';
    const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    const rows=[{registrationId:id(10),displayName:'Jugador existente',status:'INELIGIBLE',identityReviewStatus:'NOT_REQUIRED',seasonTeamId:id(4),teamName:'Equipo sintético',clubName:'Club sintético',seasonName:'Temporada sintética'}];
    const teams=[{id:id(4),clubId:id(2),seasonId:id(3),clubName:'Club sintético',seasonName:'Temporada sintética',teamName:'Equipo sintético',categoryName:'Libre',groupName:'A'}];
    const calls=[];let revisionAttempts=0,mode='workspace';const root=createRoot(document.getElementById('root'));
    window.fetch=async(url,options)=>{
      calls.push({url,method:options?.method??'GET',body:options?.body});
      if(url==='/api/auth/session')return Response.json({user:{id:id(1)}});
      if(url==='/api/player-registrations' && options?.method==='POST')return Response.json({registrationId:id(11),status:'ACTIVE',identityReviewStatus:'NOT_REQUIRED',curpVerification:'VERIFIED'});
      if(url==='/api/player-registrations')return Response.json(rows);
      if(url.includes('/curp-verification'))return Response.json({registrationId:id(11),identityVersion:1,checkId:id(12),status:'VERIFIED',mismatchedFields:[],checkedAt:null,replayed:true,registrationStatus:'ACTIVE'});
      if(url.includes('/document-review') && options?.method==='POST'){revisionAttempts++;if(revisionAttempts===1)throw Error('synthetic response lost');return Response.json({confirmed:true,replayed:true});}
      if(url.includes('/document-review'))throw Error('synthetic refresh unavailable');
      throw Error('Unexpected synthetic endpoint');
    };
    window.fixture={calls,render(next='workspace'){mode=next;flushSync(()=>root.render(mode==='workspace'?<PlayerRegistrationWorkspace actorId={id(1)} teams={teams} initialPlayers={rows} providerConfigured/>:<DocumentReviewForm actorId={id(1)} initial={{registrationId:id(11),fingerprint:'a'.repeat(64),documents:[{id:id(20),name:'Autorización del tutor',code:'GUARDIAN_CONSENT',status:'PENDING'}],history:[]}}/>));}};
    window.fixture.render();
  `},plugins:[{name:'synthetic-next-link',setup(plugin){
    plugin.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
    plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"import React from 'react';export default function Link(props){return React.createElement('a',props)}",resolveDir:process.cwd()}));
  }}]});
  const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/bundle.js'?'text/javascript':'text/html');response.end(request.url==='/bundle.js'?bundle.outputFiles[0].contents:'<!doctype html><div id="root"></div><script src="/bundle.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>closeTestServer(server));
  const browser=await launchChrome(`http://127.0.0.1:${server.address().port}`,{signal:t.signal,commandTimeoutMs:15000,waitForDocument:true});t.after(()=>browser.close());
  const evaluate=expression=>browser.evaluate(expression);
  const wait=expression=>evaluate(`(async()=>{const until=Date.now()+5000;while(!(${expression})){if(Date.now()>until)throw Error('Jugadores: condición pendiente: '+${JSON.stringify(expression)});await new Promise(r=>setTimeout(r,20));}})()`);
  const click=text=>evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Botón no disponible: '+${JSON.stringify(text)});b.focus();b.click();})()`);
  async function select(label,text){
    await evaluate(`(()=>{const l=Array.from(document.querySelectorAll('label')).find(l=>l.textContent===${JSON.stringify(label)});if(!l)throw Error('Etiqueta no encontrada');const control=document.getElementById(l.htmlFor);if(!control || control.disabled)throw Error('Campo no disponible: '+${JSON.stringify(label)});control.focus();control.click();})()`);
    await wait(`document.getElementById(Array.from(document.querySelectorAll('label')).find(l=>l.textContent===${JSON.stringify(label)}).htmlFor).getAttribute('aria-expanded')==='true' && document.querySelector('[role=option]')`);
    await evaluate(`Array.from(document.querySelectorAll('[role=option]')).find(o=>o.textContent.includes(${JSON.stringify(text)})).click()`);
  }
  const input=(selector,value)=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(n instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait('window.fixture && document.body.textContent.includes("Jugador existente")');
  assert.equal(await evaluate(`document.querySelector('a[href$="/documents"]').textContent`),'Abrir expediente','Acceso sin seleccionar equipo de captura');
  assert.equal(await evaluate(`window.fixture.calls.some(c=>c.method==='POST')`),false,'Abrir no consulta al proveedor');
  await input('input[type=search]','sin coincidencia');await wait('document.body.textContent.includes("No hay jugadores que coincidan")');
  await input('input[type=search]','existente');await wait('document.body.textContent.includes("Jugador existente")');
  assert.equal(await evaluate('document.querySelector("dialog").open'),false,'El alta no ocupa la página inicial');
  await click('Registrar jugador');await wait('document.querySelector("dialog").open');
  await wait(`document.activeElement===document.querySelector('dialog [data-dialog-initial]')`);
  await input('[name=firstName]','Captura pendiente');await click('Cancelar');
  await wait('document.body.textContent.includes("¿Descartar los cambios sin guardar?")');
  await click('Seguir editando');
  assert.equal(await evaluate('document.querySelector("[name=firstName]").value'),'Captura pendiente');
  await click('Cancelar');await click('Descartar cambios');await wait('!document.querySelector("dialog").open');
  assert.equal(await evaluate('document.activeElement.textContent'),'Registrar jugador','Devuelve foco al botón de origen');
  await click('Registrar jugador');await wait('document.querySelector("dialog").open');
  // FormDialog fija el foco seguro en requestAnimationFrame. Esperar solo
  // dialog.open permite abrir el selector antes y ese foco inicial lo cierra.
  await wait(`document.activeElement===document.querySelector('dialog [data-dialog-initial]')`);
  assert.equal(await evaluate('document.querySelector("[name=firstName]").value'),'','Descartar limpia la captura');
  await select('Club *','Club sintético');await select('Temporada *','Temporada sintética');await select('Equipo inscrito *','Equipo sintético');
  assert.equal(await evaluate('document.body.textContent.includes("Jugador existente")'),true,'Cambiar captura conserva listado');
  const prefix='SIAA900101HMNLRR0',alphabet='0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ',sum=[...prefix].reduce((s,c,i)=>s+alphabet.indexOf(c)*(18-i),0),curp=prefix+(10-sum%10)%10;
  for(const [name,value] of Object.entries({curp,birthDate:'1990-01-01',firstName:'Alvaro',paternalSurname:'Sierra',maternalSurname:'Lara'}))await input(`[name="${name}"]`,value);
  await click('Registrar y verificar CURP');await wait('document.body.textContent.includes("Jugador registrado y activo")');
  assert.equal(await evaluate(`window.fixture.calls.filter(c=>c.url==='/api/player-registrations' && c.method==='POST').length`),1);
  assert.equal(await evaluate(`window.fixture.calls.filter(c=>c.url.includes('/curp-verification') && c.method==='POST').length`),0,'Alta no exige otro clic ni duplica consulta');
  assert.equal(await evaluate(`document.querySelector('a[href$="000000000011/documents"]').textContent`),'Continuar al expediente');
  assert.equal(await evaluate('document.body.textContent.includes("tokens")'),false);
  await evaluate('window.fixture.render("review")');await wait('document.getElementById("review-document")');
  await select('Documento a revisar','Autorización del tutor');await select('Decisión','Aprobar documento');
  await input('#review-guardian-name','Persona responsable sintética');
  await select('Relación comprobada','Madre');await input('textarea','Identidad, relación, firma y autorización comprobadas en caso sintético.');
  assert.equal(await evaluate('document.querySelector("form").checkValidity()'),false,'No acredita sin las cuatro comprobaciones');
  await evaluate('document.querySelectorAll("input[type=checkbox]").forEach(n=>n.click())');
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('form').elements).filter(n=>n.willValidate && !n.validity.valid).map(n=>({tag:n.tagName,type:n.type,name:n.name,value:n.value,checked:n.checked,message:n.validationMessage}))`),[],'Todos los controles de acreditación están completos');
  await wait('document.querySelector("form").checkValidity()');await click('Confirmar revisión');
  await wait('document.body.textContent.includes("No se confirmó la revisión")');
  assert.match(await evaluate('document.querySelector("textarea").value'),/Identidad/,"Una respuesta incierta conserva la captura");
  await click('Reintentar la misma operación');
  await wait('document.body.textContent.includes("Revisión confirmada. Recarga")');
  assert.equal(await evaluate('document.querySelector("textarea").value'),'','El acuse confirmado limpia la justificación');
  assert.equal(await evaluate('document.getElementById("review-document").value'),'','El acuse limpia el documento elegido');
  const bodies=await evaluate(`window.fixture.calls.filter(c=>c.url.includes('/document-review') && c.method==='POST').map(c=>c.body)`);
  assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1],'Reintento conserva intención y versión');
  assert.equal(await evaluate('document.body.textContent.includes("Reintentar la misma operación")'),false,'Fallo de refresco no invalida el acuse');
});
