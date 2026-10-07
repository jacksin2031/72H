import { describe, expect, it } from 'vitest';
import { canReconcileLiveSnapshot, isPrimarySourceCurrent, liveRouteNotification, nextLiveSafetyDeadline, projectLiveSnapshot, shouldRenderCandidateRoutePreview, shouldUseCriticalMobileTakeover } from '../lib/live-presentation';
import { liveSnapshotSchema, type LiveSnapshot } from '../lib/contracts';
import { derivePower } from '../lib/vnext';
import { LIVE_NOW, movementLiveSnapshot } from './live-fixtures';

const RECONNECT_AT = LIVE_NOW - 60_000;

function replaceClaim(snapshot: LiveSnapshot, evidenceId: string, key: string, value: string) {
  const evidence = snapshot.evidence.find(item => item.id === evidenceId)!;
  evidence.claims = evidence.claims.map(claim => claim.key === key ? { ...claim, value } : claim);
}

function removeAffectedArea(snapshot: LiveSnapshot, evidenceId: string, areaId: string) {
  const evidence = snapshot.evidence.find(item => item.id === evidenceId)!;
  evidence.affected_area_ids = evidence.affected_area_ids.filter(item => item !== areaId);
}

function crossAreaMovementSnapshot() {
  const snapshot = movementLiveSnapshot();
  const destination = snapshot.destinations.find(item => item.id === 'shelter-asakusa')!;
  destination.area_id = 'JP-27';
  const destinationProof = snapshot.evidence.find(item => item.id === 'ev-destination')!;
  destinationProof.relevant_areas = ['Osaka'];
  destinationProof.affected_area_ids = ['JP-27'];
  const routeProof = snapshot.evidence.find(item => item.id === 'ev-route')!;
  routeProof.relevant_areas = ['Shibuya', 'Osaka'];
  routeProof.affected_area_ids = ['JP-13-SHIBUYA', 'JP-27'];
  return liveSnapshotSchema.parse(snapshot);
}

