const CACHE_NAME = 'last-ing-cache-v4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/icons/icon.svg',
  './assets/icons/icon-maskable.svg',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cache) => cache !== CACHE_NAME)
          .map((cache) => caches.delete(cache))
      );
    })
  );
});

function putInCache(request, networkResponse) {
  if (networkResponse?.status === 200 && networkResponse?.type === 'basic') {
    const responseToCache = networkResponse.clone();
    caches.open(CACHE_NAME).then((cache) => {
      cache.put(request, responseToCache);
    });
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) {
    return;
  }

  const isNavigation = event.request.mode === 'navigate';
  const isScript = event.request.destination === 'script' || url.pathname.endsWith('.js');

  if (isNavigation || isScript) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          putInCache(event.request, networkResponse);
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        putInCache(event.request, networkResponse);
        return networkResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});
