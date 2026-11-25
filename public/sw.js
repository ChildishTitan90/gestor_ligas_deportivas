/* Only public application resources belong here. Private reports live in IndexedDB. */
const CACHE = "match-report-resources-v1";
const SHELL = "/offline/report";
self.addEventListener("install", event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });

async function prepare() {
  const cache = await caches.open(CACHE);
  const response = await fetch(SHELL, { cache: "reload", credentials: "omit" });
  if (!response.ok || response.headers.get("X-Report-Offline-Build") !== "production") throw Error("PRODUCTION_BUILD_REQUIRED");
  const html = await response.clone().text();
  const resources = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = new URL(match[1].replaceAll("&amp;", "&"), self.location.origin);
    if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) resources.add(url.href);
  }
  if (!resources.size) throw Error("RESOURCES_INCOMPLETE");
  for (const resource of resources) {
    const asset = await fetch(resource, { cache: "reload", credentials: "omit" });
    if (!asset.ok) throw Error("RESOURCE_INCOMPLETE");
    if (new URL(resource).pathname.endsWith(".css")) {
      for (const match of (await asset.clone().text()).matchAll(/url\(["']?([^)"']+)["']?\)/g)) {
        const font = new URL(match[1], resource);
        if (font.origin === self.location.origin && font.pathname.startsWith("/_next/static/")) {
          const content = await fetch(font, { credentials: "omit" });
          if (!content.ok) throw Error("FONT_INCOMPLETE");
          await cache.put(font, content);
        }
      }
    }
    await cache.put(resource, asset);
  }
  // Publish the shell last. A partial download never enables offline navigation.
  await cache.put(SHELL, response);
}
self.addEventListener("message", event => {
  if (event.data?.type !== "PREPARE_REPORT") return;
  event.waitUntil(prepare().then(() => event.ports[0]?.postMessage({ ok: true })).catch(() => event.ports[0]?.postMessage({ ok: false })));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== "GET") return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(request)) || fetch(request)));
    return;
  }
  if (request.mode !== "navigate" || !(url.pathname === SHELL || url.pathname === "/matches" || /^\/matches\/[^/]+\/report$/.test(url.pathname))) return;
  event.respondWith((async () => {
    try { return await fetch(request); }
    catch {
      const shell = await (await caches.open(CACHE)).match(SHELL);
      if (!shell) return new Response("Preparación offline incompleta. Recupera la conexión.", { status: 503, headers: { "Content-Type": "text/plain;charset=utf-8" } });
      if (url.pathname !== SHELL) {
        const match = url.pathname.match(/^\/matches\/([^/]+)\/report$/)?.[1];
        return Response.redirect(new URL(SHELL + (match ? "?match=" + encodeURIComponent(match) : ""), url.origin).href);
      }
      return shell;
    }
  })());
});
