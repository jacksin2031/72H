import type { Action, Evidence, LiveSnapshot, NetworkState } from './contracts';
import { evidenceMatchesProfile, profileAreaIds } from './area-scoping';
import { selectPresentationPolicy, type AdaptivePresentation, type PresentationPolicyInput } from './adaptive-ui';
import { type ConnectionState, type Notification, type PowerProjection } from './vnext';

export type LiveProjection = {
  evidence: Evidence[];
  plan: LiveSnapshot['plans'][number] | null;
  planStatus: string;
  invalidActionIds: string[];
  primaryAction: Action | null;
  networkState: NetworkState;
  stale: boolean;
  mapGate: boolean;
  primarySourceCurrent: boolean;
  route: LiveSnapshot['spatial_guidance']['route'];
  presentation: AdaptivePresentation;
};

const PRIMARY_SOURCE_TTL_MS = 15 * 60_000;

export function shouldUseCriticalMobileTakeover(role: string, mode: string | undefined) {
  return role === 'mobile' && (mode === 'SAFETY_CHECK' || mode === 'EMERGENCY_PROTECT');
}

export function shouldRenderCandidateRoutePreview(previewOpen: boolean, previewAllowed: boolean, powerAllowsMap: boolean) {
  return previewOpen && previewAllowed && powerAllowsMap;
}

/** Route changes and route expiry become one bounded in-app notice; they never authorize movement. */
export function liveRouteNotification(previous: LiveSnapshot | null, next: LiveSnapshot, now: number): Notification | null {
  const before = previous?.spatial_guidance.route;
  const after = next.spatial_guidance.route;
  if (!before && !after) return null;
  const expired = !!before && !!after && before.id === after.id && Date.parse(after.expires_at) <= now;
  const changed = !before || !after || before.id !== after.id || before.status !== after.status || before.destination_id !== after.destination_id
    || before.origin_area_id !== after.origin_area_id || before.geometry_kind !== after.geometry_kind
    || before.freshness_status !== after.freshness_status || before.conflict !== after.conflict
    || before.provider_reference !== after.provider_reference || before.checked_at !== after.checked_at
    || JSON.stringify(before.geometry) !== JSON.stringify(after.geometry)
    || JSON.stringify(before.evidence_ids) !== JSON.stringify(after.evidence_ids)
    || JSON.stringify(before.waypoints) !== JSON.stringify(after.waypoints);
  if (!expired && !changed) return null;
  const identity = expired ? `${after!.id}:expired:${after!.expires_at}`
    : `${before?.id ?? 'none'}:${after?.id ?? 'none'}:${after?.status ?? 'removed'}:${after?.checked_at ?? now}`;
  return {
    id: `route_dependency_changed:${encodeURIComponent(next.session_id)}:${encodeURIComponent(identity)}`,
    event: 'ROUTE_DEPENDENCY_CHANGED', kind: after?.status === 'BLOCKED' || after?.status === 'AFFECTED' || expired ? 'IMPORTANT' : 'ATTENTION',
    evidenceIds: [...new Set(after?.evidence_ids ?? [])].sort(), href: '/sources',
  };
}

function projectEvidence(snapshot: LiveSnapshot, now: number): Evidence[] {
  const projections = new Map(snapshot.evidence_projections.map(item => [item.evidence_id, item]));
  return snapshot.evidence.map(item => {
    const projection = projections.get(item.id);
    const publishedAt = Date.parse(item.published_at);
    const expiries = [item.expires_at ? Date.parse(item.expires_at) : Number.POSITIVE_INFINITY];
    if (projection) {
      if (projection.expires_at) expiries.push(Date.parse(projection.expires_at));
      if (Number.isFinite(projection.ttl_seconds)) expiries.push(publishedAt + projection.ttl_seconds * 1000);
    }
    const expiresAt = Math.min(...expiries);
    const freshness_status = !Number.isFinite(now) || !Number.isFinite(publishedAt) || publishedAt > now
      ? 'UNKNOWN'
      : now >= expiresAt || projection?.freshness_status === 'STALE' ? 'STALE'
        : projection?.freshness_status === 'UNKNOWN' ? 'UNKNOWN' : item.freshness_status;
    return { ...item, freshness_status, conflict: item.conflict || !!projection?.conflict, eligible_for_high_risk: false };
  });
}

