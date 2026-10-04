import { describe, expect, it } from 'vitest';
import { activeSnapshot } from './fixtures';
import { cacheEnvelopeSchema, canReconcile, dependencyValues, evidenceAt, projectContinuity, replayClock } from '../lib/continuity';

describe('Local continuity safety', () => {
  it('expires transport evidence at the TTL boundary without changing published history', () => {
    const state = activeSnapshot();
    const before = JSON.stringify(state);
    const now = Date.parse('2026-10-04T17:48:00+09:00');
    const projection = projectContinuity(state, now, 'offline');
    expect(projection.evidence[0].freshness_status).toBe('STALE');
    expect(projection.invalidActionIds).toEqual(['action']);
    expect(projection.networkState).toBe('OFFLINE_STALE');
    expect(JSON.stringify(state)).toBe(before);
  });
  it('never renews delayed evidence by its receipt time or claimed long expiry', () => {
    const evidence = activeSnapshot().evidence[0];
    const delayed = { ...evidence, received_at: '2026-10-04T17:55:00+09:00', expires_at: '2026-10-04T18:55:00+09:00' };
    expect(evidenceAt(delayed, Date.parse(delayed.received_at)).freshness_status).toBe('STALE');
  });
  it('future-dated evidence and invalid clocks are unknown', () => {
    const e = activeSnapshot().evidence[0];
    expect(evidenceAt(e, Date.parse(e.published_at) - 1).freshness_status).toBe('UNKNOWN');
    expect(evidenceAt(e, Number.NaN).freshness_status).toBe('UNKNOWN');
  });
  it('preserves Last Verified Plan while disabling expired plan actions', () => {
    const state = activeSnapshot();
    const result = projectContinuity(state, Date.parse(state.plans[0].expires_at), 'offline');
    expect(result.plan?.id).toBe('plan_v1');
    expect(result.planStatus).toBe('EXPIRED');
    expect(result.invalidActionIds).toEqual(['action']);
  });
  it('social reports cannot replace trusted route dependencies', () => {
    const e = activeSnapshot().evidence[0];
    const social = { ...e, id: 'sns', source_class: 'SOCIAL_MEDIA' as const, trust_status: 'UNVERIFIED' as const, claims: [{ key: 'route.status', value: 'AVAILABLE' }], published_at: '2026-10-04T17:44:00+09:00' };
    expect(dependencyValues([e, social]).get('route.status')).toBe('DISRUPTED');
  });
  it('same-time trusted contradictions remain CONFLICT', () => {
    const e = activeSnapshot().evidence[0];
    const other = { ...e, id: 'other', claims: [{ key: 'route.status', value: 'AVAILABLE' }] };
    expect(dependencyValues([e, other]).get('route.status')).toBe('CONFLICT');
    const state = activeSnapshot(); state.evidence.push(other);
    expect(projectContinuity(state, Date.parse(e.published_at), 'online').invalidActionIds).toContain('action');
  });
  it('high-risk actions fail closed even with current cached evidence', () => {
    const state = activeSnapshot(); state.plan_actions[0].risk_level = 'HIGH';
    expect(projectContinuity(state, Date.parse(state.replay.current_time), 'offline').invalidActionIds).toContain('action');
  });
  it('connectivity alone cannot restore ONLINE_VERIFIED', () => {
    const state = activeSnapshot();
    expect(canReconcile(state, state, Date.parse(state.replay.current_time))).toBe(false);
    expect(projectContinuity(state, Date.parse(state.replay.current_time), 'reconnecting').networkState).toBe('RECONNECTING');
  });
  it('reconnect requires newly received current official AND partner evidence', () => {
    const original = activeSnapshot(); const received = activeSnapshot();
    received.evidence.push({ ...original.evidence[0], id: 'new-partner' });
    const now = Date.parse(original.replay.current_time);
    expect(canReconcile(original, received, now)).toBe(false);
    received.evidence.push({ ...original.evidence[0], id: 'new-official', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL', claim_type: 'DISASTER_STATUS', claims: [{ key: 'disaster.status', value: 'ACTIVE' }] });
    expect(canReconcile(original, received, now)).toBe(true);
    expect(canReconcile(original, received, now + 900_000)).toBe(false);
  });
  it('an offline reload retains the original clock anchor and connection gate', () => {
    const envelope = cacheEnvelopeSchema.parse({ schema_version: 1, saved_at: 1000, connection: 'offline', snapshot: activeSnapshot() });
    expect(replayClock(envelope, 301000)).toBe(Date.parse(envelope.snapshot.replay.current_time) + 300_000);
    expect(envelope.connection).toBe('offline');
    expect(replayClock(envelope, 0)).toBe(Date.parse(envelope.snapshot.replay.current_time));
  });
  it('a conflicting current server projection cannot authorize cached actions', () => {
    const state = activeSnapshot();
    state.evidence_projections.push({ evidence_id: 'ev-route', freshness_status: 'CURRENT', age_seconds: 0, ttl_seconds: 300, expires_at: state.evidence[0].expires_at, conflict: true, eligible_for_claims: false, eligible_for_high_risk: false });
    const result = projectContinuity(state, Date.parse(state.replay.current_time), 'online');
    expect(result.evidence[0].conflict).toBe(true);
    expect(result.invalidActionIds).toContain('action');
  });
});
