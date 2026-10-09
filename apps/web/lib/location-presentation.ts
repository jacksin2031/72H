import type { Location } from './contracts';
import { LOCATION_AGING_MS, LOCATION_CURRENT_MS, type LocationFreshness } from './location-freshness';
import type { DeviceLocation } from './use-device-location';

export type LocationProvenance = 'GPS' | 'USER_SELECTED' | 'LAST_KNOWN' | 'UNKNOWN';
export type ObservedLocationFreshness = LocationFreshness | 'UNKNOWN';

export type LocationPresentation = {
  area: {
    label: string;
    source: LocationProvenance;
    observedAt: string | null;
    freshness: ObservedLocationFreshness;
    accuracyM: number | null;
  };
  devicePoint: null | {
    source: 'GPS' | 'LAST_KNOWN';
    observedAt: string;
    freshness: LocationFreshness;
    accuracyM: number;
  };
};

export function observedLocationFreshness(observedAt: string | null | undefined, now: number): ObservedLocationFreshness {
  const capturedAt = Date.parse(observedAt ?? '');
  if (!Number.isFinite(capturedAt) || !Number.isFinite(now) || now <= 0 || capturedAt > now) return 'UNKNOWN';
  const age = now - capturedAt;
  if (age <= LOCATION_CURRENT_MS) return 'CURRENT';
  if (age <= LOCATION_AGING_MS) return 'AGING';
  return 'STALE';
}

/** Keep the session's confirmed information area separate from the device-only GPS point. */
export function projectLocationPresentation(area: Location, device: Pick<DeviceLocation, 'position' | 'freshness'>, now: number): LocationPresentation {
  const observedAt = area.observed_at ?? null;
  const sameObservation = area.source === 'GPS' && !!device.position && !!observedAt
    && Date.parse(observedAt) === device.position.captured_at;
  const point = device.position;
  const devicePoint = point ? {
    source: device.freshness === 'CURRENT' ? 'GPS' as const : 'LAST_KNOWN' as const,
    observedAt: new Date(point.captured_at).toISOString(),
    freshness: device.freshness,
    accuracyM: point.accuracy_m,
  } : null;

  return {
    area: {
      label: area.label,
      source: area.source ?? 'UNKNOWN',
      observedAt,
      freshness: observedLocationFreshness(observedAt, now),
      accuracyM: sameObservation ? point!.accuracy_m : null,
    },
    devicePoint,
  };
}