/** A cached high-risk context cannot be restored by connectivity or an echoed session alone. */
export function canReconcileLiveSnapshot(
  previous: LiveSnapshot | null,
  received: LiveSnapshot,
  reconnectStartedAt: number,
  now: number,
): boolean {
  const retrievedAt = Date.parse(received.source.retrieved_at ?? '');
  if (!Number.isFinite(reconnectStartedAt) || !Number.isFinite(now) || !Number.isFinite(retrievedAt)
    || retrievedAt < reconnectStartedAt || retrievedAt > now || received.source.status !== 'FRESH'
    || received.situation.network_state !== 'ONLINE_VERIFIED'
    || received.situation.conflict_flags.length > 0
    || received.situation.claim_states.some(item => item.status === 'CONFLICT')) return false;

  const previousSpatial = previous?.spatial_guidance;
  const nextSpatial = received.spatial_guidance;
  const needsSpatialRevalidation = !!previousSpatial?.movement_authorized || !!previousSpatial?.map_mount_eligible
    || nextSpatial.movement_authorized || nextSpatial.map_mount_eligible;
  if (!needsSpatialRevalidation) return true;

  const freshAfterReconnect = projectEvidence(received, now).filter(item => {
    const published = Date.parse(item.published_at);
    const receivedAt = Date.parse(item.received_at);
    return eligibleOfficialEvidence(item, now) && Number.isFinite(published) && published >= reconnectStartedAt
      && Number.isFinite(receivedAt) && receivedAt >= reconnectStartedAt;
  });
  const freshById = new Map(freshAfterReconnect.map(item => [item.id, item]));
  const destination = nextSpatial.destination;
  const route = nextSpatial.route;
  const currentPlan = received.plans.find(item => item.id === received.situation.current_plan_id);
  const destinationRecord = destination && received.destinations.find(item => item.id === destination.destination_id && !item.is_synthetic);
  const originAreaId = received.profile.current_location.area_ids[0];
  const action = currentPlan && received.plan_actions.find(item => item.id === nextSpatial.action_id
    && item.plan_id === currentPlan.id && item.category === 'NOW' && item.risk_level === 'HIGH'
    && item.status === 'ACTIVE' && item.safety_decision === 'ALLOW'
    && item.intent_id === 'evacuate_to_designated_shelter');
  const ids = [
    ...(destination?.evidence_ids ?? []), ...(route?.evidence_ids ?? []), ...(action?.evidence_ids ?? []),
  ];
  return nextSpatial.current_action_kind === 'EVACUATE' && nextSpatial.movement_authorized && nextSpatial.map_mount_eligible
    && !!destination && destination.eligibility === 'ELIGIBLE' && destination.freshness_status === 'CURRENT'
    && destination.current_open_status === 'OPEN' && !destination.conflict
    && Date.parse(destination.checked_at) >= reconnectStartedAt && Date.parse(destination.checked_at) <= now
    && Date.parse(destination.expires_at) > now
    && !!route && route.status === 'VERIFIED_USABLE' && route.freshness_status === 'CURRENT' && !route.conflict
    && Date.parse(route.expires_at) > now
    && route.geometry_kind === 'PROVIDER_GEOMETRY' && route.destination_id === destination.destination_id
    && Date.parse(route.checked_at) >= reconnectStartedAt && Date.parse(route.checked_at) <= now
    && received.route_source.status === 'FRESH' && Date.parse(received.route_source.retrieved_at ?? '') >= reconnectStartedAt
    && Date.parse(received.route_source.retrieved_at ?? '') <= now
    && route.origin_area_id === received.profile.current_location.area_ids[0]
    && nextSpatial.plan_id === currentPlan?.id
    && !!route.geometry && route.geometry.coordinates.length >= 2
    && !!currentPlan && currentPlan.status === 'ACTIVE' && !!action
    && ids.length > 0 && ids.every(id => freshById.has(id))
    && !!destinationRecord && !!originAreaId
    && scopedOfficialEvidenceSet(destination.evidence_ids, freshAfterReconnect, now, 'DESTINATION_STATUS',
      [destinationRecord.area_id], [
        { key: `destination.${destination.destination_id}.open_status`, value: 'OPEN' },
        { key: `destination.${destination.destination_id}.hazard.EARTHQUAKE.suitability`, value: 'ELIGIBLE' },
      ])
    && scopedOfficialEvidenceSet(route.evidence_ids, freshAfterReconnect, now, 'ROUTE_STATUS',
      [originAreaId, destinationRecord.area_id], [{ key: `route.${route.id}.safety_status`, value: 'VERIFIED_USABLE' }])
    && hasScopedOfficialClaim(action.evidence_ids, freshAfterReconnect, now, 'MOVEMENT_DIRECTIVE', originAreaId,
      { key: `movement.directive.${originAreaId}`, value: 'EVACUATE_TO_DESIGNATED_SHELTER' })
    && requiredSpatialEvidence(action, destination, route)
    && received.destinations.some(item => item.id === destination.destination_id && !item.is_synthetic)
    && route.destination_id === destination.destination_id;
}

