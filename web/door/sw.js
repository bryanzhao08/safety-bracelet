// web/door/sw.js - Service Worker for Homebound Door Scanner
const CACHE_NAME = 'hb-door-v1';

const PRECACHE_URLS = [
  '/door/',
  '/door/index.html',
  '/door/door.css',
  '/door/door.js',
  '/door/offline.js',
  '/shared/base.css',
  '/shared/api.js',
  '/shared/aamva.js',
  '/shared/qr-scanner.js',
  '/shared/qr.js',
  '/shared/vendor/zxing/zxing.min.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache assets individually so one failure does not abort the whole install
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res.ok) {
              await cache.put(url, res);
            }
          } catch (e) {
            console.warn('[SW] Precache failed for:', url, e);
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

  // Never intercept or cache API requests
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Handle HTML navigation (/door, /door/, etc.)
  if (event.request.mode === 'navigate' || url.pathname === '/door' || url.pathname === '/door/') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/door/index.html', clone));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cached = (await cache.match('/door/index.html')) || (await cache.match('/door/'));
          if (cached) return cached;
          return new Response('Homebound Door is offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          });
        })
    );
    return;
  }

  // For static assets: Stale-While-Revalidate
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
