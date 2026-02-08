(() => {
  "use strict";

  const CACHE = "lifeblocks-pwa-v8";
  const CORE = ["./", "index.html", "styles.css?v=17", "app.js?v=15", "favicon.svg", "manifest.webmanifest"];
  const CORE_URLS = new Set(CORE.map((p) => new URL(p, self.location).toString()));

  self.addEventListener("install", (event) => {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        await cache.addAll(CORE);
        await self.skipWaiting();
      })()
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
        await self.clients.claim();
      })()
    );
  });

  self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    if (req.mode === "navigate") {
      event.respondWith(
        (async () => {
          try {
            const res = await fetch(req);
            const cache = await caches.open(CACHE);
            cache.put("./", res.clone());
            return res;
          } catch {
            const cached = await caches.match("./");
            return cached || Response.error();
          }
        })()
      );
      return;
    }

    if (!CORE_URLS.has(url.toString())) return;

    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) {
          event.waitUntil(
            (async () => {
              try {
                const fresh = await fetch(req);
                const cache = await caches.open(CACHE);
                await cache.put(req, fresh.clone());
              } catch {}
            })()
          );
          return cached;
        }

        try {
          const res = await fetch(req);
          const cache = await caches.open(CACHE);
          await cache.put(req, res.clone());
          return res;
        } catch {
          return Response.error();
        }
      })()
    );
  });
})();
