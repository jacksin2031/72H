import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inMapPack, locationCoordinates, mapCatalogSchema, mapManifestSchema, selectMapPack, verifyMapPack } from '../lib/offline-map';

const manifest = mapManifestSchema.parse(JSON.parse(readFileSync(resolve('public/maps/manifest.json'), 'utf8')));
const raw = readFileSync(resolve('public/maps/tokyo-central.geojson'));
const bytes = Uint8Array.from(raw).buffer;

describe('bounded offline geographical map asset', () => {
  it('covers configured reference points while leaving the alternate-region profile unsupported', () => {
    const catalog = mapCatalogSchema.parse(JSON.parse(readFileSync(resolve('public/maps/catalog.json'), 'utf8')));
    const configured = JSON.parse(readFileSync(resolve('../../scenarios/tokyo-earthquake-v1.json'), 'utf8')).profile_seed;
    for (const location of [configured.current_location, configured.accommodation_location, configured.current_destination]) {
      const point = locationCoordinates(location);
      expect(point).not.toBeNull();
      expect(selectMapPack(catalog.packs, point)?.id).toBe(manifest.id);
    }
    const alternate = JSON.parse(readFileSync(resolve('../../scenarios/osaka-earthquake-v1.json'), 'utf8')).profile_seed;
    expect(locationCoordinates(alternate.current_location)).not.toBeNull();
    expect(selectMapPack(catalog.packs, locationCoordinates(alternate.current_location))).toBeNull();
  });
  it('has an authentic complete licensed road extract matching its hash and count', async () => {
    const data = await verifyMapPack(manifest, bytes);
    expect(data.features.length).toBe(manifest.feature_count);
    expect(data.features.length).toBeGreaterThan(100);
    expect(manifest.license).toBe('ODbL-1.0');
    expect(inMapPack(139.7016, 35.658, manifest.bounds)).toBe(true);
    expect(inMapPack(139.7966, 35.7148, manifest.bounds)).toBe(true);
    expect(inMapPack(135.5, 34.7, manifest.bounds)).toBe(false);
    expect(inMapPack(NaN, 35, manifest.bounds)).toBe(false);
  });
  it('rejects corrupt, incomplete and externally redirected packs', async () => {
    const corrupt = Uint8Array.from(raw); corrupt[100] ^= 1;
    await expect(verifyMapPack(manifest, corrupt.buffer)).rejects.toThrow('integrity');
    await expect(verifyMapPack(manifest, bytes.slice(0, 50))).rejects.toThrow('size');
    await expect(verifyMapPack({ ...manifest, feature_count: 1 }, bytes)).rejects.toThrow('Incomplete');
    expect(mapManifestSchema.safeParse({ ...manifest, asset: 'https://example.com/map' }).success).toBe(false);
  });
  it('precaches the map pack and More route as public assets, never API responses', () => {
    const sw = readFileSync(resolve('scripts/service-worker.js'), 'utf8');
    const catalog = mapCatalogSchema.parse(JSON.parse(readFileSync(resolve('public/maps/catalog.json'), 'utf8')));
    expect(catalog.packs).toContainEqual(manifest);
    expect(sw).toContain("'/maps/catalog.json'");
    expect(sw).toContain('catalog.packs.map(pack => pack.asset)');
    expect(sw).toContain("'/maps/manifest.json'");
    expect(sw).toContain("'/more'");
    expect(sw).toContain("'/maplibre/maplibre-gl-worker.mjs'");
    expect(sw).toContain("'/maplibre/maplibre-gl-shared.mjs'");
    expect(sw).toContain("url.pathname.startsWith('/api/')");
  });
  it('selects installed packs by coordinates instead of labels or a Tokyo fallback', () => {
    const alternate = mapManifestSchema.parse({ ...manifest, id: 'region-b-v1', asset: '/maps/region-b.geojson', bounds: [135, 34, 136, 35] });
    expect(selectMapPack([manifest, alternate], [135.5, 34.7])?.id).toBe('region-b-v1');
    expect(selectMapPack([manifest], [135.5, 34.7])).toBeNull();
    expect(selectMapPack([manifest], null)).toBeNull();
    expect(locationCoordinates({ lat: 34.7, lng: 135.5 })).toEqual([135.5, 34.7]);
    expect(locationCoordinates({ lat: 34.7 })).toBeNull();
    expect(locationCoordinates({ lat: 91, lng: 135.5 })).toBeNull();
    expect(mapManifestSchema.safeParse({ ...alternate, bounds: [0, 90, 1, 91] }).success).toBe(false);
    expect(mapManifestSchema.safeParse({ ...alternate, asset: '/maps/../credentials.geojson' }).success).toBe(false);
    expect(mapCatalogSchema.safeParse({ version: 1, packs: [manifest, manifest] }).success).toBe(false);
  });
});
