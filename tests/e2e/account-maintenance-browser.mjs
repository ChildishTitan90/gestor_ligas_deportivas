import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { accountDiagnostic } from '../../scripts/verification/account-diagnostics.mjs';
import { launchChrome } from './chrome-session.mjs';
import { Browser } from '../integration/auth.test.mjs';
import { fixturePassword } from '../integration/auth-fixtures.mjs';

// Real Chrome, NextAuth, HTTP and PostgreSQL; only the fixture identities are synthetic.
export async function verifyAccountMaintenanceBrowser({ db, baseUrl, profileDirectory, artifactsDirectory, signal, diagnosticContext }) {
  diagnosticContext.case = 'maintenance-browser-fixtures';
  await db.query("SELECT set_config('app.user_id',id::text,false),set_config('app.reason','Interfaz sintética aislada',false) FROM sports_management.users WHERE username='pdgld48_locked'");
  const users = [];
  for (const kind of ['admin', 'target', 'denied', ...Array.from({length: 3}, (_, i) => `page${i}`)]) {
    const id = randomUUID(), person = randomUUID(), username = `ui-${kind}-${id.slice(0,8)}`, email = `${username}@example.test`;
    await db.query('INSERT INTO sports_management.people(id,first_name,paternal_surname) VALUES ($1,$2,$3)', [person,'Interfaz','Sintética']);
    await db.query(`INSERT INTO sports_management.users(id,person_id,username,email,password_hash,is_active,must_change_password)
      SELECT $1,$2,$3,$4,password_hash,true,false FROM sports_management.users WHERE username='pdgld48_locked'`, [id,person,username,email]);
    users.push({id,username,email});
    if (kind === 'admin') await db.query(`INSERT INTO sports_management.user_roles(user_id,role_id) SELECT $1,id FROM sports_management.roles WHERE code='SUPERADMIN'`,[id]);
  }
  const [admin,target,denied] = users;
  const oldSession = new Browser(baseUrl); await oldSession.login(target.email,fixturePassword);
  assert.ok((await oldSession.session()).user);
  diagnosticContext.case = 'maintenance-browser-launch';
  const chrome = await launchChrome(baseUrl,{profileDirectory,signal});
  const {command,evaluate} = chrome;
  const run = (fn,...args) => evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const wait = async (fn,...args) => {
    for(let i=0;i<240;i++) { signal?.throwIfAborted(); try { if(await run(fn,...args)) return; } catch {} await new Promise(r=>setTimeout(r,250)); }
    throw new Error(`UI_TIMEOUT_${diagnosticContext.case}`);
  };
  const go = async path => { await command('Page.navigate',{url:baseUrl+path}); await wait(path=>location.pathname+location.search===path && document.readyState==='complete',path); };
  const click = async text => {
    await wait(text=>[...document.querySelectorAll('button,a')].some(e=>(e.textContent===text||e.getAttribute('aria-label')===text)&&!e.disabled&&Object.keys(e).some(k=>k.startsWith('__reactProps$'))),text);
    const point = await run(text=>{const e=[...document.querySelectorAll('button,a')].find(e=>(e.textContent===text||e.getAttribute('aria-label')===text)&&!e.disabled);e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},text);
    for(const type of ['mousePressed','mouseReleased']) await command('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
  };
  const set = async (name,value) => { await wait(name=>{const e=document.querySelector(`[name="${name}"]`);return e&&Object.keys(e).some(k=>k.startsWith('__reactProps$'));},name); return run((name,value)=>{const e=document.querySelector(`[name="${name}"]`); const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value); e.dispatchEvent(new Event('input',{bubbles:true}));},name,value); };
  const key = async (key,code) => { for(const type of ['keyDown','keyUp']) await command('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:code,...(key==='Enter'&&type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})}); };
  const login = async user => {
    await command('Network.clearBrowserCookies'); await go('/login');
    assert.equal(await run(async(email,password)=>{const {csrfToken}=await(await fetch('/api/auth/csrf')).json();const r=await fetch('/api/auth/callback/credentials',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email,password,csrfToken,json:'true',callbackUrl:'/access'})});return r.ok&&!new URL((await r.json()).url,location.origin).searchParams.has('error');},user.email,fixturePassword),true);
  };
  const open = async (label, username) => { await click(`${label} de @${username}`); await wait(()=>!!document.querySelector('dialog[open] [data-dialog-initial]:enabled')); };
  const fill = async value => { if(value) await set('value',value); await set('reason','Validación integrada sintética'); await run(()=>document.querySelector('[name="confirmed"]').click()); };
  const saved = () => wait(()=>[...document.querySelectorAll('dialog[open] [role="status"]')].some(e=>e.textContent.startsWith('Cambio guardado.')));
  try {
    await mkdir(artifactsDirectory,{recursive:true,mode:0o700}); await command('Page.enable'); await command('Network.enable');
    await login(admin);
    diagnosticContext.case='list-pagination-search';
    diagnosticContext.case='list-first-page'; await go('/accounts?pageSize=2'); await wait(()=>document.body.textContent.includes('Página 1'));
    diagnosticContext.case='pagination-next'; await click('Página siguiente'); await wait(()=>document.body.textContent.includes('Página 2'));
    diagnosticContext.case='search-submit'; await go('/accounts'); await wait(()=>!!document.querySelector('[name="search"]')); await set('search',target.username); await click('Buscar');
    await wait(username=>document.querySelectorAll('li h2').length===1&&document.body.textContent.includes(username),target.username);
    diagnosticContext.case='create-button-and-return';
    assert.equal(await run(()=>!!document.querySelector('nav[aria-label="Gestión de la liga"] a[href^="/accounts/new"]')),false);
    await click('Crear cuenta'); await wait(()=>location.pathname==='/accounts/new'&&!!document.querySelector('h1'));
    assert.equal(await run(()=>document.querySelector('nav[aria-label="Gestión de la liga"] a[aria-current=page]').getAttribute('href')),'/accounts');
    assert.match(await run(()=>document.querySelector('ol[aria-label="Etapas de creación de cuenta"] [aria-current=step]').textContent),/Capturar datos/);
    await click('Volver a cuentas'); await wait(username=>location.pathname==='/accounts'&&new URLSearchParams(location.search).get('search')===username,target.username);
    for (const theme of ['light','dark']) for (const width of [1280,390]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:940,deviceScaleFactor:1,mobile:width===390});
      await run(theme=>{document.documentElement.dataset.theme=theme;window.scrollTo(0,0);},theme);
      assert.equal(await run(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
      const image=await command('Page.captureScreenshot',{format:'png'});
      await writeFile(`${artifactsDirectory}/listado-${theme}-${width}.png`,Buffer.from(image.data,'base64'),{mode:0o600});
    }
    await open('Ver detalles',target.username);
    diagnosticContext.case='keyboard-dialog';
    assert.equal(await run(()=>document.querySelector('dialog[open]').contains(document.activeElement)),true);
    await key('Tab',9); assert.equal(await run(()=>document.querySelector('dialog[open]').contains(document.activeElement)),true);
    diagnosticContext.case='keyboard-escape'; await key('Escape',27); await wait(()=>!document.querySelector('dialog[open]'));
    assert.equal(await run(()=>document.activeElement.textContent==='Ver detalles'),true);
    diagnosticContext.case='keyboard-enter'; await key('Enter',13); await wait(()=>!!document.querySelector('dialog[open] dd'));
    assert.equal(await run(()=>!!document.querySelector('dialog[open] [aria-haspopup=dialog]')),false);
    await key('Escape',27); await wait(()=>!document.querySelector('dialog[open]'));
    diagnosticContext.case='username-persistence';
    await open('Editar usuario',target.username);
    assert.equal(await run(()=>document.querySelector('dialog[open] [name=value]').value),target.username);
    await run(()=>document.querySelector('[name="value"]').focus()); await key('Tab',9);
    assert.equal(await run(()=>document.activeElement?.getAttribute('name')),'reason');
    assert.equal(await run(()=>{const s=getComputedStyle(document.activeElement);return s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>=2;}),true);
    await key('Tab',9); assert.equal(await run(()=>document.activeElement?.getAttribute('name')),'confirmed');
    const changed=`${target.username}-new`; await fill(changed); await click('Confirmar y guardar'); await saved();
    assert.equal((await oldSession.session()).user,undefined);
    await go(`/accounts?search=${changed}`); await open('Ver detalles',changed);
    assert.equal(await run(changed=>document.querySelector('dialog[open]').textContent.includes('@'+changed),changed),true);
    await key('Escape',27); await wait(()=>!document.querySelector('dialog[open]'));
    diagnosticContext.case='stale-review';
    await open('Dar de baja',changed); await fill();
    await db.query('UPDATE sports_management.users SET maintenance_revision=maintenance_revision+1 WHERE id=$1',[target.id]);
    await click('Confirmar y guardar'); await wait(()=>document.body.textContent.includes('La cuenta cambió desde que la abriste'));
    await click('Revisar versión actual'); await wait(()=>!!document.querySelector('dialog[open] dd'));
    await key('Escape',27); await wait(()=>!document.querySelector('dialog[open]'));
    diagnosticContext.case='deactivate-reactivate';
    await oldSession.login(target.email,fixturePassword); assert.ok((await oldSession.session()).user);
    await open('Dar de baja',changed); await fill(); await click('Confirmar y guardar'); await saved();
    assert.equal((await oldSession.session()).user,undefined);
    await go(`/accounts?search=${changed}`); await open('Reactivar cuenta',changed); await fill(); await click('Confirmar y guardar'); await saved();
    assert.equal((await oldSession.session()).user,undefined);
    diagnosticContext.case='email-not-configured';
    await go(`/accounts?search=${changed}`); await open('Cambiar correo',changed); await fill(`pending-${target.id}@example.test`); await click('Confirmar solicitud');
    await wait(()=>document.body.textContent.includes('NOT_CONFIGURED: no hay transporte de correo configurado; no se envió este mensaje.'));
    assert.equal((await db.query('SELECT email FROM sports_management.users WHERE id=$1',[target.id])).rows[0].email,target.email);
    for(const theme of ['light','dark']) for(const width of [1280,390]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
      await run(theme=>document.documentElement.dataset.theme=theme,theme);
      assert.equal(await run(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
      const image=await command('Page.captureScreenshot',{format:'png'}); await writeFile(`${artifactsDirectory}/accounts-${theme}-${width}.png`,Buffer.from(image.data,'base64'),{mode:0o600});
    }
    diagnosticContext.case='permission-denied'; await login(denied); await go('/accounts');
    await wait(()=>document.body.textContent.includes('permiso')||document.body.textContent.includes('autorizad'));
    assert.equal(await run(()=>!!document.querySelector('[name="search"]')),false);
    await writeFile(`${artifactsDirectory}/maintenance-browser.json`,JSON.stringify({passed:true,checks:['list','search','pagination','detail','username-reload','session-revocation','status-reason-confirmation','stale-review','email-NOT_CONFIGURED-current-preserved','permission-denied','keyboard-dialog-focus','light-dark-desktop-mobile']},null,2),{mode:0o600});
  } catch (error) {
    const indicators = await run(username=>({path:location.pathname,dialogOpen:!!document.querySelector('dialog[open]'),activeTag:document.activeElement.tagName,activeIsDetail:document.activeElement.textContent==='Ver detalles',rows:document.querySelectorAll('li h2').length,
      searchMatches:document.querySelector('[name="search"]')?.value===username,
      queryMatches:new URLSearchParams(location.search).get('search')===username,
      targetVisible:document.body.textContent.includes(username),alert:!!document.querySelector('[role="alert"]')}),target.username).catch(()=>null);
    await writeFile(`${artifactsDirectory}/browser-failure.json`, JSON.stringify({...accountDiagnostic(error,diagnosticContext),indicators},null,2),{mode:0o600});
    throw error;
  } finally { await chrome.close(); }
}
