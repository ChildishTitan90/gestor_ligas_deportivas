export function offlineSupport() {
  try {
    return process.env.NODE_ENV === "production" && window.isSecureContext &&
      typeof window.indexedDB?.open === "function" && typeof navigator.serviceWorker?.register === "function" &&
      typeof navigator.locks?.request === "function" && typeof BroadcastChannel === "function";
  } catch { return false; }
}
export async function prepareReportResources() {
  if (!offlineSupport()) throw Error("OFFLINE_NOT_SUPPORTED");
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker) throw Error("OFFLINE_WORKER_NOT_READY");
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(Error("OFFLINE_RESOURCES_INCOMPLETE")); }, 90000);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      channel.port1.close();
      if (event.data?.ok) resolve();
      else reject(Error("OFFLINE_RESOURCES_INCOMPLETE"));
    };
    worker.postMessage({ type: "PREPARE_REPORT" }, [channel.port2]);
  });
}
