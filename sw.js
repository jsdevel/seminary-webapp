// sw.js
const CACHE_NAME = "seminary-v5"; // bump this on deploy
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
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
  })());

  // Activate the new SW ASAP
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Take control of existing clients immediately
    await self.clients.claim();

    // Delete old cache versions so bumps actually take effect
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== CACHE_NAME)
        .map((k) => caches.delete(k))
    );
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // 1) Navigations (page loads): network-first, fallback to cached app shell
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        // Try to get the newest HTML when online
        const fresh = await fetch(req);
        // Keep the shell warm
        cache.put(APP_SHELL, fresh.clone());
        return fresh;
      } catch {
        // Important for query params like ?view=display
        const cachedShell =
          (await cache.match(APP_SHELL, { ignoreSearch: true })) ||
          (await cache.match(APP_SHELL));

        return cachedShell || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  // 2) Scripts / styles: network-first so changes show up without hard refresh
  if (req.destination === "script" || req.destination === "style") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        // Ask the browser to not serve from its own HTTP cache
        const fresh = await fetch(req, { cache: "no-store" });
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await cache.match(req);
        return cached || Response.error();
      }
    })());
    return;
  }

  // 3) Everything else: cache-first (fast + offline friendly)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    const cached = await cache.match(req);
    if (cached) return cached;

    const fresh = await fetch(req);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});
