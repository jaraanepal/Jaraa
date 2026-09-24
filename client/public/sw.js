/* Jaraa service worker — hand-written.
 * - App shell: cache-first (versioned CACHE_NAME; stale cache purged on activate).
 * - /api/*: network-first with a short timeout, falling back to cache, then to
 *   a JSON error so the UI can show its friendly offline card.
 * - Everything else (navigations): offline fallback to /offline.html.
 */
const CACHE_NAME = "jaraa-shell-v1";
const API_CACHE = "jaraa-api-v1";
const APP_SHELL = ["/", "/index.html", "/offline.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME && k !== API_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

function networkFirstApi(request) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(API_CACHE).then((cache) => cache.put(request, copy));
        }
        resolve(res);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  }).then((res) => {
    if (res) return res;
    return caches.match(request).then(
      (cached) =>
        cached ||
        new Response(JSON.stringify({ code: "offline", message: "offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    );
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isApi(url)) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html")),
    );
    return;
  }

  // App shell assets: cache-first, then network, then cache the network copy.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
