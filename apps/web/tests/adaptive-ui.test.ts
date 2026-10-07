import { describe, expect, it } from 'vitest';
import { activeSnapshot } from './fixtures';
import { type Snapshot } from '../lib/contracts';
import { derivePower, deriveSeverity, initialSafetyCheck, type SafetyCheckState } from '../lib/vnext';
import { derivePresentation, selectPresentationPolicy, type PresentationPolicyInput } from '../lib/adaptive-ui';

const at = '2026-10-04T17:43:00+09:00';
const atMs = Date.parse(at);

function nowSnapshot(): Snapshot {
  const state = activeSnapshot();
  state.plan_actions = [{
    ...state.plan_actions[0],
    id: 'now-action',
    category: 'NOW',
    text: 'Keep your phone charged and wait for a verified update.',
    risk_level: 'LOW',
    evidence_ids: [],
    dependency_keys: [],
    dependency_values: {},
  }];
  return state;
}

function criticalSnapshot(level: 'L0' | 'L4' = 'L4'): Snapshot {
  const state = nowSnapshot();
  state.situation.active_event_ids = ['evt-earthquake'];
  state.evidence.push({
    id: `ev-critical-${level}`,
    situation_id: state.situation.id,
    source_name: 'Official replay source',
    source_class: 'OFFICIAL',
    trust_status: 'VERIFIED_OFFICIAL',
    freshness_status: 'CURRENT',
    published_at: at,
    received_at: at,
    expires_at: '2026-10-04T17:58:00+09:00',
    relevant_areas: ['Shibuya'],
    affected_area_ids: ['JP-13-SHIBUYA'],
    disaster_assessments: [{ area_id: 'JP-13-SHIBUYA', event_type: 'EARTHQUAKE', level, status: level === 'L0' ? 'RESOLVED' : 'ACTIVE' }],
    claim_type: 'DISASTER_STATUS',
    claims: [],
    summary: 'Verified local earthquake status',
    conflict_group: null,
    eligible_for_high_risk: false,
    conflict: false,
    raw_reference: 'replay://official',
    is_synthetic: false,
  });
  return state;
}

function checkFor(state: Snapshot, status: SafetyCheckState['status'] = 'AWAITING_RESPONSE'): SafetyCheckState {
  const severity = deriveSeverity(state, atMs);
  return {
    consent: true,
    status,
    eventKey: `${state.replay.id}:${severity.criticalEventKey}`,
    requestedAt: status === 'AWAITING_RESPONSE' ? atMs : null,
    attempts: status === 'AWAITING_RESPONSE' ? 1 : 3,
  };
}

function policy(overrides: Partial<PresentationPolicyInput> = {}): PresentationPolicyInput {
  const action = nowSnapshot().plan_actions[0];
  return {
    actionState: 'MONITOR',
    primaryAction: action,
    language: 'zh-TW',
    power: derivePower(80, false),
    safetyCheckRequired: false,
    movementAuthorized: false,
    destinationEligible: false,
    routeState: null,
    routePresentationAllowed: false,
    routeGeometryValid: false,
    mapMountEligible: false,
    networkState: 'ONLINE_VERIFIED',
    planStatus: 'ACTIVE',
    ...overrides,
  };
}

