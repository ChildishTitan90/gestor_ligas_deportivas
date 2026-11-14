import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";

// Inferir el protocolo del adaptador instalado, sin mantener otra versión de sus tipos.
type PgAdapter = Awaited<ReturnType<PrismaPg["connect"]>>;
type PgTransaction = Awaited<ReturnType<PgAdapter["startTransaction"]>>;

/** Prisma puede cargar relaciones hermanas en paralelo en una sola conexión.
 * Serializar su I/O evita depender de la cola implícita advertida por pg 8.23.
 * La cola pertenece a esta transacción, nunca al pool o al proceso.
 */
export function serializeTransactionQueries(transaction: PgTransaction): PgTransaction {
  let tail = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    // Un error no impide ejecutar el ROLLBACK posterior. El llamador recibe
    // el rechazo original, con su SQLSTATE/DriverAdapterError intacto.
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  return {
    provider: transaction.provider,
    adapterName: transaction.adapterName,
    options: transaction.options,
    queryRaw: query => enqueue(() => transaction.queryRaw(query)),
    executeRaw: query => enqueue(() => transaction.executeRaw(query)),
    // Estos hooks solo delegan limpieza/liberación: Prisma envía el SQL de
    // COMMIT/ROLLBACK por executeRaw. No enviar otro comando ni liberar antes.
    commit: () => enqueue(() => transaction.commit()),
    rollback: () => enqueue(() => transaction.rollback()),
    ...(transaction.createSavepoint ? { createSavepoint: (name: string) => enqueue(() => transaction.createSavepoint!(name)) } : {}),
    ...(transaction.rollbackToSavepoint ? { rollbackToSavepoint: (name: string) => enqueue(() => transaction.rollbackToSavepoint!(name)) } : {}),
    ...(transaction.releaseSavepoint ? { releaseSavepoint: (name: string) => enqueue(() => transaction.releaseSavepoint!(name)) } : {}),
  };
}

/** Conservar el adaptador oficial, sus metadatos, TLS y propiedad del pool. */
export function serializeAdapterTransactions<T extends Pick<PgAdapter, "startTransaction">>(adapter: T): T {
  const start = adapter.startTransaction.bind(adapter);
  adapter.startTransaction = async isolation => serializeTransactionQueries(await start(isolation));
  return adapter;
}

export class SerialPrismaPg extends PrismaPg {
  override async connect() {
    return serializeAdapterTransactions(await super.connect());
  }
  override async connectToShadowDb() {
    return serializeAdapterTransactions(await super.connectToShadowDb());
  }
}
