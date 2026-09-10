/* sw.js — offline shell for draft day.
   Bump CACHE_VERSION on every deploy so clients pick up new assets. */
'use strict';

var CACHE_VERSION = 'v1.2.0';
var CACHE_NAME = 'hockeydraft26-' + CACHE_VERSION;

// Everything the app needs to run with no connection at all.
var PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/draft.js',
  './js/ui.js',
  './js/app.js',
  './data/players.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // addAll is all-or-nothing; add individually so one bad path cannot
      // leave the app with no offline cache at all.
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function (err) {
          console.warn('[sw] precache miss', url, err);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the shell so a hard refresh mid-draft still works.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(function (cached) {
        return cached || fetch(req);
      })
    );
    return;
  }

  // Everything else is cache-first — offline is the expected state on
  // draft day, and the asset set only changes when the SW version does.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      });
    })
  );
});
