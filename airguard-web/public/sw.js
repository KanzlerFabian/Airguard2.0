const SHELL_CACHE = 'airguard-shell-v3';
const DATA_CACHE = 'airguard-data-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/lib/chart.umd.min.js',
  '/lib/chartjs-adapter-date-fns.bundle.min.js',
  '/assets/logo.png'
];

const DATA_ENDPOINTS = new Set([
  '/data.json',
  '/data_24h.json',
  '/data_7d.json',
  '/ai/eval',
  '/api/now',
  '/api/series'
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== SHELL_CACHE && key !== DATA_CACHE) {
              return caches.delete(key);
            }
            return undefined;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (DATA_ENDPOINTS.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, DATA_CACHE));
    return;
  }

  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, SHELL_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(event, SHELL_CACHE));
});

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put('/index.html', response.clone());
    cache.put('/', response.clone());
    return response;
  } catch (error) {
    const cache = await caches.open(SHELL_CACHE);
    const cached =
      (await cache.match(request)) || (await cache.match('/index.html')) || (await cache.match('/'));
    if (cached) {
      return cached;
    }
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

function staleWhileRevalidate(event, cacheName) {
  const { request } = event;
  return (async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request, { ignoreVary: true });
    const networkPromise = fetch(request)
      .then((response) => {
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(
        networkPromise
          .then((response) => {
            if (response && response.ok) {
              cache.put(request, response.clone());
            }
          })
          .catch(() => undefined)
      );
      return cached;
    }

    const network = await networkPromise;
    if (network) {
      return network;
    }

    if (cacheName === DATA_CACHE) {
      const fallback = await cache.match(request);
      if (fallback) {
        return fallback;
      }
      return new Response(JSON.stringify({ ok: false, offline: true }), {
        headers: { 'Content-Type': 'application/json' },
        status: 503
      });
    }

    const shellFallback = await caches.match('/index.html');
    if (shellFallback) {
      return shellFallback;
    }
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  })();
}
