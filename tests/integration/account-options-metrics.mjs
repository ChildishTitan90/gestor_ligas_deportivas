// Preload exclusivo del benchmark local. Nunca registra SQL, argumentos o identidad.
import { AsyncLocalStorage } from 'node:async_hooks';
import { Server } from 'node:http';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

if (process.env.ACCOUNT_OPTIONS_METRICS === '1') {
  const target = new URL(process.env.DATABASE_URL);
  if (process.env.AUTH_TEST_RUN !== '1' || process.env.NODE_ENV === 'production' ||
      !['postgres:', 'postgresql:'].includes(target.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
      !/^\/pdgld48_test_[a-f0-9]{16}$/.test(target.pathname) || target.search || target.hash)
    throw new Error('Las métricas solo admiten la base desechable del harness local.');
  const storage = new AsyncLocalStorage();
  const round = (value) => Math.round(value * 1000) / 1000;
  const originalEmit = Server.prototype.emit;
  Server.prototype.emit = function (event, ...args) {
    const [request, response] = args;
    if (event !== 'request' || request.method !== 'GET' || request.url.split('?')[0] !== '/api/accounts')
      return originalEmit.call(this, event, ...args);
    const metrics = { queries: 0, queryMs: 0, poolWaitMs: 0, connectMs: 0, transactions: [] };
    response.once('finish', () => {
      if (metrics.queries) process.stdout.write(`ACCOUNT_OPTIONS_METRICS ${JSON.stringify({
        status: response.statusCode, ...metrics,
      }, (_key, value) => typeof value === 'number' ? round(value) : value)}\n`);
    });
    return storage.run({ request: metrics }, () => originalEmit.call(this, event, ...args));
  };
  function observe(prototype, name, record) {
    const original = prototype[name];
    prototype[name] = function (...args) {
      const context = storage.getStore();
      if (!context) return original.apply(this, args);
      const start = performance.now();
      const finish = () => record(context, performance.now() - start, args);
      if (typeof args.at(-1) === 'function') {
        const callback = args.at(-1);
        args[args.length - 1] = function (...result) { finish(); return callback.apply(this, result); };
        return original.apply(this, args);
      }
      try {
        const result = original.apply(this, args);
        return result.finally(finish);
      } catch (error) { finish(); throw error; }
    };
  }
  observe(pg.Client.prototype, 'query', ({ request, transaction }, ms, args) => {
    request.queries++;
    request.queryMs += ms;
    if (!transaction) return;
    transaction.queries++;
    transaction.queryMs += ms;
    const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text ?? '';
    const kind = /pg_advisory/.test(sql) ? 'policyLock'
      : /FROM sports_management.users/.test(sql) ? 'actor'
      : /AS "assignmentId"/.test(sql) ? 'actorGrants'
      : /FROM sports_management.role_permissions/.test(sql) ? 'candidatePermissions'
      : /FROM sports_management.leagues/.test(sql) ? 'leagueContext'
      : /FROM sports_management.clubs/.test(sql) ? 'clubContext' : 'other';
    transaction.categories[kind] = (transaction.categories[kind] ?? 0) + 1;
  });
  observe(pg.Pool.prototype, 'connect', ({ request }, ms) => { request.poolWaitMs += ms; });
  observe(pg.Client.prototype, 'connect', ({ request }, ms) => { request.connectMs += ms; });
  const originalTransaction = PrismaClient.prototype._transactionWithCallback;
  PrismaClient.prototype._transactionWithCallback = async function ({ callback, options }) {
    const context = storage.getStore();
    if (!context) return originalTransaction.call(this, { callback, options });
    const start = performance.now();
    const transaction = { queries: 0, queryMs: 0, startWaitMs: 0, bodyMs: 0, totalMs: 0,
      timeoutMs: options?.timeout ?? this._engineConfig.transactionOptions.timeout,
      maxWaitMs: options?.maxWait ?? this._engineConfig.transactionOptions.maxWait, categories: {} };
    context.request.transactions.push(transaction);
    return storage.run({ ...context, transaction }, async () => {
      try {
        return await originalTransaction.call(this, { options, callback: async (tx) => {
          const bodyStart = performance.now();
          transaction.startWaitMs = bodyStart - start;
          try { return await callback(tx); }
          finally { transaction.bodyMs = performance.now() - bodyStart; }
        } });
      } finally { transaction.totalMs = performance.now() - start; }
    });
  };
}