function eligibleEvidence(item: Evidence, snapshot: LiveSnapshot, now: number) {
  return Number.isFinite(now)
    && item.freshness_status === 'CURRENT'
    && ['VERIFIED_OFFICIAL', 'VERIFIED_PARTNER'].includes(item.trust_status)
    && !item.conflict && !item.conflict_group
    && evidenceMatchesProfile(item, snapshot);
}

function eligibleOfficialEvidence(item: Evidence, now: number) {
  return Number.isFinite(now) && item.source_class === 'OFFICIAL' && item.trust_status === 'VERIFIED_OFFICIAL'
    && item.freshness_status === 'CURRENT' && !item.conflict && !item.conflict_group;
}

function isHighRiskEvacuation(action: Action) {
  return action.risk_level === 'HIGH' && action.intent_id === 'evacuate_to_designated_shelter';
}

type RequiredClaim = { key: string; value: string | number | boolean | null };

function evidenceHasClaim(item: Evidence, required: RequiredClaim) {
  return item.claims.some(claim => claim.key === required.key && claim.value === required.value);
}

function scopedOfficialEvidenceSet(ids: string[], evidence: Evidence[], now: number,
  claimType: string, requiredAreaIds: string[], requiredClaims: RequiredClaim[]) {
  if (!ids.length || !requiredAreaIds.length) return false;
  const byId = new Map(evidence.map(item => [item.id, item]));
  const refs = ids.map(id => byId.get(id));
  if (refs.some((item): item is undefined => !item)) return false;
  const validRefs = refs as Evidence[];
  if (!validRefs.every(item => item.claim_type === claimType && eligibleOfficialEvidence(item, now)
    && requiredAreaIds.every(areaId => item.affected_area_ids.includes(areaId)))) return false;
  return requiredClaims.every(required => validRefs.some(item => evidenceHasClaim(item, required)));
}

function hasScopedOfficialClaim(ids: string[], evidence: Evidence[], now: number,
  claimType: string, areaId: string, required: RequiredClaim) {
  const byId = new Map(evidence.map(item => [item.id, item]));
  return ids.some(id => {
    const item = byId.get(id);
    return !!item && item.claim_type === claimType && item.affected_area_ids.includes(areaId)
      && eligibleOfficialEvidence(item, now) && evidenceHasClaim(item, required);
  });
}

function requiredSpatialEvidence(action: Action | undefined, destination: LiveSnapshot['spatial_guidance']['destination'],
  route: LiveSnapshot['spatial_guidance']['route']) {
  if (!action || !destination || !route) return false;
  const selected = new Set(action.evidence_ids);
  return [...destination.evidence_ids, ...route.evidence_ids].every(id => selected.has(id));
}

