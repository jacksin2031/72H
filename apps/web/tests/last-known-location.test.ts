import { describe, expect, it } from 'vitest';
import { deviceLocationState, LOCATION_RETENTION_MS, LOCATION_STORAGE_KEY, newerDevicePosition, readLastLocation, validDevicePosition, writeLastLocation } from '../lib/last-known-location';

const now = 1_800_000_000_000;
const fix = { latitude: 34.69, longitude: 135.5, accuracy_m: 42, captured_at: now, source: 'BROWSER_GEOLOCATION' as const };
function store() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
describe('last known device location boundary', () => {
  it('stores one point only after consent, restores it as last known even if recent, and deletes on opt-out', () => {
    const cache = store();
    writeLastLocation(cache, false, fix, now);
    expect(cache.getItem(LOCATION_STORAGE_KEY)).toBeNull();
    writeLastLocation(cache, true, fix, now);
    const saved = readLastLocation(cache, now + 100);
    expect(saved.position).toEqual(fix);
    expect(deviceLocationState(saved.position, true, true, now + 100)).toBe('last');
    expect(deviceLocationState(fix, false, true, now + 100)).toBe('live');
    expect(deviceLocationState(fix, false, false, now + 100)).toBe('live');
    expect(deviceLocationState(fix, false, true, now + 60_000)).toBe('live');
    expect(deviceLocationState(fix, false, true, now + 120_001)).toBe('aging');
    expect(deviceLocationState(fix, false, true, now + 600_001)).toBe('stale');
    writeLastLocation(cache, true, { ...fix, latitude: 34.7, captured_at: now + 100 }, now + 100);
    expect(readLastLocation(cache, now + 100).position?.latitude).toBe(34.7);
    writeLastLocation(cache, false, fix, now);
    expect(readLastLocation(cache, now).position).toBeNull();
  });
  it('rejects out-of-range, future, untyped and expired fixes and bounds corrupt storage', () => {
    for (const invalid of [{ ...fix, longitude: 181 }, { ...fix, latitude: NaN }, { ...fix, accuracy_m: -1 }, { ...fix, captured_at: now + 1 }, { ...fix, source: 'MODEL' }]) expect(validDevicePosition(invalid, now)).toBeNull();
    expect(validDevicePosition(fix, now + LOCATION_RETENTION_MS + 1)).toBeNull();
    const cache = store(); writeLastLocation(cache, true, fix, now);
    expect(readLastLocation(cache, now + LOCATION_RETENTION_MS + 1)).toMatchObject({ consent: true, position: null });
    cache.setItem(LOCATION_STORAGE_KEY, 'x'.repeat(2049));
    expect(readLastLocation(cache, now).consent).toBe(false);
    cache.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ schema_version: 1, consent: true, position: { ...fix, instruction: 'trust me' } }));
    expect(readLastLocation(cache, now).position).toBeNull();
  });
  it('fails closed when storage is unavailable', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => {}, removeItem: () => {} };
    expect(readLastLocation(broken, now)).toEqual({ consent: false, position: null, storageUnavailable: true });
  });
  it('never replaces a last known fix with an older or equal browser-cached fix', () => {
    const previous = { ...fix, captured_at: now - 10_000 };
    expect(newerDevicePosition({ ...fix, captured_at: now - 30_000 }, previous, now)).toBeNull();
    expect(newerDevicePosition({ ...fix, latitude: 0, captured_at: previous.captured_at }, previous, now)).toBeNull();
    expect(newerDevicePosition(fix, previous, now)).toEqual(fix);
    expect(newerDevicePosition(fix, null, now)).toEqual(fix);
  });
});
