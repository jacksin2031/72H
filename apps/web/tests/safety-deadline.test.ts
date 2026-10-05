import { expect, it } from 'vitest';
import { nextSafetyDeadline, projectContinuity } from '../lib/continuity';
import { activeSnapshot } from './fixtures';

it('wakes at transport TTL instead of waiting for the survival polling interval', () => {
  const state = activeSnapshot();
  const before = Date.parse('2026-10-04T17:47:00+09:00');
  const deadline = nextSafetyDeadline(state, before);
  expect(deadline).toBe(Date.parse('2026-10-04T17:48:00+09:00'));
  expect(projectContinuity(state, deadline!, 'offline').invalidActionIds).toContain('action');
  expect(nextSafetyDeadline(state, deadline!)).toBe(Date.parse(state.plans[0].expires_at));
  expect(nextSafetyDeadline(state, Date.parse(state.plans[0].expires_at))).toBe(null);
});

it('retains a usable NOW action when other plan steps are waiting for evidence', () => {
  const state = activeSnapshot();
  state.plan_actions.push({ ...state.plan_actions[0], id: 'now', category: 'NOW', risk_level: 'LOW', evidence_ids: [], dependency_keys: [], dependency_values: {} });
  state.plan_actions[0].safety_decision = 'WAIT_FOR_EVIDENCE';
  const projection = projectContinuity(state, Date.parse(state.replay.current_time), 'online');
  expect(projection.invalidActionIds).toEqual(['action']);
  expect(projection.planStatus).toBe('PARTIALLY_INVALID');
});
