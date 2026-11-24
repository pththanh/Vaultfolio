// Caches build assets and icons only. Pages, server actions and exports hold
// financial data: they always go to the network and are never stored.
const CACHE = "vaultfolio-static-v1";
const OFFLINE = "/offline.html";
const MAX_ENTRIES = 150;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(new Request(OFFLINE, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const isStatic = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/"));

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    // File names are hashed per build, so old ones pile up: drop the oldest.
    const keys = (await cache.keys()).filter(
      (k) => new URL(k.url).pathname !== OFFLINE,
    );
    await Promise.all(
      keys
        .slice(0, Math.max(0, keys.length - MAX_ENTRIES))
        .map((k) => cache.delete(k)),
    );
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (isStatic(new URL(request.url))) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
  }
});
