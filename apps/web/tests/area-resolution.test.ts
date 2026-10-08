import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { areaPath, queryAreaCells, resolveAreaFeatures, validAreaFix, type AreaEntry, type AreaFeature, type AreaFix } from '../lib/area-geometry';

const assets = resolve(__dirname, '../public/areas');
const catalog: AreaEntry[] = JSON.parse(readFileSync(resolve(assets, 'catalog.json'), 'utf8'));
function official(fix: AreaFix) {
  const manifest = JSON.parse(readFileSync(resolve(assets, 'manifest.json'), 'utf8'));
  const descriptors = new Map<string, { asset: string; bytes: number; sha256: string; decoded_bytes: number }>();
  for (const cell of queryAreaCells(fix)) for (const shard of manifest.cells[cell] ?? []) descriptors.set(shard.asset, shard);
  const features: AreaFeature[] = [];
  for (const shard of descriptors.values()) {
    const bytes = readFileSync(resolve(assets, shard.asset.replace('/areas/', '')));
    expect(bytes.byteLength).toBe(shard.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(shard.sha256);
    const decoded = gunzipSync(bytes); expect(decoded.byteLength).toBe(shard.decoded_bytes);
    features.push(...JSON.parse(decoded.toString('utf8')));
  }
  return resolveAreaFeatures(fix, features, catalog);
}

describe('official nationwide N03 area resolver', () => {
  it('has every prefecture, canonical municipality ancestry and identical backend registry', () => {
    expect(catalog.filter(area => /^JP-\d{2}$/.test(area.id))).toHaveLength(47);
    expect(catalog.length).toBeGreaterThan(1700);
    expect(new Set(catalog.map(area => area.id)).size).toBe(catalog.length);
    for (const area of catalog) expect(areaPath(area.id, catalog).at(-1)).toBe('JP');
    const backend = resolve(__dirname, '../../../packages/contracts/seventytwoh_contracts/data/japan-areas.json');
    expect(readFileSync(backend, 'utf8')).toBe(readFileSync(resolve(assets, 'catalog.json'), 'utf8'));
  });
  it.each([
    ['Tokyo Shibuya', 35.6598, 139.7005, 'JP-13', 'JP-MUNI-13113'],
    ['Osaka Kita', 34.702485, 135.495951, 'JP-27', 'JP-MUNI-27127'],
    ['Sapporo', 43.062013, 141.35441, 'JP-01', 'JP-MUNI-01101'],
    ['Naha', 26.212381, 127.6792, 'JP-47', 'JP-MUNI-47201'],
    ['Ishigaki island', 24.344788, 124.157143, 'JP-47', 'JP-MUNI-47207'],
  ])('resolves original geometry for %s', (_name, latitude, longitude, pref, municipality) => {
    const result = official({ latitude: Number(latitude), longitude: Number(longitude), accuracy_m: 15 });
    expect(result.status).toBe('RESOLVED'); expect(result.area_ids).toEqual([municipality, pref, 'JP']);
  });
  it('demotes a municipality with provisional borders', () => {
    const result = official({ latitude: 35.6812, longitude: 139.7671, accuracy_m: 15 });
    expect(result.status).toBe('AMBIGUOUS'); expect(result.area_ids).toEqual(['JP-13', 'JP']);
  });
  it('does not assume Japan outside supported geometry', () => {
    expect(official({ latitude: 22.3193, longitude: 114.1694, accuracy_m: 20 }).area_ids).toEqual([]);
    expect(official({ latitude: 0, longitude: 0, accuracy_m: 10 }).status).toBe('OUTSIDE');
  });
});

const smallCatalog: AreaEntry[] = [{ id: 'JP', label: 'Japan', parent_id: null },
  { id: 'JP-13', label: 'Tokyo', parent_id: 'JP' }, { id: 'JP-27', label: 'Osaka', parent_id: 'JP' },
  { id: 'JP-MUNI-13113', label: 'A', parent_id: 'JP-13' }, { id: 'JP-MUNI-13114', label: 'B', parent_id: 'JP-13' }];
function rectangle(id: number, area_id: string, west: number, east: number): AreaFeature {
  return { id, area_id, prefecture_id: 'JP-13', bbox: [west, 35, east, 36], uncertain_scope: null,
    rings: [[[west, 35], [east, 35], [east, 36], [west, 36], [west, 35]]] };
}
describe('bounded geometry uncertainty', () => {
  it('uses all accuracy-radius candidates and only their common ancestors', () => {
    const result = resolveAreaFeatures({ latitude: 35.5, longitude: 139.5, accuracy_m: 100 },
      [rectangle(1, 'JP-MUNI-13113', 139, 139.5), rectangle(2, 'JP-MUNI-13114', 139.5, 140)], smallCatalog);
    expect(result.area_ids).toEqual(['JP-13', 'JP']); expect(result.status).toBe('AMBIGUOUS');
  });
  it('does not resolve holes as land or invent missing geometry', () => {
    const feature = rectangle(1, 'JP-MUNI-13113', 139, 140);
    feature.rings.push([[139.4, 35.4], [139.6, 35.4], [139.6, 35.6], [139.4, 35.6], [139.4, 35.4]]);
    expect(resolveAreaFeatures({ latitude: 35.5, longitude: 139.5, accuracy_m: 20 }, [feature], smallCatalog).status).toBe('OUTSIDE');
    expect(resolveAreaFeatures({ latitude: 35.5, longitude: 139.5, accuracy_m: 20 }, [], smallCatalog).area_ids).toEqual([]);
  });
  it('rejects unknown hierarchy, NaN and invalid accuracy', () => {
    expect(resolveAreaFeatures({ latitude: 35.5, longitude: 139.5, accuracy_m: 20 }, [rectangle(1, 'invented', 139, 140)], smallCatalog).status).toBe('UNAVAILABLE');
    expect(validAreaFix({ latitude: NaN, longitude: 139, accuracy_m: 20 })).toBe(false);
    expect(validAreaFix({ latitude: 35, longitude: 139, accuracy_m: -1 })).toBe(false);
  });
});
