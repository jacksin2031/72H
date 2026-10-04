/* Cache public application assets only. API/model responses never enter Cache Storage. */
const VERSION = '72h-shell-__BUILD_ID__';
const SHELL = ['/', '/dashboard', '/plan', '/sources', '/trace', '/demo', '/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch('/precache-manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Offline asset manifest unavailable');
    const assets = await response.json();
    if (!Array.isArray(assets) || assets.length > 1500 || assets.some(url => typeof url !== 'string' || !url.startsWith('/_next/static/'))) throw new Error('Invalid offline asset manifest');
    await (await caches.open(VERSION)).addAll([...SHELL, ...assets]);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('72h-shell-') && key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()));
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
  } else if (url.pathname.startsWith('/_next/static/') || SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(VERSION).then(cache => cache.put(request, copy))); }
      return response;
    })));
  }
});
