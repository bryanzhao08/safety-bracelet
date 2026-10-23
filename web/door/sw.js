// web/door/sw.js - Service Worker for Homebound Door Scanner
const CACHE_NAME = 'hb-door-v3';

const PRECACHE_PATHS = [
  './',
  './index.html',
  './door.css',
  './door.js',
  './offline.js',
  '../shared/base.css',
  '../shared/api.js',
  '../shared/aamva.js',
  '../shared/qr-scanner.js',
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
            console.warn('[SW] Precache failed for:', path, e);
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

  // Never intercept API requests or other origins (Google Fonts, Apps Script)
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) {
    return;
  }

  // Handle HTML navigation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cached = (await cache.match(new URL('./index.html', self.location).href)) ||
                         (await cache.match(new URL('./', self.location).href));
          if (cached) return cached;
          return new Response('Homebound Door is offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          });
        })
    );
    return;
  }

  // Static assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
