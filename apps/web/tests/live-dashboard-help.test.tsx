// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DeviceLocation } from '../lib/use-device-location';
import { movementLiveSnapshot } from './live-fixtures';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// LiveDashboard's first render imports the whole dashboard graph; under a full parallel run on a slow disk it exceeds the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

vi.mock('../lib/device-role', () => ({ useDeviceRole: () => 'mobile' }));
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
  loadLiveSnapshot: vi.fn(async () => ({ snapshot: movementLiveSnapshot(), saved_at: Date.now() })),
  saveLiveSnapshot: vi.fn(async () => {}),
}));
// A stateful stand-in for the distress panel: any remount resets its text.
vi.mock('../components/distress-entry', () => ({
  DistressEntry: () => {
    const [text, setText] = useState('');
    return <input className="distress-probe" value={text} onChange={event => setText(event.target.value)} />;
  },
}));

const { LiveDashboard } = await import('../components/live-dashboard');

let root: Root | null = null;
let container: HTMLDivElement | null = null;
beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  localStorage.setItem('72h-language', 'en');
  localStorage.setItem('72h-sos-onboarded', '1');
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; container?.remove(); container = null;
  localStorage.clear();
  Reflect.deleteProperty(globalThis, 'IntersectionObserver');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

async function render(view: string) {
  if (!container) { container = document.createElement('div'); document.body.append(container); root = createRoot(container); }
  await act(async () => { root!.render(<LiveDashboard view={view} />); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return container;
}
async function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setValue.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

it('keeps the distress panel mounted (same node, same state) when the help button moves between the Now slot and <main>', async () => {
  const page = await render('dashboard');
  const slotButton = page.querySelector<HTMLButtonElement>('[data-now="help"] .distress-entry-button');
  expect(slotButton).not.toBeNull();
  expect(slotButton!.classList.contains('ui-btn-danger')).toBe(true);
  await act(async () => slotButton!.click());
  const panel = page.querySelector<HTMLInputElement>('.distress-probe')!;
  expect(panel).not.toBeNull();
  expect(panel.closest('[data-now]')).toBeNull();
  await type(panel, 'trapped on 3F');

  await render('more'); // no Now slot: the full button moves to the top of <main>
  expect(page.querySelector('[data-now]')).toBeNull();
  expect(page.querySelector('.distress-probe')).toBe(panel);
  expect(panel.value).toBe('trapped on 3F');

  await render('dashboard');
  expect(page.querySelector('.distress-probe')).toBe(panel);
  expect(panel.value).toBe('trapped on 3F');
});

it('shows a pinned help control when there is no Now slot, and it toggles the same panel', async () => {
  const page = await render('more');
  const pin = page.querySelector<HTMLButtonElement>('.ui-help-pin')!;
  expect(pin).not.toBeNull();
  expect(pin.getAttribute('aria-label')).toBe('I need help');
  expect(pin.textContent).toBe('Help');
  await act(async () => pin.click());
  expect(page.querySelector('.distress-probe')).not.toBeNull();
  expect(page.querySelector('.ui-help-pin:not([hidden])')).toBeNull();
});

it('hides the pinned control while the Now slot button is mounted and IntersectionObserver is unavailable', async () => {
  const page = await render('dashboard');
  expect(page.querySelector('[data-now="help"] .distress-entry-button')).not.toBeNull();
  expect(page.querySelector('.ui-help-pin:not([hidden])')).toBeNull();
});

it('shows the pinned control when the Now slot button scrolls out of view', async () => {
  let report: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { report = callback; }
    observe() {} disconnect() {}
  };
  const page = await render('dashboard');
  await act(async () => report!([{ isIntersecting: true }]));
  expect(page.querySelector('.ui-help-pin:not([hidden])')).toBeNull();
  await act(async () => report!([{ isIntersecting: false }]));
  expect(page.querySelector('.ui-help-pin:not([hidden])')).not.toBeNull();
});

it('D4: More renders just one visible help entry; the overlay has a close control',async()=>{
  const page=await render('more');
  expect(page.querySelector('.distress-entry-button')).toBeNull();
  const pin=page.querySelector<HTMLButtonElement>('.ui-help-pin:not([hidden])')!;pin.focus();
  await act(async()=>pin.click());
  const close=page.querySelector<HTMLButtonElement>('[role=dialog] button')!;
  expect(close.textContent).toBe('Close');
  await act(async()=>close.click());
  expect(page.querySelector('[role=dialog]')).toBeNull();
  expect(document.activeElement).toBe(page.querySelector('.ui-help-pin'));
});
