import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { compile } from '@tailwindcss/node';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchChrome, closeTestServer } from './chrome-session.mjs';

// Componentes y shell reales; sesión, navegación y datos sintéticos.
// No abre NextAuth, PostgreSQL ni proveedores externos.
test('PDGLD-142: padrón, conflictos, cuotas, historial, foco y temas con fixtures sin red', { timeout: 120000 }, async t => {
  const files = [
    'src/features/referees/components/referee-workspace.tsx', 'src/features/referees/components/referee-dialog.tsx',
    'src/features/referees/components/assignment-dialog.tsx', 'src/components/ui/select-field.tsx',
    'src/components/ui/form-dialog.tsx', 'src/components/layout/management-shell.tsx',
    'src/components/layout/management-navigation.tsx', 'src/features/auth/components/account-menu.tsx',
    'src/components/ui/theme-menu-controls.tsx', 'src/components/ui/action-link.tsx',
  ];
  const source = (await Promise.all(files.map(file => readFile(file, 'utf8')))).join('\n');
  const compiler = await compile(await readFile('src/app/globals.css', 'utf8'), { base: resolve('src/app'), onDependency() {} });
  const css = compiler.build(source.split(/[\s"'`<>{}$]+/).concat(['p-5', 'bg-background', 'text-foreground']));
  const bundle = await build({ write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'synthetic-navigation', setup(plugin) {
      plugin.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: process.cwd(), contents: args.path === 'next/navigation'
        ? `export function usePathname(){return '/referees/demo'};export function useRouter(){return {push(){},replace(){},refresh(){}}};`
        : `import React from 'react';export default function Link({href,children,onClick,onNavigate,...props}){return <a {...props} href={href} onClick={event=>{onClick?.(event);event.preventDefault();if(href.startsWith('/referees/demo')){window.renderView(new URL(href,location.origin).searchParams.get('view')??'register');onNavigate?.();}}}>{children}</a>}` }));
    } }],
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {RefereeWorkspace} from './src/features/referees/components/referee-workspace';
      import {refereePreviewData} from './src/features/referees/preview-data';
      import {ManagementShell} from './src/components/layout/management-shell';
      window.networkCalls=0;window.fetch=()=>{window.networkCalls++;throw Error('Sin red en fixture de arbitraje')};
      let root=createRoot(document.getElementById('root'));
      window.renderView=(view='register')=>flushSync(()=>root.render(<ManagementShell account={{username:'demo-ui',initials:'UI',roleNames:['Revisión sintética']}} navigation={[{label:'Arbitraje',items:[{href:'/referees/demo',label:'Árbitros y designaciones · Demo',icon:'players'}]}]}><RefereeWorkspace initialData={refereePreviewData} view={view} matchesHref='/matches'/></ManagementShell>));
      window.renderView();
    ` } });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].contents : `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="bg-background text-foreground"><div id="root"></div><script>window.addEventListener('error',event=>{window.fixtureError=event.message});</script><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => closeTestServer(server));
  const browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, { signal: t.signal, waitForDocument: true }); t.after(() => browser.close());
  const ev = script => browser.evaluate(script);
  const wait = condition => ev(`(async()=>{for(let n=0;n<200;n++){if(window.fixtureError)throw Error(window.fixtureError);if(${condition})return;await new Promise(r=>setTimeout(r,15));}throw Error('No se cumple: '+${JSON.stringify(condition)});})()`);
  await wait(`document.querySelector('#referee-league')`);
  await ev(`window.clickText=(text,scope=document)=>{const el=[...scope.querySelectorAll('button,a')].find(el=>el.textContent.trim()===text);if(!el)throw Error('Falta control '+text);el.focus();el.click();};window.setInput=(id,value)=>{const el=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));};`);
  async function pick(id, label) {
    await ev(`document.getElementById(${JSON.stringify(id)}).focus();document.getElementById(${JSON.stringify(id)}).click()`);
    await wait(`document.querySelector('[role="option"]')`);
    await ev(`(()=>{const el=[...document.querySelectorAll('[role=option]')].find(el=>el.textContent.includes(${JSON.stringify(label)}));if(!el)throw Error('Falta opción '+${JSON.stringify(label)});el.click();})()`);
    await wait(`!document.querySelector('[role="listbox"]')`);
  }
  async function click(text) {
    await ev(`window.clickText(${JSON.stringify(text)})`);
    await ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  async function key(key, code = key, value = undefined) {
    await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: value });
    await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: value });
  }
  async function view(name) { await ev(`window.renderView(${JSON.stringify(name)})`); }

  assert.equal(await ev(`document.getElementById('referee-season').disabled`), true);
  await pick('referee-league', 'Municipal');
  assert.equal(await ev(`document.getElementById('referee-season').value`), '');
  await pick('referee-season', 'Apertura');
  await wait(`document.querySelectorAll('article').length===5`);
  await ev(`window.setInput('referee-search','ÁLBA')`);
  await wait(`document.querySelectorAll('article').length===1`);
  assert.match(await ev('document.body.textContent'), /Alba/);
  await click('Limpiar filtros');
  await pick('referee-active-filter', 'Inactivo');
  await wait(`document.querySelectorAll('article').length===1`);
  assert.match(await ev('document.querySelector("article").textContent'), /Bruna/);
  await click('Limpiar filtros');

  // Modal, selección dentro del diálogo, FormData, descarte y retorno del foco.
  await click('Presentar árbitro · Demo');
  await wait(`document.querySelector('dialog[open]')`);
  await pick('referee-person', 'Fina');
  await pick('referee-club', 'Faro');
  assert.equal(await ev(`new FormData(document.getElementById('referee-preview-form')).get('personId')`), 'DEMO-P6');
  await key('Escape', 'Escape', 27);
  await wait(`document.querySelector('dialog').textContent.includes('¿Descartar')`);
  await click('Seguir editando');
  await wait(`!document.querySelector('dialog').textContent.includes('¿Descartar')`);
  await click('Aplicar a la demo');
  await wait(`!document.querySelector('dialog[open]')`);
  assert.match(await ev('document.activeElement.textContent'), /Presentar árbitro/);
  assert.match(await ev('document.body.textContent'), /No se guardó información real/);
  assert.equal(await ev('document.querySelectorAll("article").length'), 6);
  await click('Editar Fina');
  await pick('referee-active', 'Inactivo');
  await key('Escape', 'Escape', 27); await wait(`document.querySelector('dialog').textContent.includes('¿Descartar')`);
  await click('Descartar cambios'); await wait(`!document.querySelector('dialog[open]')`);
  assert.equal(await ev('document.querySelectorAll("article").length'), 6);

  await click('Reiniciar demostración');
  await view('quota');
  assert.match(await ev('document.body.textContent'), /ceil\(5\/4\) = 2/);
  assert.match(await ev('document.body.textContent'), /ceil\(9\/4\) = 3/);
  assert.match(await ev('document.body.textContent'), /Faltan 2 árbitros/);
  await view('assignments');
  assert.match(await ev('document.body.textContent'), /Árbitro inactivo/);
  assert.match(await ev('document.body.textContent'), /indisponibilidad/);
  assert.match(await ev('document.body.textContent'), /Traslape con D-102/);
  assert.match(await ev('document.body.textContent'), /Cedro C.*aunque ese equipo no dispute/);
  for (const name of ['Bruna', 'Ciro', 'Dara', 'Elio']) {
    await click(`Revisar D-101 · ${name}`); await wait(`document.querySelector('dialog[open]')`);
    assert.equal(await ev(`[...document.querySelectorAll('dialog button')].find(el=>el.textContent==='Simular aprobación').disabled`), true);
    await click('Cancelar'); await wait(`!document.querySelector('dialog[open]')`);
  }
  await click('Revisar D-101 · Alba'); await wait(`document.querySelector('dialog[open]')`);
  assert.equal(await ev(`[...document.querySelectorAll('dialog button')].find(el=>el.textContent==='Simular aprobación').disabled`), false);
  await click('Simular aprobación'); await wait(`!document.querySelector('dialog[open]')`);
  assert.match(await ev('document.body.textContent'), /Aprobada solo en la simulación/);
  await click('Revisar D-101 · Alba'); await click('Simular revocación'); await wait(`!document.querySelector('dialog[open]')`);
  await view('history');
  // El antecedente inicial conserva su estado; cada acción añade otro evento local.
  assert.equal(await ev(`document.querySelectorAll('ol>li').length`), 10);
  await pick('referee-season', 'Clausura');
  assert.match(await ev('document.body.textContent'), /Identidad preservada al cierre/);
  assert.match(await ev('document.body.textContent'), /Identidad histórica no disponible/);
  assert.doesNotMatch(await ev('document.body.textContent'), /Ciro · Identidad/);
  await pick('history-referee', 'DEMO-R3');
  assert.equal(await ev('document.querySelectorAll("ol>li").length'), 1);
  await pick('referee-season', 'Apertura');
  await view('availability'); await pick('availability-referee', 'Ciro');
  assert.match(await ev('document.body.textContent'), /10:00/); // UTC 16:00, zona de la liga.
  assert.match(await ev('document.body.textContent'), /Indisponible/);
  await click('Simular sin intervalos');
  assert.match(await ev('document.body.textContent'), /No se presume disponibilidad/);
  assert.match(await ev('document.body.textContent'), /Falta confirmar disponibilidad/);
  await view('assignments'); await click('Proponer designación · Demo');
  await pick('assignment-match', 'D-103'); await pick('assignment-referee', 'Alba');
  assert.match(await ev('document.querySelector("dialog").textContent'), /Grupo único: todos/);
  assert.equal(await ev(`[...document.querySelectorAll('dialog button')].find(el=>el.textContent==='Simular propuesta').disabled`), true);
  await click('Cancelar'); await click('Descartar cambios'); await wait(`!document.querySelector('dialog[open]')`);

  await view('register');
  for (const [label, message] of [['Carga', 'Cargando árbitros'], ['Vacío', 'No hay registros'], ['Error', 'No se pudo consultar'], ['Acceso denegado', 'Acceso denegado']]) {
    await pick('referee-scenario', label); assert.match(await ev('document.body.textContent'), new RegExp(message));
    assert.equal(await ev('document.querySelectorAll("article").length'), 0);
  }
  await pick('referee-scenario', 'Datos de ejemplo');
  await pick('referee-league', 'Regional');
  assert.equal(await ev(`document.getElementById('referee-season').value`), '');
  await pick('referee-season', 'Regional 2026');
  assert.match(await ev('document.body.textContent'), /No hay registros/);
  await pick('referee-league', 'Municipal'); await pick('referee-season', 'Apertura');
  await click('Reiniciar demostración');

  // Teclado del selector: recorrer no confirma, Enter confirma y Escape cierra.
  await ev(`document.getElementById('referee-active-filter').focus()`);
  await key('ArrowDown', 'ArrowDown', 40); await key('ArrowDown', 'ArrowDown', 40);
  assert.equal(await ev(`document.getElementById('referee-active-filter').value`), 'Todos');
  await key('Escape', 'Escape', 27);
  assert.equal(await ev(`!!document.querySelector('[role=listbox]')`), false);
  await key('ArrowDown', 'ArrowDown', 40); await key('ArrowDown', 'ArrowDown', 40);
  await key('Enter', 'Enter', 13);
  await wait(`document.querySelectorAll('article').length===4`);
  assert.equal(await ev(`document.getElementById('referee-active-filter').value`), 'Activo');
  await click('Limpiar filtros');

  for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
    await browser.command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    for (const name of ['register', 'quota', 'assignments', 'history', 'availability']) {
      await view(name);
      if (name === 'availability') await pick('availability-referee', 'Ciro');
      assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'), true, `${theme}/${width}/${name} sin desbordamiento`);
      if (process.env.REFEREE_SCREENSHOTS) {
        await ev('window.scrollTo(0,0);new Promise(resolve=>requestAnimationFrame(resolve))');
        const directory = resolve(process.env.REFEREE_SCREENSHOTS); await mkdir(directory, { recursive: true });
        const shot = await browser.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        await writeFile(`${directory}/${name}-${theme}-${width}.png`, Buffer.from(shot.data, 'base64'));
      }
    }
    await view('register'); await click('Presentar árbitro · Demo'); await pick('referee-person', 'Fina');
    await ev(`document.getElementById('referee-club').focus();document.getElementById('referee-club').click()`); await wait(`document.querySelector('[role=listbox]')`);
    assert.equal(await ev(`document.querySelector('dialog').contains(document.querySelector('[role=listbox]'))`), true);
    assert.equal(await ev(`(()=>{const r=document.querySelector('dialog').getBoundingClientRect();return r.width<=innerWidth&&r.height<=innerHeight})()`), true);
    if (process.env.REFEREE_SCREENSHOTS) {
      const shot = await browser.command('Page.captureScreenshot', { format: 'png' });
      await writeFile(`${resolve(process.env.REFEREE_SCREENSHOTS)}/dialog-${theme}-${width}.png`, Buffer.from(shot.data, 'base64'));
    }
    await key('Escape', 'Escape', 27); // Cierra lista, conserva el diálogo.
    assert.equal(await ev(`!!document.querySelector('dialog[open]')`), true);
    await key('Escape', 'Escape', 27); await wait(`document.querySelector('dialog').textContent.includes('¿Descartar')`);
    await click('Descartar cambios'); await wait(`!document.querySelector('dialog[open]')`);
  }
  assert.equal(await ev('window.networkCalls'), 0, 'la demo no envía solicitudes de negocio');
});
