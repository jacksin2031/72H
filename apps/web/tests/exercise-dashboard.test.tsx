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
const seenChecks = vi.hoisted(() => [] as { consent: boolean }[]);
vi.mock('../lib/adaptive-ui', async orig => {
  const real = await orig<typeof import('../lib/adaptive-ui')>();
  return { ...real, derivePresentation: (...args: Parameters<typeof real.derivePresentation>) => { seenChecks.push(args[4]); return real.derivePresentation(...args); } };
});
// The exercise map: a light stand-in that records the synthetic earthquake it is given.
const mapCalls = vi.hoisted(() => [] as unknown[]);
vi.mock('../components/simulation-reference-map', () => ({ SimulationReferenceMap: (p: Record<string,unknown>) => { mapCalls.push(p); return <section data-testid="national-map-stub" />; } }));
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

it('/demo Now and Map tabs switch in place (no navigation), the Map tab shows the national reference map without fabricated event coordinates, and the band stays', async () => {
  served = activeSnapshot();
  served.events = [{ id: 'quake', event_type: 'EARTHQUAKE', occurred_at: served.replay.current_time, affected_areas: ['Tokyo'], affected_area_ids: ['JP-13'], source_name: 'Synthetic JMA', raw_reference: 'synthetic' }];
  served.situation = { ...served.situation, active_event_ids: ['quake'] };
  const page = await mount('demo');
  const tabs = page.querySelector('nav.ui-tabs')!;
  // 今 and 地図 are in-place buttons; only その他 is a link (to /more).
  expect([...tabs.querySelectorAll('button')].map(b => b.textContent)).toEqual(['今', '地図']);
  expect([...tabs.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(['/more']);
  const [now, map] = [...tabs.querySelectorAll<HTMLButtonElement>('button')];
  expect(now.getAttribute('aria-current')).toBe('page');
  await act(async () => map.click());
  expect(map.getAttribute('aria-current')).toBe('page');
  expect(page.querySelector('[data-testid=exercise-map] .map-screen [data-testid=national-map-stub]')).not.toBeNull();
  expect(mapCalls.at(-1)).toMatchObject({showInformation:false,legend:'none',regionPicker:false});
  expect(page.querySelector('button.ui-help-pin')?.textContent).toBe('助けが必要');
  expect(page.querySelector('.ui-band-exercise')?.textContent).toBe('演習');
  expect(page.querySelector('.ui-exercise-controls')).not.toBeNull();
  await act(async () => now.click());
  expect(page.querySelector('[data-testid=exercise-map]')).toBeNull();
  expect(page.querySelector('[data-now=hero]')?.closest('[hidden]')).toBeNull();
  expect(page.querySelector('.ui-band-exercise')?.textContent).toBe('演習');
});

it('/demo shows the safety check on the Now screen (as Live), not in the agent-log disclosure, and the hero is derived from that same check', async () => {
  const page = await mount('demo');
  const checks = page.querySelectorAll('[data-testid=replay-safety-check]');
  expect(checks).toHaveLength(1);
  expect(checks[0].closest('#exercise-details')).toBeNull();
  expect(checks[0].closest('#basis')).toBeNull();
  // Below the Now screen, like Live's AdaptiveHome slot.
  expect(page.querySelector('.now')!.compareDocumentPosition(checks[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  seenChecks.length = 0;
  const consent = checks[0].querySelector<HTMLInputElement>('input[type=checkbox]')!;
  await act(async () => consent.click());
  expect(consent.checked).toBe(true);
  // Every presentation derived after the change (hero and the disclosure alike) sees the consented check.
  expect(seenChecks.length).toBeGreaterThan(0);
  expect(seenChecks.every(check => check.consent)).toBe(true);
});

it('I3: at replay start (no evidence, plan or event) the exercise hero never claims "no active alerts"', async () => {
  served = activeSnapshot();
  served.evidence = []; served.evidence_projections = []; served.plans = []; served.plan_actions = []; served.plan_evaluations = [];
  served.events = [];
  served.situation = { ...served.situation, current_plan_id: null, active_event_ids: [], network_state: 'ONLINE_VERIFIED' };
  const page = await mount('demo');
  const hero = page.querySelector('[data-now=hero]')?.textContent;
  expect(hero).not.toBe('現在、警報はありません');
  expect(hero).toBe('確認済みの情報を待っています。');
});

it('D1: during a replayed official tsunami warning the hero carries the official protective instruction (as Live), and the band names the level with its real countdown', async () => {
  served = activeSnapshot();
  const at = Date.parse(served.replay.current_time);
  served.distress = { level: 'OFFICIAL_TSUNAMI', reports: [], trigger_evidence_ids: [served.evidence[0].id], deadline_at: new Date(at + 25 * 60_000).toISOString(),
    ai_escalated: false, synthetic: true, warning_class: 'WARNING', last_official_at: new Date(at - 60_000).toISOString(),
    trigger_expires_at: new Date(at + 60 * 60_000).toISOString(), stale_reason: null };
  served.plans = []; served.plan_actions = []; served.situation = { ...served.situation, current_plan_id: null };
  const page = await mount('demo');
  expect(page.querySelector('[data-now=hero]')?.textContent).toBe('今すぐ上の階・高い場所へ。水から離れてください。');
  const band = page.querySelector('.ui-band-danger')!;
  expect(band.querySelector('strong')?.textContent).toBe('演習 · 津波警報');
  expect(band.querySelector('[role=timer]')?.textContent).toBe('25:00');
  // The exercise label is kept on the Now screen too.
  expect(page.querySelector('[data-now=basis] .ui-tag-exercise')?.textContent).toBe('演習');
});

it('I4: exactly one visible "not a safety verdict" meta line, directly under the basis line', async () => {
  const page = await mount('demo');
  const note = page.querySelector('[data-now=note]')!;
  expect(note).not.toBeNull();
  expect(note.classList.contains('now-meta')).toBe(true);
  expect(note.closest('details')).toBeNull();
  expect(note.previousElementSibling?.getAttribute('data-now')).toBe('basis');
  expect(note.textContent).toBe('これは安全の判定ではありません。現地の状況と公式の指示に従ってください。');
  expect((page.textContent ?? '').split('安全性の証明ではありません').length - 1).toBe(0);
});

it('I2: help opens from the replay Map tab, stays mounted across tabs, and can be closed',async()=>{
  const page=await mount('demo');
  await act(async()=>{(page.querySelectorAll<HTMLButtonElement>('nav.ui-tabs button')[1]).click();});
  await act(async()=>{page.querySelector<HTMLButtonElement>('.ui-help-pin')!.click();});
  const dialog=page.querySelector('[role=dialog]')!;
  expect(dialog.closest('[hidden]')).toBeNull();
  expect(page.querySelector('.ui-help-pin:not([hidden])')).toBeNull();
  await act(async()=>{page.querySelectorAll<HTMLButtonElement>('nav.ui-tabs button')[0].click();});
  expect(page.querySelector('[role=dialog]')).toBe(dialog);
  await act(async()=>{dialog.querySelector<HTMLButtonElement>('button')!.click();});
  expect(page.querySelector('[role=dialog]')).toBeNull();
});

it('I1: offline replay Map exposes exercise provenance and last verification in its visible band',async()=>{
  const page=await mount('demo');
  await act(async()=>window.dispatchEvent(new Event('offline')));
  await act(async()=>page.querySelectorAll<HTMLButtonElement>('nav.ui-tabs button')[1].click());
  const band=page.querySelector('.ui-band-warn')!;
  expect(band.textContent).toContain('演習 · オフライン · 最終確認');
  expect(band.closest('[hidden]')).toBeNull();
  expect(page.querySelector('.ui-band-danger')).toBeNull();
});
