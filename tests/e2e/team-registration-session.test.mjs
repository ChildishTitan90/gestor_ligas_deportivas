import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// React DOM real en Chrome headless; red y datos de negocio exclusivamente sintéticos.
// No inicia Next, importa servicios de servidor ni contacta una base de datos.
test("foco de formulario y modal; cambio de usuario oculta respuestas tardías", { timeout: 45000 }, async () => {
  const bundle = await build({ write: false, bundle: true, platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"development"' },
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { TeamRegistrationFormView } from './src/features/clubs/components/team-registration-form';
      import { createTeamRegistrationFormController } from './src/features/clubs/team-registration-form-controller';
      import { TeamRegistrationWorkspace } from './src/features/clubs/components/team-registration-workspace';
      const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
      const a = id(90), b = id(91);
      let currentUser = a, changeUser, late, lateSignal, delayList = false;
      const posts = [];
      const pending = { enrollmentKey:id(100), clubId:id(1), seasonId:id(2), categoryId:id(3), groupId:id(4), team:{mode:'new',name:'PRIVATE-CAPTURE-A'} };
      const stored = JSON.stringify(pending);
      sessionStorage.setItem('team-enrollment:pending:'+a,stored);
      const options = user => ({ clubs:[{id:user===a?id(1):id(11),name:user===a?'CLUB-A':'CLUB-B',leagueId:id(9)}],
        seasons:[{id:id(2),name:'SYNTHETIC-SEASON',status:'OPEN'}],teams:[],categories:[],groups:[] });
      const json = value => new Response(JSON.stringify(value),{status:200});
      window.fetch = async (path,init) => {
        if(path==='/api/auth/session') return json({user:{id:currentUser,mustChangePassword:false}});
        if(init?.method==='POST') {posts.push({user:currentUser,body:init.body});throw Error('Unexpected POST');}
        if(String(path).startsWith('/api/team-enrollments/options')) return json(options(currentUser));
        if(String(path).startsWith('/api/team-enrollments?')) {
          if(delayList && currentUser===a) {lateSignal=init.signal; return new Promise(resolve=>{late=resolve;});}
          return json({items:[],nextAfter:null});
        }
        throw Error('Unexpected endpoint');
      };
      function Parent(){const [user,setUser]=useState(a);changeUser=setUser;return <div id="stable-parent"><TeamRegistrationWorkspace userId={user}/></div>;}
      const check=(value,message)=>{if(!value)throw Error(message);};
      const wait=async predicate=>{for(let n=0;n<300;n++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
      window.testDone=(async()=>{
        let root=createRoot(document.getElementById('root'));
        let finish;
        const formOptions={clubs:[{id:id(1),name:'SYNTHETIC',seasons:[{id:id(2),name:'SYNTHETIC',canCreateTeam:false,
          teams:[{id:id(5),name:'SYNTHETIC'}],categories:[{id:id(3),name:'SYNTHETIC',groups:[{id:id(4),name:'SYNTHETIC'}]}]}]}]};
        const formController=createTeamRegistrationFormController(formOptions,()=>new Promise(resolve=>{finish=resolve;}));
        flushSync(()=>root.render(<TeamRegistrationFormView controller={formController}/>));
        for(const [field,value] of Object.entries({clubId:id(1),seasonId:id(2),teamId:id(5)})) flushSync(()=>formController.change(field,value));
        document.querySelector('form').requestSubmit();
        await wait(()=>document.activeElement?.getAttribute('name')==='categoryId');
        check(document.getElementById(document.activeElement.getAttribute('aria-describedby'))?.textContent.includes('categoría'),'Field error association missing');
        flushSync(()=>{formController.change('categoryId',id(3));formController.change('groupId',id(4));});
        document.querySelector('form').requestSubmit();
        await wait(()=>!!finish);
        check(document.querySelector('button[type="submit"]').disabled,'Duplicate submit enabled');
        finish({kind:'correctable',fieldErrors:{groupId:'SYNTHETIC-SERVER-ERROR'}});
        await wait(()=>document.activeElement?.getAttribute('name')==='groupId');
        check(document.getElementById(document.activeElement.getAttribute('aria-describedby')).textContent==='SYNTHETIC-SERVER-ERROR','Async error not linked');
        flushSync(()=>formController.change('groupId',id(4)));
        document.querySelector('form').requestSubmit();
        finish({kind:'confirmed',teamId:id(5),seasonTeamId:id(7),status:'REGISTERED'});
        await wait(()=>document.activeElement?.getAttribute('role')==='status');
        check(document.activeElement.textContent.includes('Inscripción confirmada'),'Confirmation did not receive focus');
        Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Iniciar otra inscripción').click();
        await wait(()=>document.activeElement?.getAttribute('name')==='clubId');
        // Montar la vista real con captura pendiente; abrir/cancelar no hace POST.
        flushSync(()=>root.render(<Parent/>));
        const parent=document.getElementById('stable-parent');
        await wait(()=>document.querySelector('input[name="teamName"]')?.value==='PRIVATE-CAPTURE-A');
        const discard=Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Cerrar formulario…');
        discard.focus();discard.click();
        await wait(()=>document.querySelector('dialog')?.open);
        check(document.activeElement.textContent==='Seguir en el formulario','Unsafe initial modal focus');
        const background=document.getElementById('registration-query-club');background.focus();
        check(document.querySelector('dialog').contains(document.activeElement),'Focus escaped modal');
        // El evento cancel es el que emite el navegador al pulsar Escape.
        document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));
        await wait(()=>!document.querySelector('dialog'));
        check(document.activeElement===discard,'Cancel did not restore trigger focus');
        check(sessionStorage.getItem('team-enrollment:pending:'+a)===stored,'Cancel removed pending');
        delayList=true;
        const club=document.getElementById('registration-query-club');club.value=id(1);club.form.requestSubmit();
        await wait(()=>!!late);
        currentUser=b;flushSync(()=>changeUser(b));
        check(document.getElementById('stable-parent')===parent,'Parent was unmounted');
        check(!document.querySelector('input[name="teamName"]'),'Previous capture still visible');
        await wait(()=>lateSignal.aborted);
        late(json({items:[{id:id(7),teamId:id(5),teamName:'PRIVATE-LATE-A',teamReferenceNumber:'SYNTHETIC',clubId:id(1),seasonId:id(2),categoryId:id(3),categoryName:'SYNTHETIC',groupId:id(4),groupName:'SYNTHETIC',status:'REGISTERED'}],nextAfter:null}));
        await wait(()=>document.body.textContent.includes('CLUB-B'));
        await new Promise(r=>setTimeout(r,40));
        check(!document.body.textContent.includes('PRIVATE-LATE-A'),'Late response leaked');
        check(!document.body.textContent.includes('CLUB-A'),'Previous options leaked');
        check(!document.querySelector('input[name="teamName"]'),'Previous draft leaked');
        check(sessionStorage.getItem('team-enrollment:pending:'+a)===stored,'Previous key was removed');
        check(sessionStorage.getItem('team-enrollment:pending:'+b)===null,'Previous capture reassigned');
        check(posts.length===0,'Pending sent under a different identity');
        // Volver al propietario permite el cierre explícito; debe enfocar el bloqueo.
        delayList=false;currentUser=a;flushSync(()=>changeUser(a));
        await wait(()=>document.querySelector('input[name="teamName"]')?.value==='PRIVATE-CAPTURE-A');
        const discardAgain=Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Cerrar formulario…');
        discardAgain.focus();discardAgain.click();await wait(()=>document.querySelector('dialog')?.open);
        Array.from(document.querySelectorAll('dialog button')).find(button=>button.textContent==='Cerrar y conservar pendiente').click();
        await wait(()=>!document.querySelector('dialog') && document.activeElement?.textContent.includes('Formulario cerrado'));
        check(sessionStorage.getItem('team-enrollment:pending:'+a)===stored,'Close lost pending body or key');
        check(sessionStorage.getItem('team-enrollment:pending:'+a+':discarded')===null,'Close created a destructive marker');
        Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Retomar envío pendiente').click();
        await wait(()=>document.querySelector('input[name="teamName"]')?.value==='PRIVATE-CAPTURE-A');
        check(document.querySelector('button[type="submit"]').disabled,'Resumed pending allowed a new enrollment');
        root.unmount();root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<Parent/>));
        await wait(()=>document.querySelector('input[name="teamName"]')?.value==='PRIVATE-CAPTURE-A');
        check(sessionStorage.getItem('team-enrollment:pending:'+a)===stored,'Remount lost pending');
        check(posts.length===0,'Discard sent a POST');
        root.unmount();return {parentPreserved:true,oldReadAborted:true,lateResponseHidden:true,pendingPreserved:true,posts:posts.length};
      })();
    ` }, plugins: [{ name: "synthetic-navigation", setup(plugin) {
      plugin.onResolve({ filter: /^@\/components\/ui\/action-link$/ }, () => ({ path: "action-link", namespace: "synthetic" }));
      plugin.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "import React from 'react';export function ActionLink({children,href}){return React.createElement('a',{href},children)}", resolveDir: process.cwd() }));
    } }],
  });
  const server = createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].contents); }
    else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = await mkdtemp(join(tmpdir(), "pdgld63-browser-"));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const chrome = spawn(process.env.CHROME_BIN ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"), [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, origin,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let socket;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = "";
      chrome.once("error", reject); chrome.once("exit", code => reject(new Error(`Chrome exited: ${code}`)));
      chrome.stderr.on("data", chunk => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); });
    });
    const base = new URL(endpoint); const listUrl = `http://${base.host}/json/list`;
    let page;
    for (let n = 0; n < 100 && !page; n++) { page = (await (await fetch(listUrl)).json()).find(target => target.url.startsWith(origin)); if (!page) await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.ok(page, "Missing synthetic page");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let commandId = 0;
    const evaluate = () => new Promise((resolve, reject) => {
      const id = ++commandId;
      const listener = event => { const message = JSON.parse(event.data); if (message.id !== id) return;
        socket.removeEventListener("message", listener);
        if (message.result?.exceptionDetails || message.error) reject(new Error("Browser assertion failed: " + JSON.stringify(message.result?.exceptionDetails ?? message.error)));
        else resolve(message.result.result.value);
      };
      socket.addEventListener("message", listener);
      socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: "(async()=>{while(!window.testDone)await new Promise(r=>setTimeout(r,10));return await window.testDone})()", awaitPromise: true, returnByValue: true } }));
    });
    let result;
    for (let attempt = 0; attempt < 5; attempt++) {
      try { result = await evaluate(); break; }
      catch (error) { if (!error.message.includes("Execution context was destroyed") || attempt === 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.deepEqual(result, { parentPreserved: true, oldReadAborted: true, lateResponseHidden: true, pendingPreserved: true, posts: 0 });
  } finally { socket?.close(); chrome.kill(); await new Promise(resolve => server.close(resolve)); }
});
