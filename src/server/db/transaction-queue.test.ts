import assert from "node:assert/strict";
import test from "node:test";
import { serializeAdapterTransactions, serializeTransactionQueries } from "./transaction-queue";

type Transaction = Parameters<typeof serializeTransactionQueries>[0];
type Query = Parameters<Transaction["queryRaw"]>[0];
type Isolation = Parameters<Parameters<typeof serializeAdapterTransactions>[0]["startTransaction"]>[0];
const query = (sql: string): Query => ({ sql, args: [], argTypes: [] });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const events: string[] = [], gate = deferred(), started = deferred();
  const result: Awaited<ReturnType<Transaction["queryRaw"]>> = { columnNames: ["value"], columnTypes: [0], rows: [[null], [42]] };
  const failure = Object.assign(new Error("synthetic database failure"), { originalCode: "23505", originalMessage: "synthetic_unique" });
  const original: Transaction = {
    provider: "postgres", adapterName: "synthetic-pg", options: { usePhantomQuery: false },
    async queryRaw(q) {
      events.push(q.sql);
      if (q.sql === "WAIT") { started.resolve(); await gate.promise; }
      if (q.sql === "FAIL") throw failure;
      return result;
    },
    async executeRaw(q) { events.push(q.sql); return 7; },
    async commit() { events.push("release:commit"); },
    async rollback() { events.push("release:rollback"); },
    async createSavepoint(name) { await this.executeRaw(query(`SAVEPOINT ${name}`)); },
    async rollbackToSavepoint(name) { await this.executeRaw(query(`ROLLBACK TO ${name}`)); },
    async releaseSavepoint(name) { await this.executeRaw(query(`RELEASE ${name}`)); },
  };
  return { original, events, gate, started, result, failure, tx: serializeTransactionQueries(original) };
}

test("una conexión ejecuta I/O en orden y libera después del COMMIT, sin alterar resultados", async () => {
  const f = fixture();
  const first = f.tx.queryRaw(query("WAIT"));
  await f.started.promise;
  const second = f.tx.queryRaw(query("SECOND")), write = f.tx.executeRaw(query("UPDATE"));
  const commit = f.tx.executeRaw(query("COMMIT")), release = f.tx.commit();
  assert.deepEqual(f.events, ["WAIT"]);
  f.gate.resolve();
  assert.strictEqual(await first, f.result);
  assert.strictEqual(await second, f.result);
  assert.equal(await write, 7);
  await Promise.all([commit, release]);
  assert.deepEqual(f.events, ["WAIT", "SECOND", "UPDATE", "COMMIT", "release:commit"]);
  assert.strictEqual(f.tx.options, f.original.options);
});

test("el error original llega al llamador y no impide rollback ni su liberación", async () => {
  const f = fixture(), failed = f.tx.queryRaw(query("FAIL"));
  const rollback = f.tx.executeRaw(query("ROLLBACK")), release = f.tx.rollback();
  await assert.rejects(failed, error => error === f.failure);
  await Promise.all([rollback, release]);
  assert.deepEqual(f.events, ["FAIL", "ROLLBACK", "release:rollback"]);
});

test("transacciones distintas avanzan independientemente", async () => {
  const a = fixture(), b = fixture();
  const first = a.tx.queryRaw(query("WAIT")); await a.started.promise;
  await b.tx.queryRaw(query("OTHER CONNECTION"));
  assert.deepEqual(b.events, ["OTHER CONNECTION"]);
  assert.deepEqual(a.events, ["WAIT"]);
  a.gate.resolve(); await first;
});

test("savepoints conservan la conexión original y respetan la cola sin reentrar", async () => {
  const f = fixture(), first = f.tx.queryRaw(query("WAIT")); await f.started.promise;
  const save = f.tx.createSavepoint!("s1"), rollback = f.tx.rollbackToSavepoint!("s1"), release = f.tx.releaseSavepoint!("s1");
  assert.deepEqual(f.events, ["WAIT"]);
  f.gate.resolve(); await Promise.all([first, save, rollback, release]);
  assert.deepEqual(f.events, ["WAIT", "SAVEPOINT s1", "ROLLBACK TO s1", "RELEASE s1"]);
  const { createSavepoint: _create, rollbackToSavepoint: _rollback, releaseSavepoint: _release, ...noSavepoints } = f.original;
  void _create; void _rollback; void _release;
  assert.equal(serializeTransactionQueries(noSavepoints).createSavepoint, undefined);
});

test("la fábrica conserva aislamiento, errores de inicio y propiedad de conexión/dispose", async () => {
  const f = fixture(), levels: unknown[] = [], startError = new Error("synthetic start failure");
  let disposed = 0;
  const adapter = { marker: "metadata", async startTransaction(level?: Isolation) {
    assert.equal(this.marker, "metadata"); levels.push(level);
    if (levels.length > 1) throw startError;
    return f.original;
  }, async dispose() { disposed++; } };
  const wrapped = serializeAdapterTransactions(adapter);
  assert.strictEqual(wrapped, adapter);
  const tx = await wrapped.startTransaction("READ COMMITTED");
  assert.deepEqual(levels, ["READ COMMITTED"]);
  assert.equal(tx.adapterName, "synthetic-pg");
  await assert.rejects(wrapped.startTransaction(), error => error === startError);
  assert.equal(disposed, 0); await wrapped.dispose(); assert.equal(disposed, 1);
});