describe('LIVE movement presentation gates', () => {
  it('accepts the complete official destination, route, and directive proof set', () => {
    const snapshot = movementLiveSnapshot();
    expect(projectLiveSnapshot(snapshot, LIVE_NOW, 'online', derivePower(80, false)).mapGate).toBe(true);
  });

  it('keeps evidence authorization intact when power policy suppresses only map rendering', () => {
    const snapshot = movementLiveSnapshot();
    const projection = projectLiveSnapshot(snapshot, LIVE_NOW, 'online', derivePower(3, false));
    expect(projection.mapGate).toBe(false);
    expect(projection.invalidActionIds).not.toContain('action-live-1');
    expect(projection.primaryAction?.id).toBe('action-live-1');
  });

  it.each(['ev-directive', 'ev-destination', 'ev-route'])(
    'rejects OFFICIAL evidence %s when its trust status is only partner-verified', evidenceId => {
      const snapshot = movementLiveSnapshot();
      const evidence = snapshot.evidence.find(item => item.id === evidenceId)!;
      evidence.trust_status = 'VERIFIED_PARTNER';
      expect(projectLiveSnapshot(snapshot, LIVE_NOW, 'online', derivePower(80, false)).mapGate).toBe(false);
    },
  );

  it('reconciles a complete, exact and post-reconnect official spatial proof set', () => {
    expect(canReconcileLiveSnapshot(null, movementLiveSnapshot(), RECONNECT_AT, LIVE_NOW)).toBe(true);
  });

  it('accepts typed official destination and route proof across the origin and destination areas', () => {
    const snapshot = crossAreaMovementSnapshot();
    expect(projectLiveSnapshot(snapshot, LIVE_NOW, 'online', derivePower(80, false)).mapGate).toBe(true);
    expect(canReconcileLiveSnapshot(null, snapshot, RECONNECT_AT, LIVE_NOW)).toBe(true);
  });

  it('rejects cross-area movement when destination evidence omits the selected destination area', () => {
    const snapshot = crossAreaMovementSnapshot();
    removeAffectedArea(snapshot, 'ev-destination', 'JP-27');
    expect(projectLiveSnapshot(snapshot, LIVE_NOW, 'online', derivePower(80, false)).mapGate).toBe(false);
    expect(canReconcileLiveSnapshot(null, snapshot, RECONNECT_AT, LIVE_NOW)).toBe(false);
  });

  it.each([
    ['movement directive', 'ev-directive', 'movement.directive.JP-13-SHIBUYA', 'STAY_IN_PLACE'],
    ['destination open status', 'ev-destination', 'destination.shelter-asakusa.open_status', 'CLOSED'],
    ['destination hazard suitability', 'ev-destination', 'destination.shelter-asakusa.hazard.EARTHQUAKE.suitability', 'INELIGIBLE'],
    ['route safety status', 'ev-route', 'route.route-live-1.safety_status', 'BLOCKED'],
  ] as const)('keeps reconnect pending for an inexact %s claim', (_label, evidenceId, key, value) => {
    const snapshot = movementLiveSnapshot();
    replaceClaim(snapshot, evidenceId, key, value);
    expect(canReconcileLiveSnapshot(null, snapshot, RECONNECT_AT, LIVE_NOW)).toBe(false);
  });

  it.each([
    ['destination record area', 'ev-destination', 'JP-13'],
    ['route origin area', 'ev-route', 'JP-13-SHIBUYA'],
    ['route destination area', 'ev-route', 'JP-13'],
    ['movement origin area', 'ev-directive', 'JP-13-SHIBUYA'],
  ] as const)('keeps reconnect pending when evidence is outside the required %s', (_label, evidenceId, areaId) => {
    const snapshot = movementLiveSnapshot();
    removeAffectedArea(snapshot, evidenceId, areaId);
    expect(canReconcileLiveSnapshot(null, snapshot, RECONNECT_AT, LIVE_NOW)).toBe(false);
  });

  it('keeps reconnect pending when the source retrieval is new but required route evidence predates the reconnect window', () => {
    const snapshot = movementLiveSnapshot();
    const routeEvidence = snapshot.evidence.find(item => item.id === 'ev-route')!;
    routeEvidence.published_at = new Date(LIVE_NOW - 6_000).toISOString();
    routeEvidence.received_at = new Date(LIVE_NOW - 6_000).toISOString();
    snapshot.spatial_guidance.destination!.checked_at = new Date(LIVE_NOW - 1_000).toISOString();
    snapshot.spatial_guidance.route!.checked_at = new Date(LIVE_NOW - 1_000).toISOString();
    snapshot.source.retrieved_at = new Date(LIVE_NOW - 1_000).toISOString();
    snapshot.route_source.retrieved_at = new Date(LIVE_NOW - 1_000).toISOString();
    expect(canReconcileLiveSnapshot(null, snapshot, LIVE_NOW - 5_000, LIVE_NOW)).toBe(false);
  });

  it.each([
    ['expired canonical and spatial route', (snapshot: LiveSnapshot) => {
      const expires = new Date(LIVE_NOW - 1).toISOString();
      snapshot.routes[0].expires_at = expires;
      snapshot.spatial_guidance.route!.expires_at = expires;
    }],
    ['conflicted spatial route', (snapshot: LiveSnapshot) => { snapshot.spatial_guidance.route!.conflict = true; }],
    ['expired destination proof', (snapshot: LiveSnapshot) => { snapshot.spatial_guidance.destination!.expires_at = new Date(LIVE_NOW - 1).toISOString(); }],
    ['incorrect route safety claim', (snapshot: LiveSnapshot) => replaceClaim(snapshot, 'ev-route', 'route.route-live-1.safety_status', 'BLOCKED')],
  ] as const)('invalidates HIGH evacuation and preserves a LOW fallback when the %s closes the movement gate', (_label, closeGate) => {
    const snapshot = movementLiveSnapshot();
    const highEvacuation = snapshot.plan_actions[0];
    const lowFallback = { ...highEvacuation, id: 'action-live-low', text: 'Wait for the latest verified update.', risk_level: 'LOW' as const,
      intent_id: 'wait_for_transport_update' as const, evidence_ids: [], dependency_keys: [], dependency_values: {} };
    snapshot.plan_actions.push(lowFallback);
    closeGate(snapshot);

    const projection = projectLiveSnapshot(snapshot, LIVE_NOW, 'online', derivePower(80, false));
    expect(projection.mapGate).toBe(false);
    expect(projection.invalidActionIds).toContain(highEvacuation.id);
    expect(projection.primaryAction?.id).toBe(lowFallback.id);
    expect(projection.presentation.primaryAction?.text).not.toBe(highEvacuation.text);

    const visiblePlanActions = snapshot.plan_actions.filter(item => !projection.invalidActionIds.includes(item.id));
    expect(visiblePlanActions.map(item => item.text)).not.toContain(highEvacuation.text);
  });

  it('emits no route notice when the route is unchanged', () => {
    const snapshot = movementLiveSnapshot();
    expect(liveRouteNotification(snapshot, structuredClone(snapshot), LIVE_NOW)).toBe(null);
  });

  it('emits a dependency notice when provider geometry changes', () => {
    const before = movementLiveSnapshot();
    const after = structuredClone(before);
    after.spatial_guidance.route!.geometry!.coordinates[1][0] += 0.01;
    expect(liveRouteNotification(before, after, LIVE_NOW)).toMatchObject({
      event: 'ROUTE_DEPENDENCY_CHANGED', kind: 'ATTENTION', href: '/sources', evidenceIds: ['ev-route'],
    });
  });

  it('marks a newly blocked route notice as important', () => {
    const before = movementLiveSnapshot();
    const after = structuredClone(before);
    after.spatial_guidance.route!.status = 'BLOCKED';
    expect(liveRouteNotification(before, after, LIVE_NOW)).toMatchObject({ event: 'ROUTE_DEPENDENCY_CHANGED', kind: 'IMPORTANT' });
  });

  it('marks route expiry as important and gives the expiry notice a stable identity', () => {
    const before = movementLiveSnapshot();
    const after = structuredClone(before);
    after.spatial_guidance.route!.expires_at = new Date(LIVE_NOW - 1).toISOString();
    const notice = liveRouteNotification(before, after, LIVE_NOW);
    expect(notice).toMatchObject({ event: 'ROUTE_DEPENDENCY_CHANGED', kind: 'IMPORTANT' });
    expect(notice?.id).toContain('route-live-1%3Aexpired%3A');
    expect(notice?.id).toBe(liveRouteNotification(before, after, LIVE_NOW)?.id);
  });

  it('drops an already-open candidate map immediately when power no longer permits maps', () => {
    expect(shouldRenderCandidateRoutePreview(true, true, false)).toBe(false);
    expect(shouldRenderCandidateRoutePreview(true, true, true)).toBe(true);
  });

  it('forces critical takeover on mobile while preserving desktop and Survival More access', () => {
    expect(shouldUseCriticalMobileTakeover('mobile', 'SAFETY_CHECK')).toBe(true);
    expect(shouldUseCriticalMobileTakeover('mobile', 'EMERGENCY_PROTECT')).toBe(true);
    expect(shouldUseCriticalMobileTakeover('desktop', 'SAFETY_CHECK')).toBe(false);
    expect(shouldUseCriticalMobileTakeover('mobile', 'SURVIVAL')).toBe(false);
  });

  it('does not renew primary-source freshness from recent retrieval metadata without current publication evidence', () => {
    const snapshot = movementLiveSnapshot();
    snapshot.evidence = [];
    snapshot.evidence_projections = [];
    snapshot.plans = [];
    snapshot.situation.current_plan_id = null;
    snapshot.spatial_guidance = { ...snapshot.spatial_guidance, destination: null, route: null };
    snapshot.source.retrieved_at = new Date(LIVE_NOW - 1_000).toISOString();
    snapshot.source.last_published_at = new Date(LIVE_NOW - 16 * 60_000).toISOString();
    const projection = projectLiveSnapshot(snapshot, LIVE_NOW, 'online', derivePower(80, false));
    expect(isPrimarySourceCurrent(snapshot, projection)).toBe(false);
    expect(nextLiveSafetyDeadline(snapshot, LIVE_NOW)).toBe(null);
  });
});
