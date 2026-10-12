/* Cache public application assets only. API/model responses never enter Cache Storage. */
const VERSION = '72h-shell-__BUILD_ID__';
// Public reference packs survive shell upgrades; the client still verifies every hash.
const HAZARDS = '72h-hazards-v1';
const isHazardPath = path => /^\/hazards\/[a-z0-9/_-]{1,140}\.(json|geojson)$/.test(path);
const SHELL = ['/', '/dashboard', '/plan', '/more', '/notifications', '/sources', '/trace', '/demo', '/map', '/icon.svg', '/manifest.webmanifest', '/maps/catalog.json', '/maps/manifest.json', '/maps/japan-land-50m.geojson', '/maps/geography-manifest.json', '/maps/tokyo-central-geography.geojson', '/maplibre/maplibre-gl-worker.mjs', '/maplibre/maplibre-gl-shared.mjs', '/areas/catalog.json', '/areas/manifest.json', '/areas/worker.mjs', '/areas/area-geometry.mjs'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch('/precache-manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Offline asset manifest unavailable');
    const assets = await response.json();
    if (!Array.isArray(assets) || assets.length > 1500 || assets.some(url => typeof url !== 'string' || !url.startsWith('/_next/static/'))) throw new Error('Invalid offline asset manifest');
    const catalogResponse = await fetch('/maps/catalog.json', { cache: 'no-store' });
    if (!catalogResponse.ok) throw new Error('Map catalog unavailable');
    const catalogText = await catalogResponse.text();
    if (catalogText.length > 32000) throw new Error('Map catalog oversized');
    const catalog = JSON.parse(catalogText);
    if (catalog.version !== 1 || !Array.isArray(catalog.packs) || catalog.packs.length > 4 || catalog.packs.some(pack => typeof pack.asset !== 'string' || !/^\/maps\/[a-z0-9][a-z0-9._-]{0,96}\.geojson$/.test(pack.asset))) throw new Error('Invalid map catalog');
    await (await caches.open(VERSION)).addAll([...SHELL, ...assets, ...catalog.packs.map(pack => pack.asset)]);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const oldKeys = (await caches.keys()).filter(key => key.startsWith('72h-shell-') && key !== VERSION);
    const hazardCache = await caches.open(HAZARDS);
    // Migrate packs downloaded by the earlier shell-scoped implementation before deleting it.
    for (const key of oldKeys) {
      const oldCache = await caches.open(key);
      for (const request of await oldCache.keys()) {
        const url = new URL(request.url);
        if (request.method !== 'GET' || url.origin !== self.location.origin || url.search
          || request.headers.has('authorization') || !isHazardPath(url.pathname)) continue;
        if (await hazardCache.match(request)) continue;
        const response = await oldCache.match(request);
        if (response?.ok) await hazardCache.put(request, response);
      }
      await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || request.headers.has('authorization')) return;
  // Do not cache RSC payloads as HTML; let a navigation fall back to full cached HTML.
  if (url.search || request.headers.get('RSC')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(VERSION).then(cache => cache.put(request, copy))); }
      return response;
    }).catch(async () => (await caches.match(url.pathname)) || (await caches.match('/dashboard')) || Response.error()));
  } else if (isHazardPath(url.pathname)) {
    event.respondWith(caches.open(HAZARDS).then(async cache => {
      const cached = await cache.match(request);
      // A new app pin must be able to obtain the new manifest / bytes. Offline
      // fallback is still validated against the caller's pin; no API is cached.
      if (cached && request.cache !== 'no-cache' && request.cache !== 'reload') return cached;
      try {
        const response = await fetch(request);
        if (response.ok) { const copy = response.clone(); event.waitUntil(cache.put(request, copy)); }
        return response.ok || !cached ? response : cached;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    }));
  } else if (url.pathname.startsWith('/_next/static/') || SHELL.includes(url.pathname)
    || /^\/maps\/[a-z0-9][a-z0-9._-]{0,96}\.geojson$/.test(url.pathname)
  ) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(VERSION).then(cache => cache.put(request, copy))); }
      return response;
    })));
  }
});
