import { z } from 'zod';
import { dependencyValues, projectContinuity, canReconcile } from './continuity';
import { type Evidence, type Snapshot } from './contracts';
import { evidenceMatchesProfile, profileAreaIds } from './area-scoping';

export const sourceAuthoritySchema = z.enum(['A0', 'A1', 'A2', 'A3', 'A4']);
export type SourceAuthority = z.infer<typeof sourceAuthoritySchema>;

export function sourceAuthority(evidence: Evidence): SourceAuthority {
  if (evidence.source_class === 'USER_REPORT' || evidence.source_class === 'SOCIAL_MEDIA') return 'A1';
  if (evidence.source_class === 'PARTNER' && evidence.trust_status === 'VERIFIED_PARTNER') return 'A2';
  if (evidence.source_class === 'OFFICIAL' && evidence.trust_status === 'VERIFIED_OFFICIAL') return 'A3';
  // A4 is reserved for a registry the client does not have. Source names and claims never grant it.
  return 'A0';
}

export type SeverityLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'UNKNOWN' | 'CONFLICT';
export type SeverityActionState = 'NORMAL' | 'MONITOR' | 'PREPARE' | 'SHELTER_IN_PLACE' | 'EVACUATE' | 'EMERGENCY_PROTECT';
export type DerivedSeverity = {
  level: SeverityLevel;
  actionState: SeverityActionState;
  evidenceIds: string[];
  synthetic: boolean;
  criticalEventKey: string | null;
};

