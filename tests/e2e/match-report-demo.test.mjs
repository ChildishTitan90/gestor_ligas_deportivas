import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { launchChrome, closeTestServer } from "./chrome-session.mjs";

// React, shell, selectores, diálogos y captura de firma reales. Solo los adaptadores
// de Next (link/image/pathname), la cuenta y los datos son sintéticos.
// No inicia NextAuth, usa una base de datos ni permite solicitudes de negocio.
test("PDGLD-148: recorrido de cédula sintética en Chrome", { timeout: 180000 }, async t => {
  const compiler = await compile(await readFile("src/app/globals.css", "utf8"), { base: resolve("src/app"), onDependency() {} });
  const css = compiler.build(new Scanner({ sources: [{ base: resolve("src"), pattern: "**/*.{ts,tsx}", negated: false }] }).scan());
  const bundle = await build({ write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {ManagementShell} from './src/components/layout/management-shell';
      import {ReportWorkspace} from './src/features/match-reports/components/report-workspace';
      import {ReportDemoList} from './src/features/match-reports/components/report-demo-list';
      import {MatchReportList} from './src/features/match-reports/components/match-report-list';
      import {OfflinePreviewList} from './src/features/match-reports/components/offline-preview-list';
      import {createOfflineCapturePreview} from './src/features/match-reports/offline-preview';
      import {createReportDemo} from './src/features/match-reports/demo-data';
      let revision=0; const root=createRoot(document.getElementById('root'));
      window.networkCalls=[]; window.fetch=(...args)=>{window.networkCalls.push(String(args[0]));if(window.fixtureConfirmationStatus)return Promise.resolve(Response.json({code:'CONFIRMATION_DEPENDENCIES_PENDING'},{status:window.fixtureConfirmationStatus}));throw Error('Red prohibida en demo de componentes');};
      window.fixture={render(scenario='draft') {window.fixtureConfirmationStatus=0;const online=scenario.startsWith('online-');const offline=scenario.startsWith('offline-preview-')?scenario.slice(16):null;const download=scenario.startsWith('offline-download-')?scenario.slice(17):null;const data=offline?createOfflineCapturePreview(offline):createReportDemo(online?'confirmed':scenario);if(online){data.scenario='draft';data.report.status='DRAFT';data.report.confirmedAt=null;data.match.status={code:'IN_PROGRESS',label:'En curso',captureAllowed:true};data.confirmation={available:scenario==='online-rejected',message:'La confirmación final todavía no está disponible. Guarda el borrador para conservar esta captura y continuar después.'};}window.fixturePath=scenario.startsWith('real-')?'/matches':'/matches/report-demo/demo-018';flushSync(()=>root.render(<ManagementShell key={++revision}
        account={{username:'demo.sintetica',initials:'DS',roleNames:['Cuenta de ejemplo']}}
        navigation={[{label:scenario.startsWith('real-')?'Arbitraje':'Arbitraje · Demo',items:[{href:scenario.startsWith('real-')?'/matches':'/matches/report-demo',label:scenario.startsWith('real-')?'Cédula arbitral':'Demo · Cédula arbitral',icon:'players'}]}]}>
        {scenario==='real-empty'?<MatchReportList matches={[]}/>:scenario==='real-list'?<MatchReportList matches={[{id:'synthetic',number:'PARTIDO-7',status:'En curso',statusCode:'IN_PROGRESS',startsAt:'2026-12-05T16:00:00Z',season:'Apertura 2026',category:'Libre',group:'A',matchday:7,venue:'Cancha de prueba',home:'Deportivo Encinos',away:'Atlético Cantera'}]}/>:scenario==='list'?<ReportDemoList/>:download?<OfflinePreviewList scenario={download}/>:<ReportWorkspace data={data} live={online?{actorId:'synthetic-actor'}:undefined} offlinePreview={offline??undefined}/>}
      </ManagementShell>));}}; window.fixture.render();
    ` },
    plugins: [{ name: "next-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^next\/(link|image|navigation)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "next/navigation"
        ? "export const usePathname=()=>window.fixturePath??'/matches/report-demo/demo-018';"
        : args.path === "next/link" ? "import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}"
          : "import React from 'react';export default function Image({unoptimized,...props}){return <img {...props}/>}" , loader: "jsx", resolveDir: process.cwd() }));
    } }],
  });
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
    res.end(req.url === "/bundle.js" ? bundle.outputFiles[0].contents : `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done)); t.after(() => closeTestServer(server));
  const browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, { signal: t.signal, waitForDocument: true }); t.after(() => browser.close());
  const ev = expression => browser.evaluate(expression);
  const wait = expression => ev(`(async()=>{for(let n=0;n<250;n++){if(${expression})return;await new Promise(r=>setTimeout(r,20));}throw Error('No se cumplió: '+${JSON.stringify(expression)});})()`);
  const visibleText = () => ev("document.body.innerText");
  const click = text => ev(`(()=>{const b=[...document.querySelectorAll('button,a')].find(b=>b.getClientRects().length && (b.textContent.trim()===${JSON.stringify(text)} || b.getAttribute('aria-label')===${JSON.stringify(text)}));if(!b||b.disabled)throw Error('Control no disponible: '+${JSON.stringify(text)});b.focus();b.click();})()`);
  const key = async name => { for (const type of ["keyDown", "keyUp"]) await browser.command("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: name === "Enter" ? 13 : name === "Escape" ? 27 : name === "Tab" ? 9 : 40 }); };
  const render = async scenario => { await ev(`window.fixture.render(${JSON.stringify(scenario)})`); await ev("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))"); };
  const select = async (id, label) => {
    // Esperar al pintado y al foco inicial del diálogo antes de abrir su selector.
    await ev("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    await ev(`document.getElementById(${JSON.stringify(id)}).focus();document.getElementById(${JSON.stringify(id)}).click()`);
    await wait("document.querySelector('[role=listbox]')");
    await ev(`(()=>{const o=[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.includes(${JSON.stringify(label)}));if(!o)throw Error('Opción no encontrada');o.click();})()`);
  };
  const screenshot = async name => {
    if (!process.env.MATCH_REPORT_SCREENSHOTS) return;
    const directory = resolve(process.env.MATCH_REPORT_SCREENSHOTS); await mkdir(directory, { recursive: true });
    const shot = await browser.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(shot.data, "base64"));
  };
  await wait("Boolean(window.fixture && document.querySelector('[data-report-workspace]'))");
  assert.equal(await ev(`document.querySelector('nav[aria-label="Gestión de la liga"] a[aria-current="page"]')?.getAttribute('href')`), "/matches/report-demo");

  await t.test("partido, estados separados, alineación y dorsal independiente", async () => {
    await render("setup");
    assert.match(await visibleText(), /Partido: En curso/); assert.match(await visibleText(), /Cédula: Borrador/);
    await click("Capturar cédula");
    await ev("[...document.querySelectorAll('summary')].filter(n=>n.textContent==='Convocados y dorsales'&&n.getClientRects().length).forEach(n=>n.click())");
    assert.equal(await ev("document.getElementById('jersey-home-7').value"), "17");
    assert.match(await visibleText(), /Sanción vigente/);
    assert.equal(await ev("[...document.querySelectorAll('input[type=checkbox]')].filter(i=>i.getClientRects().length && i.disabled).length"), await ev("innerWidth>=1280?4:2"));
    await ev(`(()=>{const i=document.getElementById('jersey-home-7');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'27');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click("Resumen");
    await wait("document.querySelector('dialog[open]')");
    await ev("document.querySelector('dialog input[type=checkbox]').click()");await click("Confirmar y guardar alineaciones");
    await wait("!document.querySelector('dialog[open]')");
    await click("Resumen"); assert.match(await visibleText(), /#27/);
    assert.match(await visibleText(), /falta capturar y confirmar la firma/);
    assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Confirmar · Simulación').disabled"), true);
  });

  await t.test("diálogo breve: selectores en su capa, descarte, foco y minuto opcional", async () => {
    await click("Eventos"); await click("Registrar evento");
    await wait("document.querySelector('dialog[open]')");
    assert.equal(await ev("document.activeElement.textContent.trim()"), "Cancelar");
    await select("event-type", "Incidente grave");
    await ev("document.getElementById('event-team').focus();document.getElementById('event-team').click()");
    assert.equal(await ev("Boolean(document.querySelector('dialog[open] [role=listbox]'))"), true);
    await key("Escape");
    await ev(`(()=>{const i=document.querySelector('#report-event-form textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(i,'Incidente sintético de revisión');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click("Cancelar"); await wait("document.querySelector('dialog[open]').innerText.includes('Descartar los cambios')");
    await click("Seguir editando");
    assert.equal(await ev("document.querySelector('#report-event-form textarea').value"), "Incidente sintético de revisión");
    await click("Aplicar evento");
    await wait("!document.getElementById('report-event-form')");
    assert.match(await visibleText(), /Incidente sintético de revisión/); assert.match(await visibleText(), /Sin minuto/);
    assert.match(await visibleText(), /Sin sanción automática/);
    assert.equal(await ev("document.activeElement.textContent.trim()"), "Registrar evento");
  });

  await t.test("participación sin duraciones inventadas y selector enfocado ante error", async () => {
    await click("Participación"); await click("Registrar tiempo");
    await ev(`(()=>{const i=document.getElementById('period-number');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'2');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click("Aplicar tiempo");
    assert.equal(await ev("document.activeElement.id"), "period-player");
    await select("period-player", "Leo Paz");
    await click("Aplicar tiempo");
    await wait("!document.getElementById('report-period-form')");
    assert.match(await visibleText(), /Periodo 2/); assert.match(await visibleText(), /Entra pendiente · Sale pendiente/);
    assert.doesNotMatch(await visibleText(), /45 minutos|90 minutos/);
  });

  await t.test("guardado simulado y prevención de doble envío", async () => {
    const version = await ev("[...document.querySelectorAll('p')].find(p=>p.textContent.startsWith('Partido v')).textContent");
    await click("Guardar · Simulación");
    assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Guardar · Simulación').disabled"), true);
    await wait("document.body.innerText.includes('Guardado simulado recibido')");
    const before=Number(version.match(/Cédula v(\d+)/)[1]); assert.match(await visibleText(), new RegExp(`Cédula v${before+1}`));
    assert.match(await visibleText(), /se pierde al salir o recargar/);
  });

  await t.test("firmas en dispositivo, confirmación explícita y consulta bloqueada", async () => {
    await click("Cierre y firmas");
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    for (let pass = 0; pass < 2; pass++) {
    for (let index = 0; index < 2; index++) {
      await ev(`document.querySelectorAll('canvas')[${index}].scrollIntoView({block:'center'})`);
      const rect = await ev(`(()=>{const r=document.querySelectorAll('canvas')[${index}].getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
      const point = n => ({ x: rect.x + rect.w * (.15 + n * .06), y: rect.y + rect.h * (.45 + (n % 2) * .15) });
      await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point(0), button: "left", buttons: 1, clickCount: 1 });
      for (let n = 1; n < 10; n++) await browser.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point(n), button: "left", buttons: 1 });
      await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point(9), button: "left", buttons: 0, clickCount: 1 });
      await ev("new Promise(r=>setTimeout(r,60))");
      await ev(`document.querySelectorAll('canvas')[${index}].closest('fieldset').querySelectorAll('button')[1].click()`);
      await wait(`Boolean(document.querySelectorAll('canvas')[${index}].closest('fieldset').querySelector('img'))`);
      await ev(`[...document.querySelectorAll('canvas')[${index}].closest('fieldset').querySelectorAll('button')].find(b=>b.textContent.trim()==='Confirmar captura').click()`);
    }
    await wait("[...document.querySelectorAll('[role=status]')].filter(n=>n.textContent.includes('Firma lista en memoria')).length===2");
    if (pass === 0) {
      await ev(`(()=>{const i=[...document.querySelectorAll('textarea')].find(i=>i.getClientRects().length);Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(i,'Captura modificada después de firmar · Ejemplo');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await wait("document.body.innerText.includes('Se retiraron ambas firmas')");
      assert.equal(await ev("[...document.querySelectorAll('[role=status]')].filter(n=>n.textContent.includes('Firma lista en memoria')).length"), 0);
    }
    }
    await click("Resumen");
    await click("Confirmar · Simulación");
    await wait("document.querySelector('dialog[open]')");
    assert.equal(await ev("[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.includes('Sí, confirmar')).disabled"), true);
    await ev("document.querySelector('dialog[open] input[type=checkbox]').click()");
    await click("Sí, confirmar cédula de ejemplo");
    await wait("document.body.innerText.includes('Cédula: Confirmada')");
    assert.match(await visibleText(), /Partido: Finalizado/); assert.match(await visibleText(), /Solo consulta/);
    assert.equal(await ev("[...document.querySelectorAll('input,textarea')].filter(n=>n.getClientRects().length&&!n.disabled).length"), 0);
    await click("Alineaciones");
    assert.equal(await ev("document.getElementById('jersey-home-7').disabled"), true);
  });

  await t.test("incierto conserva operación, consulta sin reenviar y conflicto bloquea", async () => {
    await render("uncertain");
    assert.match(await visibleText(), /demo-operation-018/);
    await click("Simular consulta: no aplicada");
    assert.match(await visibleText(), /no se aplicó/);
    await click("Reintentar misma operación simulada");
    await wait("document.body.innerText.includes('Guardado simulado recibido')");
    await render("stale");
    assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Guardar · Simulación').disabled"), true);
    await click("Comparar versiones simuladas");
    assert.match(await visibleText(), /Tu captura · v2/); assert.match(await visibleText(), /Referencia simulada · v3/);
    await key("Escape"); await wait("!document.querySelector('dialog[open]')");
    assert.match(await visibleText(), /Versión obsoleta/);
  });

  await t.test("pérdida de permiso después de iniciar captura bloquea las escrituras", async () => {
    await render("draft"); await click("Capturar cédula");
    await ev("[...document.querySelectorAll('summary')].find(n=>n.textContent==='Controles de demostración').click()");
    await select("demo-response", "Pérdida de permiso");
    await click("Guardar · Simulación");
    await wait("document.body.innerText.includes('Permiso perdido')");
    assert.equal(await ev("document.getElementById('jersey-home-7').disabled"), true);
    assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Guardar · Simulación').disabled"), true);
  });

  await t.test("casos de carga, vacío, denegación, error y estado del partido", async () => {
    await render("loading"); assert.match(await visibleText(), /Cargando partido/); await click("Completar carga simulada");
    await render("error"); assert.match(await visibleText(), /No se pudo consultar/); await click("Reintentar consulta simulada");
    await render("denied"); assert.match(await visibleText(), /Acceso denegado/); assert.doesNotMatch(await visibleText(), /Capturar cédula arbitral/);
    await render("scheduled"); assert.match(await visibleText(), /Partido: Programado/); assert.match(await visibleText(), /captura está bloqueada/);
    await render("empty"); await click("Capturar cédula");assert.match(await visibleText(),/0\/11 titulares asignados/);await click("Eventos");assert.match(await visibleText(),/Guarda[r]? once inicial/);assert.equal(await ev("[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim()==='Confirmar y guardar alineaciones').disabled"),true);await click('Cancelar');
  });

  await t.test("campo táctil, formación personalizada, uniforme, lesión y cambio desde un jugador", async () => {
    await browser.command("Emulation.setDeviceMetricsOverride",{width:390,height:1000,deviceScaleFactor:1,mobile:true});
    await ev("document.documentElement.dataset.theme='dark'");
    await render("setup");await click("Capturar cédula");
    assert.equal(await ev("document.querySelectorAll('[data-pitch]').length"),2);
    await click("VisitanteCantera");
    assert.equal(await ev("document.querySelector('[data-pitch=away]').getClientRects().length>0"),true);
    await click("LocalEncinos");
    await click("Once inicial");
    await select("formation-home","4-2-3-1");
    await ev("document.querySelector('[data-pitch=home] button').click()");
    await select("pitch-player","Mateo Reyes");
    await click("Aplicar posición");await wait("!document.querySelector('dialog[open]')");
    assert.match(await ev("document.querySelector('[data-pitch=home]').innerText"),/Mateo Reyes/);
    await select("formation-home","Personalizada");
    await ev("document.querySelector('[data-pitch=home] button').click()");
    await ev("(()=>{const i=document.querySelector('dialog input[type=range]');i.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'60');i.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await click("Aplicar posición");await wait("!document.querySelector('dialog[open]')");
    assert.equal(await ev("document.querySelector('[data-pitch=home] button').style.left"),"60%");
    await click("Elegir uniforme de Encinos");
    await ev("(()=>{const i=document.getElementById('match-kit-home-primary');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'#e3a17d');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await click("Aplicar uniforme");await wait("!document.querySelector('dialog[open]')");
    assert.equal(await ev("document.querySelectorAll('[data-pitch=home] button')[1].querySelector('svg path').getAttribute('fill')"),"#e3a17d");
    await click("Continuar");await wait("document.querySelector('dialog[open]')");await ev("document.querySelector('dialog input[type=checkbox]').click()");await click("Confirmar y guardar alineaciones");await wait("!document.querySelector('dialog[open]')");
    await click("En cancha");
    await ev("[...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Iván Robles')).click()");
    await wait("document.querySelector('dialog[open]')");
    assert.equal(await ev("[...document.querySelectorAll('dialog button')].filter(b=>['Gol','Amarilla','Roja','Cambio','Lesión','Incidente'].includes(b.textContent.trim())).length"),6);
    await screenshot("dark-390-acciones-jugador");
    await click("Lesión");await wait("document.getElementById('report-event-form')");
    assert.equal(await ev("new FormData(document.getElementById('report-event-form')).get('player')"),"home-9");
    await click("Aplicar evento");await wait("!document.getElementById('report-event-form')");
    assert.equal(await ev("[...document.querySelectorAll('[data-pitch=home] button')].some(b=>b.getAttribute('aria-label').startsWith('Iván Robles'))"),true);
    for(const theme of ['light','dark']){
      await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      assert.equal(await ev("getComputedStyle([...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Iván Robles')).querySelector('.lucide-square-plus')).stroke"),'rgb(255, 255, 255)');
    }
    await ev("[...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Iván Robles')).click()");
    await click("Cambio");await wait("document.getElementById('report-event-form')");
    assert.equal(await ev("new FormData(document.getElementById('report-event-form')).get('outgoing')"),"home-9");
    await select("event-player","Adrián Solís");
    await click("Aplicar cambio");await wait("!document.getElementById('report-event-form')");
    assert.equal(await ev("[...document.querySelectorAll('[data-pitch=home] button')].some(b=>b.getAttribute('aria-label').startsWith('Adrián Solís'))"),true);
    assert.equal(await ev("[...document.querySelectorAll('[data-pitch=home] button')].some(b=>b.getAttribute('aria-label').startsWith('Iván Robles'))"),false);
    assert.doesNotMatch(await visibleText(),/Hay cambios que no se pueden representar/);
    await ev("document.querySelector('[data-pitch=home]').scrollIntoView({block:'center'})");await screenshot("dark-390-campo-interactivo");
    assert.equal(await ev("Boolean([...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Adrián Solís'))?.querySelector('[title=\"Entró de cambio\"]'))"),true);
    await click("Once inicial");
    assert.match(await ev("document.querySelector('[data-pitch=home]').innerText"),/Iván Robles/);
    for(const theme of ['light','dark']){
      await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      assert.equal(await ev("Boolean([...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').includes('Iván Robles')).querySelector('[title=\"Salió de cambio\"] .lucide-arrow-down'))"),true);
      assert.equal(await ev("(()=>{const icon=document.querySelector('[data-pitch=home] [title=\"Salió de cambio\"] .lucide-arrow-down'),probe=document.createElement('span');probe.style.color='var(--card-red)';document.body.append(probe);const same=getComputedStyle(icon).stroke===getComputedStyle(probe).color;probe.remove();return same;})()"),true);
      await screenshot(`${theme}-390-salida-cambio`);
    }
    assert.equal(await ev("document.documentElement.scrollWidth<=innerWidth"),true);
  });

  await t.test("dorsal duplicado visible, arrastre desde banca y movimiento táctil directo", async () => {
    await browser.command("Emulation.setDeviceMetricsOverride",{width:654,height:900,deviceScaleFactor:1,mobile:true});
    await render("setup");await click("Capturar cédula");
    assert.equal(await ev("[...document.querySelectorAll('button')].filter(b=>b.textContent==='En cancha').length"),0);
    await ev("[...document.querySelectorAll('summary')].find(s=>s.textContent==='Convocados y dorsales').click()");
    await ev("(()=>{const i=document.getElementById('jersey-home-7');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'8');i.dispatchEvent(new Event('input',{bubbles:true}));})()");
    assert.equal(await ev("document.getElementById('jersey-home-7').getAttribute('aria-invalid')"),"true");
    assert.match(await visibleText(),/dorsal 8 también lo usa/);
    await ev("(()=>{const i=document.getElementById('jersey-home-7');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'17');i.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await ev("document.querySelector('[aria-label=\"Arrastrar Mateo Reyes al campo\"]').scrollIntoView({block:'center'})");
    await ev("window.scrollBy(0,-140)");
    const positions=await ev("(()=>{const a=document.querySelector('[aria-label=\"Arrastrar Mateo Reyes al campo\"]').getBoundingClientRect();const b=document.querySelectorAll('[data-pitch=home] button')[0].getBoundingClientRect();return {ax:a.x+a.width/2,ay:a.y+a.height/2,bx:b.x+b.width/2,by:b.y+b.height/2};})()");
    assert.ok(positions.ay>110&&positions.by>110&&positions.ay<900&&positions.by<900,JSON.stringify(positions));
    await browser.command("Input.dispatchMouseEvent",{type:"mousePressed",x:positions.ax,y:positions.ay,button:"left",clickCount:1});
    for(let n=1;n<=8;n++)await browser.command("Input.dispatchMouseEvent",{type:"mouseMoved",x:positions.ax+(positions.bx-positions.ax)*n/8,y:positions.ay+(positions.by-positions.ay)*n/8,button:"left",buttons:1});
    await browser.command("Input.dispatchMouseEvent",{type:"mouseReleased",x:positions.bx,y:positions.by,button:"left",clickCount:1});
    await wait("document.querySelectorAll('[data-pitch=home] button')[0].innerText.includes('Mateo')");
    assert.equal(await ev("Boolean(document.querySelector('[aria-label=\"Arrastrar Adrián Solís al campo\"]'))"),true);
    await ev("document.querySelectorAll('[data-pitch=home] button')[0].scrollIntoView({block:'center'})");
    const touch=await ev("(()=>{const b=document.querySelectorAll('[data-pitch=home] button')[0].getBoundingClientRect(),r=document.querySelector('[data-pitch=home]').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,tx:r.x+r.width*.6,ty:r.y+r.height*.85};})()");
    await browser.command("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:touch.x,y:touch.y,id:1}]});
    for(let n=1;n<=8;n++)await browser.command("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:touch.x+(touch.tx-touch.x)*n/8,y:touch.y+(touch.ty-touch.y)*n/8,id:1}]});
    await browser.command("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await wait("document.querySelectorAll('[data-pitch=home] button')[0].style.left==='60%' && document.querySelectorAll('[data-pitch=home] button')[0].style.top==='85%'");
    assert.equal(await ev("document.getElementById('custom-formation-home').value"),"4-4-2");
  });

  await t.test("convocar trece llena el once y conserva dos en banca",async()=>{
    await render('empty');await click('Capturar cédula');
    await ev("document.querySelector('section[aria-label=\"Alineaciones\"] article details:last-child').open=true");
    for(let i=0;i<13;i++)await ev(`document.querySelector('section[aria-label="Alineaciones"] article').querySelectorAll('input[type=checkbox]')[${i}].click()`);
    assert.match(await visibleText(),/11\/11 titulares asignados/);
    assert.match(await visibleText(),/Banca · 2/);
    assert.equal(await ev("[...document.querySelectorAll('[data-pitch=home] button')].filter(b=>!b.innerText.includes('+')).length"),11);
    assert.equal(await ev("document.getElementById('jersey-home-13').value"),'13');
  });

  await t.test("asistencia y gol en contra usan iconos y actualizan el marcador correcto",async()=>{
    await render('draft');await click('Capturar cédula');
    await ev("[...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Iván Robles')).click()");await click('Asistencia');await click('Aplicar evento');await wait("!document.querySelector('dialog[open]')");
    assert.equal(await ev("document.querySelectorAll('[data-pitch=home] [data-player-assist] .lucide-sport-shoe').length"),1);
    assert.equal(await ev("document.querySelectorAll('[data-pitch=home] [data-player-goal] .tabler-icon-ball-football').length"),1);
    await ev("[...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Iván Robles')).click()");await click('Gol en contra');await click('Aplicar evento');await wait("!document.querySelector('dialog[open]')");
    await ev("[...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Iván Robles')).click()");
    assert.equal(await ev("document.querySelectorAll('dialog[open] .lucide-sport-shoe').length"),2);
    assert.equal(await ev("document.querySelectorAll('dialog[open] .tabler-icon-ball-football').length"),4);
    await screenshot('acciones-iconos-actualizados');await click('Cancelar');
    await click('Resumen');assert.match(await visibleText(),/1\s*:\s*1/);assert.match(await visibleText(),/Asistencia/);assert.match(await visibleText(),/Gol en contra/);
  });

  await t.test("arrastrar entre posiciones intercambia titulares con ratón y pantalla táctil", async () => {
    await browser.command("Emulation.setDeviceMetricsOverride",{width:654,height:900,deviceScaleFactor:1,mobile:true});
    await render("setup");await click("Capturar cédula");
    const snapshot=()=>ev("[...document.querySelectorAll('[data-pitch=home] button')].map(b=>({label:b.getAttribute('aria-label'),left:b.style.left,top:b.style.top}))");
    const before=await snapshot();
    async function dragSlot(from,to,touch=false){
      await ev(`document.querySelectorAll('[data-pitch=home] button')[${from}].scrollIntoView({block:'center'})`);
      const p=await ev(`(()=>{const a=document.querySelectorAll('[data-pitch=home] button')[${from}].getBoundingClientRect(),b=document.querySelectorAll('[data-pitch=home] button')[${to}].getBoundingClientRect();return {x:a.x+a.width/2,y:a.y+a.height/2,tx:b.x+b.width/2,ty:b.y+b.height/2};})()`);
      if(touch){
        await browser.command("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:p.x,y:p.y,id:1}]});
        for(let n=1;n<=8;n++)await browser.command("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:p.x+(p.tx-p.x)*n/8,y:p.y+(p.ty-p.y)*n/8,id:1}]});
        await browser.command("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
      }else{
        await browser.command("Input.dispatchMouseEvent",{type:"mousePressed",x:p.x,y:p.y,button:"left",clickCount:1});
        for(let n=1;n<=8;n++)await browser.command("Input.dispatchMouseEvent",{type:"mouseMoved",x:p.x+(p.tx-p.x)*n/8,y:p.y+(p.ty-p.y)*n/8,button:"left",buttons:1});
        await browser.command("Input.dispatchMouseEvent",{type:"mouseReleased",x:p.tx,y:p.ty,button:"left",clickCount:1});
      }
    }
    await dragSlot(1,2);
    const swapped=await snapshot();
    assert.match(swapped[1].label,/Camilo Ríos/);assert.match(swapped[2].label,/Bruno Valle/);
    assert.deepEqual(swapped.map(({left,top})=>({left,top})),before.map(({left,top})=>({left,top})));
    assert.equal(await ev("document.getElementById('formation-home').value"),"4-4-2");
    assert.equal(await ev("Boolean(document.querySelector('dialog[open]'))"),false);
    await dragSlot(2,1,true);assert.deepEqual(await snapshot(),before);
    await ev("document.querySelectorAll('[data-pitch=home] button')[2].click()");await select("pitch-player","Posición sin asignar");await click("Aplicar posición");
    await dragSlot(1,2);
    const moved=await snapshot();assert.doesNotMatch(moved[1].label,/Bruno Valle/);assert.match(moved[2].label,/Bruno Valle/);
    assert.deepEqual(moved.map(({left,top})=>({left,top})),before.map(({left,top})=>({left,top})));
  });

  await t.test("reloj: aviso al minuto 45, compensación, descanso ajustable y segundo tiempo", async () => {
    await render("clock-due");await click("Capturar cédula");await click("Captura en vivo");
    await wait("document.querySelector('[aria-label=\"Aviso de tiempo\"]')");
    await click("Registrar compensación");await wait("document.getElementById('report-clock-action')");
    await ev("(()=>{const i=document.querySelector('#report-clock-action input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'3');i.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await click("Confirmar compensación");await wait("document.body.innerText.includes('Compensación 3 min')");
    await click("Terminar tiempo");await click("Confirmar fin del tiempo");await wait("document.body.innerText.includes('Ajustar descanso')");
    await click("Ajustar descanso");await ev("(()=>{const i=document.querySelector('#report-clock-action input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'20');i.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await click("Confirmar descanso");await wait("document.body.innerText.includes('Descanso 20 min')");
    await ev("[...document.querySelectorAll('[data-pitch=away] button')].find(b=>b.getAttribute('aria-label').startsWith('Yahir Peña')).click()");
    assert.deepEqual(await ev("[...document.querySelectorAll('dialog[open] button')].filter(b=>['Gol','Amarilla','Roja','Cambio','Lesión','Incidente'].includes(b.textContent.trim())).map(b=>[b.textContent.trim(),b.disabled])"),[["Gol",true],["Amarilla",true],["Roja",true],["Cambio",false],["Lesión",true],["Incidente",true]]);
    await click("Cambio");
    assert.deepEqual(await ev("[...document.querySelectorAll('#report-event-form input[type=number]')].map(i=>[i.value,i.disabled])"),[["2",true],["45",true],["0",true]]);
    await select("event-player","Benjamín Olmo");await click("Aplicar cambio");await wait("!document.querySelector('dialog[open]')");
    await click("Eventos");assert.match(await visibleText(),/45:00/);await click("Alineaciones");
    await click("Iniciar segundo tiempo");await click("Confirmar segundo tiempo");await wait("document.body.innerText.includes('Segundo tiempo') && !document.querySelector('dialog[open]')");
    assert.match(await ev("document.querySelector('[role=timer]').textContent"),/^45:0/);
    await ev("[...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Iván Robles')).click()");await click("Gol");
    assert.equal(await ev("document.querySelectorAll('#report-event-form input[type=number]')[0].value"),"2");
    assert.equal(await ev("document.querySelectorAll('#report-event-form input[type=number]')[1].value"),"45");
    await click("Aplicar evento");await wait("!document.querySelector('dialog[open]')");
    await ev("[...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Iván Robles')).click()");await click("Cambio");
    await ev("document.getElementById('event-player').click()");await wait("document.querySelector('[role=listbox]')");
    assert.deepEqual(await ev("[...document.querySelectorAll('[role=option]')].map(o=>o.textContent)"),["Sin jugador indicado","Mateo ReyesDorsal 13"]);
    await ev("[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.includes('Mateo Reyes')).click()");await click("Aplicar cambio");await wait("!document.querySelector('dialog[open]')");
    await ev("[...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Hugo Montes')).click()");await click("Cambio");
    await ev("document.getElementById('event-player').click()");await wait("document.querySelector('[role=listbox]')");
    assert.equal(await ev("document.querySelectorAll('[role=option]').length"),1);
    await key("Escape");if(await ev("Boolean(document.querySelector('dialog[open]'))"))await click("Cancelar");
  });

  await t.test("relevo de capitán y segunda amarilla dejan antecedentes y vacante", async () => {
    await render("draft");await click("Capturar cédula");
    await ev("[...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Iván Robles')).click()");await click("Gol");
    await ev("(()=>{for(const [i,v] of [[document.querySelectorAll('#report-event-form input[type=number]')[1],'22'],[document.querySelector('#report-event-form input[name=second]'),'34']]){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}));}})()");
    await click("Aplicar evento");await wait("!document.getElementById('report-event-form')");
    assert.deepEqual(await ev("[...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Iván Robles')).querySelectorAll('[data-player-goal]').length"),2);
    assert.deepEqual(await ev("[...[...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Iván Robles')).querySelectorAll('[data-player-goal]')].map(n=>n.parentElement.style.bottom)"),["0px","8px"]);
    await click("Eventos");assert.match(await visibleText(),/22:34/);await click("Alineaciones");

    await ev("[...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Darío Luna')).click()");await click("Cambio");
    await select("event-player","Mateo Reyes");await click("Aplicar cambio");
    assert.match(await visibleText(),/selecciona al nuevo capitán/);
    await select("event-replacement-captain","Bruno Valle");await click("Aplicar cambio");await wait("!document.getElementById('report-event-form')");
    assert.equal(await ev("Boolean([...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Bruno Valle')).querySelector('[aria-label=Capitán]'))"),true);
    assert.equal(await ev("document.querySelector('#captain-home input[type=hidden]')?.value ?? document.querySelector('input[name=\"captain-home\"]').value"),"home-4");
    for(let n=0;n<2;n++) {await ev("[...document.querySelectorAll('[data-pitch=home] button')].find(b=>b.getAttribute('aria-label').startsWith('Hugo Montes')).click()");await click("Amarilla");await click("Aplicar evento");await wait("!document.getElementById('report-event-form')");}
    assert.equal(await ev("[...document.querySelectorAll('[data-pitch=home] button')].some(b=>b.getAttribute('aria-label').startsWith('Hugo Montes'))"),false);
    await ev("[...document.querySelectorAll('summary')].find(s=>s.textContent==='Jugadores que salieron o fueron expulsados').click()");
    assert.match(await visibleText(),/Hugo Montes · Roja por segunda amarilla/);
    assert.deepEqual(await ev("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Hugo Montes · Roja'));return [b.querySelectorAll('[data-player-yellow]').length,b.querySelectorAll('[data-player-red]').length,...[...b.querySelectorAll('[data-player-yellow],[data-player-red]')].map(n=>n.parentElement.style.bottom)];})()"),[1,1,"0px","8px"]);
    await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Hugo Montes · Roja')).click()");
    assert.equal(await ev("[...document.querySelectorAll('dialog[open] li')].filter(li=>li.textContent.startsWith('Amonestación')).length"),2);
    assert.equal(await ev("document.querySelectorAll('dialog[open] [data-player-yellow]').length"),1);
    assert.equal(await ev("document.querySelectorAll('dialog[open] [data-player-red]').length"),1);
    await screenshot('segunda-amarilla-iconos');await click('Cancelar');
  });

  await t.test("claro/oscuro, 360/390/1440, teclado y revisión visual", async () => {
    for (const theme of ["light", "dark"]) for (const width of [360, 390, 1440]) {
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await render("draft"); await ev("window.scrollTo(0,0)"); await screenshot(`${theme}-${width}-partido`);
      assert.equal(await ev("document.documentElement.scrollWidth<=innerWidth"), true, `${theme}/${width}: partido sin desbordamiento`);
      await click("Capturar cédula"); await ev("window.scrollTo(0,0)"); await screenshot(`${theme}-${width}-alineaciones`);
      assert.equal(await ev("document.documentElement.scrollWidth<=innerWidth"), true, `${theme}/${width}: alineaciones sin desbordamiento`);
      await ev("document.getElementById('captain-home').scrollIntoView({block:'center'})"); await screenshot(`${theme}-${width}-jugadores`);
      await click("Cierre y firmas"); await ev("document.querySelector('canvas').scrollIntoView({block:'center'})"); await screenshot(`${theme}-${width}-firmas`);
      await click("Eventos"); await click("Registrar evento");
      await ev("document.getElementById('event-type').focus()"); await key("ArrowDown");
      assert.equal(await ev("Boolean(document.querySelector('dialog[open] [role=listbox]'))"), true);
      await screenshot(`${theme}-${width}-dialogo-selector`);
      await key("Escape"); await key("Escape");
      await wait("!document.querySelector('dialog[open]')");
      assert.equal(await ev("document.activeElement.textContent.trim()"), "Registrar evento");
      await render("confirmed"); await ev("window.scrollTo(0,0)"); await screenshot(`${theme}-${width}-confirmada`);
      assert.equal(await ev("document.documentElement.scrollWidth<=innerWidth"), true);
    }
    assert.deepEqual(await ev("window.networkCalls"), []);
    assert.equal(await ev("navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r=>r.length) : 0"), 0);
  });
  await t.test("listado real conserva tarjetas y estado vacío, sin controles de demo", async () => {
    for(const theme of ["light","dark"]) for(const width of [390,1440]) {
      await browser.command("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<600});
      await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await render("real-list");await ev("window.scrollTo(0,0)");
      assert.match(await visibleText(),/PARTIDO-7/);assert.match(await visibleText(),/Abrir cédula/);
      assert.doesNotMatch(await ev("document.querySelector('main').innerText"),/Demostración|Datos sintéticos|Simulación/);
      assert.equal(await ev("document.documentElement.scrollWidth<=innerWidth"),true);
      await screenshot(`${theme}-${width}-listado-real`);
      await render("real-empty");assert.match(await visibleText(),/Aún no tienes partidos disponibles/);
      await screenshot(`${theme}-${width}-sin-partidos`);
    }
  });

  await t.test("confirmación no disponible: evita POST y se recupera del rechazo conocido", async () => {
    await render("online-blocked");await click("Capturar cédula");await click("Resumen");
    assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Solicitar confirmación').disabled"),true);
    assert.match(await ev("document.getElementById('report-confirmation-availability').textContent"),/Guarda el borrador/);
    assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Guardar borrador').disabled"),false);
    assert.deepEqual(await ev("window.networkCalls"),[]);
    for(const status of [409,503]) {
      await render("online-rejected");await ev(`window.networkCalls=[];window.fixtureConfirmationStatus=${status}`);
      await click("Capturar cédula");await click("Resumen");await click("Solicitar confirmación");
      await ev("document.querySelector('dialog[open] input[type=checkbox]').click()");await click("Confirmar cédula");
      await wait("!document.querySelector('dialog[open]') && document.getElementById('report-confirmation-availability')");
      assert.equal(await ev("window.networkCalls.length"),1);
      assert.doesNotMatch(await visibleText(),/Esperando acuse|Resultado incierto|No conocemos el resultado|Reintentar misma operación/);
      assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Solicitar confirmación').disabled"),true);
      assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Guardar borrador').disabled"),false);
    }
    await ev("window.networkCalls=[];window.fixtureConfirmationStatus=0");
  });

  await t.test("vista previa PDGLD-19/20: preparación, borrador sin red y recuperación", async () => {
    const panel = 'document.querySelector("[aria-label=\\"Estado offline simulado\\"]")';
    const status = text => wait(`${panel}.innerText.includes(${JSON.stringify(text)})`);
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await ev("document.documentElement.dataset.theme='dark';window.networkCalls=[]");
    for (const [scenario, message] of [["incomplete", "Descarga incompleta"], ["space", "Espacio insuficiente"]]) {
      await render(`offline-download-${scenario}`);
      await click("Preparar para usar sin conexión");
      assert.match(await visibleText(), /Descargando partido/);
      await wait(`document.body.innerText.includes(${JSON.stringify(message + " · Simulación")})`);
      assert.doesNotMatch(await visibleText(), /Disponible sin conexión · Simulación/);
      await click("Reintentar descarga");
      await wait("document.activeElement.textContent.trim()==='Abrir cédula'");
      assert.match(await visibleText(), /Disponible sin conexión · Simulación/);
    }

    await render("offline-preview-offline");
    await status("Sin conexión");
    assert.equal(await ev(`(() => {
      const nav = document.querySelector('nav[aria-label="Secciones de la cédula"]');
      const step = nav.querySelector('[aria-current="step"]');
      return step.getBoundingClientRect().right <= nav.getBoundingClientRect().right + 1;
    })()`), true);
    await click("Cierre y firmas");
    await ev(`(()=>{const field=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Captura de prueba sin red');field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await status("Guardando cambios en el dispositivo");
    await status("Guardado en este dispositivo");
    await click("Volver a la ficha del partido");
    await wait("document.activeElement.textContent.trim()==='Retomar borrador de ejemplo'");
    await click("Retomar borrador de ejemplo");
    assert.equal(await ev("document.querySelector('textarea').value"), "Captura de prueba sin red");
    await click("Simular regreso de red");
    await status("Pendiente de sincronizar");
    await click("Sincronizar borrador");
    await status("Acuse de borrador recibido");
    assert.match(await visibleText(), /Cédula: Borrador/);
    assert.equal(await ev("document.documentElement.scrollWidth<=innerWidth"), true);

    await render("offline-preview-storage");
    await status("Espacio insuficiente para guardar");
    await click("Reintentar guardado local");
    await status("Guardado en este dispositivo");
    await render("offline-preview-session");
    await click("Simular inicio de sesión");
    await status("Pendiente de sincronizar");
    await render("offline-preview-conflict");
    await click("Comparar versiones simuladas");
    await wait("document.querySelector('dialog[open]').textContent.includes('Referencia simulada')");
    await key("Escape");
    await render("offline-preview-uncertain");
    await click("Simular consulta: no aplicada");
    await click("Reintentar misma operación simulada");
    await status("Acuse de borrador recibido");
    await render("offline-preview-confirmed");
    await status("Confirmación oficial · Simulación");
    assert.doesNotMatch(await visibleText(), /Acuse de borrador recibido/);
    assert.deepEqual(await ev("window.networkCalls"), []);
  });

});
