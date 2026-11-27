import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from './chrome-session.mjs';

export async function billingJourney(origin, fixture, db) {
  const browser = await launchChrome(origin + '/login', { commandTimeoutMs: 45000 });
  const str = JSON.stringify, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const actions = [];
  let stage = 'inicio';
  let loseResponse = false, loseRequest = false, pausedResponse, releaseResponse;
  const wait = async (expression, label = expression, timeout = 60000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await browser.evaluate(expression)) return; await pause(100); }
    throw Error(`Navegador: ${label}. Vista: ${await browser.evaluate("document.querySelector('dialog[open]')?.innerText || document.querySelector('main')?.innerText?.slice(-450)")}`);
  };
  const text = value => wait(`document.querySelector('main')?.innerText.includes(${str(value)})`, value);
  const nav = async path => {
    stage = 'Navegar ' + path;
    await browser.command('Page.navigate', { url: origin + path });
    await wait(`location.pathname===${str(new URL(origin + path).pathname)} && document.readyState==='complete' && !!document.querySelector('main h1')`, 'Navegación');
  };
  const click = async (label, scope = 'main') => {
    stage = label;
    const expression = `[...document.querySelectorAll(${str(scope + ' button,' + scope + ' a')})].find(e=>e.textContent.trim()===${str(label)} && e.getClientRects().length)`;
    await wait(`!!(${expression})`, label);
    await browser.evaluate(`(()=>{let e=${expression};e.focus();e.click()})()`);
  };
  const set = async (selector, value) => browser.evaluate(`(()=>{let e=document.querySelector(${str(selector)});Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${str(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const key = async (key, code, number) => {
    for (const type of ['keyDown', 'keyUp']) await browser.command('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: number });
  };
  const pick = async (id, label, keyboard = false) => {
    stage = id + ': ' + label;
    await wait(`!!document.getElementById(${str(id)})`, 'Campo ' + id);
    for (let n = 0; n < 80; n++) {
      if (await browser.evaluate(`document.getElementById(${str(id)})?.getAttribute('aria-expanded')==='true'`)) break;
      await browser.evaluate(`document.getElementById(${str(id)}).focus()`);
      if (keyboard) await key('Enter', 'Enter', 13);
      else await browser.evaluate(`document.getElementById(${str(id)}).click()`);
      await pause(100);
    }
    const option = `[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.trim().startsWith(${str(label)}))`;
    await wait(`!!(${option})`, 'Opciones de ' + id);
    if (keyboard) {
      // Búsqueda + Enter confirma mediante el control compartido.
      await browser.command('Input.insertText', { text: label });
      await key('ArrowDown', 'ArrowDown', 40); await key('Enter', 'Enter', 13);
    } else await browser.evaluate(`(${option}).click()`);
    await wait(`document.getElementById(${str(id)}).getAttribute('aria-expanded')==='false'`);
  };
  const screenshot = async (name, width, theme) => {
    await browser.command('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: width < 768 });
    await browser.evaluate(`localStorage.setItem('liga-theme',${str(theme)})`);
    await browser.command('Page.reload');
    await wait(`document.readyState==='complete' && !!document.querySelector('main h1') && document.documentElement.dataset.theme===${str(theme)}`);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Sin desbordamiento horizontal');
    const metrics = await browser.command('Page.getLayoutMetrics');
    const png = await browser.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: Math.ceil(metrics.cssContentSize.height), scale: 1 } });
    mkdirSync(process.env.BILLING_EVIDENCE, { recursive: true });
    writeFileSync(join(process.env.BILLING_EVIDENCE, name + '.png'), Buffer.from(png.data, 'base64'));
  };
  browser.socket.addEventListener('message', event => {
    const item = JSON.parse(event.data);
    if (item.method === 'Network.requestWillBeSent') {
      const request = item.params.request;
      const id = Object.entries(request.headers).find(([key]) => key.toLowerCase() === 'next-action')?.[1];
      if (id) actions.push({ id, body: request.postData });
    }
    if (item.method === 'Fetch.requestPaused') {
      const p = item.params;
      if (loseRequest && p.request.method === 'POST' && !p.responseStatusCode) {
        loseRequest = false; void browser.command('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionClosed' });
      } else if (loseResponse && p.request.method === 'POST' && p.responseStatusCode) {
        loseResponse = false; pausedResponse = p.requestId; releaseResponse?.();
      } else void browser.command('Fetch.continueRequest', { requestId: p.requestId });
    }
  });
  try {
    await browser.command('Network.enable');
    await browser.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false });
    await wait("document.readyState==='complete'");
    const login = await browser.evaluate(`(async()=>{const {csrfToken}=await(await fetch('/api/auth/csrf')).json();const r=await fetch('/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrfToken,email:'treasury176',password:${str(fixture.password)},json:'true',callbackUrl:${str(origin + '/access')}})});if(!r.ok || (await r.json()).url?.includes('error='))return null;return (await(await fetch('/api/auth/session')).json()).user?.id})()`);
    assert.equal(login, fixture.users.treasury176, 'NextAuth confirma la sesión del actor sintético');
    await nav('/treasury/charges'); await text('Cargos');
    assert.equal(await browser.evaluate("!!document.querySelector('nav a[href=\"/treasury/charges\"]')"), true);
    await click('Nuevo cargo'); await wait("!!document.getElementById('charge-seasonId')", 'Página de captura');
    await pick('charge-seasonId', 'Temporada sintética 176', true);
    await pick('charge-recipientKind', 'Club'); await pick('charge-recipientId', 'Monarcas sintético'); await pick('charge-concept', 'Inscripción');
    const fill = async (values, prefix = '#charge-') => { for (const [name, value] of Object.entries(values)) await set(prefix + name, value); };
    await fill({ amount: '0', dueOn: fixture.due, periodStart: fixture.start, periodEnd: `${fixture.year}-01-31`, reason: 'Captura sintética de aceptación' });
    await click('Revisar cargo');
    await wait("document.activeElement?.id==='charge-amount'", 'Foco de importe inválido');
    assert.equal(await browser.evaluate("document.getElementById('charge-amount').getAttribute('aria-invalid')"), 'true');
    await set('#charge-amount', '100.50'); await click('Revisar cargo'); await text('Revisa los datos del cargo');
    await wait("document.activeElement?.id==='review-charge'", 'Foco de revisión');
    await click('Crear cargo'); await wait("!!document.querySelector('dialog[open]')");
    await wait("document.querySelector('dialog[open]')?.contains(document.activeElement)", 'Foco inicial dentro del diálogo');
    await key('Escape', 'Escape', 27); await wait("!document.querySelector('dialog[open]')");
    assert.equal((await db.query('SELECT count(*)::int n FROM sports_management.charges')).rows[0].n, 0, 'Cancelar no escribe');
    await wait("document.activeElement?.textContent.trim()==='Crear cargo'", 'Retorno al origen');
    await click('Crear cargo');
    await browser.command('Fetch.enable', { patterns: [{ urlPattern: origin + '/treasury/charges*', requestStage: 'Response' }] });
    loseResponse = true;
    const held = new Promise(resolve => { releaseResponse = resolve; });
    await click('Confirmar cargo', 'dialog[open]');
    await Promise.race([held, pause(60000).then(() => { throw Error('No llegó la respuesta a interceptar'); })]);
    await text('Enviando la solicitud');
    assert.equal(await browser.evaluate("!![...document.querySelectorAll('main button')].find(e=>e.textContent.trim()==='Crear cargo')"), false, 'No ofrece otro envío pendiente');
    const saved = (await db.query('SELECT id,amount::text FROM sports_management.charges')).rows;
    assert.equal(saved.length, 1); assert.equal(saved[0].amount, '100.50');
    // Fallo de transporte DESPUÉS del commit real: no se sustituye backend ni acuse.
    await browser.command('Fetch.failRequest', { requestId: pausedResponse, errorReason: 'ConnectionClosed' });
    await text('Resultado incierto.');
    await click('Consultar resultado'); await text('Cargo creado');
    await wait("document.activeElement?.id==='charge-result'", 'Foco del resultado confirmado');
    const save = actions[0]?.id, consult = actions.at(-1)?.id;
    assert.ok(save && consult && save !== consult, 'Referencias reales de ambas Server Actions');
    await browser.command('Fetch.disable');
    assert.equal((await db.query('SELECT count(*)::int n FROM sports_management.charges')).rows[0].n, 1);
    await click('Ver cargo'); await text('Historial de modificaciones');
    await click('Modificar cargo');
    await wait("document.querySelector('dialog[open] [data-dialog-initial]')===document.activeElement", 'Foco inicial del diálogo de corrección');
    await set('dialog input[name="amount"]', '0'); await set('dialog textarea[name="reason"]', 'Corrección sintética con motivo');
    await click('Modificar cargo', 'dialog[open]');
    await wait("document.activeElement?.name==='amount' && document.activeElement.getAttribute('aria-invalid')==='true'", 'Error de modificación asociado al campo');
    assert.ok(await browser.evaluate("!!document.getElementById(document.activeElement.getAttribute('aria-describedby'))"));
    await set('dialog input[name="amount"]', '125.75'); await set('dialog textarea[name="reason"]', 'Corrección sintética con motivo');
    await wait("!document.querySelector('dialog input[name=amount]').hasAttribute('aria-invalid')", 'Captura corregida');
    await click('Cancelar', 'dialog[open]'); await wait("document.querySelector('dialog[open]')?.textContent.includes('¿Descartar los cambios sin guardar?')", 'Confirmación de descarte');
    await click('Seguir editando', 'dialog[open]');
    assert.equal(await browser.evaluate("document.querySelector('dialog input[name=amount]').value"), '125.75', 'Cancelar descarte conserva datos');
    await key('Tab', 'Tab', 9);
    assert.equal(await browser.evaluate("document.querySelector('dialog[open]').contains(document.activeElement)"), true, 'Tab permanece en el diálogo');
    await set('dialog input[name="dueOn"]', '2000-01-01');
    await click('Modificar cargo', 'dialog[open]'); await text('El vencimiento debe ser igual o posterior');
    assert.equal(await browser.evaluate("document.querySelector('dialog input[name=amount]').value"), '125.75', 'Rechazo del servidor conserva captura');
    await set('dialog input[name="dueOn"]', fixture.due);
    await click('Modificar cargo', 'dialog[open]'); await text('Modificación confirmada.'); await click('Ver cargo actualizado', 'dialog[open]'); await text('125.75');
    for (const [width, theme] of [[1440, 'light'], [1440, 'dark'], [390, 'light'], [390, 'dark']]) await screenshot(`detalle-${width}-${theme}`, width, theme);
    await nav('/treasury/charges/new'); await pick('charge-seasonId', 'Temporada sintética 176'); await pick('charge-recipientKind', 'Equipo'); await pick('charge-recipientId', 'Pumas sintético');
    await pick('charge-concept', 'Cancha'); await pick('charge-frequency', 'Semanal');
    await fill({ amount: '75.50', dueOn: fixture.due, periodStart: fixture.start, periodEnd: fixture.end, reason: 'Plan semanal sintético' });
    await click('Revisar cargo'); await click('Guardar plan semanal'); await click('Confirmar plan', 'dialog[open]'); await text('Plan semanal guardado');
    assert.equal((await db.query('SELECT count(*)::int n FROM sports_management.charges')).rows[0].n, 1, 'Guardar plan no genera cargos');
    await click('Volver al listado'); await text('Planes semanales'); await click('Generar cargo del periodo');
    const period = { periodStart: `${fixture.year}-01-04`, periodEnd: `${fixture.year}-01-10`, dueOn: fixture.due, reason: 'Generación manual sintética' };
    for (const [name, value] of Object.entries(period)) await set(`dialog [name="${name}"]`, value);
    await click('Generar cargo del periodo', 'dialog[open]'); await text('Cargo generado y confirmado.');
    await click('Generar otro periodo', 'dialog[open]');
    for (const [name, value] of Object.entries(period)) await set(`dialog [name="${name}"]`, value);
    await click('Generar cargo del periodo', 'dialog[open]'); await text('Se recuperó el cargo ya generado para este periodo.');
    assert.equal((await db.query('SELECT count(*)::int n FROM sports_management.charges')).rows[0].n, 2);
    await nav('/treasury/charges');
    for (const [width, theme] of [[1440, 'light'], [1440, 'dark'], [390, 'light'], [390, 'dark']]) await screenshot(`listado-${width}-${theme}`, width, theme);
    await nav('/treasury/charges/new'); await pick('charge-seasonId', 'Temporada sintética 176'); await pick('charge-recipientKind', 'Club');
    await pick('charge-recipientId', 'Monarcas sintético'); await pick('charge-concept', 'Arbitraje');
    await fill({ amount: '65.25', dueOn: fixture.due, periodStart: `${fixture.year}-07-01`, periodEnd: `${fixture.year}-07-31`, reason: 'Reintento sintético antes de aplicar' });
    await click('Revisar cargo'); await click('Crear cargo');
    await browser.command('Fetch.enable', { patterns: [{ urlPattern: origin + '/treasury/charges*', requestStage: 'Request' }] });
    loseRequest = true;
    const actionStart = actions.length;
    await click('Confirmar cargo', 'dialog[open]'); await text('Resultado incierto.');
    assert.equal((await db.query('SELECT count(*)::int n FROM sports_management.charges')).rows[0].n, 2, 'El envío interrumpido antes de aplicar no escribe');
    await click('Consultar resultado'); await text('La consulta confirmó que ese intento no se aplicó.');
    await click('Reintentar la misma solicitud'); await text('Cargo creado');
    const submissions = actions.slice(actionStart).filter(item => item.id === save);
    assert.equal(submissions.length, 2); assert.equal(submissions[0].body, submissions[1].body, 'Reintento conserva intención y contenido exactos');
    assert.equal((await db.query('SELECT count(*)::int n FROM sports_management.charges')).rows[0].n, 3);
    await browser.command('Fetch.disable');
    return { save, consult, chargeId: saved[0].id };
  } catch (error) { throw Error(`Chrome en ${stage}: ${error.message}`, { cause: error }); }
  finally { await browser.close(); }
}
