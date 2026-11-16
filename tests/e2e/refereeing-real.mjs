import assert from 'node:assert/strict';
import {launchChrome} from './chrome-session.mjs';

/** No reemplaza fetch, sesión, React ni consultas: usa el Next real del runner. */
export async function verifyRealRefereeingBrowser({base,league,season,commission,referee,match}){
  const browser=await launchChrome(`${base}/login`,{commandTimeoutMs:45000});
  const ev=s=>browser.evaluate(s);
  async function wait(condition){const end=Date.now()+45000;while(Date.now()<end){try{if(await ev(`Boolean(${condition})`))return;}catch(e){if(!/navigated|context.*destroyed|Cannot find context/i.test(String(e)))throw e;}await new Promise(r=>setTimeout(r,100));}throw Error('REAL_BROWSER_EXPECTATION_FAILED '+JSON.stringify(await ev(`({heading:document.querySelector('h1')?.textContent,dialogs:document.querySelectorAll('dialog').length,buttons:[...document.querySelectorAll('button')].slice(-8).map(b=>b.textContent.trim()),overlay:!!document.querySelector('nextjs-portal')})`)));}
  async function session(client){await browser.command('Network.clearBrowserCookies');for(const [name,value]of client.cookies)await browser.command('Network.setCookie',{name,value,url:base});}
  async function navigate(path,condition){await browser.command('Page.navigate',{url:base+path});await wait(`location.href===${JSON.stringify(base+path)}&&document.readyState==='complete'&&(${condition})`);}
  try{
    await session(commission);
    for(const theme of ['light','dark'])for(const width of [390,1440]){
      await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
      await navigate(`/referees?league=${league}&season=${season}&view=assignments`,`document.querySelector('h1')?.textContent==='Árbitros y designaciones'`);
      await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true);
      await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Asignar árbitro');if(!b||b.disabled)throw Error('ASSIGNMENT_CAPABILITY_MISSING');b.focus();b.click();})()`);
      await wait(`document.querySelector('dialog[open]')||(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Asignar árbitro');b?.focus();b?.click();return false})()`);
      assert.match(await ev(`document.querySelector('dialog').textContent`),/Asignar árbitro/);
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await wait(`!document.querySelector('dialog[open]')`);assert.ok(await ev(`document.activeElement.textContent==='Asignar árbitro'`),'FOCUS_MUST_RETURN_TO_ASSIGNMENT_BUTTON');
    }
    await session(referee);await navigate(`/matches/${match}/lineup`,`document.body.textContent.includes('Acceso denegado')`);
    assert.equal(await ev(`document.body.textContent.includes('Preparar alineación · Partido')`),false);
    await navigate('/matches',`document.querySelector('h1')?.textContent==='Mis partidos · Alineación'`);
    assert.equal(await ev(`!!document.querySelector('a[href="/matches/${match}/lineup"]')`),false);
    console.log(JSON.stringify({suite:'PDGLD-143 Chrome real',sessions:'NextAuth',backend:'Next.js + PostgreSQL + Preview RLS',themes:2,widths:[390,1440],keyboardFocus:true,revokedMatchDenied:true,fetchMocked:false}));
  }finally{await browser.close();}
}
