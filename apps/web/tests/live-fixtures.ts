import { liveSnapshotSchema, type LiveSnapshot } from '../lib/contracts';
import { activeSnapshot } from './fixtures';

export const LIVE_NOW = Date.parse('2026-10-06T12:00:00+09:00');
const at = (offsetMs: number) => new Date(LIVE_NOW + offsetMs).toISOString();

export function movementLiveSnapshot(): LiveSnapshot {
  const base = activeSnapshot();
  const checkedAt = at(-10_000);
  const publishedAt = at(-30_000);
  const receivedAt = at(-20_000);
  const expiry = at(900_000);
  const source = (source_key: string, record_count = 1) => ({
    source_key, source_name: source_key, source_url: 'https://data.example.jp/live', status: 'FRESH' as const,
    retrieved_at: checkedAt, last_published_at: publishedAt, next_retry_at: null, record_count, detail: 'test fixture',
  });
  const claims = [
    { key: 'movement.directive.JP-13-SHIBUYA', value: 'EVACUATE_TO_DESIGNATED_SHELTER' },
    ...Array.from({ length: 63 }, (_, index) => ({ key: `jma.claim.${index}`, value: index })),
  ];
  const evidence = [
    { id: 'ev-directive', situation_id: 'live-situation', source_key: 'JMA_DISASTER_XML', source_name: 'JMA', source_class: 'OFFICIAL',
      trust_status: 'VERIFIED_OFFICIAL', freshness_status: 'CURRENT', published_at: publishedAt, received_at: receivedAt,
      expires_at: expiry, relevant_areas: ['Shibuya'], affected_area_ids: ['JP-13-SHIBUYA'], disaster_assessments: [],
      claim_type: 'MOVEMENT_DIRECTIVE', claims, summary: 'Typed movement directive', conflict_group: null, conflict: false,
      eligible_for_high_risk: true, raw_reference: 'https://data.example.jp/jma/event', is_synthetic: false },
    { id: 'ev-destination', situation_id: 'live-situation', source_key: 'TOKYO_SHELTER_CSV', source_name: 'Tokyo Open Data', source_class: 'OFFICIAL',
      trust_status: 'VERIFIED_OFFICIAL', freshness_status: 'CURRENT', published_at: publishedAt, received_at: receivedAt,
      expires_at: expiry, relevant_areas: ['Tokyo'], affected_area_ids: ['JP-13'], disaster_assessments: [],
      claim_type: 'DESTINATION_STATUS', claims: [
        { key: 'destination.shelter-asakusa.open_status', value: 'OPEN' },
        { key: 'destination.shelter-asakusa.hazard.EARTHQUAKE.suitability', value: 'ELIGIBLE' },
      ], summary: 'Typed destination status', conflict_group: null, conflict: false,
      eligible_for_high_risk: true, raw_reference: 'https://data.example.jp/shelters/1', is_synthetic: false },
    { id: 'ev-route', situation_id: 'live-situation', source_key: 'JARTIC_ROAD_STATUS', source_name: 'JARTIC', source_class: 'OFFICIAL',
      trust_status: 'VERIFIED_OFFICIAL', freshness_status: 'CURRENT', published_at: publishedAt, received_at: receivedAt,
      expires_at: expiry, relevant_areas: ['Shibuya', 'Tokyo'], affected_area_ids: ['JP-13-SHIBUYA', 'JP-13'],
      disaster_assessments: [], claim_type: 'ROUTE_STATUS', claims: [
        { key: 'route.route-live-1.safety_status', value: 'VERIFIED_USABLE' },
      ], summary: 'Typed route status', conflict_group: null, conflict: false,
      eligible_for_high_risk: true, raw_reference: 'https://data.example.jp/roads/1', is_synthetic: false },
  ];
  const destination = {
    id: 'shelter-asakusa', name: 'Asakusa designated shelter', address: null, area_id: 'JP-13',
    coordinates: { lng: 139.8, lat: 35.71 }, source_key: 'TOKYO_SHELTER_CSV', source_name: 'Tokyo Open Data',
    source_url: 'https://data.example.jp/shelters', source_published_at: publishedAt,
    designation_types: ['DESIGNATED_EVACUATION_PLACE'], supported_hazards: ['EARTHQUAKE'], open_status: 'UNKNOWN', is_synthetic: false,
  };
  const destinations = [destination, ...Array.from({ length: 511 }, (_, index) => ({
    ...destination, id: `shelter-other-${index + 1}`, name: `Tokyo shelter ${index + 1}`,
    coordinates: { lng: 139.81 + index / 100_000, lat: 35.72 + index / 100_000 },
  }))];
  const route = {
    id: 'route-live-1', status: 'VERIFIED_USABLE', geometry: { type: 'LineString', coordinates: [[139.7, 35.66], [139.8, 35.71]] },
    geometry_kind: 'PROVIDER_GEOMETRY', presentation_label: 'Current verified candidate', waypoints: [], crs: 'EPSG:4326',
    origin_area_id: 'JP-13-SHIBUYA', destination_id: destination.id, provider: 'JARTIC', provider_reference: 'road-route-1',
    checked_at: checkedAt, expires_at: expiry, evidence_ids: ['ev-route'], freshness_status: 'CURRENT', conflict: false,
  };
  const plan = {
    id: 'plan-live-1', situation_id: 'live-situation', version: 1, status: 'ACTIVE', created_at: publishedAt,
    expires_at: at(1_200_000), invalidate_on_new_relevant_evidence: true,
    based_on_evidence_ids: evidence.map(item => item.id), previous_plan_id: null, invalidation_reason: null,
    changed_action_ids: [], language: 'zh-TW',
  };
  const action = {
    id: 'action-live-1', plan_id: plan.id, category: 'NOW',
    text: 'Go to the designated shelter shown in the current plan.', reason: 'The typed evidence supports the current movement action.',
    intent_id: 'evacuate_to_designated_shelter', risk_level: 'HIGH', evidence_ids: evidence.map(item => item.id),
    dependency_keys: [], dependency_values: {}, status: 'ACTIVE', safety_decision: 'ALLOW',
  };
  const routeProjection = { ...route };
  const payload = {
    session_id: 'f247799c-95d9-4d77-a830-f978e7e1352a', mode: 'LIVE',
    source: source('JMA_DISASTER_XML'), destination_source: source('TOKYO_SHELTER_CSV', destinations.length),
    route_source: source('JARTIC_ROAD_STATUS'), profile: base.profile, area_catalog: base.area_catalog,
    situation: { ...base.situation, id: 'live-situation', current_plan_id: plan.id, latest_evidence_at: publishedAt,
      network_state: 'ONLINE_VERIFIED', conflict_flags: [], claim_states: [], updated_at: checkedAt },
    events: [], evidence,
    evidence_projections: evidence.map(item => ({ evidence_id: item.id, freshness_status: 'CURRENT', age_seconds: 30,
      ttl_seconds: 900, expires_at: expiry, conflict: false, eligible_for_claims: true, eligible_for_high_risk: true })),
    plans: [plan], plan_actions: [action], trace: [], plan_evaluations: [], destinations, routes: [route],
    spatial_guidance: {
      current_action_kind: 'EVACUATE', movement_authorized: true,
      destination: { destination_id: destination.id, eligibility: 'ELIGIBLE', hazard_type: 'EARTHQUAKE',
        hazard_suitability: 'ELIGIBLE', freshness_status: 'CURRENT', conflict: false, evidence_ids: ['ev-destination'],
        current_open_status: 'OPEN', checked_at: checkedAt, expires_at: expiry },
      route: routeProjection, plan_id: plan.id, action_id: action.id, evaluated_at: checkedAt,
      gate_reasons: [], map_mount_eligible: true,
    },
  };
  return liveSnapshotSchema.parse(payload);
}
