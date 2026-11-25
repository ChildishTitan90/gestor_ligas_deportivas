import { generateScheduleSchema } from "./schemas";
import { z } from "zod";

export type PendingSchedule = z.infer<typeof generateScheduleSchema>;
const storeName = "pending";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("schedule-generation-submissions", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function scheduleRecoveryStore(actorId: string) {
  async function transaction<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore, done: (value: T) => void) => void,
  ): Promise<T> {
    const db = await openDatabase();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        let result: T;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error);
        operation(tx.objectStore(storeName), value => { result = value; });
      });
    } finally {
      db.close();
    }
  }
  return {
    read: () => transaction<PendingSchedule | undefined>("readonly", (store, done) => {
      const request = store.get(actorId);
      request.onsuccess = () => {
        if (request.result === undefined) { done(undefined); return; }
        const parsed = generateScheduleSchema.safeParse(request.result);
        if (!parsed.success) { request.transaction?.abort(); return; }
        done(parsed.data);
      };
    }),
    add: (payload: PendingSchedule) => transaction<void>("readwrite", store => { store.add(payload, actorId); }),
    remove: (operationId: string) => transaction<void>("readwrite", store => {
      const request = store.get(actorId);
      request.onsuccess = () => {
        if (request.result?.operationId === operationId) store.delete(actorId);
      };
    }),
  };
}
