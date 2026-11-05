import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchChrome,closeTestServer} from './chrome-session.mjs';

test('Bandeja de identidad: casos identificables, filtros, teclado, refresco y vacíos sin consultas externas', {timeout:45000},async t=>{
  const css=process.env.PLAYER_REVIEW_VISUAL_CSS?await readFile(process.env.PLAYER_REVIEW_VISUAL_CSS,'utf8'):'';
  const shots=css?await mkdtemp(join(tmpdir(),'pdgld-review-ui-')):null;
  const bundle=await build({write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {PlayerReviewWorkspace} from './src/features/players/components/player-review-workspace';
    const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    const base={registeredAt:'2026-11-04T12:00:00Z',clubId:id(10),club:'Club del Parque',seasonId:id(20),season:'Torneo sintético 2026',category:'Categoría A',team:'Equipo del Parque'};
    const rows=[
      {...base,id:id(1),name:'Álvaro Sierra Lara',kind:'IDENTITY',reason:'Nombre y fecha similares: comparar identidades.'},
      {...base,id:id(2),name:'Marina Soto Cruz',kind:'INE',reason:'Fotos o datos requieren revisión administrativa.'},
      {...base,id:id(3),name:'Lucía Torres Reyes',kind:'DOCUMENTS',reason:'2 documentos vigentes pendientes de revisión. Incluye autorización del tutor por acreditar.'},
      {...base,id:id(4),clubId:id(11),club:'Club del Bosque',team:'Equipo del Bosque',seasonId:id(21),season:'Torneo sintético 2027',name:'Daniel Paz Luna',kind:'DOCUMENTS',reason:'1 documento vigente pendiente de revisión.'},
    ];
    window.fetch=async()=>{throw Error('Esta bandeja sintética no debe consultar APIs');};
    const root=createRoot(document.getElementById('root'));
    window.fixture={rows,refreshes:0,render(items=rows){flushSync(()=>root.render(<PlayerReviewWorkspace items={items}/>));}};
    window.fixture.render();
  `},plugins:[{name:'synthetic-next',setup(plugin){
    plugin.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'fixture'}));
    plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='next/link'?"import React from 'react';export default function Link({prefetch,...props}){return React.createElement('a',props)}":"export function useRouter(){return {refresh(){window.fixture.refreshes++}}}",resolveDir:process.cwd()}));
  }}]});
  const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/bundle.js'?'text/javascript':'text/html');response.end(request.url==='/bundle.js'?bundle.outputFiles[0].contents:`<!doctype html><html lang="es" data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root" class="mx-auto w-full max-w-6xl p-5"></div><script src="/bundle.js"></script></html>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>closeTestServer(server));
  const browser=await launchChrome(`http://127.0.0.1:${server.address().port}`,{signal:t.signal,commandTimeoutMs:10000,waitForDocument:true});t.after(()=>browser.close());
  const evaluate=expression=>browser.evaluate(expression);
  const wait=expression=>evaluate(`(async()=>{const until=Date.now()+5000;while(!(${expression})){if(Date.now()>until)throw Error('Bandeja: condición pendiente: '+${JSON.stringify(expression)});await new Promise(r=>setTimeout(r,20));}})()`);
  const click=text=>evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Botón no disponible: '+${JSON.stringify(text)});b.click();})()`);
  const filter=kind=>evaluate(`Array.from(document.querySelectorAll('[aria-pressed]')).find(n=>n.textContent.includes(${JSON.stringify(kind)})).click()`);
  const input=value=>evaluate(`(()=>{const n=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const key=async(key,code=key)=>{const windowsVirtualKeyCode={Tab:9,Enter:13,Escape:27}[key];await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,...(key==='Enter'?{text:'\r'}:{})});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});};
  async function select(label,text){
    await evaluate(`(()=>{const l=Array.from(document.querySelectorAll('label')).find(l=>l.textContent===${JSON.stringify(label)});document.getElementById(l.htmlFor).click();})()`);
    await wait('document.querySelector("[role=option]")');
    await evaluate(`Array.from(document.querySelectorAll('[role=option]')).find(o=>o.textContent.includes(${JSON.stringify(text)})).click()`);
  }
  async function screenshot(name,width,height,theme){
    if(!shots)return;
    await browser.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await evaluate('new Promise(resolve=>setTimeout(resolve,200))');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Sin desbordamiento horizontal');
    const image=await browser.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    const path=join(shots,name+'.png');await writeFile(path,Buffer.from(image.data,'base64'));t.diagnostic(path);
  }
  await wait('window.fixture && document.querySelector("table")');
  assert.equal(await evaluate('document.querySelector("[role=status]").textContent'),'4 de 4 casos en tu alcance');
  assert.equal(await evaluate(`document.querySelector('a[aria-label="Revisar documentos de Lucía Torres Reyes"]').getAttribute('href')`),'/players/review/00000000-0000-4000-8000-000000000003/documents');
  await screenshot('revision-escritorio-oscuro',1440,1000,'dark');
  await filter('Documentos y tutor');await wait('document.querySelector("[role=status]").textContent.includes("2 de 4")');
  assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'),2);
  assert.equal(await evaluate('document.querySelector("[aria-pressed=true]").textContent.includes("Documentos y tutor")'),true);
  await select('Club','Club del Bosque');await wait('document.querySelector("[role=status]").textContent.includes("1 de 4")');
  assert.equal(await evaluate('document.querySelector("tbody").textContent.includes("Daniel Paz Luna")'),true);
  await click('Limpiar filtros');await input('alvaro');await wait('document.querySelector("[role=status]").textContent.includes("1 de 4")');
  assert.equal(await evaluate('document.querySelector("tbody").textContent.includes("Álvaro Sierra Lara")'),true,'Busca sin acentos');
  await input('no existe');await wait('document.body.textContent.includes("No hay casos que coincidan")');await click('Ver todos los casos');
  await wait('document.querySelector("tbody")');
  await select('Temporada','2027');await wait('document.querySelector("[role=status]").textContent.includes("1 de 4")');
  await click('Actualizar bandeja');await wait('window.fixture.refreshes===1');
  assert.equal(await evaluate('document.querySelector("[role=status]").textContent'),'1 de 4 casos en tu alcance','Refrescar conserva filtros');
  await click('Limpiar filtros');
  await evaluate(`document.querySelector('[role=group] button').focus()`);await key('Tab');await key('Enter');
  await wait('document.querySelector("[aria-pressed=true]").textContent.includes("Posibles coincidencias")');
  await click('Limpiar filtros');
  await evaluate(`document.querySelector('[role=combobox]').focus()`);await key('Enter');await wait('document.querySelector("[role=listbox]")');await key('Escape');
  assert.equal(await evaluate('document.activeElement.getAttribute("role")'),'combobox');
  await screenshot('revision-escritorio-claro',1440,1000,'light');
  await screenshot('revision-movil-oscuro',390,844,'dark');
  if(css)assert.equal(await evaluate('getComputedStyle(document.querySelector("table").parentElement).display'),'none');
  await screenshot('revision-movil-claro',390,844,'light');
  await evaluate('window.fixture.render([])');await wait('document.body.textContent.includes("No hay revisiones pendientes")');
  assert.equal(await evaluate('document.querySelector("[role=status]").textContent'),'0 de 0 casos en tu alcance');
  await screenshot('revision-vacia-movil',390,844,'dark');
});
