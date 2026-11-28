import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { getPrisma } from '../../src/server/db/prisma.ts';
import { billingAutomationCases } from './billing-automation.mjs';
import { automationSettingsJourney } from '../e2e/billing-automation-journey.mjs';

// Subconjunto de diagnóstico; CI ejecuta siempre billing.test.mjs con ambos recorridos.
test('Automatización: diagnóstico PostgreSQL/HTTP/Chrome aislado', { timeout: 360000 }, async t => {
  assert.equal(process.env.BILLING_ISOLATED, '1');
  const fixture = JSON.parse(readFileSync(process.env.BILLING_MANIFEST, 'utf8'));
  const target = new URL(process.env.BILLING_ADMIN_URL);
  assert.equal(target.hostname, '127.0.0.1'); assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const db = new pg.Client({ connectionString: target.href }); await db.connect();
  const origin = process.env.NEXTAUTH_URL;
  const login = async name => {
    const jar = new Map();
    const cookies = r => { for (const c of r.headers.getSetCookie()) { const i = c.indexOf('='); jar.set(c.slice(0, i), c.slice(i + 1).split(';')[0]); } };
    const csrf = await fetch(origin + '/api/auth/csrf'); cookies(csrf);
    const response = await fetch(origin + '/api/auth/callback/credentials', { method: 'POST', redirect: 'manual',
      headers: { cookie: [...jar].map(c => c.join('=')).join('; '), origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken: (await csrf.json()).csrfToken, email: name, password: fixture.password, json: 'true', callbackUrl: origin + '/access' }) });
    cookies(response); assert.ok(jar.get('next-auth.session-token'));
    return [...jar].map(c => c.join('=')).join('; ');
  };
  const check = async (name, operation) => { let passed = false; await t.test(name, async () => { await operation(); passed = true; }); assert.ok(passed); };
  try {
    await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','Fixture automatización',false)", [fixture.users.treasury176]);
    const treasury = await login('treasury176'), delegate = await login('delegate176'), other = await login('other176');
    await billingAutomationCases({ check, q: async (sql, args = []) => (await db.query(sql, args)).rows, fixture, origin, login, treasury, delegate, other });
    await check('Interfaz de configuración, pérdida de respuesta y temas', () => automationSettingsJourney(origin, treasury, fixture, db));
  } finally { await getPrisma().$disconnect(); await db.end(); }
});
