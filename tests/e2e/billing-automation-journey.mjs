import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from './chrome-session.mjs';

export async function automationSettingsJourney(origin, cookie, fixture, db) {
  const browser = await launchChrome(origin + '/login', { commandTimeoutMs: 45000 });
  const str = JSON.stringify, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let loseResponse = true;
  const requests = [];
  const wait = async (expression, timeout = 60000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await browser.evaluate(expression)) return; await pause(100); }
    throw Error('Automatización UI: ' + expression + '. Vista: ' + await browser.evaluate("document.querySelector('main')?.innerText.slice(-600)"));
  };
  const click = async (label, scope = 'main') => {
    const expr = `[...document.querySelectorAll(${str(scope + ' button')})].find(e=>e.textContent.trim()===${str(label)} && e.getClientRects().length)`;
    await wait(`!!(${expr})`); await browser.evaluate(`(${expr}).click()`);
  };
  const set = async (name, value) => browser.evaluate(`(()=>{let e=document.querySelector('[name="${name}"]');Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${str(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  try {
    await browser.command('Network.setCookies', { cookies: cookie.split('; ').map(part => {
      const equals = part.indexOf('='); return { name: part.slice(0, equals), value: part.slice(equals + 1), url: origin };
    }) });
    await browser.command('Page.navigate', { url: origin + '/treasury/charges/automation' });
    await wait("document.querySelector('main h1')?.textContent==='Cargos automáticos'");
    for (let i = 0; i < 80; i++) {
      if (await browser.evaluate("document.getElementById('automation-season')?.getAttribute('aria-expanded')==='true'")) break;
      await browser.evaluate("document.getElementById('automation-season').click()"); await pause(100);
    }
    const option = `[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.includes('Temporada sintética 176'))`;
    await wait(`!!(${option})`); await browser.evaluate(`(${option}).click()`);
    await wait("!!document.querySelector('[name=amount]')");
    const before = (await db.query("SELECT max(revision)::int n FROM sports_management.billing_automation_policies WHERE season_id=$1 AND kind='CLUB_AFFILIATION'", [fixture.season])).rows[0].n;
    await set('amount', '140.50'); await set('dueDays', '12'); await set('reason', 'Configuración sintética desde interfaz real');
    await click('Revisar configuración');
    await wait("!!document.querySelector('dialog[open]') && document.activeElement?.hasAttribute('data-dialog-initial')");
    await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait("!document.querySelector('dialog[open]')");
    assert.equal(await browser.evaluate("document.querySelector('[name=amount]').value"), '140.50');
    await click('Revisar configuración'); await wait("!!document.querySelector('dialog[open]')");
    browser.socket.addEventListener('message', async message => {
      const item = JSON.parse(message.data);
      if (item.method !== 'Fetch.requestPaused') return;
      const event = item.params;
      requests.push(JSON.parse(event.request.postData));
      if (loseResponse) { loseResponse = false; await browser.command('Fetch.failRequest', { requestId: event.requestId, errorReason: 'ConnectionClosed' }); }
      else await browser.command('Fetch.continueRequest', { requestId: event.requestId });
    });
    await browser.command('Fetch.enable', { patterns: [{ urlPattern: '*/api/v1/billing/automation', requestStage: 'Response' }] });
    await click('Confirmar configuración', 'dialog[open]');
    await wait("document.querySelector('dialog[open]')?.innerText.includes('Se perdió la respuesta')");
    assert.equal(await browser.evaluate("document.querySelector('[name=amount]').matches(':disabled')"), true);
    await click('Reintentar el mismo envío', 'dialog[open]');
    await wait("!document.querySelector('dialog[open]') && document.querySelector('main')?.innerText.includes('Configuración confirmada por el servidor')");
    assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1], 'La respuesta perdida conserva exactamente la intención');
    const rows = (await db.query("SELECT revision,amount::text FROM sports_management.billing_automation_policies WHERE season_id=$1 AND kind='CLUB_AFFILIATION' ORDER BY revision DESC", [fixture.season])).rows;
    assert.equal(rows[0].revision, before + 1); assert.equal(rows[0].amount, '140.50');
    await browser.command('Fetch.disable');
    mkdirSync(process.env.BILLING_EVIDENCE, { recursive: true });
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await browser.command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
      await browser.evaluate(`document.documentElement.dataset.theme=${str(theme)}`);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'), true, 'Sin desbordamiento horizontal');
      const metrics = await browser.command('Page.getLayoutMetrics');
      const screenshot = await browser.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height: Math.ceil(metrics.cssContentSize.height), scale: 1 } });
      writeFileSync(join(process.env.BILLING_EVIDENCE, `automatizacion-${width}-${theme}.png`), Buffer.from(screenshot.data, 'base64'));
    }
  } finally { await browser.close(); }
}
