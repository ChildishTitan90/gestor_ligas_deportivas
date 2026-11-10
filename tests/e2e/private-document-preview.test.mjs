import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {launchChrome,closeTestServer} from './chrome-session.mjs';
test('Visor privado: imagen/PDF, cierre por teclado, vencimiento y permiso denegado sin descargar',{timeout:45000},async t=>{
 const bundle=await build({write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {PrivateDocumentPreview} from './src/features/players/components/private-document-preview';
 let kind='image',life=60;const calls=[],revoked=[],nativeRevoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=u=>{revoked.push(u);nativeRevoke(u)};
 window.fetch=async(url,options)=>{calls.push({url,options});if(url==='/api/document'){if(kind==='denied')return Response.json({code:'FORBIDDEN'},{status:403});return Response.json({downloadUrl:'https://private.example.test/object',expiresInSeconds:life,mimeType:kind==='pdf'?'application/pdf':'image/png'});}if(url==='https://private.example.test/object'){if(kind==='pdf')return new Response('%PDF-1.7\\n%%EOF',{headers:{'Content-Type':'application/pdf'}});const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));return new Response(bytes,{headers:{'Content-Type':'image/png'}});}throw Error('Unexpected request');};
 function App(){const [request,setRequest]=useState(null);return <><button id="open" onClick={()=>setRequest({label:'Documento sintético',path:'/api/document',body:{}})}>Consultar documento</button>{request && <PrivateDocumentPreview actorId="00000000-0000-4000-8000-000000000001" request={request} onClose={()=>setRequest(null)}/>}</>}
 createRoot(document.getElementById('root')).render(<App/>);window.fixture={calls,revoked,configure(k,l=60){kind=k;life=l;}};
 `}});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].contents:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>closeTestServer(server));
 const b=await launchChrome(`http://127.0.0.1:${server.address().port}`,{signal:t.signal,commandTimeoutMs:10000,waitForDocument:true});t.after(()=>b.close());
 const ev=e=>b.evaluate(e),wait=e=>ev(`(async()=>{const end=Date.now()+5000;while(!(${e})){if(Date.now()>end)throw Error('Visor: '+${JSON.stringify(e)});await new Promise(r=>setTimeout(r,20));}})()`);
 await wait('window.fixture && document.getElementById("open")');
 const open=async(kind,life=60)=>{await ev(`window.fixture.configure(${JSON.stringify(kind)},${life});document.getElementById('open').focus();document.getElementById('open').click()`);await wait('document.querySelector("dialog")?.open');};
 const close=async()=>{await ev(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Cerrar vista previa').click()`);await wait('!document.querySelector("dialog")');};
 await open('image');await wait('document.querySelector("dialog img")?.naturalWidth===1');assert.equal(await ev('document.querySelector("dialog img").src.startsWith("blob:")'),true);
 await ev(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Ampliar imagen').click()`);assert.equal(await ev('document.querySelector("[aria-pressed]").getAttribute("aria-pressed")'),'true');
 await b.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await b.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait('!document.querySelector("dialog")');assert.equal(await ev('document.activeElement.id'),'open');assert.equal(await ev('window.fixture.revoked.length'),1);
 await open('pdf');await wait('document.querySelector("iframe")');assert.equal(await ev('document.querySelector("iframe").src.startsWith("blob:")'),true);await close();
 await open('image',1);await wait('document.body.textContent.includes("El acceso temporal venció")');assert.equal(await ev('!!document.querySelector("dialog img")'),false);await close();
 const before=await ev('window.fixture.calls.filter(c=>c.url.startsWith("https:")).length');await open('denied');await wait('document.body.textContent.includes("No se pudo mostrar")');assert.equal(await ev('window.fixture.calls.filter(c=>c.url.startsWith("https:")).length'),before);await close();
 assert.equal(await ev('!!document.querySelector("a[download]")'),false);assert.equal(await ev('localStorage.length+sessionStorage.length'),0);assert.ok((await ev('window.fixture.calls.filter(c=>c.url.startsWith("https:")).map(c=>c.options)')).every(o=>o.cache==='no-store' && o.credentials==='omit'));
});