function mapGate(snapshot: LiveSnapshot, evidence: Evidence[], plan: LiveSnapshot['plans'][number] | null,
  currentAction: Action | null, invalidActionIds: string[], now: number, connection: ConnectionState,
  networkState: NetworkState, planStatus: string) {
  const guidance = snapshot.spatial_guidance;
  const destination = guidance.destination;
  const route = guidance.route;
  const originAreaId = snapshot.profile.current_location.area_ids[0];
  const destinationRecord = destination && snapshot.destinations.find(item => item.id === destination.destination_id && !item.is_synthetic);
  const destinationTime = destination ? { checked: Date.parse(destination.checked_at), expires: Date.parse(destination.expires_at) } : null;
  const routeTime = route ? { checked: Date.parse(route.checked_at), expires: Date.parse(route.expires_at) } : null;
  const evidenceKnownBy = (ids: string[], checkedAt: number) => ids.length > 0 && ids.every(id => {
    const item = evidence.find(candidate => candidate.id === id);
    return !!item && Date.parse(item.published_at) <= checkedAt && Date.parse(item.received_at) <= checkedAt;
  });
  const destinationEvidenceValid = !!destination && !!destinationRecord && !!destinationTime
    && destinationTime.checked <= now && now < destinationTime.expires
    && evidenceKnownBy(destination.evidence_ids, destinationTime.checked);
  const destinationClaimsValid = !!destination && !!destinationRecord
    && scopedOfficialEvidenceSet(destination.evidence_ids, evidence, now, 'DESTINATION_STATUS',
      [destinationRecord.area_id], [
        { key: `destination.${destination.destination_id}.open_status`, value: 'OPEN' },
        { key: `destination.${destination.destination_id}.hazard.EARTHQUAKE.suitability`, value: 'ELIGIBLE' },
      ]);
  const routeEvidenceValid = !!route && !!destinationRecord && !!originAreaId
    && scopedOfficialEvidenceSet(route.evidence_ids, evidence, now, 'ROUTE_STATUS',
      [originAreaId, destinationRecord.area_id], [{ key: `route.${route.id}.safety_status`, value: 'VERIFIED_USABLE' }])
    && !!routeTime && evidenceKnownBy(route.evidence_ids, routeTime.checked);
  const actionEvidenceValid = !!currentAction && currentAction.evidence_ids.length > 0
    && currentAction.evidence_ids.every(id => {
      const item = evidence.find(candidate => candidate.id === id);
      return !!item && eligibleOfficialEvidence(item, now);
    })
    && hasScopedOfficialClaim(currentAction.evidence_ids, evidence, now, 'MOVEMENT_DIRECTIVE', originAreaId ?? '',
      { key: `movement.directive.${originAreaId ?? ''}`, value: 'EVACUATE_TO_DESIGNATED_SHELTER' });
  const actionPlan = currentAction && snapshot.plans.find(item => item.id === currentAction.plan_id);
  const routeCurrent = !!route && !!routeTime && route.status === 'VERIFIED_USABLE'
    && route.freshness_status === 'CURRENT' && !route.conflict
    && routeTime.checked <= now && now < routeTime.expires
    && snapshot.route_source.status === 'FRESH'
    && Date.parse(snapshot.route_source.retrieved_at ?? '') <= now
    && route.geometry?.type === 'LineString' && route.geometry.coordinates.length >= 2;
  return connection === 'online'
    && networkState === 'ONLINE_VERIFIED'
    && snapshot.situation.conflict_flags.length === 0
    && !snapshot.situation.claim_states.some(item => item.status === 'CONFLICT')
    && snapshot.source.status === 'FRESH'
    && profileAreaIds(snapshot).length > 0
    && !!plan && plan.status === 'ACTIVE' && planStatus === 'ACTIVE'
    && guidance.current_action_kind === 'EVACUATE' && guidance.movement_authorized && guidance.map_mount_eligible
    && guidance.plan_id === plan.id && guidance.action_id === currentAction?.id
    && actionPlan?.id === plan.id && actionPlan.status === 'ACTIVE'
    && !!destination && destination.eligibility === 'ELIGIBLE' && destination.hazard_suitability === 'ELIGIBLE'
    && destination.hazard_type !== null && destination.freshness_status === 'CURRENT' && !destination.conflict
    && destination.current_open_status === 'OPEN' && !!destinationRecord
    && !!route && route.destination_id === destination.destination_id
    && route.origin_area_id === snapshot.profile.current_location.area_ids[0]
    && route.geometry_kind === 'PROVIDER_GEOMETRY'
    && routeCurrent && destinationEvidenceValid && destinationClaimsValid && routeEvidenceValid && actionEvidenceValid
    && requiredSpatialEvidence(currentAction ?? undefined, destination, route)
    && currentAction?.category === 'NOW' && currentAction.status === 'ACTIVE'
    && currentAction.risk_level === 'HIGH' && currentAction.safety_decision === 'ALLOW'
    && currentAction.intent_id === 'evacuate_to_designated_shelter'
    && !invalidActionIds.includes(currentAction.id);
}

