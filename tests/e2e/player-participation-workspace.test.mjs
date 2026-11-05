import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchChrome,closeTestServer} from './chrome-session.mjs';

test('Entrega 3: familias, política visual y autorización con acuse recuperable, sin red externa',{timeout:60000},async t=>{
 const css=process.env.PLAYER_PARTICIPATION_VISUAL_CSS?await readFile(process.env.PLAYER_PARTICIPATION_VISUAL_CSS,'utf8'):'';
 const shots=css?await mkdtemp(join(tmpdir(),'pdgld-participation-ui-')):null;
 const bundle=await build({write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
 import {PlayerPathwayWorkspace} from './src/features/competitions/components/player-pathway-workspace';
 import {DocumentPolicyFields} from './src/features/competitions/components/document-policy-fields';
 import {ConfigurationForm} from './src/features/competitions/components/configuration-form';
 import {PlayerParticipationWorkspace} from './src/features/players/components/player-participation-workspace';
 import {syntheticDocumentPolicy} from './tests/fixtures/player-document-policy';
 const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),actor=id(1),root=createRoot(document.getElementById('root'));
 const configuration={actorId:actor,season:{id:id(2),name:'Temporada sintética 2026',version:4,status:'PLANNED'},canEdit:true,canApprove:true,categories:[{id:id(3),name:'Fuerza base',type:'OPEN',policy:null},{id:id(4),name:'Fuerza superior',type:'OPEN',policy:null},{id:id(5),name:'Veteranos',type:'VETERANS',policy:null}],levels:[]};
 const ready={ready:true,fingerprint:'a'.repeat(64),blockers:[]},blocked={...ready,ready:false,blockers:[{code:'DOCUMENT_CURP',message:'Falta aprobar la constancia CURP.'}]};
 const receipt={id:id(7),originRegistrationId:id(6),targetSeasonTeamId:id(8),targetSeasonCategoryId:id(4),status:'PENDING_ELIGIBILITY',version:1,sportsEligible:false,replayed:false};
 const data={actorId:actor,registrationId:id(6),player:{id:id(6),name:'Lucía Sierra Lara',team:'Equipo Origen',category:'Fuerza base',club:'Club sintético',season:'Temporada sintética 2026'},source:{status:'ACTIVE',pathwayCode:'FUERZAS',level:1,canApprove:true,assessment:ready},canRequest:true,targets:[],participations:[{...receipt,targetId:id(8),targetTeam:'Equipo Superior',targetCategory:'Fuerza superior',targetCategoryId:id(4),canReview:true,assessment:ready}]};
 let levels=[],reviewCalls=0,mode='families';const calls=[];
 window.fetch=async(url,options={})=>{const method=options.method??'GET';calls.push({url,method,body:options.body,actor:options.headers?.['X-Expected-Actor-Id']});
  if(url==='/api/auth/session')return Response.json({user:{id:actor}});
  if(url.endsWith('/player-pathways')){if(method==='GET')return Response.json(levels);const body=JSON.parse(options.body);levels=body.categories.map(c=>({season_category_id:c.seasonCategoryId,pathway_code:body.pathwayCode,level:c.level}));throw Error('Synthetic lost receipt');}
  if(url.endsWith('/player-policy'))return Response.json({id:id(3)});
  if(url.includes('/player-participations/')){reviewCalls++;if(reviewCalls===1)throw Error('Synthetic uncertain review');return Response.json({...receipt,status:'AUTHORIZED',version:2,sportsEligible:true,replayed:true});}
  throw Error('Unexpected synthetic endpoint '+url);
 };
 window.fixture={calls,refreshes:0,data,configuration,render(next,options={}){mode=next;flushSync(()=>root.render(next==='families'?<PlayerPathwayWorkspace key={mode} data={configuration}/>:next==='policy'?<ConfigurationForm key={'policy'+!!options.legacy} title="Guardar política documental" endpoint={'/api/competitions/seasons/'+id(2)+'/categories/'+id(3)+'/player-policy'} version={4} actorId={actor}><DocumentPolicyFields type="OPEN" canApprove sportPolicy={{referenceYear:2026,minimumAge:18,maximumAge:null,exceptionMinimumAge:null,documents:options.legacy?['CURP']:syntheticDocumentPolicy(),registrationDays:[1,2,3],timezone:'America/Mexico_City',playersOnField:11,maximumCalledUp:22,maximumRoster:null}}/></ConfigurationForm>:<PlayerParticipationWorkspace key={mode+!!options.blocked} data={options.blocked?{...data,participations:[{...data.participations[0],assessment:blocked}]}:data}/>));}};
 window.fixture.render('families');
 `},plugins:[{name:'next-fixture',setup(p){p.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'fixture'}));p.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='next/link'?"import React from 'react';export default function Link({prefetch,...props}){return React.createElement('a',props)}":"export function useRouter(){return {refresh(){window.fixture.refreshes++},replace(){window.fixture.refreshes++}}}",resolveDir:process.cwd()}));}}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].contents:`<!doctype html><html lang="es" data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root" class="mx-auto w-full max-w-5xl p-5"></div><script src="/bundle.js"></script></html>`);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>closeTestServer(server));
 const browser=await launchChrome(`http://127.0.0.1:${server.address().port}`,{signal:t.signal,commandTimeoutMs:10000,waitForDocument:true});t.after(()=>browser.close());
 const ev=e=>browser.evaluate(e),wait=e=>ev(`(async()=>{const until=Date.now()+5000;while(!(${e})){if(Date.now()>until)throw Error('Entrega 3: '+${JSON.stringify(e)});await new Promise(r=>setTimeout(r,20));}})()`);
 const click=text=>ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Botón no disponible: '+${JSON.stringify(text)});b.focus();b.click();})()`);
 const input=(selector,value)=>ev(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(n instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 async function select(label,text){await ev(`(()=>{const l=[...document.querySelectorAll('label')].find(n=>n.textContent===${JSON.stringify(label)});const n=document.getElementById(l.htmlFor);n.focus();n.click();})()`);await wait('document.querySelector("[role=option]")');await ev(`[...document.querySelectorAll('[role=option]')].find(n=>n.textContent.includes(${JSON.stringify(text)})).click()`);}
 async function shot(name,width,theme){if(!shots)return;await browser.command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await ev('new Promise(r=>setTimeout(r,100))');assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true);const result=await browser.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});const path=join(shots,name+'.png');await writeFile(path,Buffer.from(result.data,'base64'));t.diagnostic(path);}
 await wait('window.fixture');await input('input[pattern]','FUERZAS');await select('Nivel 1','Fuerza base');await select('Nivel 2','Fuerza superior');await input('textarea','Configuración sintética autorizada por el responsable');
 await shot('familias-escritorio',1440,'dark');await shot('familias-movil',390,'light');
 await click('Confirmar orden para subir');await wait('document.body.textContent.includes("No se confirmó")');assert.equal(await ev('document.querySelector("input[pattern]").matches(":disabled")'),true);
 await click('Consultar definición sin reenviar');await wait('document.body.textContent.includes("Definición confirmada")');assert.equal(await ev('window.fixture.calls.filter(c=>c.url.endsWith("/player-pathways")&&c.method==="POST").length'),1);
 await ev('window.fixture.render("policy")');await wait('document.querySelector("input[name=documentPolicyJson]")');await input('textarea','Ajuste documental sintético que conserva edades y ventana');
 assert.equal(await ev('JSON.parse(document.querySelector("input[name=documentPolicyJson]").value).requirements.find(r=>r.key==="PHOTO_IDENTIFICATION").requiredForEligibility'),false);
 await shot('politica-escritorio',1440,'light');await shot('politica-movil',390,'dark');
 await click('Guardar política documental');await wait('document.body.textContent.includes("Cambio confirmado")');
 const policyCall=await ev('window.fixture.calls.find(c=>c.url.endsWith("/player-policy"))'),payload=JSON.parse(policyCall.body);
 assert.equal(payload.policy.minimumAge,18);assert.equal(payload.policy.referenceYear,2026);assert.deepEqual(payload.policy.registrationDays,[1,2,3]);assert.equal(payload.policy.maximumCalledUp,22);assert.equal(policyCall.actor,'00000000-0000-4000-8000-000000000001');
 await ev('window.fixture.render("policy",{legacy:true})');await wait('document.body.textContent.includes("propuesta en borrador")');assert.equal(await ev('JSON.parse(document.querySelector("input[name=documentPolicyJson]").value).status'),'DRAFT');
 assert.ok((await ev('JSON.parse(document.querySelector("input[name=documentPolicyJson]").value).pendingDecisions')).includes('ADULT_SIGNATURE_SCOPE'));
 await ev('window.fixture.render("participations",{blocked:true})');await wait('document.body.textContent.includes("Lucía Sierra Lara")');
 assert.equal(await ev('[...document.querySelectorAll("button")].find(b=>b.textContent==="Autorizar participación superior").disabled'),true);
 await ev('window.fixture.render("participations")');await wait('document.querySelector("form[aria-label^=Decidir]")');await shot('participacion-escritorio',1440,'dark');await shot('participacion-movil',390,'light');
 await input('form[aria-label="Decidir participación superior"] textarea','Se revisaron las condiciones sintéticas de origen y destino');await click('Autorizar participación superior');await wait('document.body.textContent.includes("No se confirmó esta decisión")');
 await click('Consultar estado actual');await click('Reintentar la misma operación');await wait('document.body.textContent.includes("Decisión confirmada")');
 const reviewCalls=await ev('window.fixture.calls.filter(c=>c.url.includes("/player-participations/"))');assert.equal(reviewCalls.length,2);assert.equal(reviewCalls[0].body,reviewCalls[1].body,'Misma clave, versión, huella y motivo');assert.ok((await ev('window.fixture.calls')).every(c=>!/^https?:/.test(c.url)),'Sin llamadas externas');
});
