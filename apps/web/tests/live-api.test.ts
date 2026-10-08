import { describe, expect, it, vi } from 'vitest';
import { buildLiveProfileUpdate, isMissingLiveSessionError, LiveApiError, updateLiveLocation, updateLiveProfile } from '../lib/live-api';
import { movementLiveSnapshot } from './live-fixtures';

describe('live session loss handling', () => {
  it('recognizes an evicted server session separately from network failures', () => {
    expect(isMissingLiveSessionError(new LiveApiError(404))).toBe(true);
    expect(isMissingLiveSessionError(new LiveApiError(503))).toBe(false);
    expect(isMissingLiveSessionError(new TypeError('network'))).toBe(false);
  });
});

describe('live location updates', () => {
  it('posts only area IDs, source and observation time to the existing session', async () => {
    const snapshot = movementLiveSnapshot();
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(snapshot), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await updateLiveLocation(snapshot.session_id, { area_ids: ['JP-MUNI-13104', 'JP-13', 'JP'], source: 'GPS', observed_at: '2026-10-08T01:02:03.000Z' });
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0][0]).toBe(`/api/live/${snapshot.session_id}/location`);
      const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
      expect(body).toEqual({ area_ids: ['JP-MUNI-13104', 'JP-13', 'JP'], source: 'GPS', observed_at: '2026-10-08T01:02:03.000Z' });
      expect(body).not.toHaveProperty('lat'); expect(body).not.toHaveProperty('lng');
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects malformed IDs, duplicate or invalid area chains before fetch', () => {
    expect(() => updateLiveLocation('bad/id', { area_ids: ['JP'], source: 'GPS', observed_at: new Date().toISOString() })).toThrowError(LiveApiError);
    expect(() => updateLiveLocation('session', { area_ids: ['JP', 'JP'], source: 'GPS', observed_at: new Date().toISOString() })).toThrowError(LiveApiError);
    expect(() => updateLiveLocation('session', { area_ids: ['OTHER'], source: 'GPS', observed_at: new Date().toISOString() })).toThrowError(LiveApiError);
    expect(() => updateLiveLocation('session', { area_ids: ['JP'], source: 'USER_SELECTED', observed_at: 'invalid' })).toThrowError(LiveApiError);
  });
});

describe('live profile metadata updates', () => {
  it('updates the existing profile without sending or requiring current GPS', async () => {
    const snapshot = movementLiveSnapshot();
    const staleGpsProfile = { ...snapshot.profile, current_location: { ...snapshot.profile.current_location,
      source: 'GPS' as const, observed_at: '2026-10-01T01:02:03.000Z' }, accommodation_location: {
        ...snapshot.profile.accommodation_location, area_ids: ['JP-13', 'JP'],
      } };
    const update = buildLiveProfileUpdate(staleGpsProfile);
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(snapshot), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await updateLiveProfile(snapshot.session_id, update);
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0][0]).toBe(`/api/live/${snapshot.session_id}/profile`);
      const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
      expect(body).toEqual({ accommodation_location: {
        label: snapshot.profile.accommodation_location.label,
        area_ids: ['JP-13', 'JP'],
        lat: null, lng: null, source: null, observed_at: null,
      }, party_size: snapshot.profile.party_size, self_reported_safety_status: snapshot.profile.self_reported_safety_status,
      accessibility_constraints: snapshot.profile.accessibility_constraints });
      expect(body).not.toHaveProperty('current_location');
      expect(JSON.stringify(body)).not.toContain('2026-10-01T01:02:03.000Z');
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects GPS coordinates or observed GPS timestamps in metadata updates', () => {
    const update = buildLiveProfileUpdate(movementLiveSnapshot().profile);
    expect(() => updateLiveProfile('bad/id', update)).toThrowError(LiveApiError);
    expect(() => updateLiveProfile('session', { ...update, accommodation_location: { ...update.accommodation_location, lat: 35 } as never })).toThrowError(LiveApiError);
    expect(() => updateLiveProfile('session', { ...update, accommodation_location: { ...update.accommodation_location, source: 'GPS' } as never })).toThrowError(LiveApiError);
  });
});
