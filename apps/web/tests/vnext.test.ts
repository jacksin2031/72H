import { describe, expect, it } from 'vitest';
import { activeSnapshot } from './fixtures';
import { snapshotSchema, type Evidence, type Snapshot } from '../lib/contracts';
import {
  deriveNotifications,
  derivePower,
  deriveSeverity,
  initialSafetyCheck,
  reduceSafetyCheck,
  safetyCheckSchema,
  sourceAuthority,
  type SafetyCheckState,
} from '../lib/vnext';

const at = '2026-10-04T17:43:00+09:00';
const atMs = Date.parse(at);
type Level = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
type AssessmentStatus = 'ACTIVE' | 'RESOLVED' | 'UNKNOWN';

function officialSeverity(
  state = activeSnapshot(),
  level: Level | null = 'L4',
  id = 'ev-severity',
  publishedAt = at,
  status: AssessmentStatus = level === 'L0' ? 'RESOLVED' : 'ACTIVE',
): Snapshot {
  state.situation.active_event_ids = ['evt-earthquake'];
  state.evidence.push({
    id,
    situation_id: state.situation.id,
    source_name: 'Official replay source',
    source_class: 'OFFICIAL',
    trust_status: 'VERIFIED_OFFICIAL',
    freshness_status: 'CURRENT',
    published_at: publishedAt,
    received_at: publishedAt,
    expires_at: null,
    relevant_areas: ['Tokyo'],
    affected_area_ids: ['JP-13'],
    disaster_assessments: [{ area_id: 'JP-13', event_type: 'EARTHQUAKE', level, status }],
    claim_type: 'DISASTER_STATUS',
    claims: [],
    summary: 'Synthetic severity evidence',
    conflict_group: null,
    eligible_for_high_risk: false,
    conflict: false,
    raw_reference: `replay://${id}`,
    is_synthetic: true,
  });
  return state;
}

function assessment(level: Level | null, status: AssessmentStatus, area_id = 'JP-13') {
  return [{ area_id, event_type: 'EARTHQUAKE' as const, level, status }];
}

function addedEvidence(state: Snapshot, overrides: Partial<Evidence>): Evidence {
  const base = state.evidence[0];
  const evidence: Evidence = { ...base, id: 'ev-added', claims: [], ...overrides };
  state.evidence.push(evidence);
  return evidence;
}

