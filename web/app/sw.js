// web/app/sw.js - Service Worker for Homebound App
const CACHE_NAME = 'hb-app-v6';

const PRECACHE_PATHS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './ui/scanner.js',
  './ui/keypad.js',
  './ui/thread.js',
  './lib/b64.js',
  './lib/card.js',
  './lib/vault.js',
  './lib/store.js',
  './lib/nights.js',
  './lib/party.js',
  '../shared/base.css',
  '../shared/qr.js',
  '../shared/vendor/zxing/zxing.min.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_PATHS.map(async (path) => {
          try {
            const url = new URL(path, self.location).href;
            const res = await fetch(url, { cache: 'no-cache' });
            if (res.ok) {
              await cache.put(url, res);
            }
          } catch (e) {
            // Best effort precache
          }
        })
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Non-GET requests pass through
  if (event.request.method !== 'GET') {
    return;
  }

  // Cache-first for same-origin
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(async () => {
        // Fallback for navigation requests
        if (event.request.mode === 'navigate') {
          const cache = await caches.open(CACHE_NAME);
          const fallback = (await cache.match(new URL('./index.html', self.location).href)) ||
                           (await cache.match(new URL('./', self.location).href));
          if (fallback) return fallback;
        }
        throw new Error('Offline');
      });
    })
  );
});
