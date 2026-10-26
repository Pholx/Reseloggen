const CACHE = 'reselogg-v4';
const TILE_CACHE = 'tiles-v1';
const MAX_TILES = 500;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './css/lib/leaflet.css',
  './js/app.js',
  './js/storage.js',
  './js/ui.js',
  './js/nearby.js',
  './js/map.js',
  './js/lib/leaflet.js',
  './js/lib/localforage.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  'https://cdn.tailwindcss.com'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      for (const url of PRECACHE) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('Kunde inte förcacha:', url, err);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE && k !== TILE_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  if (e.request.url.includes('overpass-api.de') || e.request.url.includes('kumi.systems')) return;

  if (e.request.url.includes('basemaps.cartocdn.com')) {
    e.respondWith((async () => {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      try {
        const res = await fetch(e.request);
        if (res && (res.ok || res.type === 'opaque')) {
          const cache = await caches.open(TILE_CACHE);
          const keys = await cache.keys();
          if (keys.length >= MAX_TILES) {
            await cache.delete(keys[0]);
          }
          cache.put(e.request, res.clone());
        }
        return res;
      } catch {
        return new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) {
      fetch(e.request).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone())).catch(() => {});
        }
      }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(e.request);
      if (res && (res.ok || res.type === 'opaque')) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
      }
      return res;
    } catch {
      return new Response('Offline – öppna appen online först', { status: 503 });
    }
  })());
});