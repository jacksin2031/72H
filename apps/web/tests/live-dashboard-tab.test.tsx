// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DeviceLocation } from '../lib/use-device-location';
import { movementLiveSnapshot } from './live-fixtures';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flags = vi.hoisted(() => ({ takeover: false, role: 'mobile', locateCalls: 0 }));
vi.mock('../lib/device-role', () => ({ useDeviceRole: () => flags.role }));
vi.mock('../lib/live-presentation', async orig => ({
  ...await orig<typeof import('../lib/live-presentation')>(),
  shouldUseCriticalMobileTakeover: () => flags.takeover,
}));
vi.mock('../lib/use-power', async () => {
  const { derivePower } = await import('../lib/vnext');
  const value = { power: derivePower(75, false), level: null, override: 'AUTO', choose: () => {} };
  return { usePower: () => value };
});
vi.mock('../lib/use-device-location', () => {
  const location: DeviceLocation = {
    position: null, state: 'unavailable', freshness: 'UNAVAILABLE', now: 0, consent: false, ready: true, busy: false,
    failed: false, permissionDenied: false, permissionGranted: false, storageUnavailable: false,
    locate: async () => { flags.locateCalls += 1; return null; }, retain: () => {},
  };
  return { useDeviceLocation: () => location };
});
vi.mock('../lib/continuity', async orig => ({
  ...await orig<typeof import('../lib/continuity')>(),
  loadLiveSnapshot: vi.fn(async () => ({ snapshot: movementLiveSnapshot(), saved_at: Date.now() })),
  saveLiveSnapshot: vi.fn(async () => {}),
}));
vi.mock('../components/distress-entry', () => ({ DistressEntry: () => null }));

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
  root = null; container?.remove(); container = null; flags.takeover = false; flags.role = 'mobile'; flags.locateCalls = 0;
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
async function render(view: string) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root!.render(<LiveDashboard view={view} />); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return container;
}
const currentTab = (page: HTMLElement) => page.querySelector('nav.ui-tabs a[aria-current="page"]')?.textContent;

it('highlights More on the More view when there is no takeover', async () => {
  const page = await render('more');
  expect(currentTab(page)).toBe('More');
  expect(page.querySelector('.more')).not.toBeNull();
});
it('highlights Now (not More) when an official takeover shows the Now content on the More and notifications views', async () => {
  flags.takeover = true;
  for (const view of ['more', 'notifications']) {
    const page = await render(view);
    expect(page.querySelector('[data-now="hero"]'), view).not.toBeNull();
    expect(page.querySelector('.more'), view).toBeNull();
    expect(currentTab(page), view).toBe('Now');
    await act(async () => root!.unmount()); root = null; container?.remove(); container = null;
  }
});
it('desktop role: the More location button runs a location update (device locate), not a session refresh', async () => {
  flags.role = 'desktop';
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  const page = await render('more');
  expect(page.querySelector('.more')).not.toBeNull();
  const row = [...page.querySelectorAll<HTMLElement>('.ui-row')].find(r => r.querySelector('.ui-row-label')?.textContent === 'Location & privacy')!;
  await act(async () => row.click());
  const button = page.querySelector<HTMLButtonElement>('.more-location-card button.primary')!;
  expect(button.disabled).toBe(false);
  await act(async () => { button.click(); });
  expect(flags.locateCalls).toBeGreaterThan(0);
});
