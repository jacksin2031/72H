import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapGeographyManifestSchema, mapGeographySchema, verifyMapGeography } from '../lib/map-geography';

const manifest = mapGeographyManifestSchema.parse(JSON.parse(readFileSync(resolve('public/maps/geography-manifest.json'), 'utf8')));
const raw = readFileSync(resolve('public' + manifest.asset));
const bytes = Uint8Array.from(raw).buffer;

describe('offline land and coastline geography', () => {
  it('verifies the shipped official asset and precaches it for offline rendering', async () => {
    const data = await verifyMapGeography(manifest, bytes);
    expect(data.features.map(feature => feature.properties.kind)).toEqual(['land', 'coastline']);
    const sw = readFileSync(resolve('scripts/service-worker.js'), 'utf8');
    expect(sw).toContain(manifest.asset);
    expect(sw).toContain('/maps/geography-manifest.json');
  });
  it('rejects corrupted or truncated geographic data and remote asset paths', async () => {
    const corrupt = Uint8Array.from(raw); corrupt[100] ^= 1;
    await expect(verifyMapGeography(manifest, corrupt.buffer)).rejects.toThrow('integrity');
    await expect(verifyMapGeography(manifest, bytes.slice(0, 20))).rejects.toThrow('size');
    expect(mapGeographyManifestSchema.safeParse({ ...manifest, asset: 'https://example.com/geo.json' }).success).toBe(false);
  });
  it('rejects out-of-extent geometry instead of inventing map coverage', () => {
    const data = JSON.parse(raw.toString('utf8'));
    const coast = data.features.find((feature: { properties: { kind: string } }) => feature.properties.kind === 'coastline');
    coast.geometry.coordinates[0][0] = [135, 34];
    expect(mapGeographySchema.safeParse(data).success).toBe(false);
  });
});
