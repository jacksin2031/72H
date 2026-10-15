import { projectContinuity } from './continuity';
import { type Action, type Language, type Snapshot } from './contracts';
import { evidenceMatchesProfile, profileAreaIds } from './area-scoping';
import {
  deriveSeverity,
  safetyCheckSchema,
  type ConnectionState,
  type PowerProjection,
  type SafetyCheckState,
  type SeverityActionState,
} from './vnext';

export type PresentationMode =
  | 'TEXT_ONLY'
  | 'TEXT_WITH_DETAILS'
  | 'MAP_ASSISTED'
  | 'SAFETY_CHECK'
  | 'EMERGENCY_PROTECT'
  | 'SURVIVAL';

/** Safe route copy keys. None of these keys means that a route is disaster-safe. */
export type RouteText =
  | 'CANDIDATE_NEEDS_VERIFICATION'
  | 'BLOCKED'
  | 'UNKNOWN'
  | 'VERIFIED_USABLE_CANDIDATE';

export type AdaptivePresentation = {
  mode: PresentationMode;
  primaryAction: Action | null;
  primaryActionText: string;
  routeText: RouteText | null;
  networkState: Snapshot['situation']['network_state'];
  planStatus: string;
  showMap: boolean;
  showRoute: boolean;
  showDestination: boolean;
  showLocation: boolean;
  showNotificationsBadge: boolean;
  showEvidenceInline: boolean;
  showSafetyCheck: boolean;
  showPowerWarning: boolean;
  reasonCodes: string[];
};

export type PresentationProjection = AdaptivePresentation;

export type PresentationPolicyInput = {
  actionState: SeverityActionState;
  primaryAction: Action | null;
  language: Language;
  power: PowerProjection;
  safetyCheckRequired: boolean;
  movementAuthorized: boolean;
  destinationEligible: boolean;
  routeState: 'AVAILABLE' | 'DISRUPTED' | 'UNKNOWN' | null;
  routePresentationAllowed: boolean;
  routeGeometryValid: boolean;
  mapMountEligible: boolean;
  manualMapOpen?: boolean;
  notificationCount?: number;
  networkState: Snapshot['situation']['network_state'];
  planStatus: string;
};

export type AdaptivePresentationOptions = {
  manualMapOpen?: boolean;
  notificationCount?: number;
};

const copy: Record<Language, Record<string, string>> = {
  ja: {
    NORMAL: '現在、すぐに移動する指示はありません。確認済みの情報をお待ちください。',
    MONITOR: '安全な場所にとどまり、確認済みの更新情報を確認してください。',
    PREPARE: '安全な場所にとどまり、確認済みの公式情報を確認してください。',
    SHELTER_IN_PLACE: '現在の場所で身を守り、確認済みの更新をお待ちください。',
    EMERGENCY_PROTECT: 'まず身を守り、窓や落下物から離れてください。',
    EVACUATE: '移動先の確認が完了するまで、移動に関する新しい案内をお待ちください。',
  },
  en: {
    NORMAL: 'There is no instruction to move right now. Wait for verified updates.',
    MONITOR: 'Stay in a safe place and check verified updates.',
    PREPARE: 'Stay in a safe place and check verified official updates.',
    SHELTER_IN_PLACE: 'Protect yourself where you are and wait for verified updates.',
    EMERGENCY_PROTECT: 'Protect yourself first and move away from windows and falling objects.',
    EVACUATE: 'Wait for a verified destination and movement instruction before travelling.',
  },
  'zh-TW': {
    NORMAL: '目前沒有需要立即移動的指示，請等待已確認的更新。',
    MONITOR: '請留在安全位置，留意已確認的更新。',
    PREPARE: '請留在安全位置，留意已確認的官方資訊。',
    SHELTER_IN_PLACE: '請在目前位置保護自己，等待已確認的更新。',
    EMERGENCY_PROTECT: '請先保護自己，遠離窗戶與可能掉落的物品。',
    EVACUATE: '目的地與移動指示確認前，請等待已驗證的行動資訊。',
  }, 'zh-CN': {
    NORMAL: '目前没有需要立即移动的指示，请等待已确认的更新。',
    MONITOR: '请留在安全位置，留意已确认的更新。',
    PREPARE: '请留在安全位置，留意已确认的官方信息。',
    SHELTER_IN_PLACE: '请在目前位置保护自己，等待已确认的更新。',
    EMERGENCY_PROTECT: '请先保护自己，远离窗户与可能掉落的物品。',
    EVACUATE: '目的地与移动指示确认前，请等待已验证的行动信息。',
  },
};

