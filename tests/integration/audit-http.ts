import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {randomBytes} from "node:crypto";
import pg from "pg";
import {Browser} from "./auth.test.mjs";
import {childEnvironment} from "../../scripts/ci/delegate-isolated-runtime.mjs";
import {launchChrome} from "../e2e/chrome-session.mjs";

export async function verifyAuditHttp(f:{actors:Record<string,string>;a:{id:string};ea:{id:string};eb:{id:string}},password:string) {
  const target=new URL(process.env.DATABASE_URL??"");
  assert.match(target.pathname,/^\/pdgld91_test_[a-f0-9]{16}$/);
  assert.ok(["127.0.0.1","localhost","[::1]"].includes(target.hostname));
  const role=process.env.AUDIT_TEST_ROLE??"";assert.match(role,/^pdgld91_reader_[a-f0-9]{16}$/);
  const runtimePassword=randomBytes(24).toString("hex");
  const admin=new pg.Client({connectionString:target.href});await admin.connect();
  try{await admin.query(`ALTER ROLE "${role}" LOGIN PASSWORD '${runtimePassword}'`);}finally{await admin.end();}
  target.username=role;target.password=runtimePassword;
  const base="http://127.0.0.1:3191";
  const app=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--webpack","--hostname","127.0.0.1","--port","3191"],{
    env:{...childEnvironment(process.env),NODE_ENV:"development",DATABASE_URL:target.href,NEXTAUTH_URL:base,NEXTAUTH_SECRET:randomBytes(48).toString("hex"),AUTH_TEST_RUN:"1",NEXT_TELEMETRY_DISABLED:"1"},
    windowsHide:true,detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"],
  });
  const stopped=once(app,"exit");let log="";
  const capture=(value:Buffer)=>{log=(log+value.toString()).slice(-4000);};app.stdout.on("data",capture);app.stderr.on("data",capture);
  try{
    let ready=false;
    for(let attempt=0;attempt<100 && app.exitCode===null;attempt++){
      try{ready=(await fetch(base+"/api/auth/csrf",{signal:AbortSignal.timeout(5000)})).ok;}catch{}
      if(ready)break;await new Promise(resolve=>setTimeout(resolve,300));
    }
    assert.ok(ready,"No se pudo abrir la autenticación del servidor de pruebas");
    const anon=new Browser(base),a=new Browser(base),denied=new Browser(base);
    for(const [session,name] of [[a,"a"],[denied,"denied"]] as const){
      const result=await session.login(`${name}@audit.example.test`,password);
      assert.ok(!result.searchParams.has("error"));assert.equal((await session.session()).user.id,f.actors[name]);
    }
    const path=`/api/audit?scope=${f.a.id}`;
    assert.equal((await anon.request(path)).status,401);
    assert.equal((await denied.request(path)).status,403);
    const response=await a.request(path);assert.equal(response.status,200);
    assert.match(response.headers.get("cache-control")??"",/private, no-store/);
    const body=await response.json();assert.ok(body.entries.length>0);
    assert.ok(!JSON.stringify(body).includes("NEVER_SHOW_"));
    const page=await a.request(`/audit?scope=${f.a.id}`);
    assert.equal(page.status,200);const pageHtml=await page.text();
    assert.ok(pageHtml.includes("Bitácora de operaciones") && !pageHtml.includes("NEVER_SHOW_"));
    const detailPage=await a.request(`/audit/${f.ea.id}?scope=${f.a.id}`);
    assert.equal(detailPage.status,200);const detailHtml=await detailPage.text();
    assert.ok(detailHtml.includes("Detalle de la operación") && !detailHtml.includes("NEVER_SHOW_"));
    if(process.env.AUDIT_BROWSER_TEST==="1"){
      const browser=await launchChrome(base+"/api/auth/csrf",{waitForDocument:true});
      try{
        await browser.command("Network.setCookies",{cookies:Array.from(a.cookies,([name,value])=>({name:String(name),value:String(value),domain:"127.0.0.1",path:"/",httpOnly:true,secure:false,sameSite:"Lax"}))});
        await browser.command("Page.navigate",{url:`${base}/audit?scope=${f.a.id}&entity=clubs&actor=audit-a`});
        async function waitFor(text:string){
          await browser.evaluate(`(async()=>{const until=Date.now()+30000;while(!document.querySelector('[aria-current="step"]')?.textContent.includes(${JSON.stringify(text)})){if(Date.now()>until)throw Error('El recorrido no abrió el paso esperado');await new Promise(resolve=>setTimeout(resolve,100));}return true})()`);
        }
        await waitFor("Consultar");
        await new Promise(resolve=>setTimeout(resolve,500));
        assert.ok(await browser.evaluate("Boolean(document.querySelector('section[aria-label=\"Operaciones registradas\"] a'))"));
        await browser.evaluate("document.querySelector('section[aria-label=\"Operaciones registradas\"] a').click();true");
        await waitFor("Detalle");
        assert.equal(await browser.evaluate("document.querySelectorAll('main button[type=submit]').length"),0);
        await browser.evaluate("document.querySelector('nav[aria-label=\"Recorrido de la bitácora\"] a').click();true");
        await waitFor("Consultar");
        assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('actor')"),"audit-a");
        assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('entity')"),"clubs");
      }finally{await browser.close();}
    }
    assert.equal((await a.request(`/api/audit/${f.eb.id}`)).status,403);
    assert.equal((await a.request(`/api/audit/${f.ea.id}`)).status,200);
    assert.equal((await a.request(path+"&after=invalid")).status,400);
    for(const method of ["POST","PUT","PATCH","DELETE"]){
      for(const path of ["/api/audit",`/api/audit/${f.ea.id}`])
        assert.equal((await a.request(path,{method,headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({reason:"Intento no permitido"})})).status,405);
    }
  }catch(error){console.error(log.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi,"[base temporal]"));throw error;}
  finally{
    if(app.exitCode===null){
      if(process.platform==="win32" && app.pid){const child=spawn("taskkill.exe",["/PID",String(app.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});await once(child,"exit");}
      else if(app.pid)process.kill(-app.pid,"SIGTERM");
      await stopped;
    }
  }
}
