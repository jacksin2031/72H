import { z } from 'zod';
import { liveSnapshotSchema, snapshotSchema, type Action, type Evidence, type LiveSnapshot, type Snapshot } from './contracts';
import { evidenceMatchesProfile } from './area-scoping';

export const cacheEnvelopeSchema = z.object({
  schema_version: z.literal(1), saved_at: z.number().finite().nonnegative(), snapshot: snapshotSchema,
  connection: z.enum(['online', 'offline', 'reconnecting']).default('online'),
});
export type CacheEnvelope = z.infer<typeof cacheEnvelopeSchema>;
export const liveCacheEnvelopeSchema = z.object({
  schema_version: z.literal(1), saved_at: z.number().finite().nonnegative(), snapshot: liveSnapshotSchema,
});
export type LiveCacheEnvelope = z.infer<typeof liveCacheEnvelopeSchema>;
const ttl: Record<string, number> = { TRANSPORT_STATUS: 300_000, DISASTER_STATUS: 900_000, USER_REPORT: 600_000, GENERAL_UPDATE: 900_000 };

export function evidenceAt(evidence: Evidence, now: number): Evidence {
  const published = Date.parse(evidence.published_at);
  const policyExpiry = published + (ttl[evidence.claim_type] || 0);
  const expiry = evidence.expires_at ? Math.min(Date.parse(evidence.expires_at), policyExpiry) : policyExpiry;
  const freshness_status = !Number.isFinite(now) || published > now ? 'UNKNOWN' : now >= expiry ? 'STALE' : evidence.freshness_status;
  return { ...evidence, freshness_status, eligible_for_high_risk: false };
}
function eligible(e: Evidence) {
  return ['VERIFIED_OFFICIAL', 'VERIFIED_PARTNER'].includes(e.trust_status) && e.freshness_status === 'CURRENT' && !e.conflict && !e.conflict_group;
}
export function dependencyValues(evidence: Evidence[]) {
  const groups = new Map<string, Evidence[]>();
  for (const e of evidence.filter(eligible)) for (const c of e.claims) groups.set(c.key, [...(groups.get(c.key) || []), e]);
  const values = new Map<string, unknown>();
  for (const [key, records] of groups) {
    const published = Math.max(...records.map(e => Date.parse(e.published_at)));
    const candidates = records.filter(e => Date.parse(e.published_at) === published).flatMap(e => e.claims.filter(c => c.key === key).map(c => c.value));
    values.set(key, candidates.every(v => v === candidates[0]) ? candidates[0] : 'CONFLICT');
  }
  return values;
}

type ContinuityState = Pick<Snapshot, 'profile' | 'area_catalog' | 'evidence' | 'evidence_projections' | 'plans' | 'plan_actions' | 'plan_evaluations' | 'situation'>;
/** A read projection; immutable published plans and evidence are never rewritten. */
export function projectContinuity(snapshot: ContinuityState, now: number, connection: 'online' | 'offline' | 'reconnecting') {
  const projections = new Map(snapshot.evidence_projections.map(p => [p.evidence_id, p]));
  const evidence = snapshot.evidence.map(e => {
    const p = projections.get(e.id);
    return evidenceAt(p ? { ...e, freshness_status: p.freshness_status, conflict: e.conflict || p.conflict, expires_at: p.expires_at } : e, now);
  });
  const byId = new Map(evidence.map(e => [e.id, e]));
  const dependencies = dependencyValues(evidence.filter(e => evidenceMatchesProfile(e, snapshot)));
  const plan = snapshot.plans.find(p => p.id === snapshot.situation.current_plan_id) || snapshot.plans.at(-1);
  const evaluation = plan && snapshot.plan_evaluations.findLast(e => e.plan_id === plan.id);
  const expired = !!plan && now >= Date.parse(plan.expires_at);
  const actionInvalid = (action: Action) => {
    if (expired || action.status !== 'ACTIVE' || ['BLOCK', 'WAIT_FOR_EVIDENCE'].includes(action.safety_decision)) return true;
    if (evaluation?.invalid_action_ids.includes(action.id)) return true;
    // The client can only degrade. High-risk movement is unavailable in continuity mode.
    if (action.risk_level === 'HIGH') return true;
    if (action.evidence_ids.some(id => !byId.has(id))) return true;
    if (action.risk_level !== 'LOW' && (!action.evidence_ids.length || action.evidence_ids.some(id => !eligible(byId.get(id)!) || !evidenceMatchesProfile(byId.get(id)!, snapshot)))) return true;
    return action.dependency_keys.some(key => {
      const actual = dependencies.get(key) ?? 'UNKNOWN';
      return actual === 'CONFLICT' || actual !== (action.dependency_values[key] ?? 'UNKNOWN');
    });
  };
  const currentActions = snapshot.plan_actions.filter(a => a.plan_id === plan?.id);
  const invalidActionIds = currentActions.filter(actionInvalid).map(a => a.id);
  const stale = evidence.some(e => e.freshness_status !== 'CURRENT' && ['VERIFIED_OFFICIAL', 'VERIFIED_PARTNER'].includes(e.trust_status));
  const networkState = connection === 'offline' ? (stale || expired ? 'OFFLINE_STALE' : 'OFFLINE_RECENT') : connection === 'reconnecting' ? 'RECONNECTING' : snapshot.situation.network_state;
  const localStatus = invalidActionIds.length === currentActions.length ? 'INVALIDATED' : 'PARTIALLY_INVALID';
  return { evidence, plan, invalidActionIds, networkState, planStatus: expired ? 'EXPIRED' : evaluation?.status === 'INVALIDATED' ? 'INVALIDATED' : invalidActionIds.length ? localStatus : evaluation?.status || plan?.status || 'UNKNOWN' };
}

