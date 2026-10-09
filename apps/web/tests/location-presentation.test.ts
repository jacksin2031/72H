import { describe, expect, it } from 'vitest';
import type { Location } from '../lib/contracts';
import { projectLocationPresentation } from '../lib/location-presentation';
import type { DeviceLocation } from '../lib/use-device-location';

const now = Date.parse('2026-10-09T03:00:00.000Z');
const capturedAt = now - 30_000;
const position = { latitude: 35.68, longitude: 139.76, accuracy_m: 18, captured_at: capturedAt, source: 'BROWSER_GEOLOCATION' as const };
const device = (freshness: DeviceLocation['freshness']): Pick<DeviceLocation, 'position' | 'freshness'> => ({ position, freshness });
const area = (source: Location['source'], observedAt = new Date(capturedAt).toISOString()): Location => ({
  label: 'Tokyo', lat: null, lng: null, area_ids: ['JP-13', 'JP'], observed_at: observedAt, source,
});

describe('location presentation provenance', () => {
  it('shows the area source and age, and attaches GPS accuracy only to the same GPS observation', () => {
    const presentation = projectLocationPresentation(area('GPS'), device('CURRENT'), now);
    expect(presentation.area).toMatchObject({ source: 'GPS', freshness: 'CURRENT', accuracyM: 18, observedAt: new Date(capturedAt).toISOString() });
    expect(presentation.devicePoint).toMatchObject({ source: 'GPS', observedAt: new Date(capturedAt).toISOString(), accuracyM: 18 });
  });

  it('does not attach device accuracy to a selected or differently timed server area', () => {
    const selected = projectLocationPresentation(area('USER_SELECTED'), device('CURRENT'), now);
    const differentObservation = projectLocationPresentation(area('GPS', new Date(capturedAt - 1).toISOString()), device('CURRENT'), now);
    expect(selected.area).toMatchObject({ source: 'USER_SELECTED', accuracyM: null });
    expect(differentObservation.area.accuracyM).toBeNull();
  });

  it('labels a restored device point last-known and keeps stale server area timestamps stale', () => {
    const staleArea = area('GPS', new Date(now - 11 * 60_000).toISOString());
    const presentation = projectLocationPresentation(staleArea, device('LAST_KNOWN'), now);
    expect(presentation.area).toMatchObject({ source: 'GPS', freshness: 'STALE', accuracyM: null });
    expect(presentation.devicePoint).toMatchObject({ source: 'LAST_KNOWN', observedAt: new Date(capturedAt).toISOString() });
  });
});
