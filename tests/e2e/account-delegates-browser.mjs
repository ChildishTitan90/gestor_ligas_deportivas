import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Browser } from '../integration/auth.test.mjs';
import { captureMaskedFailure } from '../../scripts/verification/account-diagnostics.mjs';
import { launchChrome } from './chrome-session.mjs';

/** Real hydrated Next UI and real backend. No React, fetch or HTTP mocks. */
export async function verifyAccountDelegateBrowser({ db, baseUrl, fixture, profileDirectory, artifactsDirectory, signal, diagnosticContext = {} }) {
  diagnosticContext.case = 'browser-launch';
  diagnosticContext.stage = 'chrome-startup';
  diagnosticContext.safeValues = false;
  const browser = await launchChrome(baseUrl, { profileDirectory });
  const { command, evaluate } = browser;
  const stop = () => { void browser.close(); };
  signal?.addEventListener('abort', stop, { once: true });
  const evaluateFunction = (fn, ...args) => evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const wait = async (fn, ...args) => {
    for (let attempt = 0; attempt < 240; attempt++) {
      signal?.throwIfAborted();
      try { if (await evaluateFunction(fn, ...args)) return; } catch { /* Navigation can replace the execution context. */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('BROWSER_CONDITION_TIMEOUT');
  };
  const set = async (name, value) => {
    const custom = await evaluateFunction(name => {
      const element = document.querySelector(`[data-select-field="${name}"]`);
      if (!element) return false;
      element.focus(); element.click();
      // Search opens the real shared popup; choosing still uses its actual option handler.
      return true;
    }, name);
    if (custom) {
      await wait(value => !!document.querySelector(`[role="option"][data-value="${value}"]:not([aria-disabled="true"])`), value);
      await evaluateFunction(value => document.querySelector(`[role="option"][data-value="${value}"]`).click(), value);
      await wait((name, value) => document.querySelector(`[name="${name}"]`)?.value === value, name, value);
      return;
    }
    await evaluateFunction((name, value) => {
      const element = document.querySelector(`[name="${name}"]`);
      if (!element) throw new Error('MISSING_CONTROL');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, name, value);
  };
  const press = async (key, code) => {
    for (const type of ['keyDown', 'keyUp']) await command('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  };
  const available = () => wait(() => {
    const control = document.querySelector('[data-select-field="delegatePosition"]');
    return control && !control.matches(":disabled");
  });
  const navigate = async path => {
    await command('Page.navigate', { url: `${baseUrl}${path}` });
    await wait(() => document.readyState === 'complete');
  };
  const login = async (email, password) => {
    await command('Network.clearBrowserCookies'); // Only this fresh owned profile.
    await navigate('/login');
    assert.equal(await evaluateFunction(async (email, password) => {
      const { csrfToken } = await (await fetch('/api/auth/csrf')).json();
      const response = await fetch('/api/auth/callback/credentials', { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, password, csrfToken, json: 'true', callbackUrl: '/access' }) });
      const result = await response.json();
      return response.ok && !new URL(result.url, location.origin).searchParams.has('error');
    }, email, password), true); // Set-Cookie flags come from NextAuth, not mocks.
  };
  const screenshot = async name => {
    const image = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`${artifactsDirectory}/${name}.png`, Buffer.from(image.data, 'base64'), { mode: 0o600 });
  };
  try {
    diagnosticContext.case = 'empty-selector';
    diagnosticContext.stage = 'browser-interaction';
    await mkdir(artifactsDirectory, { recursive: true, mode: 0o700 });
    await command('Page.enable'); await command('Network.enable');
    await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const admin = new Browser(baseUrl); await admin.login(fixture.actor.email, fixture.password);
    await login(fixture.actor.email, fixture.password); await navigate('/accounts/new');
    await wait(() => !!document.querySelector('[name="leagueId"]'));
    await set('leagueId', fixture.leagueId);
    await wait(() => !!document.querySelector('input[name="roles"][value="CLUB_DELEGATE"]') && !document.querySelector('input[name="roles"][value="CLUB_DELEGATE"]').disabled);
    await evaluateFunction(() => document.querySelector('input[name="roles"][value="CLUB_DELEGATE"]').click());
    await wait(() => !!document.querySelector('[name="club.id"]'));
    await set('club.id', fixture.clubs[0]); await available();
    assert.equal(await evaluateFunction(() => document.querySelector('[name="delegatePosition"]').value), '');
    await screenshot('desktop-empty-position'); // Before entering credentials/capture.
    diagnosticContext.case = 'keyboard-focus';
    await evaluateFunction(() => document.querySelector('[data-select-field="club.id"]').focus());
    await press('Tab', 9);
    assert.equal(await evaluateFunction(() => document.activeElement?.getAttribute("data-select-field")), 'delegatePeriodMode');
    await press('Tab', 9);
    assert.equal(await evaluateFunction(() => document.activeElement?.getAttribute("data-select-field")), 'delegatePosition');
    assert.equal(await evaluateFunction(() => {
      const style = getComputedStyle(document.activeElement);
      return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
    }), true);
    await press('ArrowDown', 40); await press('Enter', 13);
    await wait(() => document.querySelector('[name="delegatePosition"]').value === 'PRIMARY');
    diagnosticContext.case = 'capture-conflict';
    const suffix = randomUUID();
    const capture = { username: `browser-${suffix}`, email: `${suffix}@example.test`,
      'person.firstName': 'Captura sintética', 'person.paternalSurname': 'Navegador' };
    for (const [name, value] of Object.entries(capture)) await set(name, value);
    const password = `Browser-${randomBytes(20).toString('hex')}!aA`;
    await set('temporaryPassword', password);
    // A real competing account takes the position after this page read its options.
    const competitor = await admin.request('/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ username: `competitor-${suffix}`, email: `other-${suffix}@example.test`, temporaryPassword: password,
        person: { firstName: 'Competidor', paternalSurname: 'Sintético' }, roles: ['CLUB_DELEGATE'], leagueId: fixture.leagueId,
        club: { kind: 'existing', id: fixture.clubs[0] }, delegatePosition: 'PRIMARY' }) });
    assert.equal(competitor.status, 201);
    const before = (await db.query('SELECT count(*)::int n FROM sports_management.users')).rows[0].n;
    await evaluateFunction(() => document.querySelector('form button[type="submit"]').click());
    await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('cargo ya está ocupado'));
    await available();
    for (const [name, value] of Object.entries(capture))
      assert.equal(await evaluateFunction(name => document.querySelector(`[name="${name}"]`).value, name), value);
    assert.equal(await evaluateFunction(() => document.querySelector('[name="temporaryPassword"]').value.length), 0);
    assert.equal(await evaluateFunction(() => document.querySelector('[name="delegatePosition"]').value), '');
    assert.equal(await evaluateFunction(() => {
      const control = document.querySelector('[data-select-field="delegatePosition"]');
      return control.getAttribute('aria-invalid') === 'true' && control.getAttribute('aria-describedby').split(' ')
        .some(id => document.getElementById(id)?.textContent.includes('cargo ya está ocupado'));
    }), true);
    assert.equal((await db.query('SELECT count(*)::int n FROM sports_management.users')).rows[0].n, before);
    diagnosticContext.case = 'context-changes';
    await set('delegatePosition', 'DEPUTY');
    await set('club.id', fixture.clubs[2]); await available();
    assert.equal(await evaluateFunction(() => document.querySelector('[name="delegatePosition"]').value), '');
    await set('delegatePeriodMode', 'scheduled');
    await wait(() => !!document.querySelector('[name="delegatePeriod.startsAt"]'));
    await set('delegatePeriod.startsAt', '2035-01-01T12:00');
    await set('delegatePeriod.endsAt', '2035-02-01T12:00'); await available();
    await set('delegatePosition', 'PRIMARY');
    await set('delegatePeriod.endsAt', '2035-03-01T12:00'); await available();
    assert.equal(await evaluateFunction(() => document.querySelector('[name="delegatePosition"]').value), '');
    await set('delegatePeriodMode', 'now'); await available();
    await set('club.id', fixture.clubs[1]); await available();
    await evaluateFunction(() => document.querySelector('[data-select-field="delegatePosition"]').click());
    await wait(() => document.querySelectorAll('[role="option"]').length === 2);
    assert.equal(await evaluateFunction(() => [...document.querySelectorAll('[role="option"]')]
      .every(option => option.getAttribute('aria-disabled') === 'true')), true);
    await press('Escape', 27);
    assert.equal(await evaluateFunction(() => document.body.textContent.includes('Se necesita regularización')), true);
    await set('club.id', fixture.clubs[2]); await available();
    diagnosticContext.case = 'mobile-layout';
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await command('Emulation.setTouchEmulationEnabled', { enabled: true });
    assert.equal(await evaluateFunction(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true);
    assert.equal(await evaluateFunction(() => [...document.querySelectorAll('select, input:not([type="checkbox"]), button[type="submit"]')]
      .filter(element => element.getClientRects().length).every(element => element.getBoundingClientRect().height >= 44)), true);
    await screenshot('mobile-position');
    diagnosticContext.case = 'explicit-deputy-signup';
    await set('delegatePosition', 'DEPUTY'); await set('temporaryPassword', password);
    await evaluateFunction(() => document.querySelector('form button[type="submit"]').click());
    await wait(() => document.body.textContent.includes('Cuenta creada.'));
    const saved = (await db.query(`SELECT ur.delegate_position FROM sports_management.user_roles ur
      JOIN sports_management.users u ON u.id=ur.user_id WHERE u.username=$1`, [capture.username])).rows;
    assert.deepEqual(saved.map(row => row.delegate_position), ['DEPUTY']);
    diagnosticContext.case = 'stored-position-presentation';
    const delegate = new Browser(baseUrl); await delegate.login(capture.email, password);
    const newPassword = `Changed-${randomBytes(20).toString('hex')}!aA`;
    assert.equal((await delegate.request('/api/auth/change-password', { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ currentPassword: password, newPassword, confirmPassword: newPassword }) })).status, 200);
    await login(capture.email, newPassword); await navigate('/access');
    await wait(() => document.querySelector('header')?.textContent.includes('Subdelegado'));
    await login(fixture.legacy.email, fixture.password); await navigate('/access');
    await wait(() => document.querySelector('header')?.textContent.includes('Cargo no identificado'));
    assert.equal((await db.query('SELECT delegate_position FROM sports_management.user_roles WHERE user_id=$1', [fixture.legacy.id])).rows[0].delegate_position, null);
    await writeFile(`${artifactsDirectory}/checks.json`, JSON.stringify({ selectorEmpty: true, contextResets: true,
      conflictPreservedCapture: true, passwordCleared: true, keyboardAndFocus: true, mobileViewport: '390x844',
      storedPositionShown: true, legacyPreserved: true }, null, 2), { mode: 0o600 });
  } catch (error) {
    await captureMaskedFailure(command, artifactsDirectory);
    throw error;
  } finally { signal?.removeEventListener('abort', stop); await browser.close(); }
}