describe('vNext source authority and severity projections', () => {
  it('parses old offline snapshots without inventing area identity or severity', () => {
    const legacy = JSON.parse(JSON.stringify(activeSnapshot())) as Record<string, unknown>;
    delete legacy.area_catalog;
    const profile = legacy.profile as {
      current_location: Record<string, unknown>;
      accommodation_location: Record<string, unknown>;
      current_destination: Record<string, unknown>;
    };
    for (const location of [profile.current_location, profile.accommodation_location, profile.current_destination]) {
      delete location.area_ids;
      delete location.observed_at;
      delete location.lat;
      delete location.lng;
    }
    for (const item of legacy.evidence as Array<Record<string, unknown>>) {
      delete item.affected_area_ids;
      delete item.disaster_assessments;
    }
    const parsed = snapshotSchema.parse(legacy);
    expect(parsed.area_catalog).toEqual([]);
    expect(parsed.profile.current_location.area_ids).toEqual([]);
    expect(deriveSeverity(parsed, atMs).level).toBe('UNKNOWN');
  });

  it('keeps A4 reserved and maps only verified partner and official sources upward', () => {
    const evidence = activeSnapshot().evidence[0];
    expect(sourceAuthority(evidence)).toBe('A2');
    expect(sourceAuthority({ ...evidence, source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL' })).toBe('A3');
    expect(sourceAuthority({ ...evidence, source_class: 'SOCIAL_MEDIA', trust_status: 'UNVERIFIED' })).toBe('A1');
    expect(sourceAuthority({ ...evidence, source_class: 'OFFICIAL', trust_status: 'UNVERIFIED', source_name: 'Emergency Authority' })).toBe('A0');
    expect(sourceAuthority({ ...evidence, source_class: 'OTHER', trust_status: 'VERIFIED_OFFICIAL', source_name: 'A4 emergency authority' })).toBe('A0');
  });

  it('derives fresh, scoped official severity without turning L4 into evacuation', () => {
    const state = officialSeverity();
    const result = deriveSeverity(state, atMs + 1_000);
    expect(result).toEqual({
      level: 'L4', actionState: 'PREPARE', evidenceIds: ['ev-severity'],
      synthetic: true, criticalEventKey: 'critical:situation:JP-13-SHIBUYA:incidents:evt-earthquake',
    });
    expect(result.actionState).not.toBe('EVACUATE');
  });

  it('uses exact typed status fallbacks and never parses summaries', () => {
    const active = officialSeverity(activeSnapshot(), null, 'ev-active', at, 'ACTIVE');
    active.evidence.at(-1)!.summary = 'Untrusted display prose says L4 evacuation now';
    expect(deriveSeverity(active, atMs + 1).level).toBe('L1');
    const resolved = officialSeverity(activeSnapshot(), null, 'ev-resolved', at, 'RESOLVED');
    expect(deriveSeverity(resolved, atMs + 1).level).toBe('L0');
    const missing = officialSeverity(activeSnapshot(), null, 'ev-unknown', at, 'UNKNOWN');
    expect(deriveSeverity(missing, atMs + 1).level).toBe('UNKNOWN');
    expect(deriveSeverity(officialSeverity(activeSnapshot(), 'L4', 'ev-status-unknown', at, 'UNKNOWN'), atMs + 1).level).toBe('UNKNOWN');
    const invalid = JSON.parse(JSON.stringify(missing)) as {
      evidence: Array<{ disaster_assessments: Array<{ level: string | null }> }>;
    };
    invalid.evidence[1].disaster_assessments[0].level = 'L5';
    expect(snapshotSchema.safeParse(invalid).success).toBe(false);
  });

  it('lets a newer ACTIVE or RESOLVED update supersede older severity and conflicts on tied contradictions', () => {
    const active = officialSeverity(activeSnapshot(), 'L4', 'ev-old-level', at);
    addedEvidence(active, {
      id: 'ev-active', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL',
      claim_type: 'DISASTER_STATUS', relevant_areas: ['Tokyo'],
      affected_area_ids: ['JP-13'], disaster_assessments: assessment(null, 'ACTIVE'),
      claims: [],
      published_at: '2026-10-04T17:44:00+09:00', freshness_status: 'CURRENT', conflict: false, conflict_group: null,
    });
    expect(deriveSeverity(active, atMs + 60_000).level).toBe('L1');

    const resolved = officialSeverity(activeSnapshot(), 'L4', 'ev-old-level', at);
    addedEvidence(resolved, {
      id: 'ev-resolved', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL',
      claim_type: 'DISASTER_STATUS', relevant_areas: ['Tokyo'],
      affected_area_ids: ['JP-13'], disaster_assessments: assessment(null, 'RESOLVED'),
      claims: [],
      published_at: '2026-10-04T17:44:00+09:00', freshness_status: 'CURRENT', conflict: false, conflict_group: null,
    });
    expect(deriveSeverity(resolved, atMs + 60_000).level).toBe('L0');

    const tied = officialSeverity(activeSnapshot(), 'L4', 'ev-level', at);
    addedEvidence(tied, {
      id: 'ev-status', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL',
      claim_type: 'DISASTER_STATUS', relevant_areas: ['Tokyo'],
      affected_area_ids: ['JP-13'], disaster_assessments: assessment(null, 'RESOLVED'),
      claims: [],
      published_at: at, freshness_status: 'CURRENT', conflict: false, conflict_group: null,
    });
    expect(deriveSeverity(tied, atMs + 1).level).toBe('CONFLICT');
  });

  it('treats ACTIVE as compatible with same-time L1-L4, and conflicts only with contradictory pairs', () => {
    const activeL4 = officialSeverity(activeSnapshot(), 'L4', 'ev-level', at);
    addedEvidence(activeL4, {
      id: 'ev-active', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL',
      claim_type: 'DISASTER_STATUS', relevant_areas: ['Tokyo'],
      affected_area_ids: ['JP-13'], disaster_assessments: assessment(null, 'ACTIVE'),
      claims: [],
      published_at: at, freshness_status: 'CURRENT', conflict: false, conflict_group: null,
    });
    expect(deriveSeverity(activeL4, atMs + 1)).toMatchObject({
      level: 'L4', evidenceIds: ['ev-active', 'ev-level'],
    });

    const activeL0 = officialSeverity(activeSnapshot(), 'L0', 'ev-level', at);
    addedEvidence(activeL0, {
      id: 'ev-active', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL',
      claim_type: 'DISASTER_STATUS', relevant_areas: ['Tokyo'],
      affected_area_ids: ['JP-13'], disaster_assessments: assessment(null, 'ACTIVE'),
      claims: [],
      published_at: at, freshness_status: 'CURRENT', conflict: false, conflict_group: null,
    });
    expect(deriveSeverity(activeL0, atMs + 1).level).toBe('CONFLICT');

    const resolvedL4 = officialSeverity(activeSnapshot(), 'L4', 'ev-level', at);
    addedEvidence(resolvedL4, {
      id: 'ev-resolved', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL',
      claim_type: 'DISASTER_STATUS', relevant_areas: ['Tokyo'],
      affected_area_ids: ['JP-13'], disaster_assessments: assessment(null, 'RESOLVED'),
      claims: [],
      published_at: at, freshness_status: 'CURRENT', conflict: false, conflict_group: null,
    });
    expect(deriveSeverity(resolvedL4, atMs + 1).level).toBe('CONFLICT');
  });

  it('rejects stale, future, reconnecting, out-of-scope, social and partner severity', () => {
    const stale = officialSeverity();
    expect(deriveSeverity(stale, atMs + 900_000).level).toBe('UNKNOWN');
    const future = officialSeverity();
    expect(deriveSeverity(future, atMs - 1).level).toBe('UNKNOWN');
    const reconnecting = officialSeverity();
    reconnecting.situation.network_state = 'RECONNECTING';
    expect(deriveSeverity(reconnecting, atMs + 1).level).toBe('UNKNOWN');
    const unrelated = officialSeverity();
    unrelated.evidence.at(-1)!.affected_area_ids = ['JP-27'];
    unrelated.evidence.at(-1)!.disaster_assessments = assessment('L4', 'ACTIVE', 'JP-27');
    expect(deriveSeverity(unrelated, atMs + 1).level).toBe('UNKNOWN');
    const accommodationOnly = officialSeverity();
    accommodationOnly.evidence.at(-1)!.affected_area_ids = ['JP-13-ASAKUSA'];
    accommodationOnly.evidence.at(-1)!.disaster_assessments = assessment('L4', 'ACTIVE', 'JP-13-ASAKUSA');
    expect(deriveSeverity(accommodationOnly, atMs + 1).level).toBe('UNKNOWN');
    const blankLocation = officialSeverity();
    blankLocation.profile.current_location.label = '  ';
    expect(deriveSeverity(blankLocation, atMs + 1).level).toBe('L4');
    const labelOnly = officialSeverity();
    labelOnly.profile.current_location.area_ids = [];
    expect(deriveSeverity(labelOnly, atMs + 1).level).toBe('UNKNOWN');
    const social = officialSeverity();
    Object.assign(social.evidence.at(-1)!, { source_class: 'SOCIAL_MEDIA', trust_status: 'UNVERIFIED' });
    expect(deriveSeverity(social, atMs + 1).level).toBe('UNKNOWN');
    const partner = officialSeverity();
    Object.assign(partner.evidence.at(-1)!, { source_class: 'PARTNER', trust_status: 'VERIFIED_PARTNER' });
    expect(deriveSeverity(partner, atMs + 1).level).toBe('UNKNOWN');
  });

  it('returns CONFLICT for tied newest contradictions and respects evidence projection conflicts', () => {
    const contradicted = officialSeverity();
    addedEvidence(contradicted, {
      id: 'ev-tie', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL',
      claim_type: 'DISASTER_STATUS', relevant_areas: ['Tokyo'], published_at: at,
      affected_area_ids: ['JP-13'], disaster_assessments: assessment('L2', 'ACTIVE'),
      claims: [], conflict: false, conflict_group: null,
    });
    const result = deriveSeverity(contradicted, atMs + 1);
    expect(result.level).toBe('CONFLICT');
    expect(result.actionState).toBe('MONITOR');
    expect(result.evidenceIds).toEqual(['ev-severity', 'ev-tie']);

    const projectedConflict = officialSeverity();
    projectedConflict.evidence_projections.push({
      evidence_id: 'ev-severity', freshness_status: 'CURRENT', age_seconds: 0, ttl_seconds: 900,
      expires_at: null, conflict: true, eligible_for_claims: false, eligible_for_high_risk: false,
    });
    expect(deriveSeverity(projectedConflict, atMs + 1)).toMatchObject({ level: 'CONFLICT', evidenceIds: ['ev-severity'] });

    const oldClean = officialSeverity(activeSnapshot(), 'L4', 'ev-old-clean', at);
    addedEvidence(oldClean, {
      id: 'ev-latest-projected-conflict', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL',
      claim_type: 'DISASTER_STATUS', relevant_areas: ['Tokyo'],
      affected_area_ids: ['JP-13'], disaster_assessments: assessment('L1', 'ACTIVE'), claims: [],
      published_at: '2026-10-04T17:44:00+09:00', freshness_status: 'CURRENT', conflict: false, conflict_group: null,
    });
    oldClean.evidence_projections.push({
      evidence_id: 'ev-latest-projected-conflict', freshness_status: 'CURRENT', age_seconds: 0, ttl_seconds: 900,
      expires_at: null, conflict: true, eligible_for_claims: false, eligible_for_high_risk: false,
    });
    expect(deriveSeverity(oldClean, atMs + 60_000)).toMatchObject({ level: 'CONFLICT', evidenceIds: ['ev-latest-projected-conflict'] });
  });

  it('ignores unrelated server claim conflict projections and keeps incident identity stable across updates', () => {
    const first = officialSeverity();
    first.situation.claim_states.push({ key: 'unrelated.claim', status: 'CONFLICT', value: null, evidence_ids: [], updated_at: at });
    expect(deriveSeverity(first, atMs + 1).level).toBe('L4');
    const updated = officialSeverity(first, 'L4', 'ev-severity-update', '2026-10-04T17:44:00+09:00');
    const oldKey = deriveSeverity(first, atMs + 1).criticalEventKey;
    const newKey = deriveSeverity(updated, atMs + 60_000).criticalEventKey;
    expect(newKey).toBe(oldKey);

    const withoutEventIds = officialSeverity();
    withoutEventIds.situation.active_event_ids = [];
    const laterUpdate = officialSeverity(withoutEventIds, 'L4', 'ev-later-severity', '2026-10-04T17:44:00+09:00');
    laterUpdate.situation.active_event_ids = [];
    expect(deriveSeverity(laterUpdate, atMs + 60_000).criticalEventKey)
      .toBe(deriveSeverity(withoutEventIds, atMs + 1).criticalEventKey);
  });
});

describe('vNext transition notifications', () => {
  it('does not flood an initial baseline and warns once for a new fresh L4 incident', () => {
    const next = officialSeverity();
    expect(deriveNotifications(null, next, atMs + 1)).toEqual([]);
    const notifications = deriveNotifications(activeSnapshot(), next, atMs + 1);
    expect(notifications).toContainEqual({
      id: 'critical_warning:critical%3Asituation%3AJP-13-SHIBUYA%3Aincidents%3Aevt-earthquake',
      event: 'CRITICAL_WARNING', kind: 'CRITICAL', evidenceIds: ['ev-severity'], href: '/dashboard',
    });
  });

  it('does not issue critical warnings from stale or unverified L4 claims', () => {
    const previous = activeSnapshot();
    const stale = officialSeverity();
    expect(deriveNotifications(previous, stale, atMs + 900_000).some(item => item.event === 'CRITICAL_WARNING')).toBe(false);
    const social = officialSeverity();
    Object.assign(social.evidence.at(-1)!, { source_class: 'SOCIAL_MEDIA', trust_status: 'UNVERIFIED' });
    expect(deriveNotifications(previous, social, atMs + 1).some(item => item.event === 'CRITICAL_WARNING')).toBe(false);
  });

  it('deduplicates critical updates within a stable incident key', () => {
    const previous = officialSeverity();
    const next = officialSeverity(previous, 'L4', 'ev-severity-update', '2026-10-04T17:44:00+09:00');
    expect(deriveNotifications(previous, next, atMs + 60_000).some(item => item.event === 'CRITICAL_WARNING')).toBe(false);
  });

  it('does not start a critical warning while offline or reconnecting', () => {
    const previous = activeSnapshot();
    const l4 = officialSeverity();
    expect(deriveNotifications(previous, l4, atMs + 1, 'offline').some(item => item.event === 'CRITICAL_WARNING')).toBe(false);
    expect(deriveNotifications(previous, l4, atMs + 1, 'reconnecting').some(item => item.event === 'CRITICAL_WARNING')).toBe(false);
    const reconnectingIncident = deriveNotifications(l4, structuredClone(l4), atMs + 2, 'online', 'offline');
    expect(reconnectingIncident.some(item => item.event === 'CRITICAL_WARNING')).toBe(false);
  });

  it('notifies on locally detected expiration of previously current trusted evidence', () => {
    const previous = officialSeverity();
    const next = structuredClone(previous);
    const notifications = deriveNotifications(previous, next, atMs + 900_000, 'offline');
    expect(notifications.some(item => item.event === 'EVIDENCE_EXPIRED' && item.evidenceIds.includes('ev-severity'))).toBe(true);
  });

  it('separates network restoration from verification restoration', () => {
    const offline = activeSnapshot();
    offline.situation.network_state = 'OFFLINE_STALE';
    const reconnecting = activeSnapshot();
    reconnecting.situation.network_state = 'RECONNECTING';
    const connected = deriveNotifications(offline, reconnecting, atMs + 1, 'reconnecting');
    expect(connected.map(item => item.event)).toEqual(['NETWORK_RESTORED']);
    const cycleOne = deriveNotifications(offline, reconnecting, atMs + 1, 'reconnecting', 'offline')[0];
    const cycleTwo = deriveNotifications(offline, reconnecting, atMs + 120_001, 'reconnecting', 'offline')[0];
    expect(cycleOne.id).not.toBe(cycleTwo.id);

    const physicallyOffline = activeSnapshot();
    const physicallyOnline = activeSnapshot();
    const restoredFromBrowserConnection = deriveNotifications(physicallyOffline, physicallyOnline, atMs + 1, 'online', 'offline');
    expect(restoredFromBrowserConnection.some(item => item.event === 'NETWORK_RESTORED')).toBe(true);

    const replayOnline = activeSnapshot();
    const replayOffline = structuredClone(replayOnline);
    replayOffline.situation.network_state = 'OFFLINE_RECENT';
    expect(deriveNotifications(replayOnline, replayOffline, atMs + 1, 'online').map(item => item.event)).toContain('NETWORK_LOST');
    expect(deriveNotifications(replayOffline, replayOffline, atMs + 2, 'online').some(item => item.event === 'NETWORK_RESTORED')).toBe(false);
    const replayReconnect = structuredClone(replayOffline);
    replayReconnect.situation.network_state = 'RECONNECTING';
    expect(deriveNotifications(replayOffline, replayReconnect, atMs + 3, 'online').map(item => item.event)).toContain('NETWORK_RESTORED');

    const verified = activeSnapshot();
    verified.situation.network_state = 'ONLINE_VERIFIED';
    addedEvidence(verified, {
      id: 'ev-new-official', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL',
      claim_type: 'DISASTER_STATUS', relevant_areas: ['Tokyo'], affected_area_ids: ['JP-13'],
      disaster_assessments: assessment(null, 'ACTIVE'), claims: [],
      freshness_status: 'CURRENT', conflict: false, conflict_group: null,
    });
    addedEvidence(verified, {
      id: 'ev-new-partner', source_class: 'PARTNER', trust_status: 'VERIFIED_PARTNER',
      claim_type: 'TRANSPORT_STATUS', relevant_areas: ['Shibuya'], affected_area_ids: ['JP-13-SHIBUYA'], claims: [],
      freshness_status: 'CURRENT', conflict: false, conflict_group: null,
    });
    const restored = deriveNotifications(reconnecting, verified, atMs + 1, 'online');
    expect(restored.map(item => item.event)).toContain('VERIFICATION_RESTORED');
    expect(restored.find(item => item.event === 'VERIFICATION_RESTORED')?.evidenceIds).toEqual(['ev-new-official', 'ev-new-partner']);

    const projectedConflict = structuredClone(verified);
    projectedConflict.evidence_projections.push({
      evidence_id: 'ev-new-partner', freshness_status: 'CURRENT', age_seconds: 0, ttl_seconds: 300,
      expires_at: null, conflict: true, eligible_for_claims: false, eligible_for_high_risk: false,
    });
    expect(deriveNotifications(reconnecting, projectedConflict, atMs + 1, 'online').some(item => item.event === 'VERIFICATION_RESTORED')).toBe(false);

    const claimConflict = structuredClone(verified);
    claimConflict.situation.claim_states.push({ key: 'unrelated', status: 'CONFLICT', value: null, evidence_ids: [], updated_at: at });
    expect(deriveNotifications(reconnecting, claimConflict, atMs + 1, 'online').some(item => item.event === 'VERIFICATION_RESTORED')).toBe(false);
  });

  it('completes staged reconnect only with scoped official and partner evidence after the restore trace', () => {
    const restoreAt = '2026-10-04T17:52:40+09:00';
    const before = activeSnapshot();
    before.situation.network_state = 'RECONNECTING';
    before.trace.push({
      id: 'trace-network-restored', timestamp: restoreAt, agent: 'replay', event_type: 'NETWORK_RESTORED',
      input_refs: [], output_refs: [], status: 'SUCCESS', public_summary: 'Connectivity returned; reconciliation remains open.',
    });
    addedEvidence(before, {
      id: 'ev-reconnect-official', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL',
      claim_type: 'DISASTER_STATUS', relevant_areas: ['Tokyo'],
      affected_area_ids: ['JP-13'], disaster_assessments: assessment(null, 'ACTIVE'), claims: [],
      expires_at: null,
      published_at: '2026-10-04T17:52:45+09:00', received_at: '2026-10-04T17:52:50+09:00',
      freshness_status: 'CURRENT', conflict: false, conflict_group: null,
    });
    const ready = structuredClone(before);
    ready.situation.network_state = 'ONLINE_VERIFIED';
    addedEvidence(ready, {
      id: 'ev-reconnect-partner', source_class: 'PARTNER', trust_status: 'VERIFIED_PARTNER',
      claim_type: 'TRANSPORT_STATUS', relevant_areas: ['Shibuya'],
      affected_area_ids: ['JP-13-SHIBUYA'], claims: [{ key: 'route.status', value: 'AVAILABLE' }],
      expires_at: null,
      published_at: '2026-10-04T17:52:50+09:00', received_at: '2026-10-04T17:52:55+09:00',
      freshness_status: 'CURRENT', conflict: false, conflict_group: null,
    });

    const notifications = deriveNotifications(before, ready, Date.parse('2026-10-04T17:53:00+09:00'), 'online', 'online');
    expect(notifications).toContainEqual(expect.objectContaining({
      event: 'VERIFICATION_RESTORED', evidenceIds: ['ev-reconnect-official', 'ev-reconnect-partner'],
    }));
  });

  it('rejects reconnect evidence at the epoch, outside current-location scope, or with claim conflicts', () => {
    const restoreAt = '2026-10-04T17:52:40+09:00';
    const makeStaged = (
      officialPublishedAt: string,
      partnerAreaId = 'JP-13-SHIBUYA',
      officialReceivedAt = '2026-10-04T17:52:50+09:00',
    ) => {
      const before = activeSnapshot();
      before.situation.network_state = 'RECONNECTING';
      before.trace.push({
        id: 'trace-network-restored', timestamp: restoreAt, agent: 'replay', event_type: 'NETWORK_RESTORED',
        input_refs: [], output_refs: [], status: 'SUCCESS', public_summary: 'Connectivity returned; reconciliation remains open.',
      });
      addedEvidence(before, {
        id: 'ev-reconnect-official', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL',
        claim_type: 'DISASTER_STATUS', relevant_areas: ['Tokyo'],
        affected_area_ids: ['JP-13'], disaster_assessments: assessment(null, 'ACTIVE'), claims: [],
        expires_at: null,
        published_at: officialPublishedAt, received_at: officialReceivedAt,
        freshness_status: 'CURRENT', conflict: false, conflict_group: null,
      });
      const next = structuredClone(before);
      next.situation.network_state = 'ONLINE_VERIFIED';
      addedEvidence(next, {
        id: 'ev-reconnect-partner', source_class: 'PARTNER', trust_status: 'VERIFIED_PARTNER',
        claim_type: 'TRANSPORT_STATUS', relevant_areas: [partnerAreaId], affected_area_ids: [partnerAreaId],
        claims: [{ key: 'route.status', value: 'AVAILABLE' }],
        expires_at: null,
        published_at: '2026-10-04T17:52:50+09:00', received_at: '2026-10-04T17:52:55+09:00',
        freshness_status: 'CURRENT', conflict: false, conflict_group: null,
      });
      return { before, next };
    };

    const exactlyAtEpoch = makeStaged(restoreAt);
    expect(deriveNotifications(exactlyAtEpoch.before, exactlyAtEpoch.next, Date.parse('2026-10-04T17:53:00+09:00'), 'online')
      .some(item => item.event === 'VERIFICATION_RESTORED')).toBe(false);

    const receivedAtBoundary = makeStaged('2026-10-04T17:52:45+09:00', 'Shibuya', restoreAt);
    expect(deriveNotifications(receivedAtBoundary.before, receivedAtBoundary.next, Date.parse('2026-10-04T17:53:00+09:00'), 'online')
      .some(item => item.event === 'VERIFICATION_RESTORED')).toBe(false);

    const outOfScope = makeStaged('2026-10-04T17:52:45+09:00', 'JP-27');
    expect(deriveNotifications(outOfScope.before, outOfScope.next, Date.parse('2026-10-04T17:53:00+09:00'), 'online')
      .some(item => item.event === 'VERIFICATION_RESTORED')).toBe(false);

    const conflicted = makeStaged('2026-10-04T17:52:45+09:00');
    conflicted.next.situation.claim_states.push({
      key: 'route.status', status: 'CONFLICT', value: null, evidence_ids: ['ev-reconnect-partner'], updated_at: restoreAt,
    });
    expect(deriveNotifications(conflicted.before, conflicted.next, Date.parse('2026-10-04T17:53:00+09:00'), 'online')
      .some(item => item.event === 'VERIFICATION_RESTORED')).toBe(false);

    const projectionConflict = makeStaged('2026-10-04T17:52:45+09:00');
    projectionConflict.next.evidence_projections.push({
      evidence_id: 'ev-reconnect-partner', freshness_status: 'CURRENT', age_seconds: 0, ttl_seconds: 300,
      expires_at: null, conflict: true, eligible_for_claims: false, eligible_for_high_risk: false,
    });
    expect(deriveNotifications(projectionConflict.before, projectionConflict.next, Date.parse('2026-10-04T17:53:00+09:00'), 'online')
      .some(item => item.event === 'VERIFICATION_RESTORED')).toBe(false);
  });

  it('does not notify for an unrelated verified update that does not affect the plan', () => {
    const previous = activeSnapshot();
    const next = structuredClone(previous);
    addedEvidence(next, {
      id: 'ev-unrelated', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL',
      claim_type: 'DISASTER_STATUS', relevant_areas: ['Tokyo'],
      affected_area_ids: ['JP-27'], disaster_assessments: assessment('L1', 'ACTIVE', 'JP-27'),
      claims: [],
      published_at: '2026-10-04T17:43:10+09:00', freshness_status: 'CURRENT', conflict: false, conflict_group: null,
    });
    next.plans[0].status = 'INVALIDATED';
    expect(deriveNotifications(previous, next, atMs + 30_000).some(item => item.event === 'PLAN_INVALIDATED')).toBe(false);
  });

  it('notifies for verified plan dependency invalidation and supersession but suppresses social-only changes', () => {
    const previous = activeSnapshot();
    const invalidated = structuredClone(previous);
    addedEvidence(invalidated, {
      id: 'ev-route-new', source_class: 'PARTNER', trust_status: 'VERIFIED_PARTNER',
      claim_type: 'TRANSPORT_STATUS', relevant_areas: ['Tokyo'], claims: [{ key: 'route.status', value: 'AVAILABLE' }],
      published_at: '2026-10-04T17:43:10+09:00',
      freshness_status: 'CURRENT', conflict: false, conflict_group: null,
    });
    expect(deriveNotifications(previous, invalidated, atMs + 30_000).some(item => item.event === 'PLAN_INVALIDATED')).toBe(true);

    const superseded = structuredClone(previous);
    superseded.evidence.push({
      ...superseded.evidence[0], id: 'ev-plan-support', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL',
      claim_type: 'DISASTER_STATUS', affected_area_ids: ['JP-13'],
      disaster_assessments: assessment(null, 'ACTIVE'), claims: [],
    });
    superseded.plans.push({
      ...superseded.plans[0], id: 'plan_v2', version: 2, previous_plan_id: 'plan_v1', status: 'ACTIVE',
      based_on_evidence_ids: ['ev-plan-support'],
    });
    superseded.situation.current_plan_id = 'plan_v2';
    expect(deriveNotifications(previous, superseded, atMs + 1).some(item => item.event === 'PLAN_SUPERSEDED')).toBe(true);

    const socialChange = structuredClone(previous);
    socialChange.evidence.push({
      ...socialChange.evidence[0], id: 'ev-social', source_class: 'SOCIAL_MEDIA', trust_status: 'UNVERIFIED',
      claims: [{ key: 'route.status', value: 'AVAILABLE' }],
    });
    socialChange.plans.push({
      ...socialChange.plans[0], id: 'plan_social', version: 2, previous_plan_id: 'plan_v1', status: 'ACTIVE',
      based_on_evidence_ids: ['ev-social'],
    });
    socialChange.situation.current_plan_id = 'plan_social';
    expect(deriveNotifications(previous, socialChange, atMs + 1).some(item => item.event === 'PLAN_SUPERSEDED')).toBe(false);
  });
});

describe('vNext power projection', () => {
  it.each([
    [30, 'CONSERVE'], [15, 'EMERGENCY_POWER'], [5, 'SURVIVAL'], [30.01, 'NORMAL'],
  ] as const)('uses the inclusive battery threshold %s%%', (level, mode) => {
    expect(derivePower(level, false).mode).toBe(mode);
  });

  it('keeps critical thresholds while charging and never lets a manual choice lower conservation', () => {
    expect(derivePower(4, true).mode).toBe('SURVIVAL');
    expect(derivePower(80, false, 'EMERGENCY_POWER').mode).toBe('EMERGENCY_POWER');
    expect(derivePower(4, false, 'CONSERVE').mode).toBe('SURVIVAL');
    expect(derivePower(15, false).allowMap).toBe(false);
    expect(derivePower(80, false, 'SURVIVAL').allowMap).toBe(false);
  });

  it('does not invent unknown battery values and fails conservatively on invalid input', () => {
    for (const level of [null, -1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = derivePower(level, false);
      expect(result.batteryKnown).toBe(false);
      expect(result.mode).toBe('CONSERVE');
    }
    expect(derivePower(80, false, 'UNKNOWN' as never).mode).toBe('SURVIVAL');
  });
});

describe('vNext local safety check reducer', () => {
  function consented() {
    return reduceSafetyCheck(initialSafetyCheck(), { type: 'CONSENT', enabled: true });
  }

  function openCheck(state: SafetyCheckState = consented(), eventKey = 'critical:evt-1', now = atMs) {
    return reduceSafetyCheck(state, { type: 'CRITICAL', eventKey, eligible: true, now });
  }

  it('validates persisted state and requires prior consent plus an eligible fresh critical event', () => {
    expect(safetyCheckSchema.safeParse(initialSafetyCheck()).success).toBe(true);
    expect(safetyCheckSchema.safeParse({ ...initialSafetyCheck(), status: 'AWAITING_RESPONSE' }).success).toBe(false);
    const noConsent = openCheck(initialSafetyCheck());
    expect(noConsent.status).toBe('UNKNOWN');
    expect(noConsent.eventKey).toBe('critical:evt-1');
    const priorConsent = reduceSafetyCheck(noConsent, { type: 'CONSENT', enabled: true });
    expect(reduceSafetyCheck(priorConsent, { type: 'CRITICAL', eventKey: 'critical:evt-1', eligible: true, now: atMs }).status).toBe('UNKNOWN');
    expect(reduceSafetyCheck(consented(), { type: 'CRITICAL', eventKey: 'critical:stale', eligible: false, now: atMs })).toEqual(consented());
  });

  it('fails closed for blank or overlong incident keys without throwing', () => {
    const state = consented();
    expect(reduceSafetyCheck(state, { type: 'CRITICAL', eventKey: '   ', eligible: true, now: atMs })).toEqual(state);
    expect(reduceSafetyCheck(state, { type: 'CRITICAL', eventKey: 'x'.repeat(513), eligible: true, now: atMs })).toEqual(state);
    expect(reduceSafetyCheck(state, { type: 'CRITICAL', eventKey: 'x'.repeat(512), eligible: true, now: atMs }))
      .toMatchObject({ status: 'AWAITING_RESPONSE', eventKey: 'x'.repeat(512) });
  });

  it('starts once for an eligible event and keeps responses stable for that incident', () => {
    const open = openCheck();
    expect(open).toMatchObject({ consent: true, status: 'AWAITING_RESPONSE', eventKey: 'critical:evt-1', requestedAt: atMs, attempts: 1 });
    const answered = reduceSafetyCheck(open, { type: 'RESPOND', response: 'SAFE_CONFIRMED', now: atMs + 10_000 });
    expect(answered.status).toBe('SAFE_CONFIRMED');
    expect(reduceSafetyCheck(answered, { type: 'CRITICAL', eventKey: 'critical:evt-1', eligible: true, now: atMs + 20_000 })).toEqual(answered);
  });

  it('repeats at most three checks and silence remains UNRESPONSIVE_UNKNOWN', () => {
    let state = openCheck();
    state = reduceSafetyCheck(state, { type: 'TICK', now: atMs + 59_999 });
    expect(state.attempts).toBe(1);
    state = reduceSafetyCheck(state, { type: 'TICK', now: atMs + 60_000 });
    expect(state).toMatchObject({ status: 'AWAITING_RESPONSE', attempts: 2, requestedAt: atMs + 60_000 });
    state = reduceSafetyCheck(state, { type: 'TICK', now: atMs + 120_000 });
    expect(state).toMatchObject({ status: 'AWAITING_RESPONSE', attempts: 3, requestedAt: atMs + 120_000 });
    state = reduceSafetyCheck(state, { type: 'TICK', now: atMs + 180_000 });
    expect(state).toMatchObject({ status: 'UNRESPONSIVE_UNKNOWN', eventKey: 'critical:evt-1', requestedAt: null, attempts: 3 });
    state = reduceSafetyCheck(state, { type: 'RESPOND', response: 'SAFE_CONFIRMED', now: atMs + 181_000 });
    expect(state).toMatchObject({ status: 'SAFE_CONFIRMED', eventKey: 'critical:evt-1', requestedAt: null, attempts: 3 });
  });

  it('accepts a user response after the deadline before a timeout tick runs', () => {
    const open = openCheck();
    const late = reduceSafetyCheck(open, { type: 'RESPOND', response: 'NEEDS_ASSISTANCE', now: atMs + 120_000 });
    expect(late.status).toBe('NEEDS_ASSISTANCE');
  });

  it('records assistance responses locally and lets consent revocation cancel an open check', () => {
    const open = openCheck();
    const help = reduceSafetyCheck(open, { type: 'RESPOND', response: 'NEEDS_ASSISTANCE', now: atMs + 1 });
    expect(help.status).toBe('NEEDS_ASSISTANCE');
    const pending = openCheck(consented(), 'critical:evt-2', atMs + 2);
    const revoked = reduceSafetyCheck(pending, { type: 'CONSENT', enabled: false });
    expect(revoked).toMatchObject({ consent: false, status: 'UNKNOWN', eventKey: 'critical:evt-2', requestedAt: null });
    const reconsented = reduceSafetyCheck(revoked, { type: 'CONSENT', enabled: true });
    expect(reduceSafetyCheck(reconsented, { type: 'CRITICAL', eventKey: 'critical:evt-2', eligible: true, now: atMs + 3 })).toEqual(reconsented);
  });

  it('accepts CANNOT_MOVE as a user response without implying rescue dispatch', () => {
    const result = reduceSafetyCheck(openCheck(), { type: 'RESPOND', response: 'CANNOT_MOVE', now: atMs + 5 });
    expect(result.status).toBe('CANNOT_MOVE');
    expect(JSON.stringify(result)).not.toMatch(/dispatch|beacon|danger/i);
  });
});
