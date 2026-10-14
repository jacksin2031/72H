// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DeviceLocation } from '../lib/use-device-location';
import type { Snapshot } from '../lib/contracts';
import { activeSnapshot } from './fixtures';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/link', () => ({ default: ({ children, ...p }: React.ComponentProps<'a'>) => <a {...p}>{children}</a> }));
vi.mock('../lib/use-power', async () => {
  const { derivePower } = await import('../lib/vnext');
  const value = { power: derivePower(75, false), level: null, override: 'AUTO', choose: () => {} };
  return { usePower: () => value };
});
vi.mock('../lib/use-device-location', () => {
  const location: DeviceLocation = {
    position: null, state: 'unavailable', freshness: 'UNAVAILABLE', now: 0, consent: false, ready: true, busy: false,
    failed: false, permissionDenied: false, permissionGranted: false, storageUnavailable: false,
    locate: async () => null, retain: () => {},
  };
  return { useDeviceLocation: () => location };
});
vi.mock('../lib/continuity', async orig => ({
  ...await orig<typeof import('../lib/continuity')>(),
  loadSnapshot: async () => null, saveSnapshot: async () => {},
}));
import { Dashboard } from '../components/dashboard';

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let served: Snapshot;
const calls: string[] = [];
beforeEach(() => {
  served = activeSnapshot();
  calls.length = 0;
  localStorage.setItem('72h-session', 'session');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path.startsWith('/api/replay/session')) {
      if (path.endsWith('/next')) {
        // The next replay step comes from the server pipeline: a new plan version with different actions.
        const next = activeSnapshot();
        next.plans = [{ ...next.plans[0], id: 'plan_v2', version: 2 }];
        next.situation = { ...next.situation, current_plan_id: 'plan_v2' };
        next.plan_actions = [{ ...next.plan_actions[0], id: 'action-2', plan_id: 'plan_v2', text: 'Stay where you are until transport is verified' }];
        served = next;
      }
      if (path.endsWith('/explanation')) return { ok: false, status: 503, text: async () => '{}', json: async () => ({}) } as unknown as Response;
      return { ok: true, status: 200, json: async () => served } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as unknown as Response;
  }));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove(); root = null; host = null;
  localStorage.clear(); vi.unstubAllGlobals();
});
async function mount(view: 'demo' | 'trace') {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<Dashboard view={view} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return host;
}

it('demo renders the replayed snapshot on the shared Now screen with the 演練 band, tag and secondary controls', async () => {
  const page = await mount('demo');
  expect(page.querySelector('.ui-band-exercise')?.textContent).toBe('演習');
  expect(page.querySelector('[data-now=hero]')).not.toBeNull();
  expect(page.querySelector('[data-now=basis] .ui-tag-exercise')?.textContent).toBe('演習');
  expect(page.querySelector('[data-now=next]')?.textContent).toContain('Wait for verified transport updates');
  const controls = [...page.querySelectorAll<HTMLButtonElement>('.ui-exercise-controls button')];
  expect(controls.map(b => b.textContent)).toEqual(['次の更新 →', '再開', '最初から']);
  expect(controls.every(b => b.classList.contains('ui-btn-secondary'))).toBe(true);
  // One primary action per screen: the danger "I need help" button only.
  expect(page.querySelectorAll('.ui-btn-primary, .ui-btn-danger, button.primary')).toHaveLength(1);
  expect(page.querySelector('.ui-btn-danger')?.classList.contains('distress-entry-button')).toBe(true);
});

it('agent log and Judge content live only in the last Disclosure of the basis details', async () => {
  const page = await mount('demo');
  const body = page.querySelector('#basis > .ui-disclosure-body')!;
  const last = body.lastElementChild as HTMLDetailsElement;
  expect(last.id).toBe('exercise-details');
  expect(last.tagName).toBe('DETAILS');
  expect(last.open).toBe(false);
  expect(last.textContent).toContain('エージェントの記録');
  const outside = (page.textContent ?? '').replace(last.textContent ?? '', '');
  expect(outside).not.toContain('エージェントの記録');
  expect(outside).not.toContain('Judge');
});

it('/trace opens the basis and the agent log disclosure', async () => {
  const page = await mount('trace');
  expect((page.querySelector('#basis') as HTMLDetailsElement).open).toBe(true);
  expect((page.querySelector('#exercise-details') as HTMLDetailsElement).open).toBe(true);
  expect(page.querySelector('.ui-exercise-controls')).toBeNull();
});

it('"next update" drives the screen through the replay API state, not a hard-coded step', async () => {
  const page = await mount('demo');
  const next = [...page.querySelectorAll<HTMLButtonElement>('.ui-exercise-controls button')].find(b => b.textContent === '次の更新 →')!;
  await act(async () => { next.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(calls).toContain('POST /api/replay/session/next');
  expect(page.querySelector('[data-now=next]')?.textContent).toContain('Stay where you are until transport is verified');
  expect(page.querySelector('[data-now=next]')?.textContent).not.toContain('Wait for verified transport updates');
  expect(page.querySelector('.error')).toBeNull();
});