describe('adaptive presentation policy', () => {
  it('keeps NORMAL and MONITOR text-only and PREPARE opens details', () => {
    expect(selectPresentationPolicy(policy({ actionState: 'NORMAL' })).mode).toBe('TEXT_ONLY');
    expect(selectPresentationPolicy(policy()).mode).toBe('TEXT_ONLY');
    expect(selectPresentationPolicy(policy({ actionState: 'PREPARE' })).mode).toBe('TEXT_WITH_DETAILS');
  });

  it.each(['SHELTER_IN_PLACE', 'EMERGENCY_PROTECT'] as const)(
    'does not auto-open a map for %s, including L4 severity projection',
    actionState => {
      const selected = selectPresentationPolicy(policy({ actionState }));
      expect(selected.mode).toBe('EMERGENCY_PROTECT');
      expect(selected.showMap).toBe(false);
    },
  );

  it('does not infer evacuation or map use from L4 severity alone', () => {
    const state = criticalSnapshot('L4');
    const projection = derivePresentation(state, atMs, 'online', derivePower(80, false), initialSafetyCheck());
    expect(deriveSeverity(state, atMs).actionState).toBe('PREPARE');
    expect(projection.mode).toBe('TEXT_WITH_DETAILS');
    expect(projection.showMap).toBe(false);
  });

  it('only enters map-assisted mode when future movement and destination gates both pass', () => {
    const blocked = selectPresentationPolicy(policy({ actionState: 'EVACUATE', movementAuthorized: true, destinationEligible: false }));
    expect(blocked.mode).toBe('TEXT_WITH_DETAILS');
    expect(blocked.primaryAction).toBeNull();
    expect(blocked.showMap).toBe(false);
    const allowed = selectPresentationPolicy(policy({
      actionState: 'EVACUATE', movementAuthorized: true, destinationEligible: true,
      routeState: 'AVAILABLE', routePresentationAllowed: true,
      routeGeometryValid: true, mapMountEligible: true,
    }));
    expect(allowed.mode).toBe('MAP_ASSISTED');
    expect(allowed.showMap).toBe(true);
    expect(allowed.showDestination).toBe(true);
    expect(allowed.routeText).toBe('VERIFIED_USABLE_CANDIDATE');
  });

  it('does not mount a map for an available route without the complete movement gate', () => {
    const selected = selectPresentationPolicy(policy({
      manualMapOpen: true,
      routeState: 'AVAILABLE',
      routePresentationAllowed: false,
    }));
    expect(selected.showMap).toBe(false);
    expect(selected.showRoute).toBe(false);
    expect(selected.routeText).toBeNull();
    expect(selected.mode).toBe('TEXT_ONLY');
    expect(selected.primaryAction).toEqual(policy().primaryAction);
  });

  it('manual map access does not change the NOW action and exposes location controls', () => {
    const state = nowSnapshot();
    const before = derivePresentation(state, atMs, 'online', derivePower(80, false), initialSafetyCheck());
    const opened = derivePresentation(state, atMs, 'online', derivePower(80, false), initialSafetyCheck(), { manualMapOpen: true });
    expect(before.mode).toBe('TEXT_ONLY');
    expect(before.showMap).toBe(false);
    expect(opened.showMap).toBe(false);
    expect(opened.showLocation).toBe(false);
    expect(opened.primaryAction).toEqual(before.primaryAction);
    expect(opened.primaryActionText).toBe(before.primaryActionText);
  });

  it('fails closed on mobility state without fresh, trusted, profile-relevant evidence', () => {
    const state = nowSnapshot();
    state.mobility.push({ id: 'mob-route', status: 'AVAILABLE', evidence_ids: ['ev-route'] });
    const current = derivePresentation(state, atMs, 'online', derivePower(80, false), initialSafetyCheck(), { manualMapOpen: true });
    expect(current.showMap).toBe(false);
    expect(current.routeText).toBeNull();

    const offline = derivePresentation(state, atMs, 'offline', derivePower(80, false), initialSafetyCheck(), { manualMapOpen: true });
    expect(offline.showMap).toBe(false);

    const stale = derivePresentation(state, atMs + 301_000, 'online', derivePower(80, false), initialSafetyCheck(), { manualMapOpen: true });
    expect(stale.showMap).toBe(false);

    const mobilityExpired = nowSnapshot();
    const timedMobility = {
      id: 'mob-expired', status: 'AVAILABLE' as const, evidence_ids: ['ev-route'],
      expires_at: '2026-10-04T17:44:00+09:00',
    };
    mobilityExpired.mobility.push(timedMobility);
    const expiredRoute = derivePresentation(mobilityExpired, atMs + 60_000, 'online', derivePower(80, false), initialSafetyCheck(), { manualMapOpen: true });
    expect(expiredRoute.showMap).toBe(false);

    const unrelated = nowSnapshot();
    unrelated.mobility.push({ id: 'mob-route', status: 'AVAILABLE', evidence_ids: ['ev-route'] });
    unrelated.evidence[0].affected_area_ids = ['JP-27'];
    const outOfScope = derivePresentation(unrelated, atMs, 'online', derivePower(80, false), initialSafetyCheck(), { manualMapOpen: true });
    expect(outOfScope.showMap).toBe(false);
  });

  it('shows a still-valid cached NOW action offline, reports stale state, and keeps reconnecting distinct', () => {
    const state = nowSnapshot();
    const offline = derivePresentation(state, atMs + 301_000, 'offline', derivePower(80, false), initialSafetyCheck());
    expect(offline.primaryAction?.id).toBe('now-action');
    expect(offline.networkState).toBe('OFFLINE_STALE');
    expect(offline.reasonCodes).toContain('OFFLINE_STALE');

    const reconnecting = derivePresentation(state, atMs, 'reconnecting', derivePower(80, false), initialSafetyCheck());
    expect(reconnecting.networkState).toBe('RECONNECTING');
    expect(reconnecting.reasonCodes).toContain('RECONNECTING');
    expect(reconnecting.reasonCodes).not.toContain('VERIFICATION_RESTORED');
  });

  it('never selects invalid, expired, blocked, or unapproved NOW actions', () => {
    const state = nowSnapshot();
    state.plan_actions[0].status = 'INVALID';
    expect(derivePresentation(state, atMs, 'online', derivePower(80, false), initialSafetyCheck()).primaryAction).toBeNull();

    const expired = nowSnapshot();
    expired.plans[0].expires_at = at;
    expect(derivePresentation(expired, atMs, 'online', derivePower(80, false), initialSafetyCheck()).primaryAction).toBeNull();

    const blocked = nowSnapshot();
    blocked.plan_actions[0].safety_decision = 'MODIFY';
    expect(derivePresentation(blocked, atMs, 'online', derivePower(80, false), initialSafetyCheck()).primaryAction).toBeNull();
  });

  it('does not present even LOW-risk NOW with stale cited evidence as a current instruction', () => {
    const state = nowSnapshot();
    state.plan_actions[0].evidence_ids = ['ev-route'];
    const current = derivePresentation(state, atMs, 'online', derivePower(80, false), initialSafetyCheck());
    expect(current.primaryAction?.id).toBe('now-action');
    const stale = derivePresentation(state, atMs + 301_000, 'online', derivePower(80, false), initialSafetyCheck());
    expect(stale.primaryAction).toBeNull();
    expect(stale.reasonCodes).toContain('NOW_EVIDENCE_NOT_CURRENT');
  });
  it('does not mark a valid selected NOW stale because a different NOW cites expired evidence', () => {
    const state = nowSnapshot();
    state.plan_actions.unshift({ ...state.plan_actions[0], id: 'stale-now', evidence_ids: ['ev-route'] });
    const result = derivePresentation(state, atMs + 301_000, 'online', derivePower(80, false), initialSafetyCheck());
    expect(result.primaryAction?.id).toBe('now-action');
    expect(result.reasonCodes).not.toContain('NOW_EVIDENCE_NOT_CURRENT');
  });

  it.each(['AWAITING_RESPONSE', 'UNRESPONSIVE_UNKNOWN', 'NEEDS_ASSISTANCE', 'CANNOT_MOVE'] as const)(
    'shows a consented check for the matching prior incident offline (%s)',
    status => {
      const state = criticalSnapshot();
      const check = checkFor(state, status);
      const projection = derivePresentation(state, atMs + 301_000, 'offline', derivePower(80, false), check);
      expect(projection.showSafetyCheck).toBe(true);
      expect(projection.mode).toBe('SAFETY_CHECK');
    },
  );

  it('keeps an existing help response for the matching incident after online severity resolves', () => {
    const state = criticalSnapshot();
    const help = checkFor(state, 'NEEDS_ASSISTANCE');
    state.evidence.push({
      ...state.evidence.at(-1)!,
      id: 'ev-resolved',
      published_at: '2026-10-04T17:44:00+09:00',
      received_at: '2026-10-04T17:44:00+09:00',
      disaster_assessments: [{ area_id: 'JP-13-SHIBUYA', event_type: 'EARTHQUAKE', level: 'L0', status: 'RESOLVED' }],
    });
    const result = derivePresentation(state, atMs + 60_000, 'online', derivePower(80, false), help);
    expect(result.showSafetyCheck).toBe(true);
    expect(result.mode).toBe('SAFETY_CHECK');
  });

  it('requires prior consent and exact session plus critical event key', () => {
    const state = criticalSnapshot();
    const valid = checkFor(state);
    expect(derivePresentation(state, atMs, 'online', derivePower(80, false), valid).showSafetyCheck).toBe(true);
    expect(derivePresentation(state, atMs, 'online', derivePower(80, false), { ...valid, consent: false }).showSafetyCheck).toBe(false);
    expect(derivePresentation(state, atMs, 'online', derivePower(80, false), { ...valid, eventKey: `other-session:${valid.eventKey!.split(':').slice(1).join(':')}` }).showSafetyCheck).toBe(false);
    expect(derivePresentation(state, atMs, 'online', derivePower(80, false), { ...valid, eventKey: `${state.replay.id}:critical:other-event` }).showSafetyCheck).toBe(false);
  });

  it('lets SURVIVAL override ordinary surfaces and blocks manual maps in emergency power', () => {
    const check = initialSafetyCheck();
    const survival = derivePresentation(nowSnapshot(), atMs, 'online', derivePower(5, false), check, { manualMapOpen: true, notificationCount: 3 });
    expect(survival.mode).toBe('SURVIVAL');
    expect(survival.showMap).toBe(false);
    expect(survival.showLocation).toBe(true);
    expect(survival.showNotificationsBadge).toBe(false);
    expect(survival.showPowerWarning).toBe(true);

    const emergency = derivePresentation(nowSnapshot(), atMs, 'online', derivePower(15, false), check, { manualMapOpen: true });
    expect(emergency.showMap).toBe(false);
    expect(emergency.reasonCodes).toContain('MANUAL_MAP_BLOCKED_BY_POWER');
  });

  it('shows only a badge for notification count and hides normal power controls', () => {
    const noBadge = derivePresentation(nowSnapshot(), atMs, 'online', derivePower(80, false), initialSafetyCheck());
    const withBadge = derivePresentation(nowSnapshot(), atMs, 'online', derivePower(80, false), initialSafetyCheck(), { notificationCount: 2 });
    expect(noBadge.showNotificationsBadge).toBe(false);
    expect(noBadge.showPowerWarning).toBe(false);
    expect(withBadge.showNotificationsBadge).toBe(true);
    expect(withBadge).not.toHaveProperty('notifications');
  });

  it('is stable across non-safety snapshot refreshes and does not mutate the source snapshot', () => {
    const state = nowSnapshot();
    const before = JSON.stringify(state);
    const first = derivePresentation(state, atMs, 'online', derivePower(80, false), initialSafetyCheck());
    state.situation.updated_at = '2026-10-04T17:43:01+09:00';
    const second = derivePresentation(state, atMs, 'online', derivePower(80, false), initialSafetyCheck());
    expect(second).toEqual(first);
    state.situation.updated_at = at;
    expect(JSON.stringify(state)).toBe(before);
  });
});
