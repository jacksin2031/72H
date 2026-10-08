import { resolveAreaFeatures, queryAreaCells, unavailableArea, validAreaFix } from './area-geometry.mjs';

const MANIFEST_SHA = '__AREA_MANIFEST_SHA__';
const CACHE_NAME = '72h-area-n03-2026-v1';
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_JSON_BYTES = 8_000_000;
let metadata;
async function hash(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join(''); }
async function verifiedBytes(path, sha, expectedBytes, cacheable = true) {
  let cache;
  try { cache = await caches.open(CACHE_NAME); } catch { /* No persistence is required for a foreground lookup. */ }
  let response = cacheable && cache ? await cache.match(path) : null;
  if (!response) response = await fetch(path, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response?.ok) throw new Error('Area data unavailable');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== expectedBytes || bytes.byteLength > MAX_JSON_BYTES || await hash(bytes) !== sha) {
    if (cache) await cache.delete(path);
    throw new Error('Invalid area asset');
  }
  if (cacheable && cache) {
    try {
      const keys = await cache.keys();
      let total = 0;
      for (const key of keys) total += Number((await cache.match(key))?.headers.get('Content-Length') || 0);
      for (const key of keys) {
        if (total + bytes.byteLength <= MAX_CACHE_BYTES) break;
        const saved = await cache.match(key); total -= Number(saved?.headers.get('Content-Length') || 0); await cache.delete(key);
      }
      await cache.put(path, new Response(bytes, { headers: { 'Content-Length': String(bytes.byteLength) } }));
    } catch { /* Quota/disabled storage leaves the current verified bytes usable. */ }
  }
  return bytes;
}
async function loadMetadata() {
  const response = await fetch('/areas/manifest.json', { credentials: 'omit', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('No area manifest');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 4_000_000 || await hash(bytes) !== MANIFEST_SHA) throw new Error('Invalid area manifest');
  const manifest = JSON.parse(new TextDecoder().decode(bytes));
  if (manifest.version !== 1 || manifest.dataset !== 'N03-20260101' || manifest.grid_degrees !== 0.25 || !manifest.cells) throw new Error('Unsupported area manifest');
  const catalog = JSON.parse(new TextDecoder().decode(await verifiedBytes('/areas/catalog.json', manifest.catalog_sha256, manifest.catalog_bytes, false)));
  if (!Array.isArray(catalog) || catalog.length > 10000 || new Set(catalog.map(item => item.id)).size !== catalog.length) throw new Error('Invalid catalog');
  return { manifest, catalog };
}
function validFeature(feature, known) {
  return feature && Number.isInteger(feature.id) && known.has(feature.area_id) && known.has(feature.prefecture_id)
    && (feature.uncertain_scope === null || known.has(feature.uncertain_scope))
    && Array.isArray(feature.bbox) && feature.bbox.length === 4 && feature.bbox.every(Number.isFinite)
    && Array.isArray(feature.rings) && feature.rings.length > 0
    && feature.rings.every(ring => Array.isArray(ring) && ring.length >= 4 && ring.every(point => Array.isArray(point)
      && point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90));
}
async function resolve(fix) {
  if (!validAreaFix(fix) || !globalThis.DecompressionStream) return unavailableArea();
  metadata ||= loadMetadata().catch(error => { metadata = undefined; throw error; });
  const { manifest, catalog } = await metadata;
  const descriptors = new Map();
  for (const cell of queryAreaCells(fix)) {
    for (const descriptor of manifest.cells[cell] || []) descriptors.set(descriptor.asset, descriptor);
  }
  if (!descriptors.size) return { area_ids: [], label: '', status: 'OUTSIDE' };
  // Large inaccurate fixes fail closed rather than fetch unbounded country geometry.
  if (descriptors.size > 48) return unavailableArea();
  if ([...descriptors.values()].reduce((sum, item) => sum + Number(item.decoded_bytes), 0) > 128 * 1024 * 1024) return unavailableArea();
  const known = new Set(catalog.map(area => area.id));
  const features = new Map();
  for (const descriptor of descriptors.values()) {
    if (!/^\/areas\/n03-2026-[a-f0-9]{64}\.json\.gz$/.test(descriptor.asset)
      || !Number.isInteger(descriptor.bytes) || descriptor.bytes <= 0 || descriptor.bytes > MAX_JSON_BYTES
      || !Number.isInteger(descriptor.decoded_bytes) || descriptor.decoded_bytes > MAX_JSON_BYTES) throw new Error('Invalid shard descriptor');
    const bytes = await verifiedBytes(descriptor.asset, descriptor.sha256, descriptor.bytes);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader(); let length = 0; const chunks = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length;
      if (length > descriptor.decoded_bytes || length > MAX_JSON_BYTES) { await reader.cancel(); throw new Error('Oversized area shard'); }
      chunks.push(value); }
    if (length !== descriptor.decoded_bytes) throw new Error('Truncated area shard');
    const items = JSON.parse(await new Blob(chunks).text());
    if (!Array.isArray(items) || items.length !== descriptor.features || !items.every(feature => validFeature(feature, known))) throw new Error('Invalid area geometry');
    for (const feature of items) if (!features.has(feature.id)) features.set(feature.id, feature);
  }
  return resolveAreaFeatures(fix, [...features.values()], catalog);
}
self.onmessage = async event => {
  try { self.postMessage(await resolve(event.data)); }
  catch { self.postMessage(unavailableArea()); }
};
