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
assert.match(target.pathname, /^\/pdgld135_test_[a-f0-9]{16}$/);
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
  await db.query("UPDATE sports_management.season_teams SET status='WITHDRAWN' WHERE id=(SELECT id FROM sports_management.season_teams ORDER BY id LIMIT 1)");
  // Las canchas pertenecen a otro club y cada equipo cuenta con préstamos sintéticos aprobados.
  await db.query(`
    UPDATE sports_management.venues SET is_league_sports_complex=false,
      owner_club_id=(SELECT id FROM sports_management.clubs ORDER BY id LIMIT 1);
    INSERT INTO sports_management.files(storage_key,original_name,mime_type,size_bytes,uploaded_by)
      SELECT 'synthetic-browser-letter','Carta sintética','application/pdf',0,actor FROM public.scheduling_fixture;
    INSERT INTO sports_management.venue_loans(season_id,venue_id,club_id,letter_file_id,status,approved_by,approved_at,requested_by,request_hash,requested_windows)
      SELECT f.season,v.id,c.id,fi.id,'APPROVED',f.actor,now(),f.outsider,repeat('a',64),
        (SELECT jsonb_agg(jsonb_build_object('startsAt',to_char(a.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'endsAt',to_char(a.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY a.starts_at)
         FROM sports_management.venue_availability a WHERE a.venue_id=v.id)
      FROM public.scheduling_fixture f CROSS JOIN sports_management.venues v
      CROSS JOIN sports_management.clubs c CROSS JOIN sports_management.files fi
      WHERE fi.storage_key='synthetic-browser-letter';
  `);
  const launchApp = () => spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port)],{
    env:{...process.env, AUTH_TEST_RUN:'1',NEXTAUTH_URL:origin,NEXTAUTH_SECRET:randomBytes(32).toString('hex'),NEXT_TELEMETRY_DISABLED:'1'},
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
  await clickButton('Cerrar y conservar pendiente');
  await wait("!document.querySelector('dialog[open]')",'Diálogo cerrado');
  assert.ok(await browser.evaluate("document.querySelector('#schedule-season').disabled && document.querySelector('#schedule-group').disabled"));
  await clickButton('Recuperar propuesta pendiente');
  await clickButton('Reintentar la misma solicitud');
  await wait("document.querySelector('summary')?.textContent==='Jornada 1'",'Detalle de jornadas');
  await browser.evaluate("document.querySelector('summary').click()");
  const detail=await browser.evaluate("document.querySelector('details[open]').innerText");
  for(const label of ['Local','Visitante','Cancha sintetica','Fecha y horario','2030','Descansa','Equipo']) assert.ok(detail.includes(label),label);
  assert.equal((await db.query('SELECT count(*) FROM sports_management.schedule_proposals')).rows[0].count,'1');
  await db.query('DELETE FROM sports_management.venue_availability');
  await clickButton('Generar propuesta');
  await wait("document.querySelector('dialog[open] textarea')",'Segunda solicitud');
  await browser.evaluate("(()=>{const el=document.querySelector('dialog[open] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Grupo sin horarios');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await clickButton('Generar');
  await wait("document.querySelector('summary')?.textContent.startsWith('Ver encuentros afectados')",'Conflictos de disponibilidad');
  await browser.evaluate("document.querySelector('summary').click()");
  assert.match(await browser.evaluate("document.querySelector('details[open] li').innerText"),/Jornada 1.*Local: Equipo.*Visitante: Equipo/);
  assert.equal((await db.query('SELECT count(*) FROM sports_management.schedule_proposals')).rows[0].count,'1');
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