const emergencyStates = new Set<SeverityActionState>(['SHELTER_IN_PLACE', 'EMERGENCY_PROTECT']);
const activeCheckStates = new Set<SafetyCheckState['status']>([
  'AWAITING_RESPONSE', 'UNRESPONSIVE_UNKNOWN', 'NEEDS_ASSISTANCE', 'CANNOT_MOVE',
]);

function fallbackText(actionState: SeverityActionState, language: Language) {
  return copy[language][actionState] ?? copy[language].MONITOR;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

/**
 * Pure policy selector. Movement authorization and destination eligibility are
 * explicit inputs so a future server-owned Safety Core can add those contracts;
 * snapshot/model text never supplies either value.
 */
export function selectPresentationPolicy(input: PresentationPolicyInput): AdaptivePresentation {
  const reasons: string[] = [];
  const movementEligible = input.actionState === 'EVACUATE'
    && input.movementAuthorized
    && input.destinationEligible
    && input.routeState === 'AVAILABLE'
    && input.routePresentationAllowed
    && input.routeGeometryValid
    && input.mapMountEligible;
  let mode: PresentationMode;

  if (input.power.mode === 'SURVIVAL') {
    mode = 'SURVIVAL';
    reasons.push('POWER_SURVIVAL');
  } else if (input.safetyCheckRequired) {
    mode = 'SAFETY_CHECK';
    reasons.push('SAFETY_CHECK_MATCHED');
  } else if (emergencyStates.has(input.actionState)) {
    mode = 'EMERGENCY_PROTECT';
    reasons.push(input.actionState === 'SHELTER_IN_PLACE' ? 'SHELTER_IN_PLACE' : 'EMERGENCY_PROTECT');
  } else if (input.actionState === 'EVACUATE' && movementEligible) {
    mode = 'MAP_ASSISTED';
    reasons.push('MOVEMENT_AUTHORIZED', 'DESTINATION_ELIGIBLE');
  } else if (input.actionState === 'PREPARE' || input.actionState === 'EVACUATE') {
    mode = 'TEXT_WITH_DETAILS';
    reasons.push(input.actionState === 'PREPARE' ? 'PREPARE_ACTION_STATE' : 'MOVEMENT_GATE_BLOCKED');
  } else {
    mode = 'TEXT_ONLY';
    reasons.push(input.actionState === 'MONITOR' ? 'MONITOR_ACTION_STATE' : 'NORMAL_ACTION_STATE');
  }

  const blockedEvacuation = input.actionState === 'EVACUATE' && !movementEligible;
  const primaryAction = blockedEvacuation ? null : input.primaryAction;
  if (primaryAction) reasons.push('NOW_ACTION_AVAILABLE');
  else reasons.push('NOW_ACTION_UNAVAILABLE');

  const mapPowerAllowed = input.power.allowMap
    && input.power.mode !== 'EMERGENCY_POWER'
    && input.power.mode !== 'SURVIVAL';
  const manualMapOpen = input.manualMapOpen === true;
  const showMap = mapPowerAllowed && mode === 'MAP_ASSISTED' && movementEligible;
  if (mode === 'MAP_ASSISTED' && !mapPowerAllowed) reasons.push('MAP_SUPPRESSED_BY_POWER');
  if (manualMapOpen && showMap) reasons.push('MANUAL_MAP_OPEN');
  else if (manualMapOpen && !showMap) reasons.push(input.power.mode === 'SURVIVAL' ? 'MAP_SUPPRESSED_BY_SURVIVAL' : 'MANUAL_MAP_BLOCKED_BY_POWER');

  const routeText: RouteText | null = !showMap || input.routeState === null ? null
    : input.routeState === 'DISRUPTED' ? 'BLOCKED'
      : input.routeState === 'UNKNOWN' ? 'UNKNOWN'
        : input.routePresentationAllowed ? 'VERIFIED_USABLE_CANDIDATE' : 'CANDIDATE_NEEDS_VERIFICATION';
  const showRoute = routeText !== null;
  if (routeText === 'CANDIDATE_NEEDS_VERIFICATION') reasons.push('ROUTE_CANDIDATE_REQUIRES_VERIFICATION');
  if (routeText === 'VERIFIED_USABLE_CANDIDATE') reasons.push('ROUTE_PRESENTATION_ALLOWED');
  if (routeText === 'BLOCKED') reasons.push('ROUTE_BLOCKED');
  if (routeText === 'UNKNOWN') reasons.push('ROUTE_UNKNOWN');

  const showDestination = mode === 'MAP_ASSISTED' && movementEligible;
  const showLocation = input.power.mode === 'SURVIVAL'
    || (manualMapOpen && showMap)
    || (mode === 'MAP_ASSISTED' && movementEligible);
  const showSafetyCheck = input.safetyCheckRequired;
  const showNotificationsBadge = input.power.mode !== 'SURVIVAL'
    && Number.isInteger(input.notificationCount)
    && (input.notificationCount ?? 0) > 0;
  const showPowerWarning = input.power.mode !== 'NORMAL';
  if (input.power.mode === 'CONSERVE') reasons.push('POWER_CONSERVE');
  if (input.power.mode === 'EMERGENCY_POWER') reasons.push('POWER_EMERGENCY');
  if (showNotificationsBadge) reasons.push('NOTIFICATIONS_AVAILABLE');

  const showEvidenceInline = input.power.mode !== 'SURVIVAL'
    && !!primaryAction?.evidence_ids.length
    && ['SAFETY_CHECK', 'EMERGENCY_PROTECT', 'MAP_ASSISTED'].includes(mode);

  return {
    mode,
    primaryAction,
    primaryActionText: primaryAction?.text ?? fallbackText(blockedEvacuation ? 'EVACUATE' : input.actionState, input.language),
    routeText,
    networkState: input.networkState,
    planStatus: input.planStatus,
    showMap,
    showRoute,
    showDestination,
    showLocation,
    showNotificationsBadge,
    showEvidenceInline,
    showSafetyCheck,
    showPowerWarning,
    reasonCodes: unique(reasons),
  };
}

function currentCriticalIdentity(snapshot: Snapshot, severityEvidenceIds: string[]) {
  const areaId = profileAreaIds(snapshot)[0] ?? 'unknown';
  const prefix = `critical:${encodeURIComponent(snapshot.situation.id)}:${encodeURIComponent(areaId)}:`;
  const incidentIds = unique(snapshot.situation.active_event_ids).sort();
  if (incidentIds.length) return `${prefix}incidents:${incidentIds.map(encodeURIComponent).join(',')}`;

  const firstCriticalEvidence = snapshot.evidence
    .filter(evidence => evidence.situation_id === snapshot.situation.id
      && evidence.source_class === 'OFFICIAL'
      && evidence.trust_status === 'VERIFIED_OFFICIAL'
      && evidence.claim_type === 'DISASTER_STATUS'
      && evidenceMatchesProfile(evidence, snapshot)
      && evidence.disaster_assessments.some(assessment => assessment.level === 'L4' && profileAreaIds(snapshot).includes(assessment.area_id)))
    .sort((left, right) => Date.parse(left.published_at) - Date.parse(right.published_at) || left.id.localeCompare(right.id))[0]?.id;
  const evidenceId = firstCriticalEvidence ?? [...severityEvidenceIds].sort()[0] ?? '';
  return `${prefix}evidence:${encodeURIComponent(evidenceId)}`;
}

function checkIsCurrent(
  snapshot: Snapshot,
  check: SafetyCheckState,
  severityKey: string | null,
  preservePriorIncident: boolean,
) {
  const parsed = safetyCheckSchema.safeParse(check);
  if (!parsed.success || !parsed.data.consent || !activeCheckStates.has(parsed.data.status)) return false;
  const expectedKey = severityKey ?? (preservePriorIncident ? currentCriticalIdentity(snapshot, []) : null);
  return expectedKey !== null && parsed.data.eventKey === `${snapshot.replay.id}:${expectedKey}`;
}

function currentNowAction(snapshot: Snapshot, now: number, projection: ReturnType<typeof projectContinuity>): Action | null {
  const plan = projection.plan;
  if (!Number.isFinite(now)
    || !plan
    || snapshot.situation.current_plan_id !== plan.id
    || plan.status !== 'ACTIVE'
    || projection.planStatus === 'INVALIDATED'
    || projection.planStatus === 'EXPIRED'
    || projection.planStatus === 'SUPERSEDED') return null;
  const invalid = new Set(projection.invalidActionIds);
  const evidenceById = new Map(projection.evidence.map(e => [e.id, e]));
  return snapshot.plan_actions.find(action => action.plan_id === plan.id
    && action.category === 'NOW'
    && action.status === 'ACTIVE'
    && action.safety_decision === 'ALLOW'
    && action.evidence_ids.every(id => {
      const evidence = evidenceById.get(id);
      return evidence && evidence.freshness_status === 'CURRENT'
        && ['VERIFIED_OFFICIAL', 'VERIFIED_PARTNER'].includes(evidence.trust_status)
        && !evidence.conflict && !evidence.conflict_group;
    })
    && !invalid.has(action.id)) ?? null;
}

function routeState(
  snapshot: Snapshot,
  projectedEvidence: ReturnType<typeof projectContinuity>['evidence'],
  now: number,
  connection: ConnectionState,
  networkState: Snapshot['situation']['network_state'],
): PresentationPolicyInput['routeState'] {
  if (!snapshot.mobility.length) return null;
  if (connection !== 'online' || networkState !== 'ONLINE_VERIFIED' || !Number.isFinite(now)) return 'UNKNOWN';

  const evidenceById = new Map(projectedEvidence.map(evidence => [evidence.id, evidence]));
  const statuses: Array<'AVAILABLE' | 'DISRUPTED' | 'UNKNOWN'> = [];
  for (const mobility of snapshot.mobility) {
    // Current public contracts omit mobility timestamps, so associated transport
    // evidence TTL is the baseline. If timing fields are present, honor their
    // stricter boundary as well.
    const timed = mobility as typeof mobility & { checked_at?: unknown; expires_at?: unknown };
    const checkedAt = typeof timed.checked_at === 'string' ? Date.parse(timed.checked_at) : null;
    const expiresAt = typeof timed.expires_at === 'string' ? Date.parse(timed.expires_at) : null;
    if ((timed.checked_at !== undefined && (!Number.isFinite(checkedAt) || checkedAt! > now))
      || (timed.expires_at !== undefined && timed.expires_at !== null && (!Number.isFinite(expiresAt) || now >= expiresAt!))) {
      return 'UNKNOWN';
    }
    const evidence = mobility.evidence_ids.map(id => evidenceById.get(id));
    if (!evidence.length || evidence.some(item => !item
      || item.freshness_status !== 'CURRENT'
      || item.conflict
      || !!item.conflict_group
      || item.claim_type !== 'TRANSPORT_STATUS'
      || !['VERIFIED_OFFICIAL', 'VERIFIED_PARTNER'].includes(item.trust_status)
      || !evidenceMatchesProfile(item, snapshot))) {
      return 'UNKNOWN';
    }
    statuses.push(mobility.status);
  }
  if (statuses.includes('UNKNOWN') || (statuses.includes('AVAILABLE') && statuses.includes('DISRUPTED'))) return 'UNKNOWN';
  if (statuses.includes('DISRUPTED')) return 'DISRUPTED';
  return statuses.includes('AVAILABLE') ? 'AVAILABLE' : 'UNKNOWN';
}

/** Deterministic consumer-home projection. It reads snapshots and returns a new value only. */
export function derivePresentation(
  snapshot: Snapshot,
  now: number,
  connection: ConnectionState,
  power: PowerProjection,
  check: SafetyCheckState,
  options: AdaptivePresentationOptions = {},
): AdaptivePresentation {
  const projection = projectContinuity(snapshot, now, connection);
  const severity = deriveSeverity(snapshot, now);
  const action = currentNowAction(snapshot, now, projection);
  const isHelpResponse = check.status === 'NEEDS_ASSISTANCE' || check.status === 'CANNOT_MOVE';
  const preservePriorIncident = isHelpResponse || connection !== 'online' || projection.networkState !== 'ONLINE_VERIFIED';
  const safetyCheckRequired = checkIsCurrent(snapshot, check, severity.criticalEventKey, preservePriorIncident);
  const reasons: string[] = [];
  if (!Number.isFinite(now)) reasons.push('INVALID_CLOCK');
  if (!projection.plan || snapshot.situation.current_plan_id !== projection.plan.id || projection.plan.status !== 'ACTIVE') reasons.push('PLAN_UNAVAILABLE');
  else if (projection.planStatus === 'EXPIRED' || projection.planStatus === 'INVALIDATED' || projection.planStatus === 'SUPERSEDED') reasons.push('PLAN_NOT_CURRENT');
  if (projection.invalidActionIds.length) reasons.push('ACTION_INVALIDATED');
  if (projection.networkState === 'RECONNECTING') reasons.push('RECONNECTING');
  else if (projection.networkState === 'OFFLINE_RECENT' || projection.networkState === 'OFFLINE_STALE') reasons.push(projection.networkState);
  if (projection.evidence.some(evidence => evidence.freshness_status !== 'CURRENT')) reasons.push('EVIDENCE_NOT_CURRENT');
  const currentNowEvidence = snapshot.plan_actions.filter(item => item.plan_id === projection.plan?.id && item.category === 'NOW').flatMap(item => item.evidence_ids);
  if (!action && currentNowEvidence.some(id => projection.evidence.some(e => e.id === id && e.freshness_status !== 'CURRENT'))) reasons.push('NOW_EVIDENCE_NOT_CURRENT');
  if (check.consent && activeCheckStates.has(check.status) && !safetyCheckRequired) reasons.push('SAFETY_CHECK_SESSION_OR_EVENT_MISMATCH');

  const selected = selectPresentationPolicy({
    actionState: severity.actionState,
    primaryAction: action,
    language: snapshot.profile.preferred_language,
    power,
    safetyCheckRequired,
    // The public snapshot has no Safety-Core movement or destination authorization contract.
    movementAuthorized: false,
    destinationEligible: false,
    routeState: routeState(snapshot, projection.evidence, now, connection, projection.networkState),
    // Mobility availability is provider data only; it cannot authorize route presentation.
    routePresentationAllowed: false,
    routeGeometryValid: false,
    mapMountEligible: false,
    manualMapOpen: options.manualMapOpen,
    notificationCount: options.notificationCount,
    networkState: projection.networkState,
    planStatus: projection.planStatus,
  });
  return { ...selected, reasonCodes: unique([...reasons, ...selected.reasonCodes]) };
}