export function projectLiveSnapshot(snapshot: LiveSnapshot, now: number, connection: ConnectionState,
  power: PowerProjection, notificationCount = 0, safetyCheckRequired = false): LiveProjection {
  const evidence = projectEvidence(snapshot, now);
  const route = projectLiveRoute(snapshot.spatial_guidance.route, evidence, snapshot, now);
  const byId = new Map(evidence.map(item => [item.id, item]));
  const plan = snapshot.plans.find(item => item.id === snapshot.situation.current_plan_id) ?? null;
  const evaluation = plan && snapshot.plan_evaluations.findLast(item => item.plan_id === plan.id);
  const expired = !!plan && (!Number.isFinite(now) || now >= Date.parse(plan.expires_at));
  const hasStaleOfficial = evidence.some(item => ['VERIFIED_OFFICIAL', 'VERIFIED_PARTNER'].includes(item.trust_status) && item.freshness_status !== 'CURRENT');
  const networkState: NetworkState = connection === 'offline'
    ? (expired || hasStaleOfficial ? 'OFFLINE_STALE' : 'OFFLINE_RECENT')
    : connection === 'reconnecting' ? 'RECONNECTING' : snapshot.situation.network_state;
  const planStatus = expired ? 'EXPIRED'
    : evaluation?.status === 'INVALIDATED' || evaluation?.status === 'EXPIRED' ? evaluation.status
      : evaluation?.status === 'PARTIAL_INVALIDATION' ? 'PARTIALLY_INVALID'
        : plan?.status ?? 'UNKNOWN';
  const actions = snapshot.plan_actions.filter(item => item.plan_id === plan?.id);
  const baseInvalidActionIds = actions.filter(action => {
    if (expired || planStatus !== 'ACTIVE' || action.status !== 'ACTIVE' || action.safety_decision !== 'ALLOW') return true;
    if (evaluation?.invalid_action_ids.includes(action.id)) return true;
    if (action.evidence_ids.some(id => !byId.has(id))) return true;
    if (action.risk_level !== 'LOW' && (!action.evidence_ids.length
      || action.evidence_ids.some(id => isHighRiskEvacuation(action)
        ? !eligibleOfficialEvidence(byId.get(id)!, now) : !eligibleEvidence(byId.get(id)!, snapshot, now)))) return true;
    if (action.risk_level === 'HIGH' && connection !== 'online') return true;
    return action.dependency_keys.some(key => {
      const claim = snapshot.situation.claim_states.find(item => item.key === key);
      return !claim || claim.status !== 'VERIFIED' || claim.value !== action.dependency_values[key];
    });
  }).map(action => action.id);
  const firstActionForGate = actions.find(action => action.category === 'NOW' && action.status === 'ACTIVE'
    && !baseInvalidActionIds.includes(action.id)) ?? null;
  const evacAction = snapshot.spatial_guidance.action_id
    ? actions.find(action => action.id === snapshot.spatial_guidance.action_id) ?? null : null;
  const actionForGate = snapshot.spatial_guidance.current_action_kind === 'EVACUATE' ? evacAction : firstActionForGate;
  const mapGateAllowed = mapGate(snapshot, evidence, plan, actionForGate, baseInvalidActionIds, now, connection, networkState, planStatus);
  const invalidActionIds = mapGateAllowed ? baseInvalidActionIds : [...new Set([
    ...baseInvalidActionIds,
    ...actions.filter(isHighRiskEvacuation).map(action => action.id),
  ])];
  const firstAction = actions.find(action => action.category === 'NOW' && action.status === 'ACTIVE'
    && !invalidActionIds.includes(action.id)) ?? null;
  const primarySourceCurrent = primarySourceIsCurrent(snapshot, evidence, now);
  const primaryAction = snapshot.spatial_guidance.current_action_kind === 'EVACUATE' && mapGateAllowed ? actionForGate : firstAction;
  const actionState: PresentationPolicyInput['actionState'] = snapshot.spatial_guidance.current_action_kind === 'EVACUATE'
    ? 'EVACUATE'
    : snapshot.spatial_guidance.current_action_kind === 'SHELTER_IN_PLACE' ? 'SHELTER_IN_PLACE' : 'MONITOR';
  const routeState = mapGateAllowed ? 'AVAILABLE'
    : route?.status === 'BLOCKED' || route?.status === 'AFFECTED' ? 'DISRUPTED' : route ? 'UNKNOWN' : null;
  const presentation = selectPresentationPolicy({
    actionState, primaryAction, language: snapshot.profile.preferred_language, power,
    safetyCheckRequired,
    movementAuthorized: mapGateAllowed,
    destinationEligible: mapGateAllowed,
    routeState,
    routePresentationAllowed: mapGateAllowed,
    routeGeometryValid: mapGateAllowed,
    mapMountEligible: mapGateAllowed,
    notificationCount,
    networkState,
    planStatus,
  });
  return {
    evidence, plan, planStatus, invalidActionIds, primaryAction,
    networkState, primarySourceCurrent, stale: !primarySourceCurrent || hasStaleOfficial || expired
      || (!!route && (route.status === 'EXPIRED' || route.freshness_status === 'STALE')),
    mapGate: mapGateAllowed && presentation.showMap, route,
    presentation,
  };
}

