export type VenueLoanCapture = {
  requestId: string;
  contextId: string;
  venueId: string;
  windows: { id: string; start: string; end: string }[];
  letter: File;
};

export type VenueLoanRecoveryStore = {
  read(): Promise<VenueLoanCapture | undefined>;
  add(capture: VenueLoanCapture): Promise<void>;
  remove(requestId: string): Promise<void>;
};

const storeName = "pending";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("venue-loan-submissions", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function venueLoanRecoveryStore(actorId: string): VenueLoanRecoveryStore {
  async function transaction<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore, result: (value: T) => void) => void,
  ): Promise<T> {
    const db = await openDatabase();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        let value: T;
        tx.oncomplete = () => resolve(value);
        tx.onabort = () => reject(tx.error);
        operation(tx.objectStore(storeName), result => { value = result; });
      });
    } finally {
      db.close();
    }
  }

  return {
    read: () => transaction("readonly", (store, result) => {
      const request = store.get(actorId);
      request.onsuccess = () => result(request.result);
    }),
    add: capture => transaction("readwrite", store => { store.add(capture, actorId); }),
    remove: requestId => transaction("readwrite", store => {
      const request = store.get(actorId);
      request.onsuccess = () => {
        if (request.result?.requestId === requestId) store.delete(actorId);
      };
    }),
  };
}

export async function sendVenueLoan(
  store: VenueLoanRecoveryStore,
  capture: VenueLoanCapture,
  retry: boolean,
  send: (body: FormData) => Promise<Response>,
): Promise<"confirmed" | "invalid" | "denied" | "uncertain"> {
  const { letter, windows, ...payload } = capture;
  const body = new FormData();
  body.set("letter", letter);
  body.set("payload", JSON.stringify({ ...payload, windows: windows.map(({ start, end }) => ({ start, end })) }));
  if (!retry) await store.add(capture);

  let invalid: "invalid" | "denied" | undefined;
  try {
    const response = await send(body);
    if (response.ok) {
      const receipt = await response.json();
      if (receipt?.id !== capture.requestId || !["PENDING", "APPROVED", "REJECTED"].includes(receipt.status)) {
        return "uncertain";
      }
    } else {
      if (retry || ![400, 403, 413].includes(response.status)) return "uncertain";
      invalid = response.status === 403 ? "denied" : "invalid";
    }
    await store.remove(capture.requestId);
    return invalid ?? "confirmed";
  } catch {
    return "uncertain";
  }
}
