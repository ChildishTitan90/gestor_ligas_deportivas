import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { compile } from '@tailwindcss/node';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchChrome, closeTestServer } from './chrome-session.mjs';

test('PDGLD-145: elegible, bloqueado, motivo y tiempos; teclado y ambos temas con DTO sintético', { timeout: 60000 }, async t => {
  const source = await readFile('src/features/matches/components/lineup-evaluation.tsx', 'utf8');
  const compiler = await compile(await readFile('src/app/globals.css', 'utf8'), { base: resolve('src/app'), onDependency() {} });
  const candidates = [...source.matchAll(/className="([^"]+)"/g)].flatMap(m => m[1].split(' '));
  const css = compiler.build([...candidates, 'p-5', 'bg-background', 'text-foreground']);
  const bundle = await build({ write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {LineupEvaluationView} from './src/features/matches/components/lineup-evaluation';
      const base={registrationId:'synthetic',team:'Club sintético · Equipo origen',targetTeam:'Equipo superior sintético',seasonTeamId:'target',jerseyNumber:7,participation:[]};
      const data={matchId:'synthetic-match',number:'DEMO-16',version:1,startsAt:'2026-11-11T18:00:00Z',historical:false,
        notices:['Evaluación sintética; no guarda una cédula.','[PV] Cruces pendientes de confirmación.'],players:[
        {...base,name:'Jugador elegible sintético',eligible:true,blockers:[],participation:[{matchNumber:'DEMO-15',period:1,entry:0,exit:30}]},
        {...base,registrationId:'blocked',name:'Jugador bloqueado sintético',eligible:false,blockers:[{code:'PARTICIPATION_BLOCKED',message:'Hay una sanción vigente que impide la participación.'}]}]};
      window.fetch=()=>{throw Error('Sin red en fixture');};
      createRoot(document.getElementById('root')).render(<LineupEvaluationView data={data}/>);
    ` } });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].contents : `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="bg-background text-foreground"><div id="root" class="p-5"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => closeTestServer(server));
  const browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, { signal: t.signal, waitForDocument: true }); t.after(() => browser.close());
  const ev = script => browser.evaluate(script);
  await ev(`(async()=>{for(let n=0;n<100;n++){if(document.querySelectorAll('article').length===2)return;await new Promise(r=>setTimeout(r,20));}throw Error('No renderizó');})()`);
  assert.match(await ev('document.body.textContent'), /Elegible para este partido/);
  assert.match(await ev('document.body.textContent'), /No habilitado para alinear/);
  assert.match(await ev('document.body.textContent'), /sanción vigente/);
  await ev('document.querySelector("summary").focus()');
  await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text:'\r' });
  await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await ev(`(async()=>{for(let n=0;n<50;n++){if(document.querySelector('details').open)return;await new Promise(r=>setTimeout(r,20));}throw Error('Enter no abrió los tiempos');})()`);
  assert.equal(await ev('document.querySelector("details").open'), true);
  assert.match(await ev('document.querySelector("details").textContent'), /entrada 0, salida 30/);
  for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
    await browser.command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'), true);
    if (process.env.MATCH_ELIGIBILITY_SCREENSHOTS) {
      const directory = resolve(process.env.MATCH_ELIGIBILITY_SCREENSHOTS);
      await mkdir(directory, { recursive: true });
      const shot = await browser.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await writeFile(`${directory}/${theme}-${width}.png`, Buffer.from(shot.data, 'base64'));
    }
  }
});
