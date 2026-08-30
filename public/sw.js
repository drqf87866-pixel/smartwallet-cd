// SmartWallet Service Worker
// - Cache-first für statische Assets (/assets/*, Icons, offline.html)
// - Network-first für Seiten-Navigation mit Offline-Fallback
// - Authentifizierte HTML-Antworten und /api/* werden NIEMALS gecacht
var VERSION = 'smartwallet-v1';
var ASSET_CACHE = VERSION + '-assets';

var ASSET_PATTERN = /^\/(assets\/|offline\.html$)/;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(ASSET_CACHE).then(function (cache) {
      return cache.addAll(['/offline.html']);
    }).then(function () {
      return self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key.indexOf(VERSION) !== 0; })
          .map(function (key) { return caches.delete(key); }),
      );
    }).then(function () {
      return self.clients.claim();
    }),
  );
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') return;

  // JS-Assets: network-first – die Inline-Scripts der Seiten hängen von den
  // Globals in app.js ab, daher darf app.js nie älter als das frisch
  // ausgelieferte HTML sein. Offline-Fallback: letzter Cache-Stand.
  if (/^\/assets\/.+\.js$/.test(url.pathname)) {
    event.respondWith(
      fetch(event.request).then(function (response) {
        if (response.ok) {
          caches.open(ASSET_CACHE).then(function (cache) {
            cache.put(event.request, response.clone());
          });
        }
        return response;
      }).catch(function () {
        return caches.match(event.request);
      }),
    );
    return;
  }

  // Statische Assets (CSS, Icons, offline.html): stale-while-revalidate.
  // Cached Antwort sofort, aktualisiert den Cache im Hintergrund – CSS-/Icon-
  // Änderungen erreichen Nutzer damit spätestens nach dem nächsten Reload
  // (app.css liegt unter konstanter URL, daher kein cache-first möglich).
  if (ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(function (cache) {
        return cache.match(event.request).then(function (cached) {
          var network = fetch(event.request).then(function (response) {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          });
          return cached || network;
        });
      }),
    );
    return;
  }

  // API-Aufrufe: immer Netz, kein Caching (Finanzdaten)
  if (url.pathname.indexOf('/api/') === 0) return;

  // Navigation: network-first, offline → offline.html (HTML wird nie gecacht)
  if (event.request.mode === 'navigate' ||
      (event.request.headers.get('accept') || '').indexOf('text/html') !== -1) {
    event.respondWith(
      fetch(event.request).catch(function () {
        return caches.match('/offline.html');
      }),
    );
  }
});
