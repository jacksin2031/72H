import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { snapshotSchema } from '../lib/contracts';
import { deriveNotifications, deriveSeverity, initialSafetyCheck, reduceSafetyCheck } from '../lib/vnext';

describe.skipIf(!process.env.P0_API_FIXTURE)('real local API to P0 projections', () => {
  const states = process.env.P0_API_FIXTURE ? (JSON.parse(readFileSync(process.env.P0_API_FIXTURE, 'utf8')) as unknown[]).map(raw => snapshotSchema.parse(raw)) : [];
  it('drives critical checks from actual normalized synthetic evidence', () => {
    const official = states[2];
    const severity = deriveSeverity(official, Date.parse(official.replay.current_time));
    expect(severity.level).toBe('L4');
    expect(severity.synthetic).toBe(true);
    expect(severity.evidenceIds.every(id => official.evidence.some(e => e.id === id))).toBe(true);
    const consented = reduceSafetyCheck(initialSafetyCheck(), { type: 'CONSENT', enabled: true });
    const state = reduceSafetyCheck(consented, { type: 'CRITICAL', eligible: true, eventKey: severity.criticalEventKey!, now: 1000 });
    expect(state.status).toBe('AWAITING_RESPONSE');
    expect(official.plan_actions.every(a => a.risk_level !== 'HIGH')).toBe(true);
  });
  it('preserves real replay history and prevents social-driven critical events', () => {
    const social = states[4];
    const beforeSocial = states[3];
    expect(social.plans).toEqual(beforeSocial.plans);
    expect(deriveNotifications(beforeSocial, social, Date.parse(social.replay.current_time))).toEqual([]);
    const final = states.at(-1)!;
    expect(final.replay.status).toBe('COMPLETED');
    expect(final.plans.map(p => p.version)).toEqual([1, 2, 3, 4]);
    expect(states[2].plans[0]).toEqual(final.plans[0]);
    expect(states[8].situation.network_state).toBe('RECONNECTING');
    expect(states[9].situation.network_state).toBe('RECONNECTING');
    expect(states[10].situation.network_state).toBe('ONLINE_VERIFIED');
  });
  it('notifies replay network loss, reconnection and staged verification separately', () => {
    const events = states.slice(1).flatMap((state, index) => deriveNotifications(states[index], state, Date.parse(state.replay.current_time), 'online', 'online').map(n => ({ step: index + 1, event: n.event })));
    expect(events).toContainEqual({ step: 6, event: 'NETWORK_LOST' });
    expect(events).toContainEqual({ step: 8, event: 'NETWORK_RESTORED' });
    expect(events).toContainEqual({ step: 10, event: 'VERIFICATION_RESTORED' });
    expect(events.some(e => e.step === 9 && e.event === 'VERIFICATION_RESTORED')).toBe(false);
  });
});
