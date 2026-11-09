import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { childEnvironment } from '../../scripts/ci/delegate-isolated-runtime.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tsImport } from 'tsx/esm/api';
import { launchChrome } from './chrome-session.mjs';
import { Browser } from '../integration/auth.test.mjs';
import { fixturePassword } from '../integration/auth-fixtures.mjs';
import { prepareMaintenanceUI } from '../integration/account-maintenance-ui-fixtures.mjs';
import { validateAccountProvisioningTarget } from '../../scripts/verification/account-provisioning-entry.mjs';
import { accountDiagnostic } from '../../scripts/verification/account-diagnostics.mjs';

// Only the validated IPC entry runs this in its independent application copy.
// Simulated transport collects tokens in memory; never an env/browser injection.
export async function verifyAccountEmailConfirmationBrowser(config) {
  const target = validateAccountProvisioningTarget(config);
  assert.equal(target.suite, 'email-confirmation');
  assert.match(process.cwd(), /^\/(?:private\/tmp|tmp)\/pdgld106-[a-f0-9-]{36}\/app-pg(?:15|17)$/);
  const major = Number(new URL(target.databaseUrl).port.slice(-2));
  assert.ok(process.cwd().endsWith(`app-pg${major}`));
  const root = dirname(process.cwd()), evidence = `${root}/evidence-pg${major}`;
  await mkdir(evidence, {recursive:true,mode:0o700});
  const context = {case:'email-confirmation-fixtures',stage:'browser-verification'};
  const db = new pg.Client({connectionString:target.databaseUrl});
  const prisma = new PrismaClient({adapter:new PrismaPg({connectionString:target.databaseUrl}),log:[]});
  let chrome;
  const messages = [], secrets = [];
  let posts = 0, leaked = false;
  try {
    await prepareMaintenanceUI(target);
    await db.connect();
    const users = (await db.query("SELECT id,username,email FROM sports_management.users WHERE username IN ('pdgld48_operational','pdgld48_underscore','pdgld48_idle','pdgld48_concurrent') ORDER BY username")).rows;
    const actor=users.find(u=>u.username==='pdgld48_operational');
    const person=users.find(u=>u.username==='pdgld48_underscore');
    const expiring=users.find(u=>u.username==='pdgld48_idle');
    const replaced=users.find(u=>u.username==='pdgld48_concurrent');
    await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','Confirmación sintética aislada',false)",[actor.id]);
    await db.query("INSERT INTO sports_management.user_roles(user_id,role_id) SELECT $1,id FROM sports_management.roles WHERE code='SUPERADMIN'",[actor.id]);
    const {createDatabaseEmailChanges} = await tsImport('../../src/features/accounts/server/email-change.ts',import.meta.url);
    const service=createDatabaseEmailChanges(prisma,async()=>actor.id,{async send(message){messages.push(message);return 'ACCEPTED';}});
    const snapshot=async id=>(await db.query('SELECT email,version,maintenance_revision,email_verified_at FROM sports_management.users WHERE id=$1',[id])).rows[0];
    const request=async user=>{
      const before=await snapshot(user.id), email=`confirm-${randomUUID()}@example.test`;
      const receipt=await service.request(user.id,{email,operationKey:randomUUID(),expectedRevision:before.maintenance_revision,reason:'Validación de propiedad sintética',confirmed:true});
      assert.equal(receipt.confirmationDelivery,'ACCEPTED');
      const message=messages.filter(m=>m.kind==='EMAIL_CHANGE_CONFIRMATION').at(-1);
      assert.equal(message.to===email,true); secrets.push(message.token);
      assert.equal((await snapshot(user.id)).email===before.email,true);
      return {token:message.token,email,receipt};
    };
    const old=new Browser(target.baseUrl);await old.login(person.email,fixturePassword);assert.ok((await old.session()).user);
    const oldCookies=new Map(old.cookies), before=await snapshot(person.id);
    const first=await request(person);
    await old.login(person.email,fixturePassword);assert.ok((await old.session()).user);
    const pending=new Browser(target.baseUrl);await pending.login(first.email,fixturePassword);assert.equal((await pending.session()).user,undefined);
    context.case='email-confirmation-launch';
    chrome=await launchChrome(target.baseUrl,{profileDirectory:`${root}/chrome-pg${major}`});
    const {command,evaluate,socket}=chrome;
    const run=(fn,...args)=>evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
    const wait=async(fn,...args)=>{for(let i=0;i<240;i++){try{if(await run(fn,...args))return;}catch{} await new Promise(r=>setTimeout(r,250));}throw new Error('EMAIL_UI_TIMEOUT');};
    socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.method!=='Network.requestWillBeSent')return;
      const request=message.params.request, url=new URL(request.url);
      if(url.pathname==='/api/account-maintenance/email-change/confirm'&&request.method==='POST')posts++;
      // Discard body/headers immediately; only retain a boolean about URL/referrer leaks.
      const publicUrl=url.origin+url.pathname+url.search;
      const referrer=String(request.headers?.Referer??request.headers?.referer??'');
      leaked ||= secrets.some(secret=>publicUrl.includes(secret)||referrer.includes(secret));
    });
    await command('Page.enable');await command('Network.enable');
    const page='/email-change/confirm';
    const go=async path=>{await command('Page.navigate',{url:target.baseUrl+path});await wait(()=>document.readyState==='complete'&&!!document.querySelector('#email-confirmation-title'));};
    const openLink=async token=>{
      await go(`${page}#token=${encodeURIComponent(token)}`);
      await wait(()=>location.hash===''&&[...document.querySelectorAll('button')].some(e=>e.textContent==='Confirmar correo'&&Object.keys(e).some(k=>k.startsWith('__reactProps$'))));
      assert.equal(await run(token=>document.documentElement.outerHTML.includes(token),token),false);
    };
    const clickConfirm=async()=>{
      const point=await run(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent==='Confirmar correo');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
      for(const type of ['mousePressed','mouseReleased'])await command('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
    };
    const invalid=()=>wait(()=>document.querySelector('[role="alert"]')?.textContent.includes('El enlace ya no es válido'));
    await command('Network.setCookies',{cookies:[...oldCookies].map(([name,value])=>({name,value,url:target.baseUrl}))});
    context.case='email-open-without-consumption';
    await go(page);await invalid();assert.equal(posts,0);
    await openLink(first.token);await new Promise(r=>setTimeout(r,500));
    assert.equal(posts,0);assert.equal((await snapshot(person.id)).email===person.email,true);
    assert.equal((await db.query('SELECT used_at IS NULL AS unused FROM sports_management.account_email_changes WHERE id=$1',[first.receipt.id])).rows[0].unused,true);
    await command('Page.reload');await invalid();assert.equal(posts,0);
    // The scrubbed secret is intentionally not recovered from storage after reload.
    await openLink(first.token);
    context.case='email-explicit-confirmation';
    await clickConfirm();await wait(()=>document.querySelector('[role="status"] h2')?.textContent==='Correo confirmado');
    assert.equal(posts,1);
    const after=await snapshot(person.id);assert.equal(after.email===first.email,true);assert.ok(after.email_verified_at);assert.equal(after.version,before.version+1);
    old.cookies=new Map(oldCookies);assert.equal((await old.session()).user,undefined);
    assert.equal((await db.query('SELECT count(*)::int n FROM sports_management.sessions WHERE user_id=$1 AND revoked_at IS NULL',[person.id])).rows[0].n,0);
    const former=new Browser(target.baseUrl);await former.login(person.email,fixturePassword);assert.equal((await former.session()).user,undefined);
    const current=new Browser(target.baseUrl);await current.login(first.email,fixturePassword);assert.ok((await current.session()).user);
    // Observe the revoked session in the public confirmation route without losing its result.
    await command('Network.setCookies',{cookies:[...oldCookies].map(([name,value])=>({name,value,url:target.baseUrl}))});
    await run(()=>window.dispatchEvent(new Event('online')));await new Promise(r=>setTimeout(r,500));
    assert.equal(await run(()=>location.pathname),page);
    for(const theme of ['light','dark'])for(const width of [1280,390]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
      await run(theme=>document.documentElement.dataset.theme=theme,theme);
      assert.equal(await run(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
      const screenshot=await command('Page.captureScreenshot',{format:'png'});
      await writeFile(`${evidence}/email-confirmed-${theme}-${width}.png`,Buffer.from(screenshot.data,'base64'),{mode:0o600});
    }
    context.case='email-reused-link';
    await openLink(first.token);await clickConfirm();await invalid();assert.deepEqual(await snapshot(person.id),after);
    context.case='email-expired-link';
    const expired=await request(expiring), expiredBefore=await snapshot(expiring.id);
    await db.query("UPDATE sports_management.account_email_changes SET created_at=created_at-interval '31 minutes',expires_at=expires_at-interval '31 minutes' WHERE id=$1",[expired.receipt.id]);
    await openLink(expired.token);await clickConfirm();await invalid();assert.deepEqual(await snapshot(expiring.id),expiredBefore);
    context.case='email-replaced-link';
    const superseded=await request(replaced);
    await db.query("UPDATE sports_management.account_email_changes SET created_at=created_at-interval '61 seconds' WHERE id=$1",[superseded.receipt.id]);
    const replacement=await request(replaced), replacementBefore=await snapshot(replaced.id);
    await openLink(superseded.token);await clickConfirm();await invalid();assert.deepEqual(await snapshot(replaced.id),replacementBefore);
    await openLink(replacement.token);await clickConfirm();await wait(()=>document.querySelector('[role="status"] h2')?.textContent==='Correo confirmado');
    assert.equal((await snapshot(replaced.id)).email===replacement.email,true);
    assert.equal(leaked,false);
    context.case='email-confirmation-typecheck';
    await new Promise((resolve,reject)=>execFile(process.execPath,
      [`${process.cwd()}/node_modules/typescript/bin/tsc`,'--noEmit','--incremental','false'],
      {cwd:process.cwd(),env:childEnvironment(process.env),timeout:120000},
      error=>error?reject(new Error('EMAIL_CONFIRMATION_TYPECHECK_FAILED')):resolve()));
    await writeFile(`${evidence}/email-confirmation-browser.json`,JSON.stringify({passed:true,transport:'simulated-in-memory-request-delivery',completionTransport:'NOT_CONFIGURED',typecheck:true,checks:['no-consumption-on-open-or-reload','explicit-post','old-login-until-confirmed','new-login-after-confirmation','previous-sessions-revoked','one-use','expired','superseded','replacement-confirmed','secret-not-rendered-or-in-request-urls','light-dark-mobile-desktop']},null,2),{mode:0o600});
  } catch(error) {
    await writeFile(`${evidence}/email-confirmation-failure.json`,JSON.stringify(accountDiagnostic(error,context),null,2),{mode:0o600});throw error;
  } finally {
    try { await chrome?.close(); } finally {
      messages.length=0;secrets.length=0;
      const closed=await Promise.allSettled([db.end(),prisma.$disconnect()]);
      assert.ok(closed.every(result=>result.status==='fulfilled'),'EMAIL_FIXTURE_CLEANUP_FAILED');
    }
  }
}
