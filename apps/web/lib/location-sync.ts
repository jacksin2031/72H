import type { LiveLocationUpdate } from './live-api';

export type LocationSyncGate = { phase: 'pending' | 'failed'; update: LiveLocationUpdate | null } | null;

export function sameLocationUpdate(left: LiveLocationUpdate | null | undefined, right: LiveLocationUpdate): boolean {
  return !!left && left.source === right.source && left.observed_at === right.observed_at
    && JSON.stringify(left.area_ids) === JSON.stringify(right.area_ids);
}

/** A same-area observation cannot clear an in-flight update for another area. */
export function canClearLocationGateForSameArea(gate: LocationSyncGate): boolean {
  return gate?.update == null;
}

export function shouldPostSameAreaToResolveGate(gate: LocationSyncGate, requestPending: boolean): boolean {
  return gate?.update != null && !requestPending;
}

/** A failed GPS request is retried with a new fix, never by replaying its old timestamp. */
export function requiresFreshGpsForLocationRetry(gate: LocationSyncGate): boolean {
  return gate?.phase === 'failed' && gate.update?.source === 'GPS';
}

/** Only clear the gate owned by this response, and only when it covers the latest fix. */
export function canClearLocationGateForUpdate(input: {
  gateUpdate: LiveLocationUpdate | null | undefined;
  completedUpdate: LiveLocationUpdate;
  latestFixAt: number | null;
}): boolean {
  return sameLocationUpdate(input.gateUpdate, input.completedUpdate)
    && (input.latestFixAt === null || input.latestFixAt <= Date.parse(input.completedUpdate.observed_at));
}

export function shouldReconcileLatestLocationFix(latestFixAt: number | null, completedUpdate: LiveLocationUpdate): boolean {
  return latestFixAt !== null && latestFixAt > Date.parse(completedUpdate.observed_at);
}
