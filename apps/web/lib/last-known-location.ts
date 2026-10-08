import { z } from 'zod';

export const LOCATION_STORAGE_KEY = '72h-last-known-location-v1';
export const LIVE_LOCATION_MS = 2 * 60_000;
export const AGING_LOCATION_MS = 10 * 60_000;
export const LOCATION_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const devicePositionSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy_m: z.number().finite().nonnegative().max(100_000),
  captured_at: z.number().int().positive(),
  source: z.literal('BROWSER_GEOLOCATION'),
}).strict();
export type DevicePosition = z.infer<typeof devicePositionSchema>;
const recordSchema = z.object({ schema_version: z.literal(1), consent: z.literal(true), position: devicePositionSchema.nullable() }).strict();
type LocalStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function validDevicePosition(input: unknown, now: number): DevicePosition | null {
  const parsed = devicePositionSchema.safeParse(input);
  if (!Number.isFinite(now) || !parsed.success || parsed.data.captured_at > now
    || now - parsed.data.captured_at > LOCATION_RETENTION_MS) return null;
  return parsed.data;
}

export function newerDevicePosition(input: unknown, previous: DevicePosition | null, now: number): DevicePosition | null {
  const approved = validDevicePosition(input, now);
  return approved && (!previous || approved.captured_at > previous.captured_at) ? approved : null;
}

export function readLastLocation(store: LocalStore, now: number) {
  const empty = { consent: false, position: null as DevicePosition | null, storageUnavailable: false };
  try {
    const raw = store.getItem(LOCATION_STORAGE_KEY);
    if (!raw) return empty;
    if (raw.length > 2048) { store.removeItem(LOCATION_STORAGE_KEY); return empty; }
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) { store.removeItem(LOCATION_STORAGE_KEY); return empty; }
    const position = validDevicePosition(parsed.data.position, now);
    if (parsed.data.position && !position) store.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ ...parsed.data, position: null }));
    return { consent: true, position, storageUnavailable: false };
  } catch { return { ...empty, storageUnavailable: true }; }
}

export function writeLastLocation(store: LocalStore, consent: boolean, position: DevicePosition | null, now: number) {
  if (!consent) { store.removeItem(LOCATION_STORAGE_KEY); return; }
  store.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ schema_version: 1, consent: true, position: validDevicePosition(position, now) }));
}

/** A restored point never becomes LIVE merely because it was saved recently. */
export function deviceLocationState(position: DevicePosition | null, restored: boolean, _online: boolean, now: number) {
  if (!position || !validDevicePosition(position, now)) return 'unavailable' as const;
  if (restored) return 'last' as const;
  const age = now - position.captured_at;
  if (age <= LIVE_LOCATION_MS) return 'live' as const;
  if (age <= AGING_LOCATION_MS) return 'aging' as const;
  return 'stale' as const;
}
