import { describe, expect, it } from 'vitest';
import { activeSnapshot } from './fixtures';
import { deriveSeverity, deriveNotifications } from '../lib/vnext';
import { profileAreaIds, evidenceMatchesProfile } from '../lib/area-scoping';
import { canReconcile, projectContinuity } from '../lib/continuity';
import type { Evidence, Snapshot } from '../lib/contracts';

const at = '2026-10-04T17:43:00+09:00';
const now = Date.parse(at);
function region(): Snapshot {
  const state = activeSnapshot();
  state.area_catalog = [{ id: 'country-x', label: 'Country', parent_id: null }, { id: 'region-a', label: 'Region', parent_id: 'country-x' }, { id: 'site-a', label: 'Same name', parent_id: 'region-a' }, { id: 'region-b', label: 'Same name', parent_id: 'country-x' }];
  state.profile.current_location = { ...state.profile.current_location, label: 'Arbitrary location', area_ids: ['site-a', 'region-a', 'country-x'] };
  state.evidence = []; state.plans = []; state.plan_actions = []; state.situation.current_plan_id = null;
  return state;
}
function assessment(state: Snapshot, area = 'region-a', level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | null = 'L4', status: 'ACTIVE' | 'RESOLVED' | 'UNKNOWN' = 'ACTIVE', time = at) {
  const evidence: Evidence = { ...activeSnapshot().evidence[0], id: 'assessment-' + state.evidence.length, situation_id: state.situation.id, source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL', claim_type: 'DISASTER_STATUS', published_at: time, received_at: time, expires_at: null, affected_area_ids: [area], relevant_areas: ['display only'], claims: [], disaster_assessments: [{ area_id: area, event_type: 'EARTHQUAKE', level, status }] };
  state.evidence.push(evidence); return evidence;
}
describe('generic area and typed severity boundary', () => {
  it('supports arbitrary configured IDs and labels without modifying the snapshot', () => {
    const state = region(); assessment(state);
    const original = JSON.stringify(state);
    expect(deriveSeverity(state, now + 1)).toMatchObject({ level: 'L4', actionState: 'PREPARE' });
    expect(JSON.stringify(state)).toBe(original);
    state.profile.current_location.label = 'Tokyo';
    expect(deriveSeverity(state, now + 1).level).toBe('L4');
  });
  it('does not infer area from identical labels, claims, coordinates or accommodation', () => {
    const state = region(); const foreign = assessment(state, 'region-b');
    foreign.relevant_areas = ['Arbitrary location']; foreign.claims = [{ key: 'disaster.tokyo.severity', value: 'L4' }];
    expect(evidenceMatchesProfile(foreign, state)).toBe(false);
    expect(deriveSeverity(state, now + 1).level).toBe('UNKNOWN');
    state.profile.current_location.area_ids = [];
    expect(profileAreaIds(state)).toEqual([]);
  });
  it('fails closed for missing catalogs, false ancestor paths and cycles', () => {
    const state = region(); assessment(state);
    state.profile.current_location.area_ids = ['site-a', 'region-b', 'country-x'];
    expect(deriveSeverity(state, now + 1).level).toBe('UNKNOWN');
    state.profile.current_location.area_ids = ['site-a', 'region-a', 'country-x'];
    state.area_catalog[0].parent_id = 'site-a';
    expect(profileAreaIds(state)).toEqual([]);
    state.area_catalog = [];
    expect(deriveSeverity(state, now + 1).level).toBe('UNKNOWN');
  });
  it('does not clear a child critical assessment with a newer parent resolution', () => {
    const state = region(); const child = assessment(state, 'site-a');
    assessment(state, 'region-a', 'L0', 'RESOLVED', '2026-10-04T17:44:00+09:00');
    expect(deriveSeverity(state, now + 60_000)).toMatchObject({ level: 'L4', evidenceIds: [child.id] });
    const unknown = assessment(state, 'site-a', null, 'UNKNOWN', '2026-10-04T17:44:30+09:00');
    expect(deriveSeverity(state, now + 90_000).level).toBe('L0');
    state.evidence = [child, unknown];
    expect(deriveSeverity(state, now + 90_000)).toMatchObject({ level: 'UNKNOWN', criticalEventKey: null, evidenceIds: [unknown.id] });
  });
  it('makes UNKNOWN disposition and same-scope conflicts ineligible for critical checks', () => {
    const unknown = region(); assessment(unknown, 'region-a', 'L4', 'UNKNOWN');
    expect(deriveSeverity(unknown, now + 1).criticalEventKey).toBeNull();
    const tied = region(); assessment(tied); assessment(tied, 'region-a', 'L2');
    expect(deriveSeverity(tied, now + 1).level).toBe('CONFLICT');
    const malformed = region(); assessment(malformed).affected_area_ids = ['region-b'];
    expect(deriveSeverity(malformed, now + 1).level).toBe('UNKNOWN');
  });
  it('requires source, freshness and profile scope even with typed L4 payloads', () => {
    const state = region(); const evidence = assessment(state);
    expect(deriveSeverity(state, now + 900_000).level).toBe('UNKNOWN');
    evidence.source_class = 'SOCIAL_MEDIA'; evidence.trust_status = 'UNVERIFIED';
    expect(deriveSeverity(state, now + 1).level).toBe('UNKNOWN');
    evidence.source_class = 'PARTNER'; evidence.trust_status = 'VERIFIED_PARTNER';
    expect(deriveSeverity(state, now + 1).level).toBe('UNKNOWN');
  });
  it('rejects foreign official/partner proof for physical reconciliation', () => {
    const anchor = region(); const next = structuredClone(anchor);
    assessment(next, 'region-b');
    next.evidence.push({ ...next.evidence[0], id: 'partner-foreign', source_class: 'PARTNER', trust_status: 'VERIFIED_PARTNER', claim_type: 'TRANSPORT_STATUS', disaster_assessments: [] });
    expect(canReconcile(anchor, next, now + 1)).toBe(false);
    expect(deriveNotifications(anchor, next, now + 1, 'online', 'reconnecting', anchor).some(event => event.event === 'VERIFICATION_RESTORED')).toBe(false);
  });
  it('degrades medium actions when cached evidence belongs to another area', () => {
    const state = activeSnapshot();
    state.profile.current_location.area_ids = [];
    expect(projectContinuity(state, now + 1, 'offline').invalidActionIds).toContain('action');
  });
});