/** Apply evidence and clock expiry to a presentation copy; source records remain immutable. */
export function projectLiveRoute(route: LiveSnapshot['spatial_guidance']['route'], evidence: Evidence[], snapshot: LiveSnapshot, now: number) {
  if (!route) return null;
  const expires = Date.parse(route.expires_at), checked = Date.parse(route.checked_at);
  const expired = Number.isFinite(now) && now >= expires;
  const future = !Number.isFinite(now) || !Number.isFinite(checked) || checked > now;
  const byId = new Map(evidence.map(item => [item.id, item]));
  const retrievedAt = Date.parse(snapshot.route_source.retrieved_at ?? '');
  const providerCurrent = snapshot.route_source.status === 'FRESH' && Number.isFinite(retrievedAt) && retrievedAt <= now;
  const evidenceFresh = route.evidence_ids.length === 0
    ? route.status === 'CANDIDATE' && route.geometry_kind === 'TRANSIT_STATION_SEQUENCE' && providerCurrent
    : route.evidence_ids.every(id => {
    const item = byId.get(id);
    return !!item && item.freshness_status === 'CURRENT' && eligibleEvidence(item, snapshot, now);
  });
  const freshness_status = expired || (!future && (!providerCurrent || !evidenceFresh)) ? 'STALE'
    : future ? 'UNKNOWN' : route.freshness_status;
  return {
    ...route,
    status: expired ? 'EXPIRED' as const : route.status,
    freshness_status,
  };
}

/** Prefer the newest JMA evidence TTL over a source status that may be left over from an older fetch. */
function primarySourceIsCurrent(snapshot: LiveSnapshot, evidence: Evidence[], now: number) {
  if (!Number.isFinite(now)) return false;
  const related = evidence.filter(item => item.source_key === snapshot.source.source_key && item.source_class === 'OFFICIAL');
  if (related.length) {
    const published = Math.max(...related.map(item => Date.parse(item.published_at)).filter(Number.isFinite));
    if (!Number.isFinite(published)) return false;
    const newest = related.filter(item => Date.parse(item.published_at) === published);
    return newest.length > 0 && newest.every(item => item.trust_status === 'VERIFIED_OFFICIAL'
      && item.freshness_status === 'CURRENT' && !item.conflict && !item.conflict_group);
  }
  const publishedAt = Date.parse(snapshot.source.last_published_at ?? '');
  return snapshot.source.status === 'FRESH' && Number.isFinite(publishedAt)
    && publishedAt <= now && now < publishedAt + PRIMARY_SOURCE_TTL_MS;
}

export function isPrimarySourceCurrent(_snapshot: LiveSnapshot, projection: LiveProjection) {
  return projection.primarySourceCurrent;
}

export function nextLiveSafetyDeadline(snapshot: LiveSnapshot, now: number): number | null {
  const projectionById = new Map(snapshot.evidence_projections.map(item => [item.evidence_id, item]));
  const dates = snapshot.evidence.filter(item => ['VERIFIED_OFFICIAL', 'VERIFIED_PARTNER'].includes(item.trust_status)
    && item.freshness_status === 'CURRENT').flatMap(item => {
    const projection = projectionById.get(item.id);
    const publishedAt = Date.parse(item.published_at);
    const expires = [item.expires_at ? Date.parse(item.expires_at) : Number.POSITIVE_INFINITY];
    if (projection) {
      if (projection.expires_at) expires.push(Date.parse(projection.expires_at));
      if (Number.isFinite(projection.ttl_seconds)) expires.push(publishedAt + projection.ttl_seconds * 1000);
    }
    return [Math.min(...expires)];
  });
  const plan = snapshot.plans.find(item => item.id === snapshot.situation.current_plan_id);
  if (plan) dates.push(Date.parse(plan.expires_at));
  const sourcePublishedAt = Date.parse(snapshot.source.last_published_at ?? '');
  if (snapshot.source.status === 'FRESH' && Number.isFinite(sourcePublishedAt)) {
    dates.push(sourcePublishedAt + PRIMARY_SOURCE_TTL_MS);
  }
  const destination = snapshot.spatial_guidance.destination;
  if (destination) dates.push(Date.parse(destination.expires_at));
  const route = snapshot.spatial_guidance.route;
  if (route) dates.push(Date.parse(route.expires_at));
  const future = dates.filter(value => Number.isFinite(value) && value > now);
  return Number.isFinite(now) && future.length ? Math.min(...future) : null;
}
