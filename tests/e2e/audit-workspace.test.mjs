import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';
import {launchChrome,closeTestServer,waitForTestDone} from './chrome-session.mjs';

const components=['src/features/audit/components/audit-workspace.tsx','src/features/audit/components/audit-journey.tsx','src/components/ui/select-field.tsx'];
const scanner=new Scanner({});
const candidates=scanner.scanFiles(await Promise.all(components.map(async file=>({content:await readFile(file,'utf8'),extension:'tsx'}))));
const compiler=await compile(await readFile('src/app/globals.css','utf8'),{base:resolve('src/app'),onDependency(){}});
const css=compiler.build(candidates);
const bundle=await build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  define:{'process.env.NODE_ENV':'"development"'},
  stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AuditWorkspaceView,AuditDetailView} from './src/features/audit/components/audit-workspace';
const root=createRoot(document.getElementById('root'));
const scope='d7434364-46d5-40f9-8d44-19d67683c468';
const filters={scope,entity:'clubs',actor:'secretaria'};
const entry={id:'e490887c-daf7-4f25-8507-ab70b0240180',at:'2030-01-03T18:30:00.123456Z',actor:'@secretaria',action:'Actualización',entity:'Clubes',name:'Club Deportivo Norte',scope:'Liga de prueba',timezone:'America/Mexico_City',reason:'Corrección autorizada del nombre del club'};
const scopes=[{value:scope,label:'Liga de prueba',timezone:'America/Mexico_City'}];
const workspace={filters,scopes,selected:scopes[0],entries:[entry],next:null};
window.showList=()=>flushSync(()=>root.render(<AuditWorkspaceView workspace={workspace}/>));
window.showDetail=()=>flushSync(()=>root.render(<AuditDetailView entry={{...entry,changes:[{field:'Nombre del club',before:'Club Norte',after:'Club Deportivo Norte'}]}} filters={filters}/>));
const check=(value,message)=>{if(!value)throw Error(message)};
const wait=async(fn)=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Tiempo de espera en la interfaz')};
window.runTest=async()=>{
 window.showList();
 check(document.querySelectorAll('button[type=submit]').length===1,'Debe haber una sola acción principal');
 check(document.querySelector('[aria-current=step]').textContent.includes('Consultar'),'Paso actual incorrecto en listado');
 check(!/Editar operación|Eliminar operación|Publicar/.test(document.body.textContent),'La bitácora recibió acciones de escritura');
 const select=document.getElementById('audit-entity');select.focus();
 flushSync(()=>select.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
 await wait(()=>document.querySelector('[role=listbox]'));
 check(document.querySelector('[aria-selected=true]')?.textContent.includes('Clubes'),'Selección no visible');
 flushSync(()=>select.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 await wait(()=>!document.querySelector('[role=listbox]'));
 check(document.activeElement===select,'Se perdió el foco al cerrar el selector');
 const values=new FormData(document.querySelector('form'));
 check(values.get('scope')===scope && values.get('entity')==='clubs' && values.get('actor')==='secretaria','Filtros no serializables');
 const row=document.querySelector('section a');check(row.href.includes('/audit/'+entry.id)&&row.href.includes('entity=clubs'),'Se perdió la consulta al abrir el detalle');
 window.showDetail();
 check(document.querySelector('[aria-current=step]').textContent.includes('Detalle'),'Paso actual incorrecto en detalle');
 check(document.querySelectorAll('button').length===0,'El detalle agregó botones innecesarios');
 check(document.body.textContent.includes('Antes')&&document.body.textContent.includes('Después'),'No se distinguen los cambios');
 check(document.querySelector('a').href.includes('actor=secretaria'),'El retorno pierde los filtros');
 flushSync(()=>root.render(<AuditDetailView entry={{...entry,reason:'<img src=x onerror=alert(1)>',changes:[]}} filters={filters}/>));
 check(!document.querySelector('img')&&document.body.textContent.includes('<img'),'El contenido de bitácora se interpretó como HTML');
 window.showDetail();
 return true;
};
window.showList();
`},plugins:[{name:'navigation-fixture',setup(plugin){
  plugin.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
  plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"import React from 'react';export default function Link(props){return React.createElement('a',props)}",resolveDir:process.cwd()}));
}}]});

for(const width of [390,1440])for(const theme of ['light','dark'])test(`bitácora: recorrido, filtros y lectura · ${width}px · ${theme}`,{timeout:60000},async t=>{
  const server=createServer((request,response)=>{
    if(request.url==='/bundle.js'){response.setHeader('Content-Type','text/javascript');response.end(bundle.outputFiles[0].contents);return;}
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="es" data-theme="${theme}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--font-geist-sans:Arial;--font-geist-mono:monospace}${css}</style><div id="root"></div><script src="/bundle.js"></script></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>closeTestServer(server));
  const browser=await launchChrome(`http://127.0.0.1:${server.address().port}`,{signal:t.signal,waitForDocument:true});t.after(()=>browser.close());
  await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
  await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
  await browser.evaluate('window.testDone=window.runTest();true');assert.equal(await waitForTestDone(browser),true);
  for(const view of ['List','Detail']){
    await browser.evaluate(`window.show${view}();true`);
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true,'La vista produce desplazamiento horizontal');
    if(process.env.AUDIT_SCREENSHOT_DIR){
      const destination=resolve(process.env.AUDIT_SCREENSHOT_DIR);await mkdir(destination,{recursive:true});
      const capture=await browser.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      await writeFile(join(destination,`audit-${view.toLowerCase()}-${theme}-${width}.png`),Buffer.from(capture.data,'base64'));
    }
  }
});
