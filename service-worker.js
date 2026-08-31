// Service worker de la app de Emma.
// Guarda en caché el "cascarón" de la app (HTML, manifest, íconos) para que
// abra al instante incluso sin conexión. Los pedidos a Apps Script (guardar
// o leer datos del Sheet) siempre van directo a la red, sin cachear.

var CACHE_NAME = 'emma-tracker-v1';
var ARCHIVOS_APP = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ARCHIVOS_APP);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (nombres) {
      return Promise.all(
        nombres
          .filter(function (nombre) { return nombre !== CACHE_NAME; })
          .map(function (nombre) { return caches.delete(nombre); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // Solo intercepta pedidos del propio sitio (el cascarón de la app).
  // Todo lo que va a script.google.com pasa directo a la red.
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (cacheada) {
      var actualizarDesdeRed = fetch(event.request)
        .then(function (respuesta) {
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, respuesta.clone());
          });
          return respuesta;
        })
        .catch(function () {
          return cacheada;
        });
      return cacheada || actualizarDesdeRed;
    })
  );
});
