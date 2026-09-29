const CACHE_NAME = 'last-ing-cache-v6';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
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

async function putInCache(request, networkResponse) {
  if (networkResponse?.status === 200 && networkResponse?.type === 'basic') {
    const responseToCache = networkResponse.clone();
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, responseToCache);
    } catch {
      // Ignore cache errors
    }
  }
}

async function fetchAndCache(request) {
  const networkResponse = await fetch(request);
  void putInCache(request, networkResponse);
  return networkResponse;
}

async function handleNetworkFirst(request) {
  try {
    return await fetchAndCache(request);
  } catch {
    return caches.match(request);
  }
}

async function handleStaleWhileRevalidate(request) {
  const cachedResponse = await caches.match(request);
  const fetchPromise = fetchAndCache(request);

  if (cachedResponse) {
    fetchPromise.catch(() => {});
    return cachedResponse;
  }

  return fetchPromise;
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
    event.respondWith(handleNetworkFirst(event.request));
    return;
  }

  event.respondWith(handleStaleWhileRevalidate(event.request));
});
