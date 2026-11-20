import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { launchChrome, closeTestServer } from './chrome-session.mjs';
import { captureReportCaptainSignatures } from './report-signature-browser.mjs';

// Production signature controls with synthetic captains. A late navigation focus
// competes with scrolling, as ReportWorkspace's scheduled panel focus can do.
// No backend, image injection, signature dumps or screenshots.
test('firmas reales: recupera el lienzo tras un desplazamiento de foco tardío', { timeout: 120000 }, async t => {
  const compiler = await compile(await readFile('src/app/globals.css', 'utf8'), { base: resolve('src/app'), onDependency() {} });
  const css = compiler.build(new Scanner({ sources: [{ base: resolve('src'), pattern: '**/*.{ts,tsx}', negated: false }] }).scan());
  const bundle = await build({ write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    stdin: { resolveDir: process.cwd(), sourcefile: 'signature-scroll-fixture.tsx', loader: 'tsx', contents: `
      import React,{useEffect,useRef,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {ReportClosing} from './src/features/match-reports/components/report-closing';
      import {createReportDemo} from './src/features/match-reports/demo-data';
      const root=createRoot(document.getElementById('root'));let revision=0;
      function Fixture(){
        const [data]=useState(()=>createReportDemo('draft'));
        const [report,setReport]=useState(data.report);
        const heading=useRef(null);
        useEffect(()=>{
          window.focusRuns=0;
          const lateFocus=()=>requestAnimationFrame(()=>{
            window.focusRuns++;heading.current.focus();heading.current.scrollIntoView({block:'start',behavior:'instant'});
          });
          window.addEventListener('scroll',lateFocus,{once:true});
          window.fixtureReady=true;
          return ()=>{window.fixtureReady=false;window.removeEventListener('scroll',lateFocus)};
        },[]);
        window.signatureCount=Object.values(report.signatures).filter(Boolean).length;
        return <><header className="fixed inset-x-0 top-0 z-10 h-16 bg-surface">Cédula · Prueba sintética</header>
          <h1 ref={heading} tabIndex={-1}>Cierre y firmas</h1><div style={{height:1200}}/>
          <ReportClosing data={data} report={report} live locked={false} signatureEpoch={0}
            onScore={()=>{}} onRemarks={()=>{}} onIncidents={()=>{}}
            onSignature={(teamId,value)=>setReport(current=>({...current,signatures:{...current.signatures,[teamId]:value}}))}/>
        </>;
      }
      window.renderFixture=()=>{window.scrollTo({top:0,behavior:'instant'});flushSync(()=>root.render(<Fixture key={++revision}/>))};
      window.renderFixture();
    ` },
    plugins: [{ name: 'next-image-fixture', setup(plugin) {
      plugin.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'next/image', namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'import React from "react";export default function Image({unoptimized,...props}){return <img {...props}/>}', loader: 'jsx', resolveDir: process.cwd() }));
    } }],
  });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].contents : `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => closeTestServer(server));
  const browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, { signal: t.signal, waitForDocument: true });
  t.after(() => browser.close());
  for (const width of [390, 1440]) {
    await browser.command('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width === 390 });
    await browser.evaluate('window.renderFixture();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await browser.evaluate('window.fixtureReady'), true);
    await captureReportCaptainSignatures(browser);
    assert.equal(await browser.evaluate('window.focusRuns'), 1, 'The browser actually performed the competing focus scroll');
    assert.equal(await browser.evaluate('window.signatureCount'), 2);
    assert.equal(await browser.evaluate('document.querySelectorAll("canvas").length'), 0);
    assert.equal(await browser.evaluate('[...document.querySelectorAll("img")].filter(i=>i.complete&&i.naturalWidth>0).length'), 2);
  }
});
