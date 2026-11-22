import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { childEnvironment } from './ci/delegate-isolated-runtime.mjs';
import { launchChrome } from '../tests/e2e/chrome-session.mjs';

const root = resolve('.');
const privateRoot = mkdtempSync(join(root, '.env-standings-ui-'));
const container = `pdgld151-${randomBytes(12).toString('hex')}`;
const manifestPath = join(privateRoot, 'manifest.json');
const origin = 'http://127.0.0.1:3193';
const base = { ...childEnvironment(process.env), NEXTAUTH_URL: origin, NEXTAUTH_SECRET: randomBytes(48).toString('hex'),
  NODE_ENV: 'development', AUTH_TEST_RUN: '1', STANDINGS_UI_ISOLATED: '1', STANDINGS_MANIFEST: manifestPath,
  ACCOUNT_EMAIL_ENABLED: 'false', PASSWORD_RECOVERY_ENABLED: 'false', VMX_API_KEY: '', NEXT_TELEMETRY_DISABLED: '1' };
const docker = args => {
  const r = spawnSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], { env: base, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0 || r.error) throw Error('Docker no confirmó la operación aislada de PDGLD-151.');
  return r.stdout.trim();
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let created = false, server, serverExit, browser, url, fixture;
const run = (args, env) => {
  const r = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0 || r.error) {
    // Tests are synthetic; redact every private runtime value before showing diagnostics.
    let text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    for (const secret of [url, base.NEXTAUTH_SECRET, fixture?.password].filter(Boolean)) text = text.replaceAll(secret, '[privado]');
    text = text.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[conexión omitida]').replace(/\$argon2[^\s"']+/g, '[hash omitido]');
    console.error(text.slice(-10000));
    throw Error('Falló la comprobación aislada de PDGLD-151.');
  }
  return r.stdout;
};
async function wait(expression, message = 'Condición de navegador', timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await browser.evaluate(expression)) return;
    await pause(100);
  }
  throw Error(`${message}: sin resultado.`);
}
async function navigate(path) {
  await browser.command('Page.navigate', { url: origin + path });
  await wait(`location.pathname === ${JSON.stringify(new URL(origin + path).pathname)} && document.readyState === 'complete'`, 'Navegación');
}
async function login(username) {
  await browser.command('Network.clearBrowserCookies');
  const result = await browser.evaluate(`(async()=>{
    const csrf=await (await fetch('/api/auth/csrf')).json();
    const r=await fetch('/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrfToken:csrf.csrfToken,email:${JSON.stringify(username)},password:${JSON.stringify(fixture.password)},json:'true',callbackUrl:${JSON.stringify(origin + '/access')}})});
    const b=await r.json();return r.ok && !b.url?.includes('error=');
  })()`);
  assert.equal(result, true, 'NextAuth real debe autenticar el fixture');
  await navigate('/access');
  await wait(`!!document.querySelector('main h1')`);
}
async function choose(id, value, keyboard = false) {
  await browser.evaluate(`document.getElementById(${JSON.stringify(id)}).focus()`);
  if (keyboard) {
    await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  } else await browser.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  await wait(`!!document.querySelector('[role="option"][data-value="${value}"]')`, 'Opciones compartidas');
  await browser.evaluate(`document.querySelector('[role="option"][data-value="${value}"]').click()`);
  await wait(`document.getElementById(${JSON.stringify(id)}).getAttribute('aria-expanded')==='false'`);
}
const path = groupId => '/standings?' + new URLSearchParams({ ...fixture.filters, groupId });
async function screenshot(name, width, height, theme) {
  await browser.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
  await browser.evaluate(`localStorage.setItem('liga-theme',${JSON.stringify(theme)})`);
  await browser.command('Page.reload');
  await wait(`!!document.querySelector('[data-testid="standing-row"]') && document.documentElement.dataset.theme === ${JSON.stringify(theme)}`);
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Sin desbordamiento de página');
  const metrics = await browser.command('Page.getLayoutMetrics');
  const clip = { x: 0, y: 0, width, height: Math.ceil(metrics.cssContentSize.height), scale: 1 };
  const png = await browser.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
  const directory = resolve('docs/validation/pdgld151'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), Buffer.from(png.data, 'base64'));
}
try {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(3193, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
  docker(['create', '--name', container, '--label', 'pdgld.ticket=PDGLD-151', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '--env', 'POSTGRES_DB=standings_ui_synthetic', '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev', 'postgres:15-bookworm']);
  created = true; docker(['start', container]);
  const mapping = /^127\.0\.0\.1:(\d+)$/.exec(docker(['port', container, '5432/tcp'])); assert.ok(mapping);
  for (let n = 0; ; n++) {
    try { docker(['exec', container, 'pg_isready', '-U', 'postgres']); break; }
    catch { if (n === 79) throw Error('PostgreSQL no disponible.'); await pause(250); }
  }
  const inspected = JSON.parse(docker(['inspect', container]))[0];
  assert.deepEqual(inspected.HostConfig.Binds ?? [], []); assert.ok(inspected.Mounts.every(m => m.Type === 'tmpfs'));
  url = `postgresql://postgres:synthetic@127.0.0.1:${mapping[1]}/standings_ui_synthetic`;
  const env = { ...base, DATABASE_URL: url, DIRECT_URL: url };
  run(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], env);
  console.log(run(['--conditions=react-server', '--import', 'tsx', 'tests/integration/standings-workspace.ts'], env));
  fixture = JSON.parse(readFileSync(manifestPath, 'utf8'));
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3193'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = ''; server.stdout.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-16000); }); server.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-16000); });
  serverExit = new Promise(resolve => server.once('exit', resolve));
  const start = Date.now();
  while (true) {
    if (server.exitCode !== null || Date.now() - start > 120000) {
      console.error(diagnostic.replaceAll(url, '[conexión omitida]').replaceAll(base.NEXTAUTH_SECRET, '[privado]'));
      throw Error('Next.js no estuvo disponible.');
    }
    try { if ((await fetch(origin + '/api/auth/csrf', { signal: AbortSignal.timeout(5000) })).ok) break; } catch { /* Compilación inicial. */ }
    await pause(250);
  }
  browser = await launchChrome(origin + '/login', { commandTimeoutMs: 45000 });
  await browser.command('Network.enable');
  await browser.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await login('secretaria151');
  assert.equal(await browser.evaluate(`!!document.querySelector('nav[aria-label="Gestión de la liga"] a[href="/standings"]')`), true, 'Secretaría debe acceder desde el menú');
  await browser.evaluate(`document.querySelector('nav[aria-label="Gestión de la liga"] a[href="/standings"]').click()`);
  await wait(`location.pathname==='/standings' && !!document.getElementById('standing-competition')`);
  await choose('standing-competition', fixture.filters.competitionId, true);
  await choose('standing-season', fixture.filters.seasonId);
  await choose('standing-category', fixture.filters.categoryId);
  await choose('standing-group', fixture.filters.groupId);
  const submitted = await browser.evaluate(`Object.fromEntries(new FormData(document.querySelector('form[aria-label="Filtros de clasificación"]')))`);
  for (const [key, value] of Object.entries(fixture.filters)) assert.equal(submitted[key], value);
  await browser.evaluate(`document.querySelector('form[aria-label="Filtros de clasificación"]').requestSubmit()`);
  await wait(`!!document.querySelector('[data-testid="standing-row"]')`);
  assert.equal(await browser.evaluate('document.querySelectorAll("main").length'), 1, 'Solo el main del shell');
  assert.equal(await browser.evaluate(`document.querySelector('nav a[href="/standings"]').getAttribute('aria-current')`), 'page');
  const rows = await browser.evaluate(`Array.from(document.querySelectorAll('[data-testid="standing-row"]')).map(row=>Array.from(row.children).map(cell=>cell.textContent.trim()))`);
  assert.deepEqual(rows, [['1','Águilas','2','1','1','0','4','2','2','4'],['2','Búhos','2','1','0','1','1','2','-1','3'],['3','Delfines','1','0','1','0','2','2','0','1'],['4','Coyotes','1','0','0','1','0','1','-1','0']]);
  assert.equal(await browser.evaluate(`document.body.textContent.includes('Reglamento v7') && document.body.textContent.includes('Clasificación v1') && document.body.textContent.includes('Jornada 2')`), true);
  await screenshot('desktop-light.png', 1440, 1000, 'light');
  await screenshot('desktop-dark.png', 1440, 1000, 'dark');
  await screenshot('mobile-light.png', 390, 844, 'light');
  await screenshot('mobile-dark.png', 390, 844, 'dark');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('ul[aria-label="Clasificación por equipo"]')).display !== 'none'`), true);
  await choose('standing-group', fixture.pending);
  await choose('standing-category', fixture.filters.categoryId);
  assert.equal(await browser.evaluate(`document.querySelector('input[name="groupId"]').value`), '', 'Cambiar categoría limpia el grupo');
  await navigate(path(fixture.pending)); await wait(`document.body.textContent.includes('Hay posiciones pendientes')`);
  await navigate(path(fixture.empty)); await wait(`document.body.textContent.includes('Grupo sin resultados oficiales')`);
  await navigate(path(fixture.filters.groupId) + '&matchdayId=' + fixture.matchdays[0]);
  await wait(`document.body.textContent.includes('Jornada 1') && document.body.textContent.includes('Vista actual sin versión guardada')`);
  await login('fuera151'); await navigate(path(fixture.filters.groupId));
  await wait(`document.querySelector('[role="alert"]')?.textContent.includes('No tienes permiso')`);
  assert.equal(await browser.evaluate(`document.body.textContent.includes('Águilas') || document.body.textContent.includes('Competencia sintética Morelia')`), false, 'El ámbito ajeno no recibe datos del grupo');
  const html = await browser.evaluate(`fetch(${JSON.stringify(path(fixture.filters.groupId))}).then(r=>r.text())`);
  assert.ok(!html.includes('Águilas') && !html.includes('calculation_data') && !html.includes('input_fingerprint'));
  await browser.command('Network.clearBrowserCookies'); await browser.command('Page.navigate', { url: origin + path(fixture.filters.groupId) });
  await wait(`location.pathname==='/login'`);
  console.log('PDGLD-151: Chrome + NextAuth/HTTP/PostgreSQL reales: menú, totales, filtros, FormData, teclado, vacío, empate, jornada, ámbito ajeno y anónimo: aprobados.');
  console.log('Claro/oscuro, escritorio/móvil: capturas sintéticas guardadas en docs/validation/pdgld151.');
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([serverExit, pause(5000)]); if (server.exitCode === null) { server.kill('SIGKILL'); await serverExit; } }
  if (created) docker(['rm', '--force', container]);
  rmSync(privateRoot, { recursive: true, force: true });
}