type SeverityRecord =
  | { evidence: Evidence; kind: 'LEVEL'; value: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' }
  | { evidence: Evidence; kind: 'STATUS'; value: 'ACTIVE' | 'RESOLVED' | 'UNKNOWN' };

function isLocationRelevant(evidence: Evidence, snapshot: Snapshot) {
  return evidenceMatchesProfile(evidence, snapshot);
}

function isSeverityLevel(value: unknown): value is 'L0' | 'L1' | 'L2' | 'L3' | 'L4' {
  return value === 'L0' || value === 'L1' || value === 'L2' || value === 'L3' || value === 'L4';
}

function latestSeverity(records: SeverityRecord[]) {
  if (!records.length) return null;
  const dated = records.map(record => ({ ...record, published: Date.parse(record.evidence.published_at) }))
    .filter(record => Number.isFinite(record.published));
  if (!dated.length) return null;
  const newest = Math.max(...dated.map(record => record.published));
  const winners = dated.filter(record => record.published === newest);
  const levels = new Set(winners.filter(record => record.kind === 'LEVEL').map(record => record.value));
  const statuses = new Set(winners.filter(record => record.kind === 'STATUS').map(record => record.value));
  const level = levels.size > 1 || statuses.size > 1
    || (statuses.has('ACTIVE') && levels.has('L0'))
    || (statuses.has('RESOLVED') && [...levels].some(value => value !== 'L0'))
    ? 'CONFLICT' as const
    : statuses.has('UNKNOWN') ? 'UNKNOWN' as const
      : levels.size === 1 ? [...levels][0] as 'L0' | 'L1' | 'L2' | 'L3' | 'L4'
      : statuses.has('ACTIVE') ? 'L1' as const
        : statuses.has('RESOLVED') ? 'L0' as const
          : null;
  return {
    level,
    evidenceIds: [...new Set(winners.map(record => record.evidence.id))].sort(),
    synthetic: winners.some(record => record.evidence.is_synthetic),
    publishedAt: newest,
  };
}

function actionStateFor(level: SeverityLevel): SeverityActionState {
  switch (level) {
    case 'L0': return 'NORMAL';
    case 'L1': return 'MONITOR';
    case 'L2': return 'PREPARE';
    case 'L3':
    case 'L4': return 'PREPARE';
    case 'UNKNOWN':
    case 'CONFLICT': return 'MONITOR';
  }
}

function criticalIdentity(snapshot: Snapshot, evidenceIds: string[]) {
  const incidentIds = [...new Set(snapshot.situation.active_event_ids)].sort();
  const firstIncidentEvidence = snapshot.evidence
    .filter(evidence => evidence.situation_id === snapshot.situation.id
      && evidence.source_class === 'OFFICIAL'
      && evidence.trust_status === 'VERIFIED_OFFICIAL'
      && evidence.claim_type === 'DISASTER_STATUS'
      && isLocationRelevant(evidence, snapshot)
      && evidence.disaster_assessments.some(assessment => assessment.level === 'L4' && profileAreaIds(snapshot).includes(assessment.area_id)))
    .sort((left, right) => Date.parse(left.published_at) - Date.parse(right.published_at) || left.id.localeCompare(right.id))[0]?.id;
  const identity = incidentIds.length
    ? `incidents:${incidentIds.map(encodeURIComponent).join(',')}`
    : `evidence:${encodeURIComponent(firstIncidentEvidence ?? [...evidenceIds].sort()[0] ?? '')}`;
  return `critical:${encodeURIComponent(snapshot.situation.id)}:${encodeURIComponent(profileAreaIds(snapshot)[0] ?? 'unknown')}:${identity}`;
}

/** Pure local projection. It never changes evidence, plans, or server claim projections. */
export function deriveSeverity(snapshot: Snapshot, now: number): DerivedSeverity {
  const empty = (level: 'UNKNOWN' | 'CONFLICT' = 'UNKNOWN'): DerivedSeverity => ({
    level, actionState: actionStateFor(level), evidenceIds: [], synthetic: false, criticalEventKey: null,
  });
  if (!Number.isFinite(now) || snapshot.situation.network_state === 'RECONNECTING') return empty();

  // projectContinuity applies local TTL and evidence-projection conflict gates. Do not read
  // situation.claim_states here: those server-side claim summaries may be unrelated.
  const projected = projectContinuity(snapshot, now, 'online');
  const typedOfficial = projected.evidence.filter(evidence =>
    evidence.claim_type === 'DISASTER_STATUS'
    && evidence.source_class === 'OFFICIAL'
    && (evidence.trust_status === 'VERIFIED_OFFICIAL' || evidence.trust_status === 'CONFLICTING' || evidence.trust_status === 'STALE')
    && evidence.freshness_status === 'CURRENT'
    && isLocationRelevant(evidence, snapshot),
  );

  const scopes = new Map<string, { explicit: SeverityRecord[]; blocked: SeverityRecord[] }>();
  const areas = profileAreaIds(snapshot);
  for (const evidence of typedOfficial) {
    const projection = snapshot.evidence_projections.find(item => item.evidence_id === evidence.id);
    const authorized = sourceAuthority(evidence) === 'A3'
      && !evidence.conflict
      && !evidence.conflict_group
      && (!projection || projection.eligible_for_claims);
    for (const assessment of evidence.disaster_assessments) {
      if (!areas.includes(assessment.area_id) || !evidence.affected_area_ids.includes(assessment.area_id)) continue;
      const key = `${assessment.event_type}:${assessment.area_id}`;
      const scope = scopes.get(key) ?? { explicit: [], blocked: [] };
      scopes.set(key, scope);
      const target = authorized ? scope.explicit : scope.blocked;
      if (isSeverityLevel(assessment.level)) target.push({ evidence, kind: 'LEVEL', value: assessment.level });
      target.push({ evidence, kind: 'STATUS', value: assessment.status });
    }
  }

  const results = [...scopes.values()].flatMap(scope => {
    const clean = latestSeverity(scope.explicit);
    const blocked = latestSeverity(scope.blocked);
    if (blocked && (!clean || blocked.publishedAt >= clean.publishedAt)) return [{ ...blocked, level: 'CONFLICT' as const, evidenceIds: sortedIds([...blocked.evidenceIds, ...(clean?.publishedAt === blocked.publishedAt ? clean.evidenceIds : [])]), synthetic: blocked.synthetic || !!clean?.synthetic }];
    return clean ? [clean] : [];
  });
  if (!results.length) return empty();
  // Resolve recency within an area/hazard scope. A newer parent-area status must
  // not silently clear a still-current critical assessment in a child area.
  const ranks: Record<SeverityLevel, number> = { UNKNOWN: -1, L0: 0, L1: 1, L2: 2, L3: 3, L4: 4, CONFLICT: 5 };
  const level = results.reduce<SeverityLevel>((highest, result) => ranks[result.level ?? 'UNKNOWN'] > ranks[highest] ? result.level as SeverityLevel : highest, 'UNKNOWN');
  const winners = results.filter(result => result.level === level);
  const evidenceIds = sortedIds(winners.flatMap(result => result.evidenceIds));
  const criticalEventKey = level === 'L4' ? criticalIdentity(snapshot, evidenceIds) : null;
  return {
    level,
    actionState: actionStateFor(level),
    evidenceIds,
    synthetic: winners.some(result => result.synthetic),
    criticalEventKey,
  };
}

export type NotificationKind = 'INFO' | 'ATTENTION' | 'IMPORTANT' | 'CRITICAL' | 'SAFETY_CHECK';
export type NotificationEvent =
  | 'PLAN_INVALIDATED'
  | 'PLAN_SUPERSEDED'
  | 'EVIDENCE_EXPIRED'
  | 'NETWORK_LOST'
  | 'NETWORK_RESTORED'
  | 'VERIFICATION_RESTORED'
  | 'CRITICAL_WARNING'
  | 'ROUTE_DEPENDENCY_CHANGED'
  | 'SAFETY_CHECK_REQUIRED';
export type DerivedNotification = {
  id: string;
  event: NotificationEvent;
  kind: NotificationKind;
  evidenceIds: string[];
  href: string;
};
export type Notification = DerivedNotification;
export type ConnectionState = 'online' | 'offline' | 'reconnecting';

function inferConnection(snapshot: Snapshot): ConnectionState {
  if (snapshot.situation.network_state === 'RECONNECTING') return 'reconnecting';
  if (snapshot.situation.network_state === 'OFFLINE_RECENT' || snapshot.situation.network_state === 'OFFLINE_STALE') return 'offline';
  return 'online';
}

function effectiveConnection(snapshot: Snapshot, physical?: ConnectionState): ConnectionState {
  if (physical === 'offline' || physical === 'reconnecting') return physical;
  // A physical online signal does not bypass replay/server reconciliation state.
  return inferConnection(snapshot);
}

function sortedIds(values: string[]) {
  return [...new Set(values)].sort();
}

function notificationId(event: NotificationEvent, identity: string) {
  return `${event.toLocaleLowerCase('en-US')}:${encodeURIComponent(identity)}`;
}

function projectedEligibleEvidence(evidence: Evidence) {
  return evidence.freshness_status === 'CURRENT'
    && !evidence.conflict
    && !evidence.conflict_group
    && ((evidence.source_class === 'OFFICIAL' && evidence.trust_status === 'VERIFIED_OFFICIAL')
      || (evidence.source_class === 'PARTNER' && evidence.trust_status === 'VERIFIED_PARTNER'));
}

function scopedVerificationEvidence(evidence: Evidence, snapshot: Snapshot) {
  const projection = snapshot.evidence_projections.find(item => item.evidence_id === evidence.id);
  return projectedEligibleEvidence(evidence)
    && (!projection || (!projection.conflict && projection.eligible_for_claims))
    && isLocationRelevant(evidence, snapshot);
}

function latestSuccessfulNetworkRestore(snapshot: Snapshot) {
  return snapshot.trace.flatMap(trace => {
    if (trace.event_type !== 'NETWORK_RESTORED' || trace.status !== 'SUCCESS') return [];
    const timestamp = Date.parse(trace.timestamp);
    return Number.isFinite(timestamp) ? [timestamp] : [];
  }).sort((left, right) => right - left)[0] ?? null;
}

function noReconciliationConflicts(snapshot: Snapshot, evidence: Evidence[]) {
  return !snapshot.situation.claim_states.some(claim => claim.status === 'CONFLICT')
    && ![...dependencyValues(evidence).values()].includes('CONFLICT');
}

function trustedNonConflictingSource(evidence: Evidence) {
  return !evidence.conflict
    && !evidence.conflict_group
    && ((evidence.source_class === 'OFFICIAL' && evidence.trust_status === 'VERIFIED_OFFICIAL')
      || (evidence.source_class === 'PARTNER' && evidence.trust_status === 'VERIFIED_PARTNER'));
}

function storedFreshness(snapshot: Snapshot, evidence: Evidence) {
  return snapshot.evidence_projections.find(projection => projection.evidence_id === evidence.id)?.freshness_status
    ?? evidence.freshness_status;
}

function currentPlan(snapshot: Snapshot) {
  return snapshot.plans.find(plan => plan.id === snapshot.situation.current_plan_id) ?? snapshot.plans.at(-1) ?? null;
}

function recordedPlanInvalid(snapshot: Snapshot, planId: string) {
  const plan = snapshot.plans.find(candidate => candidate.id === planId);
  const evaluation = snapshot.plan_evaluations.findLast(candidate => candidate.plan_id === planId);
  return ['PARTIALLY_INVALID', 'INVALIDATED', 'EXPIRED', 'SUPERSEDED'].includes(plan?.status ?? '')
    || ['PARTIAL_INVALIDATION', 'INVALIDATED', 'EXPIRED'].includes(evaluation?.status ?? '');
}

function planRelevantEvidenceIds(snapshot: Snapshot, planId: string, evidenceIds: string[]) {
  const plan = snapshot.plans.find(candidate => candidate.id === planId);
  const actions = snapshot.plan_actions.filter(action => action.plan_id === planId);
  const dependencyKeys = new Set(actions.flatMap(action => action.dependency_keys));
  const actionEvidenceIds = new Set(actions.flatMap(action => action.evidence_ids));
  const planEvidenceIds = new Set(plan?.based_on_evidence_ids ?? []);
  const candidates = new Set(evidenceIds);
  return sortedIds(snapshot.evidence.filter(evidence => candidates.has(evidence.id)
    && (dependencyKeys.size === 0
      ? actionEvidenceIds.has(evidence.id) || planEvidenceIds.has(evidence.id)
      : actionEvidenceIds.has(evidence.id) || planEvidenceIds.has(evidence.id)
        || evidence.claims.some(claim => dependencyKeys.has(claim.key))))
    .map(evidence => evidence.id));
}

/**
 * Produces bounded in-app transition events. It intentionally returns no events for an initial
 * snapshot and never treats unverified evidence or reconnectivity alone as restored verification.
 */
export function deriveNotifications(
  previous: Snapshot | null,
  next: Snapshot,
  now: number,
  connection?: ConnectionState,
  previousConnection?: ConnectionState,
  verificationAnchor?: Snapshot | null,
): DerivedNotification[] {
  if (!previous || !Number.isFinite(now)) return [];

  const priorConnection = effectiveConnection(previous, previousConnection);
  const nextConnection = effectiveConnection(next, connection);
  const nextProjection = projectContinuity(next, now, nextConnection);
  const nextById = new Map(nextProjection.evidence.map(evidence => [evidence.id, evidence]));
  const previousIds = new Set(previous.evidence.map(evidence => evidence.id));
  const freshAddedEvidenceIds = sortedIds(nextProjection.evidence
    .filter(evidence => !previousIds.has(evidence.id) && projectedEligibleEvidence(evidence))
    .map(evidence => evidence.id));
  const expiredEvidenceIds = sortedIds(previous.evidence.flatMap(evidence => {
    const current = nextById.get(evidence.id);
    if (!current || storedFreshness(previous, evidence) !== 'CURRENT') return [];
    if (!trustedNonConflictingSource(evidence)
      || previous.evidence_projections.some(projection => projection.evidence_id === evidence.id && projection.conflict)) return [];
    return current.freshness_status === 'STALE' && !current.conflict && !current.conflict_group ? [evidence.id] : [];
  }));

  const notifications: DerivedNotification[] = [];
  const ids = new Set<string>();
  const add = (event: NotificationEvent, kind: NotificationKind, identity: string, evidenceIds: string[], href: string) => {
    const id = notificationId(event, identity);
    if (ids.has(id)) return;
    ids.add(id);
    notifications.push({ id, event, kind, evidenceIds: sortedIds(evidenceIds), href });
  };

  const previousPlan = currentPlan(previous);
  const nextPlan = currentPlan(next);
  if (previousPlan) {
    const nextPreviousPlan = next.plans.find(plan => plan.id === previousPlan.id);
    const nextPreviousPlanSnapshot: Snapshot = {
      ...next,
      situation: { ...next.situation, current_plan_id: previousPlan.id },
    };
    const priorPlanProjection = projectContinuity(nextPreviousPlanSnapshot, now, nextConnection);
    const planExpired = now >= Date.parse(previousPlan.expires_at)
      && !recordedPlanInvalid(previous, previousPlan.id);
    const planInvalidated = !recordedPlanInvalid(previous, previousPlan.id)
      && (recordedPlanInvalid(next, previousPlan.id) || priorPlanProjection.planStatus === 'INVALIDATED');
    const relevantFreshAddedIds = planRelevantEvidenceIds(next, previousPlan.id, freshAddedEvidenceIds);
    const relevantExpiredIds = planRelevantEvidenceIds(next, previousPlan.id, expiredEvidenceIds);
    const verifiedInvalidationCause = relevantFreshAddedIds.length > 0
      || relevantExpiredIds.length > 0
      || planExpired;
    if ((planInvalidated || planExpired) && verifiedInvalidationCause) {
      const causes = sortedIds([...relevantFreshAddedIds, ...relevantExpiredIds]);
      add('PLAN_INVALIDATED', 'IMPORTANT', previousPlan.id,
        causes.length ? causes : (nextPreviousPlan?.based_on_evidence_ids ?? previousPlan.based_on_evidence_ids), '/plan');
    }

    if (nextPlan && nextPlan.id !== previousPlan.id
      && (nextPlan.previous_plan_id === previousPlan.id || nextPlan.version > previousPlan.version)) {
      const freshPlanEvidence = nextPlan.based_on_evidence_ids.filter(id => {
        const evidence = nextById.get(id);
        return evidence ? projectedEligibleEvidence(evidence) : false;
      });
      if (freshPlanEvidence.length > 0) {
        add('PLAN_SUPERSEDED', 'INFO', `${previousPlan.id}:${nextPlan.id}`, freshPlanEvidence, '/plan');
      }
    }
  }

  const transitionIdentity = `${priorConnection}>${nextConnection}:${next.situation.updated_at}:${next.replay.current_event_index}:${Math.floor(now / 60_000)}`;
  if (priorConnection === 'online' && nextConnection === 'offline') {
    add('NETWORK_LOST', 'ATTENTION', transitionIdentity, [], '/dashboard');
  } else if (priorConnection === 'offline' && nextConnection !== 'offline') {
    add('NETWORK_RESTORED', 'INFO', transitionIdentity, [], '/dashboard');
  }

  const verificationPrevious = verificationAnchor ?? previous;
  const verificationPreviousIds = new Set(verificationPrevious.evidence.map(evidence => evidence.id));
  const reconciledIds = nextProjection.evidence
    .filter(evidence => !verificationPreviousIds.has(evidence.id) && scopedVerificationEvidence(evidence, next))
    .map(evidence => evidence.id);
  const restoreEpoch = verificationAnchor ? null : latestSuccessfulNetworkRestore(next);
  const afterRestore = restoreEpoch === null ? [] : nextProjection.evidence.filter(evidence => {
    const publishedAt = Date.parse(evidence.published_at);
    const receivedAt = Date.parse(evidence.received_at);
    return scopedVerificationEvidence(evidence, next)
      && Number.isFinite(publishedAt) && publishedAt > restoreEpoch
      && Number.isFinite(receivedAt) && receivedAt > restoreEpoch;
  });
  const reconciliationEvidence = restoreEpoch === null ? reconciledIds.map(id => nextById.get(id)!) : afterRestore;
  const hasReconciledOfficial = reconciliationEvidence.some(evidence => evidence.source_class === 'OFFICIAL');
  const hasReconciledPartner = reconciliationEvidence.some(evidence => evidence.source_class === 'PARTNER');
  const reconciliationEvidenceIds = sortedIds(reconciliationEvidence.map(evidence => evidence.id));
  const reconciliationReady = restoreEpoch === null
    ? canReconcile(verificationPrevious, next, now)
    : noReconciliationConflicts(next, nextProjection.evidence);
  if ((previous.situation.network_state !== 'ONLINE_VERIFIED' || priorConnection !== 'online')
    && next.situation.network_state === 'ONLINE_VERIFIED'
    && nextConnection === 'online'
    && hasReconciledOfficial
    && hasReconciledPartner
    && reconciliationReady) {
    add('VERIFICATION_RESTORED', 'IMPORTANT', reconciliationEvidenceIds.join(':'), reconciliationEvidenceIds, '/sources');
  }

  for (const evidenceId of expiredEvidenceIds) {
    add('EVIDENCE_EXPIRED', 'ATTENTION', evidenceId, [evidenceId], '/sources');
  }

  const previousSnapshotTime = Date.parse(previous.situation.updated_at);
  const previousSeverity = deriveSeverity(previous, Number.isFinite(previousSnapshotTime) ? previousSnapshotTime : now);
  const nextSeverity = nextConnection === 'online' && next.situation.network_state === 'ONLINE_VERIFIED' ? deriveSeverity(next, now) : {
    level: 'UNKNOWN' as const, actionState: 'MONITOR' as const, evidenceIds: [], synthetic: false, criticalEventKey: null,
  };
  if (nextSeverity.level === 'L4'
    && nextSeverity.criticalEventKey
    && nextSeverity.criticalEventKey !== previousSeverity.criticalEventKey) {
    add('CRITICAL_WARNING', 'CRITICAL', nextSeverity.criticalEventKey, nextSeverity.evidenceIds, '/dashboard');
  }

  return notifications;
}

export type PowerMode = 'NORMAL' | 'CONSERVE' | 'EMERGENCY_POWER' | 'SURVIVAL';
export type PowerOverride = 'AUTO' | 'CONSERVE' | 'EMERGENCY_POWER' | 'SURVIVAL';
export type PowerProjection = {
  mode: PowerMode;
  batteryKnown: boolean;
  allowMap: boolean;
  allowNonCriticalNetwork: boolean;
  refreshMs: number;
};

const powerRank: Record<PowerMode, number> = { NORMAL: 0, CONSERVE: 1, EMERGENCY_POWER: 2, SURVIVAL: 3 };
const powerPolicy: Record<PowerMode, Omit<PowerProjection, 'mode' | 'batteryKnown'>> = {
  NORMAL: { allowMap: true, allowNonCriticalNetwork: true, refreshMs: 15_000 },
  CONSERVE: { allowMap: true, allowNonCriticalNetwork: true, refreshMs: 60_000 },
  EMERGENCY_POWER: { allowMap: false, allowNonCriticalNetwork: false, refreshMs: 300_000 },
  SURVIVAL: { allowMap: false, allowNonCriticalNetwork: false, refreshMs: 900_000 },
};

export function derivePower(level: number | null, charging: boolean, override: PowerOverride = 'AUTO'): PowerProjection {
  void charging; // Charging never relaxes a battery-based safety threshold.
  const batteryKnown = typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 100;
  let automatic: PowerMode = 'CONSERVE';
  if (typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 100) {
    if (level <= 5) automatic = 'SURVIVAL';
    else if (level <= 15) automatic = 'EMERGENCY_POWER';
    else if (level <= 30) automatic = 'CONSERVE';
    else automatic = 'NORMAL';
  }
  const requested: PowerMode = override === 'AUTO' ? 'NORMAL'
    : override === 'CONSERVE' || override === 'EMERGENCY_POWER' || override === 'SURVIVAL' ? override
      : 'SURVIVAL';
  const mode = powerRank[requested] > powerRank[automatic] ? requested : automatic;
  return { mode, batteryKnown, ...powerPolicy[mode] };
}

export const safetyCheckSchema = z.object({
  consent: z.boolean(),
  status: z.enum(['UNKNOWN', 'AWAITING_RESPONSE', 'SAFE_CONFIRMED', 'UNRESPONSIVE_UNKNOWN', 'NEEDS_ASSISTANCE', 'CANNOT_MOVE']),
  eventKey: z.string().min(1).max(512).nullable(),
  requestedAt: z.number().finite().nonnegative().nullable(),
  attempts: z.number().int().min(0).max(3),
}).superRefine((state, context) => {
  if (state.status === 'AWAITING_RESPONSE'
    && (!state.consent || !state.eventKey || state.requestedAt === null || state.attempts < 1)) {
    context.addIssue({ code: 'custom', message: 'An open safety check requires consent, an incident, a deadline, and an attempt.' });
  }
  if (state.status !== 'AWAITING_RESPONSE' && state.requestedAt !== null) {
    context.addIssue({ code: 'custom', message: 'Only an awaiting safety check may have an open deadline.' });
  }
});
export type SafetyCheckState = z.infer<typeof safetyCheckSchema>;

export type SafetyCheckInput =
  | { type: 'CONSENT'; enabled: boolean }
  | { type: 'CRITICAL'; eventKey: string; eligible: boolean; now: number }
  | { type: 'TICK'; now: number }
  | { type: 'RESPOND'; response: 'SAFE_CONFIRMED' | 'NEEDS_ASSISTANCE' | 'CANNOT_MOVE'; now: number };

const SAFETY_CHECK_TIMEOUT_MS = 60_000;
const EMPTY_SAFETY_CHECK: SafetyCheckState = {
  consent: false, status: 'UNKNOWN', eventKey: null, requestedAt: null, attempts: 0,
};

export function initialSafetyCheck(): SafetyCheckState {
  return { ...EMPTY_SAFETY_CHECK };
}

/** Deterministic local reducer. Silence remains unknown and never triggers dispatch or a beacon. */
export function reduceSafetyCheck(state: SafetyCheckState, input: SafetyCheckInput): SafetyCheckState {
  const parsed = safetyCheckSchema.safeParse(state);
  const current = parsed.success ? parsed.data : initialSafetyCheck();

  if (input.type === 'CONSENT') {
    if (input.enabled) return current.consent ? current : safetyCheckSchema.parse({ ...current, consent: true });
    if (!current.consent && current.status === 'UNKNOWN' && current.requestedAt === null) return current;
    return safetyCheckSchema.parse({
      ...current,
      consent: false,
      status: 'UNKNOWN',
      requestedAt: null,
      attempts: 0,
      // Retain the incident key so re-consenting cannot reopen a check for this incident.
    });
  }

  if (input.type === 'CRITICAL') {
    const eventKey = typeof input.eventKey === 'string' ? input.eventKey.trim() : '';
    if (!input.eligible || !Number.isFinite(input.now) || input.now < 0 || !eventKey || eventKey.length > 512) return current;
    if (current.eventKey === eventKey) return current;
    if (!current.consent) {
      // Remember that this incident arrived before consent; consent must predate the prompt.
      return safetyCheckSchema.parse({ ...current, status: 'UNKNOWN', eventKey, requestedAt: null, attempts: 0 });
    }
    return safetyCheckSchema.parse({ ...current, status: 'AWAITING_RESPONSE', eventKey, requestedAt: input.now, attempts: 1 });
  }

  if (!Number.isFinite(input.now) || input.now < 0) return current;
  if (input.type === 'RESPOND') {
    if (!current.eventKey || (current.status !== 'AWAITING_RESPONSE' && current.status !== 'UNRESPONSIVE_UNKNOWN')) return current;
    if (current.status === 'AWAITING_RESPONSE' && current.requestedAt !== null && input.now < current.requestedAt) return current;
    return safetyCheckSchema.parse({ ...current, status: input.response, requestedAt: null });
  }
  if (current.status !== 'AWAITING_RESPONSE' || current.requestedAt === null) return current;
  const deadline = current.requestedAt + SAFETY_CHECK_TIMEOUT_MS;
  if (input.now < deadline) return current;
  return tickSafetyCheck(current, input.now);
}

function tickSafetyCheck(state: SafetyCheckState, now: number): SafetyCheckState {
  if (state.attempts < 3) {
    return safetyCheckSchema.parse({ ...state, status: 'AWAITING_RESPONSE', requestedAt: now, attempts: state.attempts + 1 });
  }
  return safetyCheckSchema.parse({ ...state, status: 'UNRESPONSIVE_UNKNOWN', requestedAt: null });
}
