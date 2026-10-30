/* Offline shell.
   - Page, script, style, manifest: network first, cache as fallback — so an update you
     publish is picked up on the next online launch without bumping anything here.
   - Decoder wasm and icons: cache first — big, and they only change with a version bump. */
var CACHE = 'artikel-scanner-v2';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './xlsx.js',
  './manifest.webmanifest',
  './vendor/zxing-reader-iife.js',
  './vendor/zxing_reader.wasm',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) {
        // 'reload' skips the browser's own HTTP cache, otherwise a stale copy can
        // get pinned in here for as long as this cache version lives.
        return cache.addAll(ASSETS.map(function (url) {
          return new Request(url, { cache: 'reload' });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          return key === CACHE ? null : caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function freshFirst(request) {
  // A navigation Request cannot be re-created with new options, so use its URL there.
  var fresh = request.mode === 'navigate'
    ? fetch(request.url, { cache: 'no-store' })
    : fetch(request, { cache: 'no-store' });

  return fresh
    .then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    })
    .catch(function () {
      return caches.match(request).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    });
}

function cacheFirst(request) {
  return caches.match(request).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  var shell = request.mode === 'navigate' ||
    ['document', 'script', 'style', 'manifest'].indexOf(request.destination) !== -1;

  event.respondWith(shell ? freshFirst(request) : cacheFirst(request));
});
