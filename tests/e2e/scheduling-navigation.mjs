import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import argon2 from 'argon2';
import pg from 'pg';
import { launchChrome } from './chrome-session.mjs';

const target = new URL(process.env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname));
assert.match(target.pathname, process.env.SCHEDULING_PREVIEW_RUNTIME_URL
  ? /^\/pdgld48_test_[a-f0-9]{16}$/ : /^\/pdgld135_test_[a-f0-9]{16}$/);
const db = new pg.Client({connectionString: target.href});
const listener = createServer();
await new Promise(resolve => listener.listen(0,'127.0.0.1',resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const origin = 'http://127.0.0.1:'+port;
const password = randomBytes(20).toString('hex');
let app, browser;
try {
  await db.connect();
  await db.query("SELECT set_config('app.user_id',actor::text,false),set_config('app.reason','Recorrido sintético de calendario',false) FROM public.scheduling_fixture");
  await db.query("UPDATE sports_management.users SET password_hash=$1 WHERE username IN ('scheduler','outsider')",[await argon2.hash(password)]);
  await db.query(`
    INSERT INTO sports_management.permissions(module,action)
      VALUES ('competitions','READ'),('competitions','CREATE'),('competitions','UPDATE'),('competitions','APPROVE')
      ON CONFLICT DO NOTHING;
    INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
      SELECT ur.role_id,p.id,true FROM public.scheduling_fixture f
      JOIN sports_management.user_roles ur ON ur.user_id=f.actor
      CROSS JOIN sports_management.permissions p
      WHERE p.module='competitions' AND p.action IN ('READ','CREATE','UPDATE','APPROVE')
      ON CONFLICT DO NOTHING;
  `);
  const fixture = (await db.query('SELECT * FROM public.scheduling_fixture')).rows[0];
  await db.query("UPDATE sports_management.season_teams SET status='WITHDRAWN' WHERE id=(SELECT id FROM sports_management.season_teams ORDER BY id LIMIT 1)");
  // Las canchas pertenecen a otro club y cada equipo cuenta con préstamos sintéticos aprobados.
  await db.query(`
    UPDATE sports_management.venues SET is_league_sports_complex=false,
      owner_club_id=(SELECT id FROM sports_management.clubs ORDER BY id LIMIT 1);
    INSERT INTO sports_management.files(storage_key,original_name,mime_type,size_bytes,uploaded_by)
      SELECT 'synthetic-browser-letter','Carta sintética','application/pdf',0,actor FROM public.scheduling_fixture;
    INSERT INTO sports_management.venue_loans(season_id,venue_id,club_id,letter_file_id,status,approved_by,approved_at,requested_by,request_hash,requested_windows,
      owner_decision_required,owner_decision,owner_reviewed_by,owner_reviewed_at,owner_review_reason)
      SELECT f.season,v.id,c.id,fi.id,'APPROVED',f.actor,now(),f.outsider,repeat('a',64),
        (SELECT jsonb_agg(jsonb_build_object('startsAt',to_char(a.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'endsAt',to_char(a.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY a.starts_at)
         FROM sports_management.venue_availability a WHERE a.venue_id=v.id),
      true,'APPROVED',f.reviewer,now(),'Autorización sintética del club propietario'
      FROM public.scheduling_fixture f CROSS JOIN sports_management.venues v
      CROSS JOIN sports_management.clubs c CROSS JOIN sports_management.files fi
      WHERE fi.storage_key='synthetic-browser-letter';
  `);
  const launchApp = () => spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port)],{
    env:{...process.env, DATABASE_URL:process.env.SCHEDULING_PREVIEW_RUNTIME_URL ?? process.env.DATABASE_URL, AUTH_TEST_RUN:'1',NEXTAUTH_URL:origin,NEXTAUTH_SECRET:randomBytes(32).toString('hex'),NEXT_TELEMETRY_DISABLED:'1'},
    stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
  let startup='';
  const capture = chunk => { startup=(startup+chunk.toString()).slice(-2000); };
  function startApp() { app=launchApp(); app.stdout.on('data',capture); app.stderr.on('data',capture); }
  startApp();
  let retried=false;
  for(let i=0;;i++) {
    if(app.exitCode!==null && !retried && startup.includes('Retry the same command')) {
      retried=true; startup=''; startApp();
    }
    if(app.exitCode!==null || i>120) throw Error('Next no inició: '+startup.replace(/postgres(?:ql)?:\/\/\S+/gi,'[conexión]'));
    try { if((await fetch(origin+'/login')).ok && (await fetch(origin+'/api/auth/csrf')).ok) break; } catch {}
    await delay(500);
  }
  browser=await launchChrome(origin+'/login');
  const run=(fn,...args)=>browser.evaluate('('+fn.toString()+')(...'+JSON.stringify(args)+')');
  async function wait(condition,label) {
    for(let i=0;i<240;i++) {
      try {if(await browser.evaluate('Boolean('+condition+')')) return;} catch {}
      await delay(250);
    }
    throw Error(label+' · '+await browser.evaluate("location.pathname+' '+document.querySelector('main')?.innerText.slice(-500)"));
  }
  await wait("location.pathname==='/login' && document.readyState==='complete'",'Carga de login');
  async function login(email) {
    assert.ok(await run(async(email,password)=>{
      const {csrfToken}=await(await fetch('/api/auth/csrf')).json();
      const res=await fetch('/api/auth/callback/credentials',{method:'POST',body:new URLSearchParams({email,password,csrfToken,json:'true',callbackUrl:'/access'})});
      return res.ok&&!new URL((await res.json()).url,location.origin).searchParams.has('error');
    },email,password),'Inicio de sesión sintético');
    await browser.command('Page.navigate',{url:origin+'/access'});
    await wait("location.pathname==='/access' && document.querySelector('nav')",'Panel de gestión');
  }
  const link='nav a[href="/competitions/scheduling"]';
  await login('outsider@example.test');
  assert.equal(await run(s=>!!document.querySelector(s),link),false);
  await login('scheduler@example.test');
  const configUrl = origin+'/competitions/seasons/'+fixture.season;
  const oldRule=(await db.query("SELECT competition_rule_id FROM sports_management.season_categories WHERE id=$1",[fixture.category])).rows[0].competition_rule_id;
  const invalidVenue = await run(async (season,actor) => {
    const response=await fetch('/api/competitions/seasons/'+season+'/configuration',{
      method:'POST',headers:{'Content-Type':'application/json','X-Expected-Actor-Id':actor},
      body:JSON.stringify({expectedSeasonVersion:1,reason:'Prueba de cancha ajena',announcement:'Reglamento sintético',
        points:{win:3,draw:1,loss:0},tieBreakers:['GOAL_DIFFERENCE'],
        calendar:{rounds:1,matchDurationMinutes:90,scheduling:{slotStepMinutes:30,venueStages:[
          {fromRound:1,toRound:19,venueIds:[crypto.randomUUID()]},
        ]}}}),
    });
    return {status:response.status,body:await response.json()};
  },fixture.season,fixture.actor);
  assert.equal(invalidVenue.status,400);
  assert.equal(invalidVenue.body.code,'INVALID_SCHEDULING_VENUES');
  assert.equal((await db.query('SELECT count(*) FROM sports_management.competition_rules WHERE season_id=$1',[fixture.season])).rows[0].count,'1');
  const clickText = label => run(label => {
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label && b.offsetParent!==null);
    if(!button) throw Error('No se encontró '+label);
    button.click();
  },label);
  const fill = (selector,value) => run((selector,value) => {
    const input=document.querySelector(selector);
    if(!input) throw Error('No se encontró el campo');
    const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  },selector,value);
  const choose = async(selector,label) => {
    await run(selector=>document.querySelector(selector).click(),selector);
    await wait("document.querySelector('[role=option]')",'Opciones del selector');
    await run(label=>{const option=[...document.querySelectorAll('[role=option]')].find(item=>item.textContent.includes(label));if(!option)throw Error('Opción no encontrada');option.click();},label);
  };
  const openConfig = async() => {
    await browser.command('Page.navigate',{url:configUrl});
    await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Modificar reglas') && Object.keys(b).some(k=>k.startsWith('__reactProps$')))",'Configuración de temporada');
  };
  await openConfig();
  await clickText('Modificar reglas · nueva versión');
  await wait("document.querySelector('dialog[open] [data-scheduling-policy]')",'Formulario de reglas');
  for(const [name,value] of [['announcement','Reglamento sintético'],['win','3'],['draw','1'],['loss','0'],['rounds','1'],['matchDurationMinutes','90']])
    await fill('dialog[open] [name="'+name+'"]',value);
  await choose('dialog[open] #tie-breaker-0','Diferencia de goles');
  await fill('dialog[open] [data-scheduling-policy] input[type=number]','30');
  await clickText('Agregar tramo de canchas');
  await fill('dialog[open] [data-scheduling-policy] section input[type=number]:nth-of-type(1)','1');
  await fill('dialog[open] [data-scheduling-policy] section label:nth-of-type(2) input','19');
  for(let i=0;i<4;i++) {
    await choose('dialog[open] [data-scheduling-policy] [role=combobox]','Cancha sintetica');
    await wait("document.querySelectorAll('dialog[open] [data-scheduling-policy] li').length==="+(i+1),'Cancha agregada');
  }
  await fill('dialog[open] [name=reason]','Reglamento para programación sintética');
  await run(()=>document.querySelector('dialog[open] form').requestSubmit());
  await wait("document.querySelector('dialog[open] [role=status]')?.textContent.includes('Cambio confirmado')",'Reglas guardadas');
  const rule=(await db.query("SELECT id FROM sports_management.competition_rules WHERE season_id=$1 ORDER BY version_number DESC LIMIT 1",[fixture.season])).rows[0].id;
  const savedPolicy=(await db.query("SELECT parameter_value FROM sports_management.competition_rule_parameters WHERE competition_rule_id=$1 AND parameter_key='calendar'",[rule])).rows[0].parameter_value;
  assert.equal(savedPolicy.scheduling.slotStepMinutes,30);
  assert.equal(savedPolicy.scheduling.venueStages[0].venueIds.length,4);
  assert.equal(savedPolicy.scheduling.venueStages[0].fromRound,1);
  assert.equal(savedPolicy.scheduling.venueStages[0].toRound,19);
  await openConfig();
  await clickText('Aprobar reglamento versión 2');
  await wait("document.querySelector('dialog[open] [name=confirm]')",'Aprobación de reglas');
  await fill('dialog[open] [name=confirm]','APROBAR');
  await fill('dialog[open] [name=reason]','Aprobación de prueba');
  await run(()=>document.querySelector('dialog[open] form').requestSubmit());
  await wait("document.querySelector('dialog[open] [role=status]')?.textContent.includes('Cambio confirmado')",'Reglas aprobadas');
  const versionAfterApproval=(await db.query("SELECT version FROM sports_management.seasons WHERE id=$1",[fixture.season])).rows[0].version;
  const unsafeChange=await run(async (season,category,actor,version) => {
    const headers={'Content-Type':'application/json','X-Expected-Actor-Id':actor};
    const base='/api/competitions/seasons/'+season;
    const created=await fetch(base+'/configuration',{method:'POST',headers,body:JSON.stringify({
      expectedSeasonVersion:version,reason:'Prueba de protección de reglamento',announcement:'Reglamento sintético',
      points:{win:4,draw:1,loss:0},tieBreakers:['GOAL_DIFFERENCE'],
      calendar:{rounds:1,matchDurationMinutes:90,scheduling:{slotStepMinutes:30,venueStages:[]}},
    })});
    const draft=await created.json();
    if(!created.ok) return {step:'create',status:created.status};
    const approved=await fetch(base+'/configuration/'+draft.id+'/approve',{method:'POST',headers,
      body:JSON.stringify({expectedSeasonVersion:draft.seasonVersion,reason:'Prueba sintética',confirm:'APROBAR'})});
    const approval=await approved.json();
    if(!approved.ok) return {step:'approve',status:approved.status};
    const response=await fetch(base+'/categories/'+category,{method:'PATCH',headers,
      body:JSON.stringify({expectedSeasonVersion:approval.seasonVersion,reason:'No alterar puntos',ruleId:draft.id,type:'OPEN',hierarchyOrder:1})});
    return {step:'edit',status:response.status,body:await response.json()};
  },fixture.season,fixture.category,fixture.actor,versionAfterApproval);
  assert.equal(unsafeChange.step,'edit');
  assert.equal(unsafeChange.status,409);
  assert.equal(unsafeChange.body.code,'CATEGORY_IN_USE');
  assert.equal((await db.query("SELECT competition_rule_id FROM sports_management.season_categories WHERE id=$1",[fixture.category])).rows[0].competition_rule_id,oldRule);
  await openConfig();
  await clickText('Editar categoría Abierta');
  await wait("document.querySelector('dialog[open] [name=ruleId]')",'Edición de categoría');
  await choose('dialog[open] [role=combobox]','Versión 2');
  await fill('dialog[open] [name=reason]','Usar la versión aprobada');
  await run(()=>document.querySelector('dialog[open] form').requestSubmit());
  await wait("document.querySelector('dialog[open] [role=status]')?.textContent.includes('Cambio confirmado')",'Reglas asociadas');
  assert.equal((await db.query("SELECT competition_rule_id FROM sports_management.season_categories WHERE id=$1",[fixture.category])).rows[0].competition_rule_id,rule);
  await browser.command('Page.navigate',{url:origin+'/access'});
  await wait("location.pathname==='/access' && document.querySelector('nav')",'Panel después de configurar');
  await wait('document.querySelector('+JSON.stringify(link)+') !== null','Enlace Generar calendario');
  await run(s=>document.querySelector(s).click(),link);
  await wait("location.pathname==='/competitions/scheduling' && document.querySelector('#schedule-season')",'Pantalla de programación');
  for(const id of ['schedule-season','schedule-group']) {
    await wait("(()=>{const el=document.getElementById("+JSON.stringify(id)+");return el && !el.disabled && Object.keys(el).some(k=>k.startsWith('__reactProps$'));})()", 'Selector listo');
    await run(id=>{const el=document.getElementById(id);el.focus();el.click();},id);
    await wait("document.querySelector('[role=option]')",'Opciones de '+id);
    await browser.evaluate("document.querySelector('[role=option]').click()");
  }
  await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Generar propuesta').click()");
  await wait("document.querySelector('dialog[open] textarea')",'Diálogo de generación');
  await browser.evaluate("(()=>{const el=document.querySelector('dialog[open] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Recorrido sintético');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
  // Omitir únicamente el primer acuse, después de la escritura real.
  await run(()=>{
    const original=window.fetch.bind(window);
    window.fetch=async (url,init)=>{
      const response=await original(url,init);
      if(url==='/api/scheduling/generate' && response.ok) {
        window.fetch=original;
        const receipt=await response.json();
        if(receipt.ok) throw new Error('Acuse perdido');
        return Response.json(receipt);
      }
      return response;
    };
  });
  const clickButton=label=>run(label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label).click(),label);
  await clickButton('Generar');
  await wait("document.querySelector('dialog[open] [role=alert]')",'Respuesta incierta');
  const savedOperation = await browser.evaluate(`new Promise((resolve,reject)=>{const open=indexedDB.open('schedule-generation-submissions',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const tx=db.transaction('pending','readonly');const request=tx.objectStore('pending').getAll();request.onsuccess=()=>resolve(request.result[0].operationId);tx.oncomplete=()=>db.close();};})`);
  assert.equal((await db.query('SELECT count(*) FROM sports_management.schedule_proposals')).rows[0].count,'1');
  await browser.evaluate('window.__beforeScheduleReload = true');
  await browser.command('Page.reload');
  await wait("!window.__beforeScheduleReload && [...document.querySelectorAll('button')].some(b=>b.textContent==='Recuperar propuesta pendiente'&&!b.disabled)",'Recuperación tras recarga');
  assert.ok(await browser.evaluate("document.querySelector('#schedule-season').disabled && document.querySelector('#schedule-group').disabled"));
  const restoredOperation = await browser.evaluate(`new Promise((resolve,reject)=>{const open=indexedDB.open('schedule-generation-submissions',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const tx=db.transaction('pending','readonly');const request=tx.objectStore('pending').getAll();request.onsuccess=()=>resolve(request.result[0].operationId);tx.oncomplete=()=>db.close();};})`);
  assert.equal(restoredOperation,savedOperation);
  await clickButton('Recuperar propuesta pendiente');
  await clickButton('Reintentar la misma solicitud');
  await wait("document.querySelector('summary')?.textContent==='Jornada 1'",'Detalle de jornadas');
  const pendingCount = await browser.evaluate(`new Promise((resolve,reject)=>{const open=indexedDB.open('schedule-generation-submissions',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const tx=db.transaction('pending','readonly');const request=tx.objectStore('pending').count();request.onsuccess=()=>resolve(request.result);tx.oncomplete=()=>db.close();};})`);
  assert.equal(pendingCount,0);
  await browser.evaluate("document.querySelector('summary').click()");
  const detail=await browser.evaluate("document.querySelector('details[open]').innerText");
  for(const label of ['Local','Visitante','Cancha sintetica','Fecha y horario','2030','Descansa','Equipo']) assert.ok(detail.includes(label),`Falta ${label} en la jornada sintética: ${detail.slice(0,500)}`);
  assert.equal((await db.query('SELECT count(*) FROM sports_management.schedule_proposals')).rows[0].count,'1');
  await browser.command('Page.reload');
  await wait("location.pathname==='/competitions/scheduling' && document.querySelector('#schedule-season')",'Pantalla tras recarga');
  for(const id of ['schedule-season','schedule-group']) {
    await wait("(()=>{const el=document.getElementById("+JSON.stringify(id)+");return el && !el.disabled && Object.keys(el).some(k=>k.startsWith('__reactProps$'));})()", 'Selector listo tras recarga');
    await run(id=>{const el=document.getElementById(id);el.focus();el.click();},id);
    await wait("document.querySelector('[role=option]')",'Opciones tras recarga '+id);
    await browser.evaluate("document.querySelector('[role=option]').click()");
  }
  await wait("document.querySelector('#saved-proposal')",'Propuestas guardadas');
  await browser.evaluate("document.querySelector('#saved-proposal').click()");
  await wait("document.querySelector('[role=option]')",'Opciones de propuestas');
  await browser.evaluate("document.querySelector('[role=option]').click()");
  await wait("document.querySelector('summary')?.textContent==='Jornada 1'",'Propuesta recuperada');
  await browser.evaluate("document.querySelector('summary').click()");
  const restored = await browser.evaluate("document.querySelector('details[open]').innerText");
  const proposalHref = await browser.evaluate("document.querySelector('a[href*=\"/scheduling/proposals?propuesta=\"]')?.href");
  assert.equal(new URL(proposalHref).searchParams.get("propuesta"), savedOperation);
  for (const label of ['Local','Visitante','Cancha sintetica','Fecha y horario','Descansa']) assert.ok(restored.includes(label),label);
  assert.equal((await db.query('SELECT count(*) FROM sports_management.schedule_proposals')).rows[0].count,'1');
  const currentVersion = (await db.query("SELECT version FROM sports_management.seasons WHERE id=$1",[fixture.season])).rows[0].version;
  const blockedEdit = await run(async (season,category,actor,version,oldRule) => {
    const response=await fetch('/api/competitions/seasons/'+season+'/categories/'+category,{
      method:'PATCH',headers:{'Content-Type':'application/json','X-Expected-Actor-Id':actor},
      body:JSON.stringify({expectedSeasonVersion:version,reason:'Prueba de protección de propuesta',
        ruleId:oldRule,type:'OPEN',hierarchyOrder:1}),
    });
    return {status:response.status,body:await response.json()};
  },fixture.season,fixture.category,fixture.actor,currentVersion,oldRule);
  assert.equal(blockedEdit.status,409);
  assert.equal(blockedEdit.body.code,'CATEGORY_IN_USE');
  assert.equal((await db.query("SELECT competition_rule_id FROM sports_management.season_categories WHERE id=$1",[fixture.category])).rows[0].competition_rule_id,rule);
  await db.query('DELETE FROM sports_management.venue_availability');
  await clickButton('Generar propuesta');
  await wait("document.querySelector('dialog[open] textarea')",'Segunda solicitud');
  await browser.evaluate("(()=>{const el=document.querySelector('dialog[open] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Grupo sin horarios');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await clickButton('Generar');
  await wait("document.body.innerText.includes('No se encontró disponibilidad suficiente para la jornada')",'Propuesta con horarios pendientes');
  await browser.evaluate("if (!document.querySelector('summary').parentElement.open) document.querySelector('summary').click()");
  assert.match(await browser.evaluate("document.querySelector('details[open]').innerText"),/No se encontró disponibilidad suficiente para la jornada/);
  assert.equal((await db.query('SELECT count(*) FROM sports_management.schedule_proposals')).rows[0].count,'2');
  // Respuestas simuladas para verificar cómo se explican los otros resultados.
  for (const [code,message] of [['NO_SOLUTION','no se pudo acomodar'],['SEARCH_LIMIT','no significa que sea imposible']]) {
    await run(code=>{
      const original=window.fetch.bind(window);
      window.fetch=async (url,init)=>{
        if(url==='/api/scheduling/generate') {
          window.fetch=original;
          return Response.json({ok:false,code,conflicts:[{round:1,home:'synthetic-home',away:'synthetic-away'}]});
        }
        return original(url,init);
      };
    },code);
    await clickButton('Generar propuesta');
    await wait("document.querySelector('dialog[open] textarea')",'Solicitud para '+code);
    await browser.evaluate("(()=>{const el=document.querySelector('dialog[open] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Prueba de mensaje');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await clickButton('Generar');
    await wait("document.querySelector('summary')?.textContent.startsWith('Ver encuentros considerados')",'Encuentros considerados para '+code);
    await wait("document.querySelector('[role=alert]')?.innerText.includes("+JSON.stringify(code==='NO_SOLUTION'?'No se encontró una combinación para acomodar el calendario completo':message)+")",'Mensaje para '+code);
    const alert=await browser.evaluate("document.querySelector('[role=alert]')?.innerText ?? ''");
    if(code==='NO_SOLUTION') assert.match(alert,/No se encontró una combinación para acomodar el calendario completo/);
    else assert.ok(alert.includes(message));
  }
  assert.equal((await db.query('SELECT count(*) FROM sports_management.schedule_proposals')).rows[0].count,'2');
  await browser.command("Page.navigate", { url: proposalHref });
  await wait(`document.getElementById(${JSON.stringify(`propuesta-${savedOperation}`)})?.open === true`, "Abre el detalle de la propuesta exacta");
  assert.equal(await browser.evaluate("document.querySelector('details[id^=propuesta-]').id"), `propuesta-${savedOperation}`);
  console.log('Chrome: propuesta con canchas compartidas aprobadas, recuperación sin duplicado y conflictos verificados.');
} finally {
  try {await browser?.close();} finally {
    if(app?.pid && app.exitCode===null) {
      if(process.platform==='win32') spawnSync('taskkill',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      else process.kill(-app.pid,'SIGTERM');
    }
    await db.end();
  }
}
