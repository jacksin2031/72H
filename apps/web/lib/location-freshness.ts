import { LOCATION_RETENTION_MS, newerDevicePosition, validDevicePosition, type DevicePosition } from './last-known-location';

export const LOCATION_CURRENT_MS = 2 * 60_000;
export const LOCATION_AGING_MS = 10 * 60_000;
export const LOCATION_FIX_TIMEOUT_MS = 8_000;
export const CONSERVE_LOCATION_REFRESH_MS = 30_000;
export const LOCATION_AREA_REFRESH_MS = 90_000;

export type LocationFreshness = 'CURRENT' | 'AGING' | 'STALE' | 'LAST_KNOWN' | 'UNAVAILABLE';

/** A map marker denotes a current fix only; saved, aging, and stale points stay text-only. */
export function shouldShowDeviceMapMarker(freshness: LocationFreshness): boolean {
  return freshness === 'CURRENT';
}

export function isGpsObservationCurrent(observedAt: string, now: number): boolean {
  const capturedAt = Date.parse(observedAt);
  return Number.isFinite(now) && Number.isFinite(capturedAt) && capturedAt <= now
    && now - capturedAt <= LOCATION_CURRENT_MS;
}

/** A restored point is always last known, even when its timestamp is recent. */
export function locationFreshness(position: DevicePosition | null, restored: boolean, now: number): LocationFreshness {
  if (!position || !validDevicePosition(position, now)) return 'UNAVAILABLE';
  if (restored) return 'LAST_KNOWN';
  const age = now - position.captured_at;
  if (age < 0) return 'UNAVAILABLE';
  if (age <= LOCATION_CURRENT_MS) return 'CURRENT';
  if (age <= LOCATION_AGING_MS) return 'AGING';
  return 'STALE';
}

/** A new browser fix can be accepted as current only if it is valid and no older than two minutes. */
export function approveCurrentDevicePosition(input: unknown, previous: DevicePosition | null, now: number): DevicePosition | null {
  const approved = newerDevicePosition(input, previous, now);
  if (!approved || now - approved.captured_at > LOCATION_CURRENT_MS) return null;
  return approved;
}

export function shouldRefreshGpsAreaTimestamp(input: {
  source: 'GPS' | 'USER_SELECTED' | null | undefined;
  areaUnchanged: boolean;
  observedAt: string | null | undefined;
  fixCapturedAt: number;
}): boolean {
  const observedAt = Date.parse(input.observedAt ?? '');
  return input.source === 'GPS' && input.areaUnchanged && Number.isFinite(observedAt)
    && input.fixCapturedAt > observedAt && input.fixCapturedAt - observedAt >= LOCATION_AREA_REFRESH_MS;
}

export function nextLocationFreshnessDeadline(position: DevicePosition | null, restored: boolean, now: number): number | null {
  if (!position || locationFreshness(position, restored, now) === 'UNAVAILABLE') return null;
  if (restored) return position.captured_at + LOCATION_RETENTION_MS + 1 > now ? position.captured_at + LOCATION_RETENTION_MS + 1 : null;
  const deadlines = [position.captured_at + LOCATION_CURRENT_MS + 1, position.captured_at + LOCATION_AGING_MS + 1,
    position.captured_at + LOCATION_RETENTION_MS + 1];
  return deadlines.find(deadline => deadline > now) ?? null;
}
