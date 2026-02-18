const CACHE_NAME = "seminary-v1";
const APP_SHELL = "./index.html";
const ASSETS = [
  "./index.html",
  "./app.css",
  "./app.js",
  "./sw.js",
  "./favicon.ico",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// IMPORTANT: handle navigation (page loads) specially
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // If user is navigating to a page (including query params), serve app shell
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      // Always try network first when online; fall back to cached index.html offline
      try {
        const fresh = await fetch(req);
        // optionally keep cache warm
        cache.put(APP_SHELL, fresh.clone());
        return fresh;
      } catch {
        // KEY: ignoreSearch lets index.html match even if URL has ?display=...
        const cachedShell =
          await cache.match(APP_SHELL) ||
          await cache.match(APP_SHELL, { ignoreSearch: true });

        return cachedShell || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  // For other assets: cache-first is fine
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
