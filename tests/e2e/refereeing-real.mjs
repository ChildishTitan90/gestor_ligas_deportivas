import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchChrome} from './chrome-session.mjs';

/** No reemplaza fetch, sesión, React ni consultas: usa el Next real del runner. */
export async function verifyRealRefereeingBrowser({base,league,season,commission,referee,match}){
  const browser=await launchChrome(`${base}/login`,{commandTimeoutMs:45000});
  const ev=s=>browser.evaluate(s);
  const visible="element=>element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden'";
  const heading=text=>`[...document.querySelectorAll('h1')].some(h=>(${visible})(h)&&h.textContent===${JSON.stringify(text)})`;
  const assignmentButton=`[...document.querySelectorAll('button')].find(b=>(${visible})(b)&&!b.disabled&&!b.closest('[inert]')&&b.textContent.trim()==='Asignar árbitro')`;
  async function wait(condition){const end=Date.now()+45000;while(Date.now()<end){try{if(await ev(`Boolean(${condition})`))return;}catch(e){if(!/navigated|context.*destroyed|Cannot find context/i.test(String(e)))throw e;}await new Promise(r=>setTimeout(r,100));}throw Error('REAL_BROWSER_EXPECTATION_FAILED '+JSON.stringify(await ev(`({heading:document.querySelector('h1')?.textContent,dialogs:document.querySelectorAll('dialog').length,buttons:[...document.querySelectorAll('button')].slice(-8).map(b=>b.textContent.trim()),overlay:!!document.querySelector('nextjs-portal')})`)));}
  async function session(client){await browser.command('Network.clearBrowserCookies');for(const [name,value]of client.cookies)await browser.command('Network.setCookie',{name,value,url:base});}
  async function navigate(path,condition){
    const previousDocument=await ev('performance.timeOrigin');
    const navigation=await browser.command('Page.navigate',{url:base+path});
    assert.equal(navigation.errorText,undefined,'REFEREEING_NAVIGATION_FAILED');
    // Las cuatro vistas recargan la misma URL. El DOM anterior también cumple
    // URL/título/readyState: esperar al documento nuevo antes de interactuar.
    await wait(`performance.timeOrigin!==${previousDocument}&&location.href===${JSON.stringify(base+path)}&&document.readyState==='complete'&&(${condition})`);
  }
  try{
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__refereeTestErrors=[];addEventListener('error',e=>window.__refereeTestErrors.push(String(e.message).slice(0,400)));addEventListener('unhandledrejection',e=>window.__refereeTestErrors.push(String(e.reason?.message??e.reason).slice(0,400)));`});
    await session(commission);
    for(const theme of ['light','dark'])for(const width of [390,1440]){
      await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
      await navigate(`/referees?league=${league}&season=${season}&view=assignments`,heading('Árbitros y designaciones'));
      await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true);
      await wait(`document.querySelector('dialog[open]')||(()=>{const b=${assignmentButton};b?.focus();b?.click();return false})()`);
      assert.match(await ev(`document.querySelector('dialog[open]').textContent`),/Asignar árbitro/);
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await wait(`!document.querySelector('dialog[open]')&&document.activeElement.textContent==='Asignar árbitro'`);assert.ok(await ev(`document.activeElement.textContent==='Asignar árbitro'`),'FOCUS_MUST_RETURN_TO_ASSIGNMENT_BUTTON');
    }
    await session(referee);await navigate(`/matches/${match}/lineup`,`document.body.textContent.includes('Acceso denegado')`);
    assert.equal(await ev(`document.body.textContent.includes('Preparar alineación · Partido')`),false);
    await navigate('/matches',heading('Cédula arbitral'));
    assert.equal(await ev(`!!document.querySelector('a[href="/matches/${match}/lineup"]')`),false);
    assert.equal(await ev(`!!document.querySelector('a[href="/matches/${match}/report"]')`),false);
    console.log(JSON.stringify({suite:'PDGLD-143 Chrome real',sessions:'NextAuth',backend:'Next.js + PostgreSQL + Preview RLS',themes:2,widths:[390,1440],keyboardFocus:true,revokedMatchDenied:true,fetchMocked:false}));
  }catch(error){
    const major=process.argv.find(a=>a.startsWith('--postgres='))?.split('=')[1]??'15';
    assert.ok(['15','17'].includes(major));
    const directory=`.codex-attachments/pdgld149/pg${major}`;
    await mkdir(directory,{recursive:true});
    const state=await ev(`({theme:document.documentElement.dataset.theme,width:innerWidth,errors:window.__refereeTestErrors??[],assignmentButtons:[...document.querySelectorAll('button')].filter(b=>b.textContent==='Asignar árbitro').map(b=>({disabled:b.disabled,visible:!!b.getClientRects().length,inert:!!b.closest('[inert]')}))})`).catch(()=>({diagnosticUnavailable:true}));
    await writeFile(`${directory}/designaciones-failure.json`,JSON.stringify({error:error.message,...state},null,2));
    const shot=await browser.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).catch(()=>null);
    if(shot)await writeFile(`${directory}/designaciones-failure.png`,Buffer.from(shot.data,'base64'));
    throw error;
  }finally{await browser.close();}
}
