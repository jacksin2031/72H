import { z } from 'zod';

const timestamp = z.iso.datetime({ offset: true });
const id = z.string().min(1).max(160);
const areaId = z.string().min(1).max(96);
const text = z.string().max(4000);
const ids = z.array(id).max(200);
const areaIds = z.array(areaId).max(64);
const claimSchema = z.object({ key: id, value: z.union([text, z.number().finite(), z.boolean(), z.null()]) });
const evidenceProjectionSchema = z.object({ evidence_id: id, freshness_status: z.enum(['CURRENT', 'STALE', 'UNKNOWN']), age_seconds: z.number(), ttl_seconds: z.number(), expires_at: timestamp.nullable(), conflict: z.boolean(), eligible_for_claims: z.boolean(), eligible_for_high_risk: z.boolean() });
export const networkState = z.enum(['ONLINE_VERIFIED', 'ONLINE_DEGRADED', 'OFFLINE_RECENT', 'OFFLINE_STALE', 'RECONNECTING']);
export const planStatus = z.enum(['DRAFT', 'ACTIVE', 'PARTIALLY_INVALID', 'INVALIDATED', 'EXPIRED', 'SUPERSEDED']);
export const disasterSeverity = z.enum(['L0', 'L1', 'L2', 'L3', 'L4']);
export const disasterAssessmentSchema = z.object({
  area_id: areaId, event_type: z.enum(['EARTHQUAKE']), level: disasterSeverity.nullable().default(null),
  status: z.enum(['ACTIVE', 'RESOLVED', 'UNKNOWN']),
});
export const areaDefinitionSchema = z.object({ id: areaId, label: text, parent_id: areaId.nullable() });
const location = z.object({
  label: text,
  lat: z.number().finite().min(-90).max(90).nullable().default(null),
  lng: z.number().finite().min(-180).max(180).nullable().default(null),
  area_ids: areaIds.default([]),
  observed_at: timestamp.nullable().default(null),
}).superRefine((value, ctx) => {
  if ((value.lat === null) !== (value.lng === null)) {
    ctx.addIssue({ code: 'custom', message: 'lat and lng must both be present or null' });
  }
});
export const evidenceSchema = z.object({
  id, situation_id: id, source_key: id.optional(), source_name: text,
  source_class: z.enum(['OFFICIAL', 'PARTNER', 'USER_REPORT', 'SOCIAL_MEDIA', 'OTHER']),
  trust_status: z.enum(['VERIFIED_OFFICIAL', 'VERIFIED_PARTNER', 'UNVERIFIED', 'CONFLICTING', 'STALE', 'REJECTED']),
  freshness_status: z.enum(['CURRENT', 'STALE', 'UNKNOWN']),
  published_at: timestamp, received_at: timestamp, expires_at: timestamp.nullable(),
  relevant_areas: z.array(text).max(20), affected_area_ids: areaIds.default([]),
  disaster_assessments: z.array(disasterAssessmentSchema).max(64).default([]), claim_type: text,
  claims: z.array(claimSchema).max(64),
  summary: text, conflict_group: text.nullable(), eligible_for_high_risk: z.boolean(),
  conflict: z.boolean().default(false), raw_reference: text, is_synthetic: z.boolean(),
});
export const planSchema = z.object({
  id, situation_id: id, version: z.number().int().positive(), status: planStatus,
  created_at: timestamp, expires_at: timestamp, invalidate_on_new_relevant_evidence: z.boolean(),
  based_on_evidence_ids: ids, previous_plan_id: id.nullable(), invalidation_reason: text.nullable(),
  changed_action_ids: ids, language: z.enum(['ja', 'en', 'zh-TW']),
});
export const actionSchema = z.object({
  id, plan_id: id, category: z.enum(['NOW', 'NEXT', 'AVOID']), text, reason: text,
  intent_id: z.enum(['protect_and_monitor', 'review_official_guidance', 'wait_for_transport_update', 'recheck_transport_status', 'avoid_disrupted_route', 'do_not_assume_route_safety', 'evacuate_to_designated_shelter']).nullable().optional(),
  risk_level: z.enum(['LOW', 'MEDIUM', 'HIGH']), evidence_ids: ids, dependency_keys: ids,
  dependency_values: z.record(id, z.union([text, z.number().finite(), z.boolean(), z.null()])).default({}),
  status: z.enum(['ACTIVE', 'INVALID', 'EXPIRED', 'BLOCKED', 'SUPERSEDED']),
  safety_decision: z.enum(['ALLOW', 'MODIFY', 'BLOCK', 'WAIT_FOR_EVIDENCE']),
});
export const replayScenarioOptionSchema = z.object({ key: id, name: text });
export const snapshotSchema = z.object({
  profile: z.object({ id, preferred_language: z.enum(['ja', 'en', 'zh-TW']), current_location: location, accommodation_location: location, current_destination: location.nullable(), party_size: z.number().int().positive(), self_reported_safety_status: z.enum(['SAFE', 'UNCERTAIN', 'NEEDS_ASSISTANCE', 'UNKNOWN']), current_plan_summary: text.default(''), accessibility_constraints: z.array(text).max(32).default([]), created_at: timestamp, updated_at: timestamp }),
  area_catalog: z.array(areaDefinitionSchema).max(512).default([]),
  situation: z.object({ id, user_id: id, incident_status: text, network_state: networkState, active_event_ids: ids, current_plan_id: id.nullable(), latest_evidence_at: timestamp.nullable(), uncertainty_flags: z.array(text).max(64), conflict_flags: z.array(text).max(64), created_at: timestamp, updated_at: timestamp, claim_states: z.array(z.object({ key: id, status: z.enum(['VERIFIED', 'UNKNOWN', 'CONFLICT']), value: z.union([text, z.number(), z.boolean(), z.null()]), evidence_ids: ids, updated_at: timestamp })).max(128).default([]) }),
  events: z.array(z.object({ id, event_type: z.literal('EARTHQUAKE'), occurred_at: timestamp, affected_areas: z.array(text), affected_area_ids: areaIds.default([]), source_name: text, raw_reference: text })).max(100),
  evidence: z.array(evidenceSchema).max(200), plans: z.array(planSchema).max(100), plan_actions: z.array(actionSchema).max(1000),
  evidence_projections: z.array(evidenceProjectionSchema).max(200).default([]),
  trace: z.array(z.object({ id, timestamp, agent: text, event_type: text, input_refs: ids, output_refs: ids, status: text, public_summary: text })).max(1500),
  replay: z.object({ id, scenario_key: text, status: z.enum(['READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'RESET']), speed: z.union([z.literal(1), z.literal(2), z.literal(4)]), current_event_index: z.number().int().nonnegative(), current_time: timestamp, mode: z.literal('SYNTHETIC_REPLAY'), planning_mode: text }),
  scenario_events: z.array(z.object({ id, event_type: text, occurred_at: timestamp, offset_seconds: z.number().nonnegative(), label: text })).max(100),
  mobility: z.array(z.object({ id, status: z.enum(['AVAILABLE', 'DISRUPTED', 'UNKNOWN']), evidence_ids: ids })).max(128),
  plan_evaluations: z.array(z.object({ plan_id: id, status: z.enum(['KEEP', 'PARTIAL_INVALIDATION', 'INVALIDATED', 'EXPIRED']), evaluated_at: timestamp, reason: text.nullable(), invalid_action_ids: ids })).max(512),
}).superRefine((state, ctx) => {
  const evidenceIds = new Set(state.evidence.map(e => e.id));
  const planIds = new Set(state.plans.map(p => p.id));
  const areas = new Map(state.area_catalog.map(area => [area.id, area]));
  if (areas.size !== state.area_catalog.length) ctx.addIssue({ code: 'custom', message: 'Duplicate area ID' });
  for (const area of state.area_catalog) {
    if (area.parent_id !== null && !areas.has(area.parent_id)) ctx.addIssue({ code: 'custom', message: 'Unknown area parent' });
    const visited = new Set([area.id]);
    let parent = area.parent_id;
    while (parent !== null && areas.has(parent)) {
      if (visited.has(parent)) {
        ctx.addIssue({ code: 'custom', message: 'Area ancestry cycle' });
        break;
      }
      visited.add(parent);
      parent = areas.get(parent)!.parent_id;
    }
  }
  for (const location of [state.profile.current_location, state.profile.accommodation_location, state.profile.current_destination]) {
    if (location === null) continue;
    const path = location.area_ids;
    if (path.some(areaId => !areas.has(areaId))) ctx.addIssue({ code: 'custom', message: 'Location references an unknown area' });
    for (let index = 0; index + 1 < path.length; index += 1) {
      if (areas.get(path[index])?.parent_id !== path[index + 1]) ctx.addIssue({ code: 'custom', message: 'Location ancestry path is not contiguous' });
    }
    if (path.length > 0 && areas.get(path[path.length - 1])?.parent_id !== null) ctx.addIssue({ code: 'custom', message: 'Location ancestry must include the catalog root' });
  }
  for (const item of state.evidence) {
    if (new Set(item.affected_area_ids).size !== item.affected_area_ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate evidence area ID' });
    if (item.affected_area_ids.some(areaId => !areas.has(areaId))) ctx.addIssue({ code: 'custom', message: 'Evidence references an unknown area' });
    for (const assessment of item.disaster_assessments) {
      if (!item.affected_area_ids.includes(assessment.area_id)) ctx.addIssue({ code: 'custom', message: 'Assessment area is not explicitly affected' });
    }
  }
  if (state.situation.current_plan_id && !planIds.has(state.situation.current_plan_id)) ctx.addIssue({ code: 'custom', message: 'Unresolved current plan' });
  for (const action of state.plan_actions) {
    if (!planIds.has(action.plan_id) || action.evidence_ids.some(e => !evidenceIds.has(e))) ctx.addIssue({ code: 'custom', message: 'Unresolved action reference' });
  }
  if (state.replay.current_event_index > state.scenario_events.length) ctx.addIssue({ code: 'custom', message: 'Invalid replay position' });
});

const officialUrl = z.string().url().max(500).refine(value => value.startsWith('https://'), 'Official sources must use HTTPS');
const liveFreshness = z.enum(['CURRENT', 'STALE', 'UNKNOWN']);
const coordinatePair = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const liveEventSchema = z.object({
  id, situation_id: id, event_type: z.literal('EARTHQUAKE'), occurred_at: timestamp, received_at: timestamp,
  affected_areas: z.array(text).max(20), affected_area_ids: areaIds.default([]), source_name: text,
  source_class: z.enum(['OFFICIAL', 'PARTNER', 'USER_REPORT', 'SOCIAL_MEDIA', 'OTHER']),
  severity_raw: text.min(1).max(80), status: z.enum(['ACTIVE', 'RESOLVED', 'UNKNOWN']), raw_reference: text.min(1).max(300),
  is_synthetic: z.literal(false),
}).superRefine((event, ctx) => {
  if (Date.parse(event.received_at) < Date.parse(event.occurred_at)) {
    ctx.addIssue({ code: 'custom', message: 'Live event receipt cannot precede occurrence' });
  }
});
export const liveSourceSchema = z.object({
  source_key: id, source_name: text, source_url: officialUrl,
  status: z.enum(['FRESH', 'STALE', 'UNAVAILABLE', 'BACKOFF', 'CIRCUIT_OPEN', 'INVALID_RESPONSE', 'UNSUPPORTED']),
  retrieved_at: timestamp.nullable(), last_published_at: timestamp.nullable(), next_retry_at: timestamp.nullable(),
  record_count: z.number().int().nonnegative().max(4096), detail: text,
});
export const destinationRecordSchema = z.object({
  id, name: text, address: text.nullable(), area_id: areaId,
  coordinates: z.object({ lng: z.number().finite().min(-180).max(180), lat: z.number().finite().min(-90).max(90) }),
  source_key: id, source_name: text, source_url: officialUrl, source_published_at: timestamp,
  designation_types: z.array(text).max(16), supported_hazards: z.array(z.literal('EARTHQUAKE')).max(8),
  open_status: z.enum(['OPEN', 'CLOSED', 'UNKNOWN']), is_synthetic: z.literal(false),
});
export const destinationProjectionSchema = z.object({
  destination_id: id, eligibility: z.enum(['ELIGIBLE', 'INELIGIBLE', 'UNKNOWN']),
  hazard_type: z.literal('EARTHQUAKE').nullable(), hazard_suitability: z.enum(['ELIGIBLE', 'INELIGIBLE', 'UNKNOWN']),
  freshness_status: liveFreshness, conflict: z.boolean(), evidence_ids: ids,
  current_open_status: z.enum(['OPEN', 'CLOSED', 'UNKNOWN']), checked_at: timestamp, expires_at: timestamp,
}).superRefine((destination, ctx) => {
  if (destination.eligibility === 'ELIGIBLE' && (destination.hazard_type === null
    || destination.hazard_suitability !== 'ELIGIBLE' || destination.current_open_status !== 'OPEN'
    || destination.freshness_status !== 'CURRENT' || destination.conflict)) {
    ctx.addIssue({ code: 'custom', message: 'Eligible destination is missing current official safety gates' });
  }
  if (Date.parse(destination.expires_at) <= Date.parse(destination.checked_at)) {
    ctx.addIssue({ code: 'custom', message: 'Destination expiry must follow its check time' });
  }
});
export const routePresentationSchema = z.object({
  id, status: z.enum(['UNVERIFIED', 'CANDIDATE', 'AFFECTED', 'BLOCKED', 'VERIFIED_USABLE', 'EXPIRED']),
  geometry: z.object({ type: z.literal('LineString'), coordinates: z.array(coordinatePair).min(2).max(512) }).nullable(),
  geometry_kind: z.enum(['NONE', 'TRANSIT_STATION_SEQUENCE', 'PROVIDER_GEOMETRY']), presentation_label: text,
  waypoints: z.array(text).max(64),
  crs: z.literal('EPSG:4326'), origin_area_id: areaId.nullable(), destination_id: id.nullable(),
  provider: text, provider_reference: id, checked_at: timestamp, expires_at: timestamp,
  evidence_ids: ids, freshness_status: liveFreshness, conflict: z.boolean(),
}).superRefine((route, ctx) => {
  if (Date.parse(route.expires_at) <= Date.parse(route.checked_at)) {
    ctx.addIssue({ code: 'custom', message: 'Route expiry must follow its check time' });
  }
  if ((route.geometry_kind === 'NONE') !== (route.geometry === null)) {
    ctx.addIssue({ code: 'custom', message: 'Route geometry kind must match its geometry payload' });
  }
  if (route.status === 'EXPIRED' && route.freshness_status !== 'STALE') {
    ctx.addIssue({ code: 'custom', message: 'Expired routes cannot remain current or unknown' });
  }
});
export const spatialGuidanceSchema = z.object({
  current_action_kind: z.enum(['MONITOR', 'SHELTER_IN_PLACE', 'EVACUATE', 'UNKNOWN']),
  movement_authorized: z.boolean(), destination: destinationProjectionSchema.nullable(),
  route: routePresentationSchema.nullable(), plan_id: id.nullable(), action_id: id.nullable(),
  evaluated_at: timestamp, gate_reasons: z.array(text).max(16),
  map_mount_eligible: z.boolean(),
}).superRefine((guidance, ctx) => {
  if (guidance.movement_authorized && guidance.current_action_kind !== 'EVACUATE') {
    ctx.addIssue({ code: 'custom', message: 'Movement authorization requires EVACUATE state' });
  }
  if (guidance.destination && guidance.route && guidance.route.destination_id !== guidance.destination.destination_id) {
    ctx.addIssue({ code: 'custom', message: 'Route and destination do not match' });
  }
  if (guidance.map_mount_eligible && (!guidance.movement_authorized || guidance.current_action_kind !== 'EVACUATE'
    || guidance.destination?.eligibility !== 'ELIGIBLE' || guidance.destination.freshness_status !== 'CURRENT'
    || guidance.destination.conflict || guidance.destination.current_open_status !== 'OPEN'
    || guidance.route?.status !== 'VERIFIED_USABLE' || !guidance.route.geometry
    || guidance.route.freshness_status !== 'CURRENT' || guidance.route.conflict
    || guidance.route.destination_id !== guidance.destination.destination_id)) {
    ctx.addIssue({ code: 'custom', message: 'Map eligibility is inconsistent with route or destination gates' });
  }
});
export const liveProfileSeedSchema = z.object({
  current_location: location, accommodation_location: location,
  current_destination: location.nullable().optional(), party_size: z.number().int().min(1).max(20).default(1),
  self_reported_safety_status: z.enum(['SAFE', 'UNCERTAIN', 'NEEDS_ASSISTANCE', 'UNKNOWN']).default('UNKNOWN'),
  current_plan_summary: text.max(240).default(''), accessibility_constraints: z.array(text).max(32).default([]),
});
export const liveSnapshotSchema = z.object({
  session_id: z.string().uuid(), mode: z.literal('LIVE'), source: liveSourceSchema,
  destination_source: liveSourceSchema, route_source: liveSourceSchema,
  profile: snapshotSchema.shape.profile, area_catalog: snapshotSchema.shape.area_catalog,
  situation: snapshotSchema.shape.situation, events: z.array(liveEventSchema).max(64),
  evidence: z.array(evidenceSchema).max(128), evidence_projections: z.array(evidenceProjectionSchema).max(128),
  plans: snapshotSchema.shape.plans, plan_actions: snapshotSchema.shape.plan_actions,
  trace: snapshotSchema.shape.trace, plan_evaluations: snapshotSchema.shape.plan_evaluations,
  destinations: z.array(destinationRecordSchema).max(512).default([]), routes: z.array(routePresentationSchema).max(128).default([]),
  spatial_guidance: spatialGuidanceSchema,
}).superRefine((snapshot, ctx) => {
  const evidenceIds = new Set(snapshot.evidence.map(item => item.id));
  const destinationIds = new Set(snapshot.destinations.map(item => item.id));
  const planIds = new Set(snapshot.plans.map(item => item.id));
  const sourceKeys = new Set([snapshot.source.source_key, snapshot.destination_source.source_key, snapshot.route_source.source_key]);
  const areas = new Map(snapshot.area_catalog.map(area => [area.id, area]));
  if (areas.size !== snapshot.area_catalog.length) ctx.addIssue({ code: 'custom', message: 'Duplicate area ID' });
  for (const area of snapshot.area_catalog) {
    if (area.parent_id !== null && !areas.has(area.parent_id)) ctx.addIssue({ code: 'custom', message: 'Unknown area parent' });
    const visited = new Set([area.id]);
    let parent = area.parent_id;
    while (parent !== null && areas.has(parent)) {
      if (visited.has(parent)) {
        ctx.addIssue({ code: 'custom', message: 'Area ancestry cycle' });
        break;
      }
      visited.add(parent);
      parent = areas.get(parent)!.parent_id;
    }
  }
  for (const place of [snapshot.profile.current_location, snapshot.profile.accommodation_location, snapshot.profile.current_destination]) {
    if (place === null) continue;
    if (place.area_ids.some(areaId => !areas.has(areaId))) ctx.addIssue({ code: 'custom', message: 'Location references an unknown area' });
    for (let index = 0; index + 1 < place.area_ids.length; index += 1) {
      if (areas.get(place.area_ids[index])?.parent_id !== place.area_ids[index + 1]) ctx.addIssue({ code: 'custom', message: 'Location ancestry path is not contiguous' });
    }
    const root = place.area_ids.at(-1);
    if (root && areas.get(root)?.parent_id !== null) ctx.addIssue({ code: 'custom', message: 'Location ancestry must include the catalog root' });
  }
  for (const item of snapshot.evidence) {
    if (new Set(item.affected_area_ids).size !== item.affected_area_ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate evidence area ID' });
    if (item.affected_area_ids.some(areaId => !areas.has(areaId))) ctx.addIssue({ code: 'custom', message: 'Evidence references an unknown area' });
    if (item.disaster_assessments.some(assessment => !item.affected_area_ids.includes(assessment.area_id))) {
      ctx.addIssue({ code: 'custom', message: 'Assessment area is not explicitly affected' });
    }
  }
  for (const event of snapshot.events) {
    if (event.situation_id !== snapshot.situation.id) ctx.addIssue({ code: 'custom', message: 'Live event belongs to another situation' });
    if (event.affected_area_ids.some(areaId => !areas.has(areaId))) ctx.addIssue({ code: 'custom', message: 'Event references an unknown area' });
  }
  if (snapshot.evidence.some(item => item.is_synthetic)) ctx.addIssue({ code: 'custom', message: 'Live snapshots cannot contain synthetic evidence' });
  if (snapshot.evidence.some(item => !item.source_key || !sourceKeys.has(item.source_key))) {
    ctx.addIssue({ code: 'custom', message: 'Live evidence must reference a projected live source' });
  }
  if (snapshot.situation.current_plan_id && !planIds.has(snapshot.situation.current_plan_id)) {
    ctx.addIssue({ code: 'custom', message: 'Unresolved current plan' });
  }
  for (const action of snapshot.plan_actions) {
    if (!planIds.has(action.plan_id) || action.evidence_ids.some(evidenceId => !evidenceIds.has(evidenceId))) {
      ctx.addIssue({ code: 'custom', message: 'Unresolved action reference' });
    }
  }
  for (const plan of snapshot.plans) {
    if (plan.based_on_evidence_ids.some(evidenceId => !evidenceIds.has(evidenceId))) {
      ctx.addIssue({ code: 'custom', message: 'Plan references unknown evidence' });
    }
    if (plan.previous_plan_id && !planIds.has(plan.previous_plan_id)) {
      ctx.addIssue({ code: 'custom', message: 'Plan references an unknown predecessor' });
    }
  }
  for (const evaluation of snapshot.plan_evaluations) {
    if (!planIds.has(evaluation.plan_id)) ctx.addIssue({ code: 'custom', message: 'Evaluation references an unknown plan' });
    if (evaluation.invalid_action_ids.some(actionId => !snapshot.plan_actions.some(action => action.id === actionId && action.plan_id === evaluation.plan_id))) {
      ctx.addIssue({ code: 'custom', message: 'Evaluation references an unknown plan action' });
    }
  }
  for (const item of snapshot.evidence_projections) {
    if (!evidenceIds.has(item.evidence_id)) ctx.addIssue({ code: 'custom', message: 'Unresolved evidence projection reference' });
  }
  for (const destination of snapshot.destinations) {
    if (!areas.has(destination.area_id)) ctx.addIssue({ code: 'custom', message: 'Destination references an unknown area' });
  }
  for (const route of snapshot.routes) {
    if (route.origin_area_id && !areas.has(route.origin_area_id)) ctx.addIssue({ code: 'custom', message: 'Route references an unknown origin area' });
    if (route.destination_id && !destinationIds.has(route.destination_id)) ctx.addIssue({ code: 'custom', message: 'Route references an unknown destination' });
    if (route.evidence_ids.some(evidenceId => !evidenceIds.has(evidenceId))) ctx.addIssue({ code: 'custom', message: 'Route references unknown evidence' });
  }
  const guidance = snapshot.spatial_guidance;
  if (guidance.movement_authorized || guidance.map_mount_eligible) {
    const plan = guidance.plan_id ? snapshot.plans.find(item => item.id === guidance.plan_id) : undefined;
    const action = guidance.action_id ? snapshot.plan_actions.find(item => item.id === guidance.action_id) : undefined;
    if (!plan || plan.id !== snapshot.situation.current_plan_id || plan.status !== 'ACTIVE'
      || !action || action.plan_id !== plan.id || action.category !== 'NOW' || action.status !== 'ACTIVE'
      || action.risk_level !== 'HIGH' || action.safety_decision !== 'ALLOW'
      || action.intent_id !== 'evacuate_to_designated_shelter') {
      ctx.addIssue({ code: 'custom', message: 'Movement projection must reference the current active evacuation Safety Core action' });
    }
    if (action) {
      const required = [
        ...(guidance.destination?.evidence_ids ?? []), ...(guidance.route?.evidence_ids ?? []),
      ];
      if (required.some(evidenceId => !action.evidence_ids.includes(evidenceId))) {
        ctx.addIssue({ code: 'custom', message: 'Spatial movement evidence must be selected by the active NOW action' });
      }
    }
  }
  if (guidance.map_mount_eligible) {
    const destination = guidance.destination;
    const route = guidance.route;
    if (!destination || !route || route.geometry_kind !== 'PROVIDER_GEOMETRY'
      || route.status !== 'VERIFIED_USABLE' || route.freshness_status !== 'CURRENT' || route.conflict
      || !route.geometry || route.destination_id !== destination.destination_id
      || destination.eligibility !== 'ELIGIBLE' || destination.current_open_status !== 'OPEN'
      || destination.freshness_status !== 'CURRENT' || destination.conflict
      || !destination.evidence_ids.length || !route.evidence_ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Map eligibility requires current destination and provider route evidence' });
    }
  }
  if (guidance.destination && !destinationIds.has(guidance.destination.destination_id)) {
    ctx.addIssue({ code: 'custom', message: 'Spatial guidance references an unknown destination' });
  }
  if (guidance.route && !snapshot.routes.some(route => route.id === guidance.route?.id)) {
    ctx.addIssue({ code: 'custom', message: 'Spatial guidance references an unknown route' });
  }
  if (guidance.route) {
    const canonical = snapshot.routes.find(route => route.id === guidance.route?.id);
    if (canonical) {
      const projection = guidance.route;
      const geometryMatches = JSON.stringify(canonical.geometry) === JSON.stringify(projection.geometry);
      const evidenceMatches = canonical.evidence_ids.length === projection.evidence_ids.length
        && canonical.evidence_ids.every(id => projection.evidence_ids.includes(id));
      const freshnessRank = { STALE: 0, UNKNOWN: 1, CURRENT: 2 } as const;
      const projectionExpired = projection.status === 'EXPIRED' && projection.freshness_status === 'STALE'
        && Date.parse(projection.expires_at) <= Date.parse(canonical.expires_at);
      if (canonical.geometry_kind !== projection.geometry_kind || !geometryMatches || !evidenceMatches
        || canonical.destination_id !== projection.destination_id || canonical.origin_area_id !== projection.origin_area_id
        || canonical.checked_at !== projection.checked_at || canonical.provider !== projection.provider
        || canonical.provider_reference !== projection.provider_reference
        || (canonical.conflict && !projection.conflict)
        || freshnessRank[projection.freshness_status] > freshnessRank[canonical.freshness_status]
        || (!projectionExpired && canonical.status !== projection.status)
        || Date.parse(projection.expires_at) > Date.parse(canonical.expires_at)) {
        ctx.addIssue({ code: 'custom', message: 'Spatial route projection does not match its canonical route record' });
      }
    }
  }
  for (const evidenceId of [
    ...(guidance.route?.evidence_ids ?? []), ...(guidance.destination?.evidence_ids ?? []),
  ]) {
    if (!evidenceIds.has(evidenceId)) ctx.addIssue({ code: 'custom', message: 'Spatial guidance references unknown evidence' });
  }
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type LiveSnapshot = z.infer<typeof liveSnapshotSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Action = z.infer<typeof actionSchema>;
export type LiveSource = z.infer<typeof liveSourceSchema>;
export type DestinationRecord = z.infer<typeof destinationRecordSchema>;
export type DestinationProjection = z.infer<typeof destinationProjectionSchema>;
export type RoutePresentation = z.infer<typeof routePresentationSchema>;
export type SpatialGuidance = z.infer<typeof spatialGuidanceSchema>;
export type LiveProfileSeed = z.infer<typeof liveProfileSeedSchema>;
export type Location = z.infer<typeof location>;
export type Language = 'ja' | 'en' | 'zh-TW';
export type NetworkState = z.infer<typeof networkState>;
export type AreaDefinition = z.infer<typeof areaDefinitionSchema>;
export type DisasterAssessment = z.infer<typeof disasterAssessmentSchema>;
export type ReplayScenarioOption = z.infer<typeof replayScenarioOptionSchema>;
