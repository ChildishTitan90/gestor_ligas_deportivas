import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {Browser} from "../../tests/integration/auth.test.mjs";
import {getPrisma} from "../../src/server/db/prisma";
import {registerPlayerForActor} from "../../src/features/players/server/service";
import {readPlayerDossierForActor} from "../../src/features/players/server/document-queries";
import {readPlayerIneStatusForActor} from "../../src/features/players/server/ine-verification-service";
import {activateVerifiedAdultForActor} from "../../src/features/players/server/automatic-activation";
import {isManualPlayerDatabase} from "./player-fixture-target";

// No envía CURP/INE ni archivos a proveedores. El modo smoke no recibe sus claves.
assert.equal(process.env.PLAYER_DEMO_SMOKE,"1");
assert.equal(process.env.VMX_API_KEY,'');
assert.equal(process.env.SUPABASE_URL,"https://storage.example.test");
assert.ok(isManualPlayerDatabase(process.env));
assert.equal(isManualPlayerDatabase({...process.env,NODE_ENV:"production"}),false);
assert.equal(isManualPlayerDatabase({...process.env,PLAYER_MANUAL_SCENARIOS:undefined}),false);
assert.equal(isManualPlayerDatabase({...process.env,DATABASE_URL:"postgresql://localhost:5433/gestor_ligas_dev"}),false);
assert.equal(isManualPlayerDatabase({...process.env,DATABASE_URL:"postgresql://remote.example.test/pdgld48_test_0123456789abcdef"}),false);
const fixture=JSON.parse(await readFile(process.env.PLAYER_DEMO_SESSION_FILE!,"utf8"));
const browser=new Browser(process.env.PLAYER_DEMO_LOCAL_URL);
const db=getPrisma();
try{
  const csrf=await browser.csrf();
  const account=fixture.accounts[0];
  const response=await browser.request("/api/auth/callback/credentials",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrfToken:csrf,email:account.email,password:account.password,json:"true",callbackUrl:`${process.env.PLAYER_DEMO_LOCAL_URL}/players/registrations`})});
  assert.equal(response.status,200);
  const session=await (await browser.request("/api/auth/session")).json();
  assert.equal(session.user?.id,account.id,"Login del delegado sintético");
  const workspace=await browser.request("/players/registrations");
  assert.equal(workspace.status,200);
  assert.match(await workspace.text(),/Escolar y tutor/);
  const date="2006-01-15",prefix="SIAA060115HMNLRRA",alphabet="0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";
  const sum=[...prefix].reduce((s,c,i)=>s+alphabet.indexOf(c)*(18-i),0);
  const identity={curp:prefix+(10-sum%10)%10,birthDate:date,firstName:"Alvaro",paternalSurname:"Sierra",maternalSurname:"Lara"};
  for(const context of fixture.cases){
    const childDate="2011-01-15",childPrefix="SIAA110115HMNLRRA";
    const childSum=[...childPrefix].reduce((sum,c,i)=>sum+alphabet.indexOf(c)*(18-i),0);
    const minor=context.mode==="MINOR_FLOW";
    const registration=await registerPlayerForActor(account.id,{seasonTeamId:context.seasonTeamId,identity:minor?{...identity,birthDate:childDate,curp:childPrefix+(10-childSum%10)%10}:identity});
    const dossier=await readPlayerDossierForActor(account.id,registration.registrationId);
    assert.equal(dossier.minorAtRegistration,minor,"Edad real de la identidad sintética");
    assert.equal(dossier.minorDocumentFlow,context.mode==="MINOR_FLOW");
    assert.equal(dossier.school.required,context.mode==="MINOR_FLOW");
    const ine=await readPlayerIneStatusForActor(account.id,registration.registrationId);
    assert.equal(ine.applicable,context.mode==="VETERAN_FLOW");
    await activateVerifiedAdultForActor(account.id,registration.registrationId);
    assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:registration.registrationId}})).status,"INELIGIBLE");
    const page=await browser.request(`/players/registrations/${registration.registrationId}/documents`);
    assert.equal(page.status,200);
    assert.match(await page.text(),/PRUEBA AISLADA/);
    const unauthorized=new Browser(process.env.PLAYER_DEMO_LOCAL_URL);
    assert.notEqual((await unauthorized.request(`/api/player-registrations/${registration.registrationId}/documents`)).status,200);
  }
  const listed=await browser.request('/api/player-registrations');
  assert.equal(listed.status,200);
  const rows=await listed.json();assert.equal(rows.length,2);assert.ok(rows.every((r:{teamName?:string})=>r.teamName));
  assert.match(await (await browser.request('/players/registrations')).text(),/Abrir expediente/);
  if(process.env.PLAYER_DEMO_VISUAL==='1'){
    const {launchChrome}=await import('../../tests/e2e/chrome-session.mjs');
    const chrome=await launchChrome(`${process.env.PLAYER_DEMO_LOCAL_URL}/login`,{commandTimeoutMs:15000,waitForDocument:true});
    try{
      for(const [name,value] of browser.cookies)await chrome.command('Network.setCookie',{name,value,url:process.env.PLAYER_DEMO_LOCAL_URL});
      await chrome.command('Page.navigate',{url:`${process.env.PLAYER_DEMO_LOCAL_URL}/players/registrations`});
      await chrome.evaluate(`(async()=>{const end=Date.now()+10000;for(;;){const b=Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Registrar jugador');if(b && b.getBoundingClientRect().width>0 && Object.keys(b).some(k=>k.startsWith('__reactProps') && typeof b[k]?.onClick==='function'))return;if(Date.now()>end)throw Error('Vista real de jugadores no hidratada');await new Promise(r=>setTimeout(r,30));}})()`);
      for(const [width,height,theme] of [[1280,900,'dark'],[375,812,'light']] as const){
        await chrome.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
        await chrome.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        const layout=await chrome.evaluate(`(()=>{const search=document.querySelector('input[type=search]').getBoundingClientRect(),label=Array.from(document.querySelectorAll('label')).find(n=>n.textContent==='Filtrar por equipo'),filter=document.getElementById(label.htmlFor).getBoundingClientRect();return {visible:search.width>100 && filter.width>100 && search.height>=48 && filter.height>=48,overflow:document.documentElement.scrollWidth>innerWidth,aligned:Math.abs(search.top-filter.top)<2,sameHeight:Math.abs(search.height-filter.height)<2};})()`);
        assert.equal(layout.visible,true);assert.equal(layout.overflow,false);if(width>600){assert.equal(layout.aligned,true);assert.equal(layout.sameHeight,true);}
        for(const modal of [false,true]){
          if(modal){await chrome.evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Registrar jugador');b.focus();b.click();})()`);await chrome.evaluate(`(async()=>{const end=Date.now()+5000;while(!document.querySelector('dialog')?.open){if(Date.now()>end)throw Error('Modal no se abrió');await new Promise(r=>setTimeout(r,20));}})()`);}
          const shot=await chrome.command('Page.captureScreenshot',{format:'png'});
          const path=process.env.PLAYER_DEMO_SESSION_FILE!.replace('.json',`-${width}-${theme}-${modal?'modal':'lista'}.png`);
          await writeFile(path,Buffer.from(shot.data,'base64'));console.log(`Captura sintética: ${path}`);
          if(modal){await chrome.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await chrome.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await chrome.evaluate(`(async()=>{const end=Date.now()+3000;while(document.querySelector('dialog')?.open){if(Date.now()>end)throw Error('Modal no cerró por Escape');await new Promise(r=>setTimeout(r,20));}})()`);}
        }
      }
      console.log('Estilos reales: filtros alineados en escritorio y sin desbordamiento en móvil; modal abierto en ambos temas/tamaños.');
    }finally{await chrome.close();}
  }
  console.log("Smoke sintético: login, dos recorridos con edad real, páginas, bloqueo deportivo y acceso anónimo verificados; cero llamadas a proveedores.");
}finally{await db.$disconnect();}