export function replayClock(envelope: CacheEnvelope, wallNow: number) {
  return Date.parse(envelope.snapshot.replay.current_time) + Math.max(0, wallNow - envelope.saved_at);
}

/** Wake exactly when safety-relevant cached evidence/plan expires, even in survival mode. */
export function nextSafetyDeadline(snapshot: Snapshot, now: number): number | null {
  const dates = snapshot.evidence.filter(e => ['VERIFIED_OFFICIAL', 'VERIFIED_PARTNER'].includes(e.trust_status) && e.freshness_status === 'CURRENT').map(e => {
    const policyExpiry = Date.parse(e.published_at) + (ttl[e.claim_type] || 0);
    return e.expires_at ? Math.min(Date.parse(e.expires_at), policyExpiry) : policyExpiry;
  });
  const plan = snapshot.plans.find(p => p.id === snapshot.situation.current_plan_id) || snapshot.plans.at(-1);
  if (plan) dates.push(Date.parse(plan.expires_at));
  const future = dates.filter(at => Number.isFinite(at) && at > now);
  return Number.isFinite(now) && future.length ? Math.min(...future) : null;
}

export function canReconcile(previous: Snapshot, received: Snapshot, now: number) {
  if (received.situation.network_state !== 'ONLINE_VERIFIED') return false;
  if (received.situation.claim_states.some(c => c.status === 'CONFLICT')) return false;
  const values = dependencyValues(received.evidence.map(e => evidenceAt(e, now)));
  if ([...values.values()].includes('CONFLICT')) return false;
  const previousIds = new Set(previous.evidence.map(e => e.id));
  const fresh = received.evidence.filter(e => !previousIds.has(e.id) && evidenceMatchesProfile(e, received)).map(e => evidenceAt(e, now)).filter(eligible);
  return fresh.some(e => e.source_class === 'OFFICIAL') && fresh.some(e => e.source_class === 'PARTNER');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('72h-continuity-v1', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('snapshots')) request.result.createObjectStore('snapshots');
      if (!request.result.objectStoreNames.contains('live-snapshots')) request.result.createObjectStore('live-snapshots');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Offline storage unavailable'));
  });
}
export async function saveSnapshot(envelope: CacheEnvelope) {
  const approved = cacheEnvelopeSchema.parse(envelope);
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('snapshots', 'readwrite');
      transaction.objectStore('snapshots').put(approved, 'last-verified');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Offline snapshot not saved'));
      transaction.onabort = () => reject(new Error('Offline snapshot not saved'));
    });
  } finally { database.close(); }
}
export async function loadSnapshot(): Promise<CacheEnvelope | null> {
  const database = await openDatabase();
  try {
    const raw = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction('snapshots', 'readonly');
      const request = transaction.objectStore('snapshots').get('last-verified');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Offline snapshot unavailable'));
    });
    const parsed = cacheEnvelopeSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } finally { database.close(); }
}

/** Live data is cached separately from deterministic synthetic replay sessions. */
export async function saveLiveSnapshot(snapshot: LiveSnapshot, savedAt = Date.now()) {
  const approved = liveCacheEnvelopeSchema.parse({ schema_version: 1, saved_at: savedAt, snapshot });
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('live-snapshots', 'readwrite');
      transaction.objectStore('live-snapshots').put(approved, 'last-live');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Live snapshot not saved'));
      transaction.onabort = () => reject(new Error('Live snapshot not saved'));
    });
  } finally { database.close(); }
}

export async function loadLiveSnapshot(): Promise<LiveCacheEnvelope | null> {
  const database = await openDatabase();
  try {
    const raw = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction('live-snapshots', 'readonly');
      const request = transaction.objectStore('live-snapshots').get('last-live');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Live snapshot unavailable'));
    });
    const parsed = liveCacheEnvelopeSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } finally { database.close(); }
}
