import { z } from 'zod';

const timestamp = z.iso.datetime({ offset: true });
const id = z.string().min(1).max(160);
const text = z.string().max(4000);
const ids = z.array(id).max(200);
export const networkState = z.enum(['ONLINE_VERIFIED', 'ONLINE_DEGRADED', 'OFFLINE_RECENT', 'OFFLINE_STALE', 'RECONNECTING']);
export const planStatus = z.enum(['DRAFT', 'ACTIVE', 'PARTIALLY_INVALID', 'INVALIDATED', 'EXPIRED', 'SUPERSEDED']);
export const evidenceSchema = z.object({
  id, situation_id: id, source_name: text,
  source_class: z.enum(['OFFICIAL', 'PARTNER', 'USER_REPORT', 'SOCIAL_MEDIA', 'OTHER']),
  trust_status: z.enum(['VERIFIED_OFFICIAL', 'VERIFIED_PARTNER', 'UNVERIFIED', 'CONFLICTING', 'STALE', 'REJECTED']),
  freshness_status: z.enum(['CURRENT', 'STALE', 'UNKNOWN']),
  published_at: timestamp, received_at: timestamp, expires_at: timestamp.nullable(),
  relevant_areas: z.array(text).max(20), claim_type: text,
  claims: z.array(z.object({ key: id, value: z.union([text, z.number().finite(), z.boolean(), z.null()]) })).max(40),
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
  risk_level: z.enum(['LOW', 'MEDIUM', 'HIGH']), evidence_ids: ids, dependency_keys: ids,
  dependency_values: z.record(id, z.union([text, z.number().finite(), z.boolean(), z.null()])).default({}),
  status: z.enum(['ACTIVE', 'INVALID', 'EXPIRED', 'BLOCKED', 'SUPERSEDED']),
  safety_decision: z.enum(['ALLOW', 'MODIFY', 'BLOCK', 'WAIT_FOR_EVIDENCE']),
});
const location = z.object({ label: text });
export const snapshotSchema = z.object({
  profile: z.object({ id, preferred_language: z.enum(['ja', 'en', 'zh-TW']), current_location: location, accommodation_location: location, current_destination: location.nullable(), party_size: z.number().int().positive(), self_reported_safety_status: z.enum(['SAFE', 'UNCERTAIN', 'NEEDS_ASSISTANCE', 'UNKNOWN']), created_at: timestamp, updated_at: timestamp }),
  situation: z.object({ id, user_id: id, incident_status: text, network_state: networkState, active_event_ids: ids, current_plan_id: id.nullable(), latest_evidence_at: timestamp.nullable(), uncertainty_flags: z.array(text).max(64), conflict_flags: z.array(text).max(64), created_at: timestamp, updated_at: timestamp, claim_states: z.array(z.object({ key: id, status: z.enum(['VERIFIED', 'UNKNOWN', 'CONFLICT']), value: z.union([text, z.number(), z.boolean(), z.null()]), evidence_ids: ids, updated_at: timestamp })).max(128).default([]) }),
  events: z.array(z.object({ id, event_type: z.literal('EARTHQUAKE'), occurred_at: timestamp, affected_areas: z.array(text), source_name: text, raw_reference: text })).max(100),
  evidence: z.array(evidenceSchema).max(200), plans: z.array(planSchema).max(100), plan_actions: z.array(actionSchema).max(1000),
  evidence_projections: z.array(z.object({ evidence_id: id, freshness_status: z.enum(['CURRENT', 'STALE', 'UNKNOWN']), age_seconds: z.number(), ttl_seconds: z.number(), expires_at: timestamp.nullable(), conflict: z.boolean(), eligible_for_claims: z.boolean(), eligible_for_high_risk: z.boolean() })).max(200).default([]),
  trace: z.array(z.object({ id, timestamp, agent: text, event_type: text, input_refs: ids, output_refs: ids, status: text, public_summary: text })).max(1500),
  replay: z.object({ id, scenario_key: text, status: z.enum(['READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'RESET']), speed: z.union([z.literal(1), z.literal(2), z.literal(4)]), current_event_index: z.number().int().nonnegative(), current_time: timestamp, mode: z.literal('SYNTHETIC_REPLAY'), planning_mode: text }),
  scenario_events: z.array(z.object({ id, event_type: text, occurred_at: timestamp, offset_seconds: z.number().nonnegative(), label: text })).max(100),
  mobility: z.array(z.object({ id, status: z.enum(['AVAILABLE', 'DISRUPTED', 'UNKNOWN']), evidence_ids: ids })).max(128),
  plan_evaluations: z.array(z.object({ plan_id: id, status: z.enum(['KEEP', 'PARTIAL_INVALIDATION', 'INVALIDATED', 'EXPIRED']), evaluated_at: timestamp, reason: text.nullable(), invalid_action_ids: ids })).max(512),
}).superRefine((state, ctx) => {
  const evidenceIds = new Set(state.evidence.map(e => e.id));
  const planIds = new Set(state.plans.map(p => p.id));
  if (state.situation.current_plan_id && !planIds.has(state.situation.current_plan_id)) ctx.addIssue({ code: 'custom', message: 'Unresolved current plan' });
  for (const action of state.plan_actions) {
    if (!planIds.has(action.plan_id) || action.evidence_ids.some(e => !evidenceIds.has(e))) ctx.addIssue({ code: 'custom', message: 'Unresolved action reference' });
  }
  if (state.replay.current_event_index > state.scenario_events.length) ctx.addIssue({ code: 'custom', message: 'Invalid replay position' });
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Action = z.infer<typeof actionSchema>;
export type Language = 'ja' | 'en' | 'zh-TW';
