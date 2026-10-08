import { liveSnapshotSchema, type Language, type LiveProfileSeed, type LiveSnapshot, type Location } from './contracts';

export class LiveApiError extends Error {
  constructor(readonly status: number, message = 'Live service unavailable') { super(message); }
}

export function isMissingLiveSessionError(error: unknown): error is LiveApiError {
  return error instanceof LiveApiError && error.status === 404;
}

async function requestSnapshot(path: string, options: RequestInit): Promise<LiveSnapshot> {
  const response = await fetch(`/api/live/${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    cache: 'no-store',
    signal: options.signal ?? AbortSignal.timeout(35_000),
  });
  if (!response.ok) throw new LiveApiError(response.status);
  const parsed = liveSnapshotSchema.safeParse(await response.json());
  if (!parsed.success) throw new LiveApiError(502, 'Live response did not match the public contract');
  return parsed.data;
}

export function startLiveSession(language: Language, profile: LiveProfileSeed) {
  return requestSnapshot('start', { method: 'POST', body: JSON.stringify({ language, profile }) });
}

export function refreshLiveSession(sessionId: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sessionId)) throw new LiveApiError(400);
  return requestSnapshot(`${encodeURIComponent(sessionId)}/refresh`, { method: 'POST', body: '{}' });
}

export function searchLiveRoute(sessionId: string, origin: Location, destinationId: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sessionId) || !/^[a-zA-Z0-9_-]{1,160}$/.test(destinationId)) throw new LiveApiError(400);
  return requestSnapshot(`${encodeURIComponent(sessionId)}/routes/search`, {
    method: 'POST', body: JSON.stringify({ origin, destination_id: destinationId }),
  });
}

export type LiveLocationUpdate = {
  area_ids: string[];
  source: 'GPS' | 'USER_SELECTED';
  observed_at: string;
};

export type LiveProfileUpdate = {
  accommodation_location: {
    label: string;
    area_ids: string[];
    lat: null;
    lng: null;
    source: 'USER_SELECTED' | null;
    observed_at: string | null;
  };
  party_size: number;
  self_reported_safety_status: LiveProfileSeed['self_reported_safety_status'];
  accessibility_constraints: string[];
};

/** Project editable metadata into a payload that cannot alter or retransmit current GPS. */
export function buildLiveProfileUpdate(input: Pick<LiveProfileSeed, 'accommodation_location' | 'party_size' | 'self_reported_safety_status' | 'accessibility_constraints'>): LiveProfileUpdate {
  return {
    accommodation_location: {
      label: input.accommodation_location.label.trim(),
      area_ids: [...input.accommodation_location.area_ids],
      lat: null,
      lng: null,
      source: input.accommodation_location.source === 'USER_SELECTED' ? 'USER_SELECTED' : null,
      observed_at: input.accommodation_location.source === 'USER_SELECTED' ? input.accommodation_location.observed_at ?? null : null,
    },
    party_size: input.party_size,
    self_reported_safety_status: input.self_reported_safety_status,
    accessibility_constraints: [...input.accessibility_constraints],
  };
}

export function updateLiveLocation(sessionId: string, update: LiveLocationUpdate) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sessionId) || !Array.isArray(update.area_ids)
    || update.area_ids.length < 1 || update.area_ids.length > 64
    || update.area_ids.some(id => typeof id !== 'string' || !/^JP(?:-\d{2}|-MUNI-\d{5})?$/.test(id))
    || new Set(update.area_ids).size !== update.area_ids.length
    || update.area_ids.at(-1) !== 'JP'
    || !['GPS', 'USER_SELECTED'].includes(update.source)
    || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(update.observed_at)
    || !Number.isFinite(Date.parse(update.observed_at))) throw new LiveApiError(400);
  return requestSnapshot(`${encodeURIComponent(sessionId)}/location`, {
    method: 'POST',
    body: JSON.stringify({ area_ids: update.area_ids, source: update.source, observed_at: update.observed_at }),
  });
}

export function updateLiveProfile(sessionId: string, update: LiveProfileUpdate) {
  const location = update.accommodation_location;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sessionId)
    || typeof location?.label !== 'string' || location.label.trim().length < 1 || location.label.trim().length > 240
    || !Array.isArray(location.area_ids) || location.area_ids.length > 64
    || location.area_ids.some(id => typeof id !== 'string' || !/^JP(?:-\d{2}|-MUNI-\d{5})?$/.test(id))
    || new Set(location.area_ids).size !== location.area_ids.length
    || (location.area_ids.length > 0 && location.area_ids.at(-1) !== 'JP')
    || location.lat !== null || location.lng !== null
    || ![null, 'USER_SELECTED'].includes(location.source)
    || (location.observed_at !== null && (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(location.observed_at)
      || !Number.isFinite(Date.parse(location.observed_at))))
    || !Number.isInteger(update.party_size) || update.party_size < 1 || update.party_size > 20
    || !['SAFE', 'UNCERTAIN', 'NEEDS_ASSISTANCE', 'UNKNOWN'].includes(update.self_reported_safety_status)
    || !Array.isArray(update.accessibility_constraints) || update.accessibility_constraints.length > 32
    || update.accessibility_constraints.some(value => typeof value !== 'string' || value.length > 240)) throw new LiveApiError(400);
  return requestSnapshot(`${encodeURIComponent(sessionId)}/profile`, {
    method: 'POST',
    body: JSON.stringify({ accommodation_location: {
      label: location.label.trim(), area_ids: location.area_ids, lat: null, lng: null,
      source: location.source, observed_at: location.observed_at,
    }, party_size: update.party_size, self_reported_safety_status: update.self_reported_safety_status,
    accessibility_constraints: update.accessibility_constraints }),
  });
}
