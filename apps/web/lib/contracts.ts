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
const disasterEventType = z.enum(['EARTHQUAKE', 'TSUNAMI']);
export const disasterAssessmentSchema = z.object({
  area_id: areaId, event_type: disasterEventType, level: disasterSeverity.nullable().default(null),
  status: z.enum(['ACTIVE', 'RESOLVED', 'UNKNOWN']),
}).superRefine((assessment, ctx) => {
  if (assessment.event_type === 'TSUNAMI' && assessment.level !== null) {
    ctx.addIssue({ code: 'custom', message: 'Tsunami assessments cannot use earthquake L0-L4 severity levels' });
  }
});
export const areaDefinitionSchema = z.object({ id: areaId, label: text, parent_id: areaId.nullable() });
const location = z.object({
  label: z.string().min(1).max(240),
  lat: z.number().finite().min(-90).max(90).nullable().default(null),
  lng: z.number().finite().min(-180).max(180).nullable().default(null),
  area_ids: areaIds.default([]),
  observed_at: timestamp.nullable().default(null),
  source: z.enum(['GPS', 'USER_SELECTED']).nullable().optional().default(null),
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
  intent_id: z.enum(['protect_and_monitor', 'review_official_guidance', 'wait_for_transport_update', 'recheck_transport_status', 'avoid_disrupted_route', 'do_not_assume_route_safety', 'evacuate_to_designated_shelter', 'shelter_in_place_vertical', 'tsunami_evacuate_now']).nullable().optional(),
  risk_level: z.enum(['LOW', 'MEDIUM', 'HIGH']), evidence_ids: ids, dependency_keys: ids,
  dependency_values: z.record(id, z.union([text, z.number().finite(), z.boolean(), z.null()])).default({}),
  status: z.enum(['ACTIVE', 'INVALID', 'EXPIRED', 'BLOCKED', 'SUPERSEDED']),
  safety_decision: z.enum(['ALLOW', 'MODIFY', 'BLOCK', 'WAIT_FOR_EVIDENCE']),
});
export const replayScenarioOptionSchema = z.object({ key: id, name: text });
export const distressTagSchema = z.enum(['WATER_RISING','TRAPPED','INJURED','MOBILITY_LIMITED','WITH_DEPENDENTS','LOST_NO_DESTINATION','ROUTE_BLOCKED_REPORTED']);
export type DistressTag = z.infer<typeof distressTagSchema>;
const distressReportSchema = z.object({ id, tags: z.array(distressTagSchema).min(1).max(7), input_mode: z.enum(['BUTTON','VOICE','TEXT']), reported_at: timestamp, source: z.literal('USER_REPORTED') });
export const distressStatusSchema = z.object({
  level: z.enum(['NONE','USER_REPORTED','OFFICIAL_TSUNAMI','OFFICIAL_STALE']),
  reports: z.array(distressReportSchema).max(16),
  trigger_evidence_ids: ids,
  deadline_at: timestamp.nullable(),
  ai_escalated: z.boolean(),
  synthetic: z.boolean(),
  // Official basis for OFFICIAL_TSUNAMI / OFFICIAL_STALE; older snapshots omit them.
  warning_class: z.enum(['MAJOR_WARNING','WARNING','ADVISORY','FORECAST','NONE','UNKNOWN']).nullable().default(null),
  last_official_at: timestamp.nullable().default(null),
  trigger_expires_at: timestamp.nullable().default(null),
  // OFFICIAL_STALE only: expired official evidence, or current evidence with a location fix older than 2 min.
  stale_reason: z.enum(['EVIDENCE_EXPIRED','LOCATION_STALE']).nullable().default(null),
});
export type DistressStatus = z.infer<typeof distressStatusSchema>;
const defaultDistress: DistressStatus = { level: 'NONE', reports: [], trigger_evidence_ids: [], deadline_at: null, ai_escalated: false, synthetic: false, warning_class: null, last_official_at: null, trigger_expires_at: null, stale_reason: null };
export const snapshotSchema = z.object({
  profile: z.object({ id, preferred_language: z.enum(['ja', 'en', 'zh-TW']), current_location: location, accommodation_location: location, current_destination: location.nullable(), party_size: z.number().int().positive(), self_reported_safety_status: z.enum(['SAFE', 'UNCERTAIN', 'NEEDS_ASSISTANCE', 'UNKNOWN']), current_plan_summary: text.default(''), accessibility_constraints: z.array(text).max(32).default([]), created_at: timestamp, updated_at: timestamp }),
  area_catalog: z.array(areaDefinitionSchema).max(512).default([]),
  situation: z.object({ id, user_id: id, incident_status: text, network_state: networkState, active_event_ids: ids, current_plan_id: id.nullable(), latest_evidence_at: timestamp.nullable(), uncertainty_flags: z.array(text).max(64), conflict_flags: z.array(text).max(64), created_at: timestamp, updated_at: timestamp, claim_states: z.array(z.object({ key: id, status: z.enum(['VERIFIED', 'UNKNOWN', 'CONFLICT']), value: z.union([text, z.number(), z.boolean(), z.null()]), evidence_ids: ids, updated_at: timestamp })).max(128).default([]) }),
  events: z.array(z.object({ id, event_type: disasterEventType, occurred_at: timestamp, affected_areas: z.array(text), affected_area_ids: areaIds.default([]), source_name: text, raw_reference: text })).max(100),
  evidence: z.array(evidenceSchema).max(200), plans: z.array(planSchema).max(100), plan_actions: z.array(actionSchema).max(1000),
  evidence_projections: z.array(evidenceProjectionSchema).max(200).default([]),
  trace: z.array(z.object({ id, timestamp, agent: text, event_type: text, input_refs: ids, output_refs: ids, status: text, public_summary: text })).max(1500),
  replay: z.object({ id, scenario_key: text, status: z.enum(['READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'RESET']), speed: z.union([z.literal(1), z.literal(2), z.literal(4)]), current_event_index: z.number().int().nonnegative(), current_time: timestamp, mode: z.literal('SYNTHETIC_REPLAY'), planning_mode: text }),
  scenario_events: z.array(z.object({ id, event_type: text, occurred_at: timestamp, offset_seconds: z.number().nonnegative(), label: text })).max(100),
  mobility: z.array(z.object({ id, status: z.enum(['AVAILABLE', 'DISRUPTED', 'UNKNOWN']), evidence_ids: ids })).max(128),
  plan_evaluations: z.array(z.object({ plan_id: id, status: z.enum(['KEEP', 'PARTIAL_INVALIDATION', 'INVALIDATED', 'EXPIRED']), evaluated_at: timestamp, reason: text.nullable(), invalid_action_ids: ids })).max(512),
  distress: distressStatusSchema.default(defaultDistress),
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
const destinationHazardType = z.enum(['FLOOD', 'LANDSLIDE', 'STORM_SURGE', 'EARTHQUAKE', 'TSUNAMI', 'LARGE_FIRE', 'INLAND_FLOOD', 'VOLCANIC']);
const destinationHazardDesignation = z.object({
  hazard_type: destinationHazardType,
  status: z.enum(['DESIGNATED', 'NOT_DESIGNATED', 'UNKNOWN']),
});
const coordinatePair = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const liveEventSchema = z.object({
  id, situation_id: id, event_type: disasterEventType, occurred_at: timestamp, received_at: timestamp,
  affected_areas: z.array(text).max(20), affected_area_ids: areaIds.default([]), source_name: text,
  source_class: z.enum(['OFFICIAL', 'PARTNER', 'USER_REPORT', 'SOCIAL_MEDIA', 'OTHER']),
  severity_raw: text.min(1).max(80), status: z.enum(['ACTIVE', 'RESOLVED', 'UNKNOWN']), raw_reference: text.min(1).max(300),
  is_synthetic: z.literal(false),
}).superRefine((event, ctx) => {
  if (Date.parse(event.received_at) < Date.parse(event.occurred_at)) {
    ctx.addIssue({ code: 'custom', message: 'Live event receipt cannot precede occurrence' });
  }
});
export const officialRecoverySchema = z.object({
  persistence: z.enum(['MEMORY', 'SQLITE', 'GCS']), storage_status: z.enum(['HEALTHY', 'UNCONFIGURED', 'FAILED']),
  scan_status: z.enum(['NOT_STARTED', 'SCANNING', 'WINDOW_VERIFIED', 'GAP', 'UNKNOWN']),
  connection_status: z.enum(['REACHABLE', 'UNAVAILABLE', 'UNKNOWN']).default('UNKNOWN'),
  last_successful_fetch_at: timestamp.nullable().default(null),
  pending_details: z.number().int().min(0).max(1024), archived_reports: z.number().int().min(0).max(4096),
  checkpoint_version: z.number().int().nonnegative(), last_checked_at: timestamp.nullable(), last_verified_at: timestamp.nullable(),
  window_start_at: timestamp.nullable(), coverage_origin_at: timestamp.nullable(), restored: z.boolean(), limitations: z.array(text).max(8),
  reconciliation_required_since: timestamp.nullable().default(null),
}).superRefine((recovery, ctx) => {
  if (recovery.scan_status === 'WINDOW_VERIFIED' && (recovery.pending_details > 0 || recovery.last_verified_at === null || recovery.reconciliation_required_since !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Incomplete official recovery cannot be verified' });
  }
  if (recovery.storage_status === 'FAILED' && recovery.scan_status !== 'UNKNOWN') {
    ctx.addIssue({ code: 'custom', message: 'Failed persistence cannot support verified recovery' });
  }
});
export const officialReportSchema = z.object({
  report_id: z.string().regex(/^[a-f0-9]{24}--[a-f0-9]{24}$/), group_id: z.string().regex(/^[a-f0-9]{24}$/),
  product: z.enum(['VXSE53', 'VTSE41']), title: z.string().min(1).max(80), source_name: text,
  reference_url: officialUrl.refine(url => { const parsed = new URL(url); return parsed.hostname === 'www.data.jma.go.jp'
    && parsed.pathname.startsWith('/developer/xml/data/') && !parsed.search && !parsed.hash; }),
  event_ids: z.array(z.string().regex(/^\d{14}$/)).min(1).max(8), serial: z.string().max(16).nullable(),
  operation: z.enum(['ISSUE', 'CANCEL']), lifecycle: z.enum(['CURRENT', 'STALE', 'WITHDRAWN', 'SUPERSEDED', 'CONFLICT', 'UNKNOWN']),
  issued_at: timestamp, reported_at: timestamp, received_at: timestamp, target_at: timestamp.nullable(), occurred_at: timestamp.nullable(),
  official_valid_until: timestamp.nullable(), evidence_expires_at: timestamp, target_codes: z.array(z.string().min(1).max(32)).max(128),
  is_head: z.boolean(), superseded_by: id.nullable(), raw_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  parser_version: text, information_version: text, code_mapping_version: text,
  authority: z.literal('REFERENCE_ONLY'), eligible_for_action: z.literal(false),
}).superRefine((report, ctx) => {
  if (report.report_id !== `${report.group_id}--${report.raw_sha256.slice(0, 24)}`
    || Date.parse(report.reported_at) > Date.parse(report.issued_at) || Date.parse(report.issued_at) > Date.parse(report.received_at)
    || (report.lifecycle === 'CURRENT' && !report.is_head)) {
    ctx.addIssue({ code: 'custom', message: 'Official reference identity/time inconsistent' });
  }
});
export const liveSourceSchema = z.object({
  source_key: id, source_name: text, source_url: officialUrl,
  status: z.enum(['FRESH', 'STALE', 'UNAVAILABLE', 'BACKOFF', 'CIRCUIT_OPEN', 'INVALID_RESPONSE', 'UNSUPPORTED']),
  retrieved_at: timestamp.nullable(), last_published_at: timestamp.nullable(), next_retry_at: timestamp.nullable(),
  record_count: z.number().int().nonnegative().max(4096), detail: text,
  recovery: officialRecoverySchema.nullable().default(null),
}).superRefine((source, ctx) => {
  if (source.status === 'FRESH' && source.recovery && source.recovery.scan_status !== 'WINDOW_VERIFIED') {
    ctx.addIssue({ code: 'custom', message: 'Incomplete recovery cannot present a fresh official source' });
  }
});
const tsunamiOperation = z.enum(['ISSUE', 'UPDATE', 'CANCEL', 'CORRECTION', 'UNKNOWN']);
const tsunamiAreaStatus = z.enum(['ACTIVE', 'CANCELLED', 'UNKNOWN']);
const tsunamiReferenceStatus = z.enum(['ACTIVE', 'CANCELLED', 'UNKNOWN', 'CONFLICT']);
const tsunamiSourceStatus = z.enum(['CURRENT', 'STALE', 'UNKNOWN', 'CONFLICT']);
const tsunamiMaxHeightSchema = z.object({
  value_m: z.number().finite().min(0).max(100).nullable(),
  expression: z.enum(['NUMERIC', 'HIGH', 'HUGE', 'UNKNOWN']),
  description: text.nullable(),
}).superRefine((height, ctx) => {
  if ((height.value_m !== null) !== (height.expression === 'NUMERIC')) {
    ctx.addIssue({ code: 'custom', message: 'Numeric tsunami heights require NUMERIC expression; symbolic heights require null' });
  }
});
export const tsunamiReferenceSchema = z.object({
  mode: z.literal('LIVE_REFERENCE'),
  event_type: z.literal('TSUNAMI'),
  status: tsunamiReferenceStatus,
  source_status: tsunamiSourceStatus,
  source: z.object({
    source_id: z.literal('jma-bosai-xml'), product_code: z.literal('VTSE41'),
    name: text.min(1).max(240), url: officialUrl,
    published_at: timestamp.nullable(), fetched_at: timestamp.nullable(),
    operation: tsunamiOperation, serial: z.string().max(16).nullable(),
    recovery: officialRecoverySchema.nullable().default(null),
  }),
  forecast_areas: z.array(z.object({
    area_code: z.string().regex(/^\d{3}$/), area_name: text.min(1).max(240),
    status: tsunamiAreaStatus,
    warning_class: z.enum(['MAJOR_WARNING', 'WARNING', 'ADVISORY', 'FORECAST', 'NONE', 'UNKNOWN']),
    max_height: tsunamiMaxHeightSchema, arrival_at: timestamp.nullable(),
  })).max(128),
  safety_authority: z.literal('NONE'),
  official_reports: z.array(officialReportSchema).max(128).default([]),
}).superRefine((reference, ctx) => {
  const codes = reference.forecast_areas.map(area => area.area_code);
  if (new Set(codes).size !== codes.length) ctx.addIssue({ code: 'custom', message: 'Tsunami forecast area codes must be unique' });
  if (reference.source_status === 'CONFLICT' && reference.status !== 'CONFLICT') {
    ctx.addIssue({ code: 'custom', message: 'Conflicting source state must remain visible as CONFLICT' });
  }
  if (reference.source_status !== 'CURRENT' && reference.forecast_areas.some(area => area.status !== 'UNKNOWN')) {
    ctx.addIssue({ code: 'custom', message: 'Stale, unavailable, or conflicting tsunami areas must remain UNKNOWN' });
  }
  if (reference.status !== 'ACTIVE' && reference.forecast_areas.some(area => area.status === 'ACTIVE')) {
    ctx.addIssue({ code: 'custom', message: 'Non-active tsunami reference cannot contain active forecast areas' });
  }
  if (reference.status === 'ACTIVE' && !reference.forecast_areas.some(area => area.status === 'ACTIVE')) {
    ctx.addIssue({ code: 'custom', message: 'ACTIVE tsunami reference requires an active forecast area' });
  }
});
const destinationHazardDesignations = z.array(destinationHazardDesignation).length(8).nullable().optional().default(null).superRefine((items, ctx) => {
  if (items !== null && new Set(items.map(item => item.hazard_type)).size !== 8) {
    ctx.addIssue({ code: 'custom', message: 'Destination hazard designations must contain each hazard type once' });
  }
});
export const destinationRecordSchema = z.object({
  id, name: text, address: text.nullable(), area_id: areaId,
  coordinates: z.object({ lng: z.number().finite().min(-180).max(180), lat: z.number().finite().min(-90).max(90) }),
  source_key: id, source_name: text, source_url: officialUrl, source_published_at: timestamp.nullable().optional().default(null),
  designation_types: z.array(text).max(16),
  designation_roles: z.array(z.enum(['EMERGENCY_EVACUATION_SITE', 'EVACUATION_SHELTER'])).max(2).nullable().optional().default(null),
  hazard_designations: destinationHazardDesignations,
  supported_hazards: z.array(disasterEventType).max(8),
  open_status: z.enum(['OPEN', 'CLOSED', 'UNKNOWN']), is_synthetic: z.literal(false),
});
export const destinationProjectionSchema = z.object({
  destination_id: id, eligibility: z.enum(['ELIGIBLE', 'INELIGIBLE', 'UNKNOWN']),
  hazard_type: disasterEventType.nullable(), hazard_suitability: z.enum(['ELIGIBLE', 'INELIGIBLE', 'UNKNOWN']),
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
  official_reports: z.array(officialReportSchema).max(128).default([]),
  official_sources: z.array(liveSourceSchema).max(2).default([]),
  distress: distressStatusSchema.default(defaultDistress),
}).superRefine((snapshot, ctx) => {
  if (snapshot.situation.network_state === 'ONLINE_VERIFIED'
    && [snapshot.source, ...snapshot.official_sources].some(source => source.recovery && source.recovery.scan_status !== 'WINDOW_VERIFIED')) {
    ctx.addIssue({ code: 'custom', message: 'Incomplete official recovery cannot support ONLINE_VERIFIED' });
  }
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
export type OfficialReport = z.infer<typeof officialReportSchema>;
export type TsunamiReferenceResponse = z.infer<typeof tsunamiReferenceSchema>;
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
