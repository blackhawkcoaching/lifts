// Lifts: caches the app shell only. Never touches Apps Script (data) requests.
// HTML is always revalidated. fetch() inside a worker follows GitHub Pages'
// Cache-Control: max-age=600, which kept a home-screen phone on the previous
// index.html (the one that opened today's date and never caught up).
var CACHE = 'lifts-shell-v4';
var SHELL = ['./', 'index.html', 'plan.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }).then(function () {
    return self.clients.matchAll({ type: 'window' }).then(function (cs) {
      return Promise.all(cs.map(function (c) {
        if (!c.navigate || !c.url) return null;
        return c.navigate(c.url).catch(function () { return null; });
      }));
    });
  }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/\/sw\.js$/.test(url.pathname)) return; // the browser must see worker updates itself
  var shellDoc = req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname);
  var net = shellDoc
    ? fetch(req.url, { cache: 'reload', credentials: 'same-origin', redirect: 'follow' })
    : fetch(req);
  e.respondWith(net.then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match('./') || caches.match('index.html'); });
  }));
});
