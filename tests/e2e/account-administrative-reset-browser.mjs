import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tsImport } from 'tsx/esm/api';
import { Browser } from '../integration/auth.test.mjs';
import { fixturePassword } from '../integration/auth-fixtures.mjs';
import { prepareMaintenanceUI } from '../integration/account-maintenance-ui-fixtures.mjs';
import { validateAccountProvisioningTarget } from '../../scripts/verification/account-provisioning-entry.mjs';
import { childEnvironment } from '../../scripts/ci/delegate-isolated-runtime.mjs';
import { accountDiagnostic } from '../../scripts/verification/account-diagnostics.mjs';
import { launchChrome } from './chrome-session.mjs';

export async function verifyAdministrativeResetBrowser(config) {
  const target=validateAccountProvisioningTarget(config);
  assert.equal(target.suite,'administrative-reset');
  assert.match(process.cwd(),/^\/(?:private\/tmp|tmp)\/pdgld106-[a-f0-9-]{36}\/app-pg(?:15|17)$/);
  assert.equal(target.fixture.enableFile,`${process.cwd()}/.synthetic-email-enabled`);
  const major=Number(new URL(target.databaseUrl).port.slice(-2)),evidence=`${dirname(process.cwd())}/evidence-pg${major}`;
  const context={case:'reset-fixtures',stage:'administrative-reset'};
  await mkdir(evidence,{recursive:true,mode:0o700});
  const db=new pg.Client({connectionString:target.databaseUrl});
  const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:target.databaseUrl}),log:[]});
  let chrome;
  const checks=[];
  const fixture=async(path,body)=>{
    const response=await fetch(target.fixture.url+path,{headers:{'x-fixture-key':target.fixture.key,'Content-Type':'application/json'},
      ...(body?{method:'POST',body:JSON.stringify(body)}:{}),redirect:'error'});assert.equal(response.ok,true);return response.json();
  };
  const messages=async()=>(await fixture('/state')).messages;
  const delivery=mode=>fixture('/control',{delivery:mode});
  try {
    await prepareMaintenanceUI(target);await db.connect();
    const original=(await db.query("SELECT id,username,email FROM sports_management.users WHERE username IN ('pdgld48_operational','pdgld48_concurrent','pdgld48_idle')")).rows;
    const actor=original.find(u=>u.username==='pdgld48_operational'),backup=original.find(u=>u.username==='pdgld48_concurrent'),scoped=original.find(u=>u.username==='pdgld48_idle');
    await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','Prueba sintética PDGLD-119',false)",[actor.id]);
    const superRole=(await db.query("SELECT id FROM sports_management.roles WHERE code='SUPERADMIN'")).rows[0].id;
    for(const user of [actor,backup])await db.query('INSERT INTO sports_management.user_roles(user_id,role_id) VALUES($1,$2)',[user.id,superRole]);
    const league=(await db.query('INSERT INTO sports_management.leagues(name) VALUES($1) RETURNING id',[`Liga sintética ${randomUUID()}`])).rows[0].id;
    await db.query('INSERT INTO sports_management.user_roles(user_id,role_id,league_id) VALUES($1,$2,$3)',[scoped.id,superRole,league]);
    const create=async(kind,{active=true,verified=true}={})=>{
      const id=randomUUID(),person=randomUUID(),username=`reset-${kind}-${id.slice(0,8)}`,email=`${username}@example.test`;
      await db.query('INSERT INTO sports_management.people(id,first_name,paternal_surname) VALUES($1,$2,$3)',[person,'Persona','Sintética']);
      await db.query(`INSERT INTO sports_management.users(id,person_id,username,email,password_hash,is_active,must_change_password,email_verified_at)
        SELECT $1,$2,$3,$4,password_hash,$5,false,CASE WHEN $6 THEN now() ELSE NULL END FROM sports_management.users WHERE id=$7`,[id,person,username,email,active,verified,actor.id]);return{id,username,email};
    };
    const main=await create('main'),inactive=await create('inactive',{active:false}),unverified=await create('unverified',{verified:false});
    const admin=new Browser(target.baseUrl),limited=new Browser(target.baseUrl),anonymous=new Browser(target.baseUrl);
    await admin.login(actor.email,fixturePassword);assert.ok((await admin.session()).user);
    await limited.login(scoped.email,fixturePassword);assert.ok((await limited.session()).user);
    const snapshot=async id=>({
      user:(await db.query('SELECT * FROM sports_management.users WHERE id=$1',[id])).rows[0],
      sessions:(await db.query('SELECT * FROM sports_management.sessions WHERE user_id=$1 ORDER BY id',[id])).rows,
      resets:(await db.query('SELECT * FROM sports_management.password_resets WHERE user_id=$1 ORDER BY id',[id])).rows,
      pending:(await db.query('SELECT * FROM sports_management.account_email_changes WHERE user_id=$1 ORDER BY id',[id])).rows,
      audit:(await db.query('SELECT * FROM sports_management.audit_logs WHERE entity_id=$1 ORDER BY id',[id])).rows,
    });
    const input=async user=>({expectedRevision:(await snapshot(user.id)).user.maintenance_revision,identityVerified:true,
      verificationMethod:'IN_PERSON',confirmed:true,reason:'Identidad sintética comprobada en persona'});
    const post=(user,body,browser=admin)=>browser.request(`/api/account-maintenance/${user.id}/reset-access`,{method:'POST',
      headers:{origin:target.baseUrl,'content-type':'application/json'},body:JSON.stringify(body)});
    const expect=async(response,status,code)=>{context.safeValues=true;assert.equal(response.status,status);context.safeValues=false;const body=await response.json();if(code)assert.equal(body.code,code);return body;};
    context.case='reset-authorization';
    await expect(await post(main,await input(main),anonymous),401);
    await expect(await post(main,await input(main),limited),403);
    await expect(await post(actor,await input(actor)),409,'RESET_NOT_ALLOWED');
    await expect(await post(inactive,await input(inactive)),409,'RESET_NOT_ALLOWED');
    const unverifiedBefore=await snapshot(unverified.id);
    await expect(await post(unverified,await input(unverified)),409,'VERIFIED_CHANNEL_REQUIRED');
    assert.deepEqual(await snapshot(unverified.id),unverifiedBefore);
    assert.equal((await messages()).length,0);
    for(const patch of [{identityVerified:false},{confirmed:false},{reason:'short'},{verificationMethod:'OTHER'},{email:'not-authorized@example.test'}])
      await expect(await post(main,{...await input(main),...patch}),400);
    const unchanged=await snapshot(main.id);
    await expect(await post(main,await input(main)),503,'NOT_CONFIGURED');assert.deepEqual(await snapshot(main.id),unchanged);
    assert.equal((await messages()).length,0);
    checks.push('unverified-channel-and-not-configured-no-state-change-no-send');
    checks.push('permissions-scope-self-inactive-validation-verified-destination-no-provider');
    await writeFile(target.fixture.enableFile,'synthetic-only',{flag:'wx',mode:0o600});
    context.case='reset-last-superadmin';
    // A global UPDATE operator without the SUPERADMIN role must not remove the last operational SUPERADMIN.
    const role=(await db.query("INSERT INTO sports_management.roles(id,code,name) VALUES($1,'SYNTHETIC_OPERATOR','Operador sintético') RETURNING id",[randomUUID()])).rows[0].id;
    await db.query("INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) SELECT $1,id,false FROM sports_management.permissions WHERE module='users' AND action IN ('READ','UPDATE')",[role]);
    await db.query('UPDATE sports_management.user_roles SET role_id=$2 WHERE user_id=$1 AND role_id=$3',[actor.id,role,superRole]);
    await db.query('UPDATE sports_management.users SET email_verified_at=now() WHERE id=$1',[backup.id]);
    try{const before=await snapshot(backup.id);const response=await post(backup,await input(backup));assert.equal(response.status,409);assert.match((await response.json()).code,/^LAST_/);assert.deepEqual(await snapshot(backup.id),before);}
    finally{await db.query('UPDATE sports_management.user_roles SET role_id=$2 WHERE user_id=$1 AND role_id=$3',[actor.id,superRole,role]);}
    checks.push('last-operational-superadmin');
    context.case='reset-rollback';
    const rollback=await create('rollback'),rollbackSession=new Browser(target.baseUrl);await rollbackSession.login(rollback.email,fixturePassword);
    await db.query('INSERT INTO sports_management.password_resets(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval \'1 hour\')',[rollback.id,randomBytes(32).toString('hex')]);
    const rollbackBefore=await snapshot(rollback.id),countBefore=(await messages()).length;
    const trigger=`reset_fail_${randomBytes(5).toString('hex')}`;
    await db.query(`CREATE FUNCTION sports_management.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.new_data->>'operation'='ADMINISTRATIVE_RESET' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await db.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION sports_management.${trigger}()`);
    try{await expect(await post(rollback,await input(rollback)),503);assert.deepEqual(await snapshot(rollback.id),rollbackBefore);assert.equal((await messages()).length,countBefore);}
    finally{await db.query(`DROP TRIGGER ${trigger} ON sports_management.audit_logs`);await db.query(`DROP FUNCTION sports_management.${trigger}()`);}
    checks.push('atomic-rollback-no-delivery');
    context.case='reset-concurrent-issuance';
    const race=await create('race'),payload=await input(race),beforeRace=await snapshot(race.id),n=(await messages()).length;
    const outcomes=await Promise.all([post(race,payload),post(race,payload)]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[202,409]);
    const raceAfter=await snapshot(race.id);assert.equal(raceAfter.user.version,beforeRace.user.version+1);assert.equal((await messages()).length,n+1);
    const credential=(await messages()).at(-1).temporaryPassword;assert.equal(Buffer.from(credential,'base64url').length,32);
    const first=new Browser(target.baseUrl),second=new Browser(target.baseUrl);
    await Promise.all([first.login(race.email,credential),second.login(race.email,credential)]);
    const sessions=await Promise.all([first.session(),second.session()]);assert.equal(sessions.filter(s=>s.user).length,1);
    assert.equal(sessions.find(s=>s.user).user.mustChangePassword,true);
    checks.push('concurrent-reset-one-commit-one-delivery','concurrent-login-one-use');
    context.case='reset-expiry';
    const expiring=await create('expired');await expect(await post(expiring,await input(expiring)),202);
    const expiredCredential=(await messages()).at(-1).temporaryPassword;
    await db.query("UPDATE sports_management.users SET admin_reset_expires_at=now()-interval '1 second' WHERE id=$1",[expiring.id]);
    const expiredLogin=new Browser(target.baseUrl);await expiredLogin.login(expiring.email,expiredCredential);assert.equal((await expiredLogin.session()).user,undefined);
    const leased=await create('lease');const leaseReceipt=await expect(await post(leased,await input(leased)),202),leaseCredential=(await messages()).at(-1).temporaryPassword;
    const lease=new Browser(target.baseUrl);await lease.login(leased.email,leaseCredential);const leaseSession=await lease.session();assert.ok(leaseSession.user);assert.ok(Date.parse(leaseSession.expires)<=Date.parse(leaseReceipt.expiresAt));
    await db.query("UPDATE sports_management.users SET admin_reset_expires_at=now()-interval '1 second',admin_reset_consumed_at=now()-interval '2 seconds' WHERE id=$1",[leased.id]);
    assert.equal((await lease.session()).user,undefined);checks.push('credential-expiry','restricted-session-expiry');
    context.case='reset-replacement-and-delivery';
    for(const mode of ['FAILED','UNKNOWN']){
      const user=await create(mode.toLowerCase());await delivery(mode);const old=await input(user);
      const receipt=await expect(await post(user,old),202);assert.equal(receipt.delivery,mode);
      const oldCredential=(await messages()).at(-1).temporaryPassword,count=(await messages()).length;
      await expect(await post(user,old),409,'ACCOUNT_CHANGED');assert.equal((await messages()).length,count);
      await delivery('ACCEPTED');await expect(await post(user,await input(user)),202);
      const replacement=(await messages()).at(-1).temporaryPassword;assert.equal(oldCredential===replacement,false);
      const invalid=new Browser(target.baseUrl);await invalid.login(user.email,oldCredential);assert.equal((await invalid.session()).user,undefined);
      const valid=new Browser(target.baseUrl);await valid.login(user.email,replacement);assert.ok((await valid.session()).user);
      const audits=(await snapshot(user.id)).audit;assert.equal(JSON.stringify(audits).includes(oldCredential)||JSON.stringify(audits).includes(replacement),false);
    }
    checks.push('failed-unknown-delivery-no-automatic-replay','replacement-invalidates-previous-credential','secret-free-audit');
    // Keep a valid old session, recovery token and pending email to verify all invalidations from the UI.
    const oldSession=new Browser(target.baseUrl);await oldSession.login(main.email,fixturePassword);assert.ok((await oldSession.session()).user);
    const oldCookies=new Map(oldSession.cookies);
    await db.query('INSERT INTO sports_management.password_resets(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval \'1 hour\')',[main.id,randomBytes(32).toString('hex')]);
    const {createDatabaseEmailChanges}=await tsImport('../../src/features/accounts/server/email-change.ts',import.meta.url);
    const emailService=createDatabaseEmailChanges(prisma,async()=>actor.id,null);
    await emailService.request(main.id,{email:`pending-${randomUUID()}@example.test`,operationKey:randomUUID(),expectedRevision:(await input(main)).expectedRevision,confirmed:true,reason:'Correo pendiente sintético antes de restablecer'});
    context.case='reset-browser-launch';
    chrome=await launchChrome(target.baseUrl,{profileDirectory:`${dirname(process.cwd())}/chrome-pg${major}`});
    const {command,evaluate,socket}=chrome;
    const run=(fn,...args)=>evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
    const wait=async(fn,...args)=>{for(let i=0;i<240;i++){try{if(await run(fn,...args))return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('RESET_UI_TIMEOUT');};
    const key=async(key,code)=>{for(const type of ['keyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key,code:key===' '?'Space':key,windowsVirtualKeyCode:code,...(type==='keyDown'&&['Enter',' '].includes(key)?{text:key==='Enter'?'\r':' '}:{})});};
    const click=async text=>{
      await wait(text=>[...document.querySelectorAll('button,a')].some(e=>e.textContent===text&&!e.disabled&&Object.keys(e).some(k=>k.startsWith('__reactProps$'))),text);
      const point=await run(text=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent===text&&!e.disabled);e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},text);
      for(const type of ['mousePressed','mouseReleased'])await command('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
    };
    const set=async(name,value)=>{await wait(name=>{const e=document.querySelector(`[name="${name}"]`);return e&&Object.keys(e).some(k=>k.startsWith('__reactProps$'));},name);
      await run((name,value)=>{const e=document.querySelector(`[name="${name}"]`);Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));},name,value);};
    const go=async path=>{await command('Page.navigate',{url:target.baseUrl+path});await wait(()=>document.readyState==='complete');};
    const login=async(user,password)=>{await command('Network.clearBrowserCookies');await go('/login');assert.equal(await run(async(email,password)=>{const {csrfToken}=await(await fetch('/api/auth/csrf')).json();const response=await fetch('/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email,password,csrfToken,json:'true',callbackUrl:'/access'})});return response.ok&&!new URL((await response.json()).url,location.origin).searchParams.has('error');},user.email,password),true);};
    const open=async user=>{await go(`/accounts?search=${user.username}`);await click(`Ver detalle de @${user.username}`);await wait(()=>!!document.querySelector('dialog[open] dd'));};
    const fill=async()=>{
      await run(()=>document.querySelector('[data-select-field="verificationMethod"]').focus());await key('ArrowDown',40);await key('Enter',13);
      await wait(()=>document.querySelector('[name="verificationMethod"]').value==='IN_PERSON');
      await key('Tab',9);assert.equal(await run(()=>document.activeElement.name),'identityVerified');
      await key(' ',32);await set('reason','Verificación sintética de identidad en persona');await run(()=>document.querySelector('[name="confirmed"]').click());
    };
    await command('Page.enable');await command('Network.enable');await login(actor,fixturePassword);await open(main);
    context.case='reset-browser-keyboard';
    assert.equal(await run(()=>document.querySelector('dialog[open]').contains(document.activeElement)),true);
    await key('Escape',27);await wait(()=>!document.querySelector('dialog[open]'));assert.equal(await run(()=>document.activeElement.textContent.startsWith('Ver detalle de @')),true);
    await key('Enter',13);await wait(()=>!!document.querySelector('dialog[open] dd'));await click('Restablecer acceso');await fill();
    for(const theme of ['light','dark'])for(const width of [1280,390]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});await run(theme=>document.documentElement.dataset.theme=theme,theme);
      assert.equal(await run(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
      const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(`${evidence}/reset-${theme}-${width}.png`,Buffer.from(shot.data,'base64'),{mode:0o600});
    }
    context.case='reset-browser-stale-review';
    await db.query('UPDATE sports_management.users SET maintenance_revision=maintenance_revision+1 WHERE id=$1',[main.id]);
    await click('Confirmar y guardar');await wait(()=>document.body.textContent.includes('La cuenta cambió desde que la abriste'));
    await click('Revisar versión actual');await wait(()=>[...document.querySelectorAll('button')].some(e=>e.textContent==='Restablecer acceso'));await click('Restablecer acceso');await fill();
    context.case='reset-browser-lost-response';
    let drop=true,posts=0;
    socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.method==='Network.requestWillBeSent'&&message.params.request.method==='POST'&&new URL(message.params.request.url).pathname.endsWith('/reset-access'))posts++;
      if(message.method==='Fetch.requestPaused')void command(drop?'Fetch.failRequest':'Fetch.continueRequest',drop?{requestId:message.params.requestId,errorReason:'Failed'}:{requestId:message.params.requestId}).catch(()=>{});
    });
    await command('Fetch.enable',{patterns:[{urlPattern:'*/reset-access',requestStage:'Response'}]});
    const beforeUi=await snapshot(main.id),messageCount=(await messages()).length;
    assert.ok(beforeUi.user.email_verified_at);
    assert.equal(beforeUi.user.email,main.email);
    assert.ok(beforeUi.pending.some(row=>row.status==='PENDING'&&row.new_email!==beforeUi.user.email));
    await click('Confirmar y guardar');await wait(()=>document.body.textContent.includes('No se conoce el resultado.'));
    drop=false;await command('Fetch.disable');
    assert.equal(posts,1);const afterUi=await snapshot(main.id);assert.equal(afterUi.user.version,beforeUi.user.version+1);
    assert.equal((await messages()).length,messageCount+1);assert.equal((await messages()).at(-1).to===main.email,true);
    assert.ok(afterUi.sessions.every(s=>s.revoked_at));assert.ok(afterUi.resets.every(r=>r.used_at));assert.ok(afterUi.pending.every(r=>r.status==='SUPERSEDED'));
    const uiCredential=(await messages()).at(-1).temporaryPassword;assert.equal(JSON.stringify(afterUi.audit).includes(uiCredential),false);
    await key('Escape',27);await wait(()=>!document.querySelector('dialog[open]'));await click('Reabrir operación pendiente');await click('Consultar estado sin reenviar');
    await wait(()=>document.body.textContent.includes('No acredita que el cambio anterior'));
    assert.equal(posts,1);assert.equal((await messages()).length,messageCount+1);
    oldSession.cookies=oldCookies;assert.equal((await oldSession.session()).user,undefined);
    const oldLogin=new Browser(target.baseUrl);await oldLogin.login(main.email,fixturePassword);assert.equal((await oldLogin.session()).user,undefined);
    checks.push('real-browser-form-select-keyboard-focus-themes-mobile','stale-review','response-lost-consult-without-replay','current-email-not-pending','sessions-resets-and-pending-email-invalidated');
    context.case='reset-browser-required-password-change';
    await login(main,uiCredential);await go('/accounts');await wait(()=>location.pathname==='/change-password');
    assert.equal(await run(async()=> (await fetch('/api/account-maintenance')).status),403);
    const nextPassword=`Changed-${randomBytes(24).toString('base64url')}!aA`;
    await set('currentPassword',uiCredential);await set('newPassword',nextPassword);await set('confirmPassword',nextPassword);await click('Guardar nueva contraseña');await wait(()=>location.pathname==='/login');
    const changed=new Browser(target.baseUrl);await changed.login(main.email,nextPassword);assert.equal((await changed.session()).user?.mustChangePassword,false);
    const reused=new Browser(target.baseUrl);await reused.login(main.email,uiCredential);assert.equal((await reused.session()).user,undefined);
    assert.equal((await snapshot(main.id)).user.admin_reset_expires_at,null);
    checks.push('required-change-in-browser','new-password-works-temporary-password-unusable','public-session-remains-minimal');
    context.case='reset-typecheck';
    await new Promise((resolve,reject)=>execFile(process.execPath,[`${process.cwd()}/node_modules/typescript/bin/tsc`,'--noEmit','--incremental','false'],{cwd:process.cwd(),env:childEnvironment(process.env),timeout:120000},async(error,stdout)=>{
      if(!error){resolve();return;}
      // Solo ubicaciones/códigos: el transporte de la copia contiene una clave sintética.
      const diagnostics=[...stdout.matchAll(/^([^\n]+\(\d+,\d+\)): error (TS\d+):/gm)].map(([,location,code])=>({location,code}));
      await writeFile(`${evidence}/reset-typecheck-failure.json`,JSON.stringify({timedOut:error.killed===true,diagnostics},null,2),{mode:0o600}).catch(()=>{});
      reject(Error('RESET_TYPECHECK_FAILED'));
    }));
    await writeFile(`${evidence}/administrative-reset-browser.json`,JSON.stringify({passed:true,typecheck:true,transport:'resend-adapter-with-loopback-fetch',provider:'resend',realDelivery:false,checks},null,2),{mode:0o600});
  }catch(error){await writeFile(`${evidence}/administrative-reset-failure.json`,JSON.stringify(accountDiagnostic(error,context),null,2),{mode:0o600});throw error;}
  finally{try{await chrome?.close();}finally{await Promise.all([db.end(),prisma.$disconnect()]);}}
}
