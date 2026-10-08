import { describe, expect, it } from 'vitest';
import { canClearLocationGateForSameArea, canClearLocationGateForUpdate, requiresFreshGpsForLocationRetry, shouldPostSameAreaToResolveGate, shouldReconcileLatestLocationFix } from '../lib/location-sync';
import { shouldRefreshGpsAreaTimestamp } from '../lib/location-freshness';

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 8, 1, 0, seconds)).toISOString();
const O = ['JP-MUNI-13104', 'JP-13', 'JP'];
const A = ['JP-MUNI-13103', 'JP-13', 'JP'];

describe('location update ordering', () => {
  it('requires a new fix for any failed GPS update and allows manual-area retry as-is', () => {
    const failedGps = { phase: 'failed' as const, update: { area_ids: A, source: 'GPS' as const, observed_at: at(1) } };
    const failedSelection = { phase: 'failed' as const, update: { area_ids: A, source: 'USER_SELECTED' as const, observed_at: at(1) } };
    expect(requiresFreshGpsForLocationRetry(failedGps)).toBe(true);
    expect(requiresFreshGpsForLocationRetry({ ...failedGps, update: { ...failedGps.update, observed_at: at(119) } })).toBe(true);
    expect(requiresFreshGpsForLocationRetry(failedSelection)).toBe(false);
    expect(requiresFreshGpsForLocationRetry({ phase: 'failed', update: null })).toBe(false);
  });
  it('keeps the old-area gate through O→A pending and reconciles a newer O fix after A returns', async () => {
    let finishAreaA!: () => void;
    const requestA = new Promise<void>(resolve => { finishAreaA = resolve; });
    const updateA = { area_ids: A, source: 'GPS' as const, observed_at: at(10) };
    let gate: { phase: 'pending' | 'failed'; update: typeof updateA | null } | null = { phase: 'pending', update: updateA };
    const latestFixB = Date.parse(at(20));

    // Fix B resolves back to O while POST(A) is still pending. That no-op must not clear A's gate.
    expect(canClearLocationGateForSameArea(gate)).toBe(false);
    expect(shouldPostSameAreaToResolveGate(gate, true)).toBe(false);
    await Promise.resolve();

    // The response for A cannot cover B, so the UI keeps the gate and schedules B for re-resolution.
    finishAreaA();
    await requestA;
    expect(canClearLocationGateForUpdate({ gateUpdate: gate?.update, completedUpdate: updateA, latestFixAt: latestFixB })).toBe(false);
    expect(shouldReconcileLatestLocationFix(latestFixB, updateA)).toBe(true);

    // Snapshot now reflects A; re-resolving the retained latest O fix produces a second update.
    const updateB = { area_ids: O, source: 'GPS' as const, observed_at: at(20) };
    gate = { phase: 'pending', update: updateB };
    expect(canClearLocationGateForSameArea(gate)).toBe(false);
    expect(canClearLocationGateForUpdate({ gateUpdate: gate.update, completedUpdate: updateB, latestFixAt: latestFixB })).toBe(true);
    gate = null;
    expect(gate).toBeNull();
  });

  it('does not clear a failed area update after an ambiguous response; a latest same-area fix must reconcile it', () => {
    const failedUpdate = { area_ids: A, source: 'GPS' as const, observed_at: at(10) };
    const gate = { phase: 'failed' as const, update: failedUpdate };
    expect(canClearLocationGateForSameArea(gate)).toBe(false);
    expect(shouldPostSameAreaToResolveGate(gate, false)).toBe(true);
    expect(shouldPostSameAreaToResolveGate(gate, true)).toBe(false);
    const latestSameArea = { area_ids: O, source: 'GPS' as const, observed_at: at(20) };
    expect(canClearLocationGateForUpdate({ gateUpdate: latestSameArea, completedUpdate: latestSameArea, latestFixAt: Date.parse(at(20)) })).toBe(true);
  });

  it('reconciles a newer O fix after an A response is lost even when the normal keepalive window has not elapsed', () => {
    const updateA = { area_ids: A, source: 'GPS' as const, observed_at: at(10) };
    let gate: { phase: 'pending' | 'failed'; update: typeof updateA | null } | null = { phase: 'failed', update: updateA };
    // The server may have committed A before its response was lost, while the local snapshot remains O.
    let serverArea: string[] = A;
    const latestFixAt = Date.parse(at(20));
    const updateB = { area_ids: O, source: 'GPS' as const, observed_at: at(20) };

    expect(serverArea).toEqual(A);
    expect(canClearLocationGateForSameArea(gate)).toBe(false);
    expect(shouldRefreshGpsAreaTimestamp({ source: 'GPS', areaUnchanged: true, observedAt: at(0), fixCapturedAt: latestFixAt })).toBe(false);
    expect(shouldPostSameAreaToResolveGate(gate, false)).toBe(true);

    gate = { phase: 'pending', update: updateB };
    serverArea = updateB.area_ids; // Successful response explicitly confirms that the server returned to O.
    expect(canClearLocationGateForUpdate({ gateUpdate: gate.update, completedUpdate: updateB, latestFixAt })).toBe(true);
    expect(serverArea).toEqual(O);
    gate = null;
    expect(gate).toBeNull();
  });
});
