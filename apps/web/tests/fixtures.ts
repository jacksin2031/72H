import { snapshotSchema, type Snapshot } from '../lib/contracts';

export function activeSnapshot(): Snapshot {
  const at = '2026-10-04T17:43:00+09:00';
  return snapshotSchema.parse({
    profile: { id: 'user', preferred_language: 'ja', current_location: { label: 'Shibuya' }, accommodation_location: { label: 'Asakusa' }, current_destination: { label: 'Asakusa' }, party_size: 1, self_reported_safety_status: 'SAFE', created_at: at, updated_at: at },
    situation: { id: 'situation', user_id: 'user', incident_status: 'PLAN_ACTIVE', network_state: 'ONLINE_VERIFIED', active_event_ids: [], current_plan_id: 'plan_v1', latest_evidence_at: at, uncertainty_flags: [], conflict_flags: [], created_at: at, updated_at: at },
    events: [], trace: [], mobility: [], plan_evaluations: [], scenario_events: [],
    replay: { id: 'session', scenario_key: 'tokyo-earthquake-v1', status: 'PAUSED', speed: 1, current_event_index: 0, current_time: at, mode: 'SYNTHETIC_REPLAY', planning_mode: 'DETERMINISTIC_REPLAY_ONLY' },
    evidence: [{ id: 'ev-route', situation_id: 'situation', source_name: 'Synthetic transport', source_class: 'PARTNER', trust_status: 'VERIFIED_PARTNER', freshness_status: 'CURRENT', published_at: at, received_at: at, expires_at: '2026-10-04T17:48:00+09:00', relevant_areas: ['Tokyo'], claim_type: 'TRANSPORT_STATUS', claims: [{ key: 'route.status', value: 'DISRUPTED' }], summary: 'Synthetic route update', conflict_group: null, conflict: false, eligible_for_high_risk: false, raw_reference: 'replay://route', is_synthetic: true }],
    plans: [{ id: 'plan_v1', situation_id: 'situation', version: 1, status: 'ACTIVE', created_at: at, expires_at: '2026-10-04T17:58:00+09:00', invalidate_on_new_relevant_evidence: true, based_on_evidence_ids: ['ev-route'], previous_plan_id: null, invalidation_reason: null, changed_action_ids: [], language: 'ja' }],
    plan_actions: [{ id: 'action', plan_id: 'plan_v1', category: 'NEXT', text: 'Wait for verified transport updates', reason: 'Synthetic transport disruption', risk_level: 'MEDIUM', evidence_ids: ['ev-route'], dependency_keys: ['route.status'], dependency_values: { 'route.status': 'DISRUPTED' }, status: 'ACTIVE', safety_decision: 'ALLOW' }],
  });
}
