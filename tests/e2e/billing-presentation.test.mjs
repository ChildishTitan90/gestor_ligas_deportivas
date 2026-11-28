import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { build } from 'esbuild';
import { compile } from '@tailwindcss/node';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RuleParameter } from '../../src/features/competitions/components/rule-parameter.tsx';
import { formatChargeDate, formatChargePeriod } from '../../src/features/billing/presentation.ts';
import { launchChrome, closeTestServer } from './chrome-session.mjs';

test('Fechas hidratables y reglas anidadas legibles con CSS real, claro/oscuro y móvil/escritorio', { timeout: 60000 }, async () => {
  assert.equal(formatChargeDate('2027-01-01'), '01/01/2027');
  assert.equal(formatChargePeriod('2027-01-01', '2027-02-28'), '01/01/2027 al 28/02/2027');
  assert.equal(formatChargePeriod('2028-02-29', '2028-02-29'), '29/02/2028');
  const props = { parameter: { key: 'calendar', requiresValidation: false, value: { rounds: 1, scheduling: { venueStages: [{ toRound: 9, venueIds: ['morelos', 'bernabeu'] }], slotStepMinutes: 30 } } }, venueNames: { morelos: 'Estadio Morelos · LOCAL-175-V-1', bernabeu: 'Santiago Bernabéu · LOCAL-175-V-2' } };
  const markup = renderToString(React.createElement(React.Fragment, null, React.createElement('p', { id: 'period' }, formatChargePeriod('2027-01-01', '2027-02-28')), React.createElement(RuleParameter, props)));
  const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useEffect} from 'react';import {hydrateRoot} from 'react-dom/client';
    import {RuleParameter} from './src/features/competitions/components/rule-parameter';
    import {formatChargePeriod} from './src/features/billing/presentation';
    Intl.DateTimeFormat.prototype.formatRange=()=>{throw Error('No depender de formatRange entre ICU distintos')};
    window.failures=[];
    function Fixture(){useEffect(()=>{window.hydrated=true},[]);return <><p id="period">{formatChargePeriod('2027-01-01','2027-02-28')}</p><RuleParameter {...${JSON.stringify(props)}}/></>}
    hydrateRoot(document.getElementById('root'),<Fixture/>,{onRecoverableError:error=>window.failures.push(error.message)});
  ` } });
  const component = readFileSync('src/features/competitions/components/rule-parameter.tsx', 'utf8');
  const css = await compile(readFileSync('src/app/globals.css', 'utf8'), { base: resolve('src/app'), onDependency() {} });
  const styles = css.build([...new Set(component.split(/[\s"'`{}();?,]+/))]);
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].contents); }
    else if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(styles); }
    else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(`<!doctype html><html data-theme="light"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="padding:24px;font-family:Arial"><main style="max-width:960px;margin:auto" id="root">${markup}</main><script src="/bundle.js"></script></body></html>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, { waitForDocument: true });
    for (let n = 0; n < 100 && !await browser.evaluate('window.hydrated'); n++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await browser.evaluate('window.hydrated'), true);
    assert.deepEqual(await browser.evaluate('window.failures'), []);
    assert.equal(await browser.evaluate('document.getElementById("period").textContent'), '01/01/2027 al 28/02/2027');
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await browser.command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
      const metrics = await browser.evaluate(`Array.from(document.querySelectorAll('span')).filter(e=>e.textContent.includes('LOCAL-')).map(e=>({width:e.closest('li').getBoundingClientRect().width,height:e.getBoundingClientRect().height}))`);
      assert.equal(metrics.length, 2); assert.ok(metrics.every(m => m.width > 200 && m.height < 90), 'Nombres legibles, sin columnas comprimidas');
      const shot = await browser.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      mkdirSync('.artifacts/billing/presentation', { recursive: true });
      writeFileSync(`.artifacts/billing/presentation/reglas-${width}-${theme}.png`, Buffer.from(shot.data, 'base64'));
    }
  } finally { if (browser) await browser.close(); await closeTestServer(server); }
});
