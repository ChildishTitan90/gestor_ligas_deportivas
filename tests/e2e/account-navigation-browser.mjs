import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { prepareMaintenanceUI } from '../integration/account-maintenance-ui-fixtures.mjs';
import { fixturePassword } from '../integration/auth-fixtures.mjs';
import { validateAccountProvisioningTarget } from '../../scripts/verification/account-provisioning-entry.mjs';
import { launchChrome } from './chrome-session.mjs';

// Only the missing navigation evidence; no maintenance/reset matrix or transport.
export async function verifyAccountNavigation(config) {
  const target = validateAccountProvisioningTarget(config);
  assert.equal(target.suite, 'navigation');
  assert.match(process.cwd(), /^\/(?:private\/tmp|tmp)\/pdgld106-[a-f0-9-]{36}\/app-pg(?:15|17)$/);
  const db = new pg.Client({ connectionString: target.databaseUrl });
  let chrome;
  try {
    await prepareMaintenanceUI(target); await db.connect();
    const admin = (await db.query("SELECT id,email FROM sports_management.users WHERE username='pdgld48_operational'")).rows[0];
    await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','Navegación sintética PDGLD-120',false)", [admin.id]);
    await db.query("INSERT INTO sports_management.user_roles(user_id,role_id) SELECT $1,id FROM sports_management.roles WHERE code='SUPERADMIN'", [admin.id]);
    const major = new URL(target.databaseUrl).port.slice(-2);
    chrome = await launchChrome(target.baseUrl, { profileDirectory: `${dirname(process.cwd())}/chrome-pg${major}` });
    const { command, evaluate } = chrome;
    const run = (fn, ...args) => evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
    const wait = async (fn, ...args) => {
      for (let i=0;i<240;i++) { if (await run(fn,...args)) return; await new Promise(resolve=>setTimeout(resolve,250)); }
      throw Error('ACCOUNT_NAVIGATION_TIMEOUT');
    };
    const go = async path => { await command('Page.navigate',{url:target.baseUrl+path}); await wait(path=>location.pathname===path&&document.readyState==='complete',path); };
    const click = async selector => {
      await wait(selector=>{const e=document.querySelector(selector);return e&&Object.keys(e).some(k=>k.startsWith('__reactProps$'));},selector);
      const point=await run(selector=>{const e=document.querySelector(selector);e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},selector);
      for(const type of ['mousePressed','mouseReleased'])await command('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
    };
    const key = async key => { for(const type of ['keyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:key==='Tab'?9:key==='Escape'?27:13,...(key==='Enter'&&type==='keyDown'?{text:'\r'}:{})}); };
    const login = async email => {
      await command('Network.clearBrowserCookies'); await go('/login');
      assert.equal(await run(async(email,password)=>{const {csrfToken}=await(await fetch('/api/auth/csrf')).json();const r=await fetch('/api/auth/callback/credentials',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email,password,csrfToken,json:'true',callbackUrl:'/access'})});return r.ok&&!new URL((await r.json()).url,location.origin).searchParams.has('error');},email,fixturePassword),true);
    };
    await command('Network.enable'); await command('Page.enable');
    await command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await login(admin.email);await go('/access');
    const link='nav[aria-label="Gestión de la liga"] a[href="/accounts"]';
    await click(link);await wait(()=>location.pathname==='/accounts'&&!!document.querySelector('[name="search"]'));
    assert.equal(await run(selector=>document.querySelector(selector)?.getAttribute('aria-current'),link),'page');
    assert.equal(await run(()=>document.querySelectorAll('main').length),1);
    await go('/accounts');await wait(()=>!!document.querySelector('[name="search"]'));
    await go('/access');await click(link);await wait(()=>location.pathname==='/accounts');
    await evaluate('history.back()');await wait(()=>location.pathname==='/access');
    await evaluate('history.forward()');await wait(()=>location.pathname==='/accounts');
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
    await go('/access');
    const trigger='button[aria-label="Abrir menú de gestión"]';
    await click(trigger);await wait(()=>!!document.querySelector('aside[role="dialog"]'));
    assert.equal(await run(()=>document.querySelector('aside').contains(document.activeElement)),true);
    await key('Tab');assert.equal(await run(()=>document.querySelector('aside').contains(document.activeElement)),true);
    await key('Escape');await wait(()=>!document.querySelector('aside[role="dialog"]'));
    assert.equal(await run(selector=>document.activeElement===document.querySelector(selector),trigger),true);
    await key('Enter');await wait(()=>!!document.querySelector('aside[role="dialog"]'));
    await click(link);await wait(()=>location.pathname==='/accounts'&&!document.querySelector('aside[role="dialog"]'));
    assert.equal(await run(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
    await login('delegado_48@example.test');await go('/access');
    assert.equal(await run(selector=>!!document.querySelector(selector),link),false);
    await go('/accounts');await wait(()=>document.body.textContent.includes('permiso')||document.body.textContent.includes('autorizad'));
    assert.equal(await run(()=>!!document.querySelector('[name="search"]')),false);
    await writeFile(`${dirname(process.cwd())}/evidence-pg${major}/account-navigation.json`,JSON.stringify({passed:true,checks:['authorized-server-navigation','active-link','single-main','direct-route','back-forward','mobile-menu','native-tab-escape-enter','focus-return','close-on-navigation','no-horizontal-overflow','unauthorized-link-omitted','direct-denial'],backend:'real-isolated',identities:'synthetic',emailTransport:'unused'},null,2),{mode:0o600});
  } finally { await chrome?.close();await db.end(); }
}
