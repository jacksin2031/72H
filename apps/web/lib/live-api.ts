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
