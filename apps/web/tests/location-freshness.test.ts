import { describe, expect, it } from 'vitest';
import { approveCurrentDevicePosition, isGpsObservationCurrent, locationFreshness, nextLocationFreshnessDeadline, LOCATION_AREA_REFRESH_MS, shouldRefreshGpsAreaTimestamp, shouldShowDeviceMapMarker } from '../lib/location-freshness';
import { LOCATION_RETENTION_MS } from '../lib/last-known-location';

const now = 1_800_000_000_000;
const point = { latitude: 35.68, longitude: 139.76, accuracy_m: 18, captured_at: now, source: 'BROWSER_GEOLOCATION' as const };

describe('device location freshness', () => {
  it('shows a device map marker only for a current fix', () => {
    expect(shouldShowDeviceMapMarker('CURRENT')).toBe(true);
    for (const freshness of ['AGING', 'STALE', 'LAST_KNOWN', 'UNAVAILABLE'] as const) {
      expect(shouldShowDeviceMapMarker(freshness)).toBe(false);
    }
  });
  it('accepts a GPS observation at exactly two minutes and rejects old, future, or invalid times', () => {
    const observedAt = new Date(now).toISOString();
    expect(isGpsObservationCurrent(observedAt, now + 120_000)).toBe(true);
    expect(isGpsObservationCurrent(observedAt, now + 120_001)).toBe(false);
    expect(isGpsObservationCurrent(observedAt, now - 1)).toBe(false);
    expect(isGpsObservationCurrent('invalid', now)).toBe(false);
  });
  it('separates current, aging, stale, last-known and unavailable states', () => {
    expect(locationFreshness(point, false, now + 120_000)).toBe('CURRENT');
    expect(locationFreshness(point, false, now + 120_001)).toBe('AGING');
    expect(locationFreshness(point, false, now + 600_001)).toBe('STALE');
    expect(locationFreshness(point, true, now + 60_000)).toBe('LAST_KNOWN');
    expect(locationFreshness(point, false, now - 1)).toBe('UNAVAILABLE');
    expect(nextLocationFreshnessDeadline(point, false, now)).toBe(now + 120_001);
    expect(nextLocationFreshnessDeadline(point, true, now)).toBe(now + LOCATION_RETENTION_MS + 1);
    expect(nextLocationFreshnessDeadline({ ...point, captured_at: now - LOCATION_RETENTION_MS }, false, now)).toBe(now + 1);
  });

  it('accepts only valid, recent, strictly newer callbacks', () => {
    expect(approveCurrentDevicePosition(point, null, now)).toEqual(point);
    expect(approveCurrentDevicePosition({ ...point, captured_at: now + 1 }, null, now)).toBeNull();
    expect(approveCurrentDevicePosition({ ...point, captured_at: now - 120_001 }, null, now)).toBeNull();
    expect(approveCurrentDevicePosition(point, point, now)).toBeNull();
    expect(approveCurrentDevicePosition({ ...point, captured_at: now - 1 }, point, now)).toBeNull();
  });

  it('refreshes only unchanged GPS area timestamps after the bounded interval', () => {
    const observedAt = new Date(now).toISOString();
    const base = { source: 'GPS' as const, areaUnchanged: true, observedAt };
    expect(shouldRefreshGpsAreaTimestamp({ ...base, fixCapturedAt: now + LOCATION_AREA_REFRESH_MS - 1 })).toBe(false);
    expect(shouldRefreshGpsAreaTimestamp({ ...base, fixCapturedAt: now + LOCATION_AREA_REFRESH_MS })).toBe(true);
    expect(shouldRefreshGpsAreaTimestamp({ ...base, source: 'USER_SELECTED', fixCapturedAt: now + LOCATION_AREA_REFRESH_MS })).toBe(false);
    expect(shouldRefreshGpsAreaTimestamp({ ...base, areaUnchanged: false, fixCapturedAt: now + LOCATION_AREA_REFRESH_MS })).toBe(false);
    expect(shouldRefreshGpsAreaTimestamp({ ...base, observedAt: null, fixCapturedAt: now + LOCATION_AREA_REFRESH_MS })).toBe(false);
  });
});
