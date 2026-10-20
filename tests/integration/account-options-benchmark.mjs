import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tsImport } from 'tsx/esm/api';
import { Browser } from './auth.test.mjs';

export async function runAccountOptionsBenchmark({ databaseUrl, baseUrl, restartServer, metrics }) {
  const target = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.equal(target.search, '');
  assert.equal(target.hash, '');
  const { loadPermissionCatalog } = await tsImport('../../prisma/permissions-catalog.ts', import.meta.url);
  const { seedDemoDatabase } = await tsImport('../../prisma/seed-demo.ts', import.meta.url);
  const { DEMO_CONTEXT, DEMO_PASSWORD } = await tsImport('../../prisma/seed-demo-data.ts', import.meta.url);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const observer = new pg.Client({ connectionString: databaseUrl });
  try {
    await seedDemoDatabase(prisma, await loadPermissionCatalog(), {
      DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NODE_ENV: 'test',
    });
    await observer.connect();
    const browser = new Browser(baseUrl);
    await browser.login('admin@demo.example.test', DEMO_PASSWORD);
    // Reiniciar conserva la cookie pero enfría el cliente/pool del servidor.
    await restartServer();
    const results = [];
    for (let iteration = 0; iteration < 4; iteration++) {
      metrics.length = 0;
      let lockSamples = 0;
      let samples = 0;
      let sampling = true;
      const sample = (async () => {
        while (sampling) {
          const observed = await observer.query(`SELECT count(*)::int n FROM pg_stat_activity
            WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'`);
          samples++;
          if (observed.rows[0].n) lockSamples++;
          await delay(10);
        }
      })();
      const start = performance.now();
      let response;
      let body;
      let httpMs;
      try {
        response = await browser.request(`/api/accounts?leagueId=${DEMO_CONTEXT.leagueId}`, { signal: AbortSignal.timeout(30_000) });
        body = await response.json();
        httpMs = performance.now() - start;
      } finally { sampling = false; await sample; }
      assert.equal(response.status, 200);
      assert.equal(body.roles.length, 9);
      // La salida del servidor viaja por pipe; esperar su mensaje, sin otra petición.
      for (let attempt = 0; !metrics.length && attempt < 50; attempt++) await delay(10);
      assert.equal(metrics.length, 1, 'Debe medirse una petición real, sin inferir consultas desde mocks.');
      const result = { iteration, cold: iteration === 0, httpMs: Math.round(httpMs * 1000) / 1000,
        lockSamples, samples, ...metrics[0] };
      results.push(result);
      console.log(`ACCOUNT_OPTIONS_SAMPLE ${JSON.stringify(result)}`);
    }
    const summary = (samples) => {
      const values = samples.map((sample) => sample.httpMs).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return { medianHttpMs: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
        maxHttpMs: values.at(-1) };
    };
    console.log(`ACCOUNT_OPTIONS_SUMMARY ${JSON.stringify({ warm: summary(results.slice(1)), all: summary(results) })}`);
  } finally { await prisma.$disconnect(); await observer.end(); }
}
