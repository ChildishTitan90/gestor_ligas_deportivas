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
      import {createReportDemo} from './src/features/match-reports/demo-data';
      let revision=0; const root=createRoot(document.getElementById('root'));
      window.networkCalls=[]; window.fetch=(...args)=>{window.networkCalls.push(String(args[0]));throw Error('Red prohibida en demo de componentes');};
      window.fixture={render(scenario='draft') {flushSync(()=>root.render(<ManagementShell key={++revision}
        account={{username:'demo.sintetica',initials:'DS',roleNames:['Cuenta de ejemplo']}}
        navigation={[{label:'Arbitraje · Demo',items:[{href:'/matches/report-demo',label:'Demo · Cédula arbitral',icon:'players'}]}]}>
        {scenario==='list'?<ReportDemoList/>:<ReportWorkspace data={createReportDemo(scenario)}/>}
      </ManagementShell>));}}; window.fixture.render();
    ` },
    plugins: [{ name: "next-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^next\/(link|image|navigation)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "next/navigation"
        ? "export const usePathname=()=>'/matches/report-demo/demo-018';"
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
    assert.match(await visibleText(), /Partido: En curso/); assert.match(await visibleText(), /Cédula: Borrador/);
    await click("Capturar cédula");
    assert.equal(await ev("document.getElementById('jersey-home-7').value"), "17");
    assert.match(await visibleText(), /Sanción vigente/);
    assert.equal(await ev("[...document.querySelectorAll('input[type=checkbox]')].filter(i=>i.getClientRects().length && i.disabled).length"), 4);
    await ev(`(()=>{const i=document.getElementById('jersey-home-7');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'27');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
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
    assert.match(version, /Cédula v2/); assert.match(await visibleText(), /Cédula v3/);
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
    await render("empty"); await click("Capturar cédula"); await click("Eventos"); assert.match(await visibleText(), /Todavía no hay eventos/);
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
});
