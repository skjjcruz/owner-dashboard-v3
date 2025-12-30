const CACHE_NAME = "owner-dash-v1.0.2"; // bump again so the new SW definitely activates

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./champion.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;

  // Always go to network for API calls
  if (req.url.includes("api.sleeper.app")) return;

  // Network-first for HTML/CSS/JS so updates show immediately
  const isCoreAsset =
    req.destination === "document" ||
    req.destination === "style" ||
    req.destination === "script" ||
    req.url.endsWith(".css") ||
    req.url.endsWith(".js") ||
    req.url.endsWith(".html");

  if (isCoreAsset) {
    e.respondWith(
      fetch(req)
        .then((fresh) => {
          const copy = fresh.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return fresh;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for everything else (images/icons)
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
