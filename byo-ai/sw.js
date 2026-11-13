const CACHE = "bhc-byo-ai-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./css/app.css",
  "./manifest.webmanifest",
  "./schema/liftplan-0.1.schema.json",
  "./samples/full-body-2-week.json",
  "./src/format.mjs",
  "./src/schema-validate.mjs",
  "./src/progression.mjs",
  "./src/session.mjs",
  "./src/liftplan.mjs",
  "./src/prompt.mjs",
  "./src/store.mjs",
  "./icons/icon-180.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))),
  );
});
