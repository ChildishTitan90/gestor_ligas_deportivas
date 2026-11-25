import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import argon2 from 'argon2';
import pg from 'pg';
import { PDFDocument } from 'pdf-lib';
import { createClient } from '@supabase/supabase-js';
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
const storageUrl = new URL(process.env.SUPABASE_URL);
assert.equal(storageUrl.origin, 'https://loaztwwpwsaqzdtdtvvj.supabase.co');
assert.equal(process.env.SUPABASE_VENUE_LOAN_LETTERS_BUCKET, 'cartas-prestamo-canchas');
const storage = createClient(storageUrl.origin, process.env.SUPABASE_STORAGE_SERVER_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
let app, browser, fixture;
try {
  await db.connect();
  await db.query("SELECT set_config('app.user_id',actor::text,false),set_config('app.reason','Recorrido sintético de calendario',false) FROM public.scheduling_fixture");
  await db.query("UPDATE sports_management.users SET password_hash=$1 WHERE username IN ('scheduler','outsider')",[await argon2.hash(password)]);
  await db.query(`
    UPDATE sports_management.venues SET is_league_sports_complex=false,
      owner_club_id=(SELECT id FROM sports_management.clubs ORDER BY id LIMIT 1);
    INSERT INTO sports_management.permissions(module,action) VALUES ('venues','CREATE'),('venues','APPROVE') ON CONFLICT DO NOTHING;
    INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
      SELECT r.id,p.id,true FROM sports_management.roles r JOIN sports_management.permissions p
        ON p.module='venues' AND ((r.code='CLUB_DELEGATE' AND p.action='CREATE') OR (r.code='EXECUTIVE_PRESIDENT' AND p.action='APPROVE'))
      ON CONFLICT DO NOTHING;
    INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id,delegate_position)
      SELECT f.outsider,r.id,c.league_id,c.id,'PRIMARY' FROM public.scheduling_fixture f
      CROSS JOIN sports_management.roles r CROSS JOIN sports_management.clubs c
      WHERE r.code='CLUB_DELEGATE' AND c.id <> (SELECT id FROM sports_management.clubs ORDER BY id LIMIT 1)
      ORDER BY c.id LIMIT 1;
    INSERT INTO sports_management.user_roles(user_id,role_id,league_id)
      SELECT f.actor,r.id,c.league_id FROM public.scheduling_fixture f CROSS JOIN sports_management.roles r
      CROSS JOIN LATERAL (SELECT league_id FROM sports_management.clubs LIMIT 1) c WHERE r.code='EXECUTIVE_PRESIDENT';
  `);
  fixture = (await db.query(`SELECT f.outsider actor,f.season,ur.club_id,ur.league_id
    FROM public.scheduling_fixture f JOIN sports_management.user_roles ur ON ur.user_id=f.outsider LIMIT 1`)).rows[0];
  const launchApp = () => spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port)],{
    env:{...process.env, AUTH_TEST_RUN:'1',NEXTAUTH_URL:origin,NEXTAUTH_SECRET:randomBytes(32).toString('hex'),NEXT_TELEMETRY_DISABLED:'1',VENUE_LOAN_STORAGE_REAL_TEST:'1'},
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

  const pdf=await PDFDocument.create();
  pdf.addPage().drawText("Carta sintetica para prueba de cancha compartida");
  const encoded=Buffer.from(await pdf.save()).toString('base64');
  await login('outsider@example.test');
  const context = (await db.query("SELECT id FROM sports_management.club_affiliations WHERE club_id=$1 AND season_id=$2", [fixture.club_id, fixture.season])).rows[0].id;
  const venue = (await db.query("SELECT id FROM sports_management.venues ORDER BY id LIMIT 1")).rows[0].id;
  await run(async (actor, context, venue, encoded) => {
    const open = indexedDB.open("venue-loan-submissions", 1);
    await new Promise((resolve, reject) => {
      open.onupgradeneeded = () => open.result.createObjectStore("pending");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve();
    });
    const database = open.result;
    const tx = database.transaction("pending", "readwrite");
    tx.objectStore("pending").add({ requestId: crypto.randomUUID(), contextId: context, venueId: venue,
      windows: [{ id: crypto.randomUUID(), start: "2030-01-06T09:00", end: "2030-01-06T12:00" }],
      letter: new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], "carta.pdf", { type: "application/pdf" }) }, actor);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    database.close();
  },fixture.actor,context,venue,encoded);
  await browser.command('Page.navigate',{url:origin+'/venues/loans'});
  await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Solicitar') && Object.keys(b).some(k=>k.startsWith('__reactProps$')))",'Pantalla de préstamos');
  const clickButton=label=>run(label=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label); if(!button) throw Error(label); button.click();},label);
  assert.equal(await browser.evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Limpiar archivos pendientes'))"), false);
  await clickButton('Solicitar préstamo');
  await wait("document.body.innerText.includes('Comprobar captura anterior')",'Captura anterior');
  await clickButton('Comprobar captura anterior');
  await wait("document.querySelector('dialog[open] canvas')",'Formulario con nueva firma');
  assert.equal((await db.query("SELECT count(*) FROM sports_management.audit_logs WHERE action='VENUE_LOAN_CAPTURE_CANCELLED'")).rows[0].count,'1');
  async function choose(label) {
    await run(label=>{const el=[...document.querySelectorAll('dialog label')].find(x=>x.textContent.startsWith(label)); el.querySelector('button').click();},label);
    await wait("document.querySelector('[role=option]')",'Opciones '+label);
    await browser.evaluate("document.querySelector('[role=option]').click()");
  }

  await run(encoded=>{
    const inputs=document.querySelectorAll('dialog input[type=datetime-local]');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    for(const [i,v] of ['2030-01-06T09:00','2030-01-06T12:00'].entries()){setter.call(inputs[i],v); inputs[i].dispatchEvent(new Event('input',{bubbles:true})); inputs[i].dispatchEvent(new Event('change',{bubbles:true}));}
    const input=document.querySelector('dialog input[type=file]'); const dt=new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],'carta.pdf',{type:'application/pdf'})); input.files=dt.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    const original=window.fetch;
    window.fetch=async (...args)=>{if(String(args[0])==='/api/venue-loans' && args[1]?.body instanceof FormData) window.testLoanRequest=JSON.parse(args[1].body.get('payload')).requestId;return original(...args);};
  },encoded);
  await browser.evaluate("document.querySelector('dialog canvas').scrollIntoView({block:'center'})");
  await delay(300);
  const rect=await browser.evaluate("(()=>{const r=document.querySelector('dialog canvas').getBoundingClientRect();return {x:r.x+25,y:r.y+25};})()");
  await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',buttons:1,clickCount:1});
  for(let i=1;i<=10;i++) await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+i*5,y:rect.y+i,button:'left',buttons:1});
  await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+50,y:rect.y+10,button:'left',clickCount:1});
  await clickButton('Ver vista previa');
  await wait("document.body.innerText.includes('Confirmar captura')",'Vista previa de firma');
  await clickButton('Confirmar captura');
  await clickButton('Enviar solicitud');
  await wait("!document.querySelector('dialog[open]') && document.body.innerText.includes('Solicitud registrada')",'Solicitud registrada');
  assert.equal((await db.query("SELECT count(*) FROM sports_management.venue_loans WHERE status='PENDING'")).rows[0].count,'1');
  await login('scheduler@example.test');
  await browser.command('Page.navigate',{url:origin+'/venues/loans'});
  await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Revisar' && Object.keys(b).some(k=>k.startsWith('__reactProps$')))",'Bandeja de Presidencia');
  await wait("document.body.innerText.includes('Limpiar archivos pendientes')",'Limpieza disponible');
  await clickButton('Limpiar archivos pendientes');
  await wait("document.body.innerText.includes('registros. 0 no se pudieron procesar')",'Resultado de limpieza');
  await clickButton('Revisar');
  await clickButton('Ver carta privada');
  await wait("document.querySelector('iframe[title=\"Documento PDF: Carta de préstamo\"]')",'Vista privada de la carta firmada');
  await clickButton('Cerrar vista previa');
  await choose('Decisión');
  await browser.evaluate(`(()=>{const el=document.querySelector('dialog textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Aprobacion de prueba sintetica');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await clickButton('Guardar decisión');
  await wait("!document.querySelector('dialog[open]') && document.body.innerText.includes('Aprobada')",'Decisión aprobada');
  assert.equal((await db.query("SELECT count(*) FROM sports_management.venue_loans WHERE status='APPROVED'")).rows[0].count,'1');
  console.log('Solicitud firmada y aprobación verificadas con almacenamiento privado de pruebas.');
} finally {
  try {
    const requestId = await browser?.evaluate("window.testLoanRequest ?? null").catch(()=>null);
    const fileRows = await db.query("SELECT storage_key FROM sports_management.files WHERE storage_key LIKE 'venue-loan-letters/v1/%'");
    const keys = fileRows.rows.map(row => row.storage_key);
    if (requestId && fixture) keys.push(`venue-loan-letters/v1/${fixture.league_id}/${fixture.season}/${fixture.club_id}/${fixture.actor}/${requestId}`);
    if (keys.length) {
      const { error } = await storage.storage.from('cartas-prestamo-canchas').remove([...new Set(keys)]);
      if (error) throw new Error('No se pudo eliminar la carta sintética del almacenamiento de pruebas');
      for (const key of new Set(keys)) {
        const result = await storage.storage.from('cartas-prestamo-canchas').download(key);
        if (!result.error) throw new Error('La carta sintética sigue presente en el almacenamiento de pruebas');
      }
    }
  } finally { try {await browser?.close();} finally {
    if(app?.pid && app.exitCode===null) {
      if(process.platform==='win32') spawnSync('taskkill',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      else process.kill(-app.pid,'SIGTERM');
    }
    await db.end();
  } }
}
