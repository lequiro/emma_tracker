// Service worker de Emma.
// Cachea el cascarón de la app (HTML, JS/CSS con hash, íconos) para que abra
// sin conexión. Los pedidos a script.google.com siempre van a la red.

var CACHE = 'emma-tracker-v2';
var BASE = '/emma_tracker/';
var CASCARON = [BASE, BASE + 'index.html', BASE + 'manifest.json', BASE + 'icon-192.png', BASE + 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CASCARON); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ns) {
    return Promise.all(ns.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // Apps Script pasa directo

  // Navegación: red primero, cascarón cacheado como respaldo.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(function () { return caches.match(BASE + 'index.html'); }));
    return;
  }

  // Recursos: cache primero y refresco en segundo plano.
  e.respondWith(caches.match(e.request).then(function (cacheada) {
    var red = fetch(e.request).then(function (r) {
      var copia = r.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copia); });
      return r;
    }).catch(function () { return cacheada; });
    return cacheada || red;
  }));
});
