import assert from 'node:assert/strict';
import {participationPeriods} from '../../src/features/match-reports/tactics.ts';

import {mkdir,writeFile} from 'node:fs/promises';

import {launchChrome} from './chrome-session.mjs';
import {captureReportCaptainSignatures} from './report-signature-browser.mjs';

import {Browser} from '../integration/auth.test.mjs';



// NextAuth, Next.js, HTTP, almacenamiento privado local y PostgreSQL reales.

// La identidad y los trazos son sintéticos; no se intercepta fetch ni se usa Supabase.

export async function verifyRealMatchReportBrowser({base,match,postgres}){

  const client=new Browser(base);await client.login('capturista@example.test','Arbitraje-Local-141!');

  const browser=await launchChrome(`${base}/login`);

  const ev=s=>browser.evaluate(s),directory=`.codex-attachments/pdgld149/pg${postgres}`;
  const localRecord=`new Promise(resolve=>{const q=indexedDB.open('league-match-reports-v1');q.onsuccess=()=>{const db=q.result;const r=db.transaction('reports').objectStore('reports').getAll();r.onsuccess=()=>{resolve(r.result.find(row=>row.matchId===${JSON.stringify(match)}));db.close()}}})`;

  await mkdir(directory,{recursive:true});
  await writeFile(`${directory}/browser.json`,JSON.stringify({status:'RUNNING',postgres,startedAt:new Date().toISOString()}));

  async function wait(s){const end=Date.now()+45000;while(Date.now()<end){try{if(await ev(`Promise.resolve(${s}).then(Boolean)`))return;}catch(e){if(!/context|navigat/i.test(String(e)))throw e;}await new Promise(r=>setTimeout(r,100));}throw Error(`REAL_REPORT_EXPECTATION: ${s}`);}

  async function click(label){await wait(`[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&!b.disabled&&(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}))`);await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}));if(!b||b.disabled)throw Error('CONTROL_NOT_AVAILABLE');b.focus();b.click();})()`);}

  async function open(){await browser.command('Page.navigate',{url:`${base}/matches/${match}/report`});await wait("document.querySelector('[data-report-workspace]')||[...document.querySelectorAll('button')].some(b=>b.textContent==='Aceptar y preparar')");if(!await ev("Boolean(document.querySelector('[data-report-workspace]'))")){await click('Aceptar y preparar');await wait("document.querySelector('[data-report-workspace]')");}await wait("document.querySelector('nav[aria-label=\"Secciones de la cédula\"]')||(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Capturar cédula')?.click();return false})()");}

  async function shot(){/* Evidence contains only assertions/metrics, never signatures. */}
  async function choose(id,label){
    await wait(`document.getElementById(${JSON.stringify(id)})`);
    await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await ev(`document.getElementById(${JSON.stringify(id)}).focus();document.getElementById(${JSON.stringify(id)}).click()`);
    await wait("document.querySelector('[role=listbox]')");
    await ev(`(()=>{const o=[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.startsWith(${JSON.stringify(label)}));if(!o||o.getAttribute('aria-disabled')==='true')throw Error('OPTION_NOT_AVAILABLE');o.click();})()`);
  }
  async function number(name,value){await ev(`(()=>{const i=document.querySelector('#report-event-form input[name=${name}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`);}

  try{

    for(const [name,value] of client.cookies)await browser.command('Network.setCookie',{name,value,url:base});

    await open();

    assert.equal(await ev("getComputedStyle(document.querySelector('nav[aria-label=\"Secciones de la cédula\"]')).position"),'sticky','Tailwind debe estar compilado en la app real');

    await browser.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    const initial=await(await client.request(`/api/match-reports/${match}`)).json();assert.equal(initial.report.version,0);
    const home=initial.match.home.id,away=initial.match.away.id;
    for(const team of [home,away]){
      await choose(`formation-${team}`,'4-4-2');
      await ev(`document.querySelector('[data-pitch="${team}"] [data-pitch-slot="0"]').click()`);
      await choose('pitch-player',team===home?'Alonso Navegador Sintético':'Brenda Navegador Sintético');
      await ev(`(()=>{const field=document.querySelector('#pitch-slot-form input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(team===home?'17':'18')});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await click('Aplicar posición');
      await wait("!document.querySelector('dialog[open]')");
    }
    await ev("(()=>{const box=[...document.querySelectorAll('input[type=checkbox]')].find(i=>i.closest('label')?.textContent.includes('Dora Navegador Sintético'));box.closest('details').open=true;box.click();})()");
    // Convocar ahora ocupa el campo automáticamente. Este fixture mínimo deja
    // explícitamente al suplente en banca para probar la sustitución posterior.
    await ev(`document.querySelector('[data-pitch="${home}"] [data-pitch-slot="1"]').click()`);
    await choose('pitch-player','Posición sin asignar');await click('Aplicar posición');await wait("!document.querySelector('dialog[open]')");
    const firstHalf=initial.players.find(p=>p.name==='Alonso Navegador Sintético').id;
    await choose(`half-${firstHalf}`,'Solo primer tiempo');
    await choose(`captain-${home}`,'Alonso Navegador Sintético');await choose(`captain-${away}`,'Brenda Navegador Sintético');
    await click('Continuar');await wait("document.querySelector('dialog[open] input[type=checkbox]')");
    await ev("document.querySelector('dialog[open] input[type=checkbox]').click()");await click('Confirmar y guardar alineaciones');
    await wait("!document.querySelector('dialog[open]') && document.body.innerText.includes('Acuse de borrador')");
    await click('Iniciar partido');await click('Confirmar inicio');await wait("!document.querySelector('dialog[open]') && document.body.innerText.includes('Primer tiempo')");
    await wait(`(${localRecord}).then(row=>!row.pending.length&&row.lastReceipt?.receipt.clock?.phase==='FIRST_HALF')`);
    await click('Eventos');await click('Registrar evento');await choose('event-type','Cambio');await choose('event-team',initial.match.home.name);
    await choose('event-player','Dora Navegador Sintético');await choose('event-outgoing','Alonso Navegador Sintético');await choose('event-replacement-captain','Dora Navegador Sintético');
    await number('period','1');await number('minute','12');await number('second','0');await click('Aplicar cambio');await wait("!document.querySelector('dialog[open]')");
    await click('Registrar evento');await choose('event-type','Gol');await choose('event-team',initial.match.home.name);await choose('event-player','Dora Navegador Sintético');
    await number('period','1');await number('minute','15');await number('second','34');await click('Aplicar evento');await wait("!document.querySelector('dialog[open]')");
    await click('Alineaciones');
    for(const theme of ['light','dark'])for(const width of [390,1440]){

      await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});

      await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await ev('window.scrollTo(0,0)');

      assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true);

      await shot(`${theme}-${width}-alineaciones`);

    }

    await click('Eventos');await click('Registrar evento');

    await wait("document.getElementById('event-type')");

    await ev("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");await ev("document.getElementById('event-type').focus();document.getElementById('event-type').click()");

    await wait("document.querySelector('[role=listbox]')");

    await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});

    await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});

    await click('Cancelar');await wait("!document.querySelector('dialog[open]')");

    assert.equal(await ev('document.activeElement.textContent.trim()'),'Registrar evento');

    await click('Registrar evento');

    await wait("document.querySelector('dialog[open] #event-type')");
    await ev("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    await ev("document.getElementById('event-type').focus();document.getElementById('event-type').click()");await wait("document.querySelector('[role=listbox]')");

    await ev("[...document.querySelectorAll('[role=option]')].find(o=>/grave/i.test(o.textContent)).click()");

    await ev("(()=>{const t=document.querySelector('#report-event-form textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Incidente grave sintético PDGLD-149; sin sanción automática');t.dispatchEvent(new Event('input',{bubbles:true}));})()");

    await click('Aplicar evento');await wait("!document.querySelector('dialog[open]')");

    await wait(`(${localRecord}).then(row=>row.data.report.events.some(event=>event.typeCode==='SERIOUS_INCIDENT'))`);
    const revisionToSave=await ev(`(${localRecord}).then(row=>row.revision)`);
    await click('Guardar borrador');
    // An earlier clock receipt remains visible while edits are being saved.
    // Require the revision containing the incident before reading SQL.
    await wait(`(${localRecord}).then(row=>!row.pending.length&&row.acknowledgedRevision>=${revisionToSave})`);
    const persisted=await(await client.request(`/api/match-reports/${match}`)).json();
    const halfRow=persisted.report.lineups.find(r=>r.playerId===firstHalf);
    assert.equal(halfRow.participationHalf,1);
    assert.deepEqual(participationPeriods(halfRow,persisted.report.events,persisted.report.clock),[{periodNumber:1,entryMinute:0,exitMinute:12}]);
    await click('Cierre y firmas');

    // Modificar observaciones invalida las firmas anteriores de esta captura.

    await ev("(()=>{const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Recorrido Chrome real PDGLD-149 · Datos sintéticos');t.dispatchEvent(new Event('input',{bubbles:true}));})()");

    await wait("document.querySelectorAll('canvas').length===2");

    await captureReportCaptainSignatures(browser);

    await browser.command('Network.enable');
    await browser.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    try{
      await click('Guardar borrador');await wait("document.body.innerText.includes('Pendiente de sincronizar')");
      assert.equal(await ev("[...document.querySelectorAll('textarea')].some(t=>t.value.includes('Recorrido Chrome real PDGLD-149'))"),true);
    }finally{await browser.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});}
    await wait("document.body.innerText.includes('Acuse de borrador')&&!document.body.innerText.includes('Consultando acuse y sincronizando')");
    await click('Sincronizar');await wait("!document.body.innerText.includes('Consultando acuse y sincronizando')");
    const operation=await ev(`(${localRecord}).then(row=>row.lastReceipt.receipt.operationId)`);
    const recovered=await client.request(`/api/match-reports/${match}?operationId=${operation}`);
    assert.equal(recovered.status,200);assert.equal((await recovered.json()).status,'APPLIED');

    await open();
    const reopened=await(await client.request(`/api/match-reports/${match}`)).json();
    assert.equal(reopened.report.lineups.find(r=>r.playerId===firstHalf).participationHalf,1);
    assert.deepEqual(participationPeriods(reopened.report.lineups.find(r=>r.playerId===firstHalf),reopened.report.events,reopened.report.clock),[{periodNumber:1,entryMinute:0,exitMinute:12}]);
    await click('Cierre y firmas');

    assert.equal(await ev("[...document.querySelectorAll('img[alt^=Firma]')].filter(i=>i.getClientRects().length).length"),2);

    const loaded=await ev("Promise.all([...document.querySelectorAll('img')].filter(i=>i.alt.startsWith('Firma')&&i.getClientRects().length).map(i=>new Promise(r=>{if(i.complete)r(i.naturalWidth>0);else{i.onload=()=>r(true);i.onerror=()=>r(false)}})))");

    assert.deepEqual(loaded,[true,true]);

    await click('Eventos');assert.match(await ev('document.body.innerText'),/Incidente grave sintético PDGLD-149/);

    await click('Resumen');assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Solicitar confirmación').disabled"),false);

    assert.match(await ev("document.querySelector('section[aria-label=\"Resumen previo a confirmar\"]').textContent"),/Dora Navegador Sintético · Capitán en cancha/);
    assert.match(await ev("document.querySelector('section[aria-label=\"Resumen previo a confirmar\"]').textContent"),/Alonso Navegador Sintético · Capitán inicial/);
    await click('Solicitar confirmación');await wait("document.querySelector('dialog[open] input[type=checkbox]')");
    await ev("document.querySelector('dialog[open] input[type=checkbox]').click()");
    await click('Confirmar cédula');
    await wait("document.body.innerText.includes('Termina el segundo tiempo antes de solicitar el cierre')");
    assert.equal((await (await client.request(`/api/match-reports/${match}`)).json()).report.status,'DRAFT');
    await shot('resumen-guardado-reloj-en-curso');

    const result={suite:'PDGLD-149 Chrome real',postgres,session:'NextAuth',databaseRole:'Preview con RLS',fetchMocked:false,savedAndReopened:true,halfReservationAndTimesReopened:true,networkLossRecovery:true,deviceSignatures:2,privateImagesLoaded:true,themes:['light','dark'],widths:[390,1440],keyboardFocus:true,clockStillRunningRejected:true,acceptance:'NOT_EVALUATED'};

    await writeFile(`${directory}/browser.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));

  }catch(error){await shot('failure').catch(()=>{});await writeFile(`${directory}/browser.json`,JSON.stringify({status:'FAILED',postgres,error:String(error.message),acceptance:'BLOCKED'},null,2));throw error;}finally{await browser.close();}

}

