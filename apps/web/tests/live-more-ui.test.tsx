// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileScene } from '../components/live-dashboard';
import { liveMessages } from '../lib/live-i18n';
import { liveMoreMessages } from '../lib/live-more-i18n';
import { projectLiveSnapshot } from '../lib/live-presentation';
import { initialSafetyCheck, derivePower } from '../lib/vnext';
import type { DeviceLocation } from '../lib/use-device-location';
import { LIVE_NOW, movementLiveSnapshot } from './live-fixtures';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function sceneProps(overrides: Partial<React.ComponentProps<typeof MobileScene>> = {}) {
  const snapshot = movementLiveSnapshot();
  snapshot.profile.current_location = { ...snapshot.profile.current_location, source: 'USER_SELECTED',
    observed_at: new Date(LIVE_NOW - 30_000).toISOString() };
  const projection = projectLiveSnapshot(snapshot, LIVE_NOW, 'offline', derivePower(75, false));
  const deviceLocation: DeviceLocation = {
    position: null, state: 'unavailable', freshness: 'UNAVAILABLE', now: LIVE_NOW, consent: false, ready: true, busy: false,
    failed: false, permissionDenied: false, permissionGranted: false, storageUnavailable: false,
    locate: async () => null, retain: () => {},
  };
  return {
    view: 'more', snapshot, language: 'en' as const,
    messages: { ...liveMessages.en, ...liveMoreMessages.en }, projection, deviceLocation, locationResolving: false,
    onHomeMapReady: () => {}, power: derivePower(75, false), level: null, override: 'AUTO', choose: () => {},
    theme: 'dark', chooseTheme: () => {}, busy: false, onProfile: () => {}, onProfileUpdate: async () => true,
    onRefresh: () => {}, onRouteSearch: async () => true, link: null, now: LIVE_NOW, connection: 'offline' as const,
    check: initialSafetyCheck(), setCheck: () => {}, notifications: [], dismissNotification: () => {}, sessionLost: false,
    canStart: false, locationSync: null, onRetryLocation: () => {}, onLocalLocationChecked: () => {}, onChooseArea: () => {},
    ...overrides,
  };
}

async function mount(props: React.ComponentProps<typeof MobileScene>) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(<MobileScene {...props} />); });
  return container;
}

async function click(element: Element) {
  await act(async () => { (element as HTMLElement).click(); });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove(); container = null;
  sessionStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('mobile More and Plan navigation', () => {
  it('keeps the disaster simulator behind a collapsed diagnostics disclosure, not a fifth primary setting', async () => {
    const page = await mount(sceneProps());
    expect(page.querySelectorAll('.more-destination')).toHaveLength(4);
    const reference=page.querySelector<HTMLAnchorElement>('a.reference-map-link[href="/map"]');
    expect(reference).not.toBeNull();
    expect(reference!.closest('details')).toBeNull();
    const details = page.querySelector<HTMLDetailsElement>('.more-lab-entry');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('Testing & diagnostics');
    expect(details?.querySelector('a')?.getAttribute('href')).toBe('/disaster-test');
  });

  it('collapses location diagnostics while keeping the accurate area and GPS action visible', async () => {
    const page = await mount(sceneProps());
    const details = page.querySelector<HTMLDetailsElement>('.more-location-meta');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toContain('Location details');
    expect(page.querySelector('.more-location-card button.primary')).not.toBeNull();
    expect(page.querySelectorAll('.more-destination')).toHaveLength(4);
  });

  it('puts an empty plan into one concise state without mounting three blank category cards', async () => {
    const props = sceneProps({ view: 'plan' });
    props.snapshot!.plan_actions = [];
    const page = await mount(props);
    expect(page.querySelectorAll('.action-panel')).toHaveLength(0);
    expect(page.querySelectorAll('.plan-empty-state')).toHaveLength(1);
    const tools = page.querySelector<HTMLDetailsElement>('.plan-tools');
    expect(tools).not.toBeNull();
    expect(tools?.open).toBe(false);
    expect(tools?.querySelector('summary')?.textContent).toBe('History and advanced options');
  });

  it('keeps language selection in the accessible Display destination', async () => {
    const chooseLanguage = vi.fn();
    const page = await mount(sceneProps({ chooseLanguage }));
    await click(page.querySelector('[data-more-panel="display"]')!);
    const selector = page.querySelector<HTMLSelectElement>('.settings-language select');
    expect(selector?.value).toBe('en');
    await act(async () => { selector!.value = 'zh-TW'; selector!.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(chooseLanguage).toHaveBeenCalledWith('zh-TW');
  });

  it('keeps More compact, with one primary location action and four destinations', async () => {
    const page = await mount(sceneProps());
    expect(page.querySelectorAll('.more-destination')).toHaveLength(4);
    expect(page.querySelectorAll('.more-location-card button.primary')).toHaveLength(1);
    expect(page.textContent).toContain('Area selected by you');
    expect(page.textContent).toContain('Emergency basics');
    expect(page.querySelector('.more-emergency-footer a[href="tel:119"]')).not.toBeNull();
    expect(page.textContent).not.toContain('Judge / Demo');
    expect(page.textContent).not.toContain('Continue on mobile');
    expect(page.querySelector('.route-preview-card')).toBeNull();
  });

  it('retains a session-scoped profile draft across More back navigation and keeps it after save failure', async () => {
    const props = sceneProps({ onProfileUpdate: async () => false });
    const page = await mount(props);
    await click(page.querySelector('.more-destination')!);
    await click([...page.querySelectorAll('button')].find(button => button.textContent === 'Edit settings')!);
    const accommodation = page.querySelector('.live-profile-form input:not([type="checkbox"])') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setValue.call(accommodation, 'Local QA draft'); accommodation.dispatchEvent(new Event('input', { bubbles: true })); });
    const draftKey = `72h-live-profile-draft:${props.snapshot!.session_id}`;
    expect(sessionStorage.getItem(draftKey)).toContain('Local QA draft');
    await click(page.querySelector('.more-back')!);
    expect(document.activeElement).toBe(page.querySelector('[data-more-panel="personal"]'));
    await click(page.querySelector('.more-destination')!);
    expect((page.querySelector('.live-profile-form input:not([type="checkbox"])') as HTMLInputElement).value).toBe('Local QA draft');
    const form = page.querySelector('.live-profile-form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('could not be saved');
    expect(sessionStorage.getItem(draftKey)).toContain('Local QA draft');
  });

  it('uses device-only GPS while offline and leaves the selected information area unchanged', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const locate = vi.fn(async () => ({ latitude: 35.68, longitude: 139.76, accuracy_m: 24,
      captured_at: LIVE_NOW, source: 'BROWSER_GEOLOCATION' as const }));
    const retry = vi.fn();
    const localChecked = vi.fn();
    const props = sceneProps({
      deviceLocation: { ...sceneProps().deviceLocation, locate }, connection: 'offline', onRetryLocation: retry,
      onLocalLocationChecked: localChecked,
      locationSync: { phase: 'failed', update: null },
    });
    const page = await mount(props);
    expect(page.textContent).toContain('could not be updated');
    await click(page.querySelector('.more-location-card button.primary')!);
    expect(locate).toHaveBeenCalledOnce();
    expect(localChecked).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(page.textContent).toContain('GPS was checked on this device only');
    expect(page.textContent).toContain('Area selected by you');
    expect(page.querySelectorAll('.more-destination')).toHaveLength(4);

    const syncedSnapshot = structuredClone(props.snapshot!);
    syncedSnapshot.profile.current_location = { ...syncedSnapshot.profile.current_location, source: 'GPS',
      observed_at: new Date(LIVE_NOW).toISOString() };
    await act(async () => { root!.render(<MobileScene {...props} snapshot={syncedSnapshot} connection="online" locationSync={null} />); });
    expect(page.querySelector('.location-local-only')).toBeNull();
  });

  it.each([
    ['EMERGENCY_PROTECT', 'pending'], ['EMERGENCY_PROTECT', 'failed'],
    ['SAFETY_CHECK', 'pending'], ['SAFETY_CHECK', 'failed'],
  ] as const)('keeps %s protection visible through a %s location gate and suppresses stale movement UI', async (mode, phase) => {
    const props = sceneProps({ view: 'dashboard', connection: 'online', locationSync: { phase, update: null } });
    const projection = projectLiveSnapshot(props.snapshot!, LIVE_NOW, 'online', derivePower(75, false));
    expect(props.snapshot!.spatial_guidance.current_action_kind).toBe('EVACUATE');
    expect(projection.mapGate).toBe(true);
    expect(projection.primaryAction?.risk_level).toBe('HIGH');
    const emergencyProjection = {
      ...projection,
      mapGate: true,
      presentation: {
        ...projection.presentation,
        mode,
        showMap: true,
        showRoute: true,
        showDestination: true,
        showEvidenceInline: true,
        showSafetyCheck: mode === 'SAFETY_CHECK',
      },
    };
    const check = mode === 'SAFETY_CHECK'
      ? { ...initialSafetyCheck(), status: 'AWAITING_RESPONSE' as const, consent: true }
      : initialSafetyCheck();
    const page = await mount({ ...props, projection: emergencyProjection, check });

    expect(page.querySelector('.location-sync-gate')).toBeNull();
    expect(page.querySelector(`.adaptive-home[data-presentation-mode="${mode}"]`)).not.toBeNull();
    expect(page.querySelector('.emergency-contact a[href="tel:119"]')).not.toBeNull();
    expect(page.querySelector('.verified-route-panel')).toBeNull();
    expect(page.querySelector('.route-state')).toBeNull();
    expect(page.querySelector('.map-gate-notice')).toBeNull();
    expect(page.querySelector('[role="status"].location-sync-inline')).not.toBeNull();
    expect(page.textContent).not.toContain('Go to the designated shelter shown in the current plan.');
    if (mode === 'SAFETY_CHECK') expect(page.querySelector('.check-buttons')).not.toBeNull();
  });

  it('keeps plan actions behind the failed location gate', async () => {
    const page = await mount(sceneProps({ view: 'plan', locationSync: { phase: 'failed', update: null } }));
    expect(page.querySelector('.location-sync-gate')).not.toBeNull();
    expect(page.querySelector('.live-plan-scene')).toBeNull();
  });

  it.each([
    ['ja', ['無事です', '助けが必要', '今は動けません']],
    ['en', ['I am safe', 'I need help', 'I cannot move right now']],
    ['zh-TW', ['我目前安全', '我需要協助', '我現在無法移動']],
  ] as const)('gives Safety Check responses accessible %s labels and preserves response behavior', async (language, labels) => {
    const base = sceneProps({ view: 'dashboard' });
    const projection = base.projection!;
    const setCheck = vi.fn();
    const check = { ...initialSafetyCheck(), consent: true, status: 'AWAITING_RESPONSE' as const,
      eventKey: 'test-critical', requestedAt: LIVE_NOW, attempts: 1 };
    const page = await mount({ ...base, language, messages: { ...liveMessages[language], ...liveMoreMessages[language] },
      check, setCheck, projection: { ...projection, presentation: {
        ...projection.presentation, mode: 'SAFETY_CHECK', showSafetyCheck: true,
      } } });
    const buttons = [...page.querySelectorAll('.check-buttons button')];
    expect(buttons.map(button => button.textContent)).toEqual(labels);
    await click(buttons[1]);
    const update = setCheck.mock.calls[0][0];
    expect(update(check).status).toBe('NEEDS_ASSISTANCE');
  });

  it('keeps Privacy controls local and retains no point by default', async () => {
    const page = await mount(sceneProps());
    await click(page.querySelector('[data-more-panel="privacy"]')!);
    expect(page.querySelector('.device-location input[type="checkbox"]')).not.toBeNull();
    expect((page.querySelector('.device-location input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    expect(page.querySelector('.device-location button')).toBeNull();
    expect(page.querySelector('.more-back')).not.toBeNull();
  });

  it('disables the single More GPS action while a device location request is active', async () => {
    const base = sceneProps();
    const page = await mount(sceneProps({ deviceLocation: { ...base.deviceLocation, busy: true } }));
    expect(page.querySelector<HTMLButtonElement>('.more-location-card button.primary')?.disabled).toBe(true);
  });

  it('keeps Judge and replay diagnostics out of the consumer offline panel', async () => {
    const cacheDescriptor = Object.getOwnPropertyDescriptor(window, 'caches');
    const globalCacheDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
    const serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    const cachedPage = { ok: true, clone: () => ({ text: async () => '<script src="/_next/static/chunks/app.js"></script><link href="/_next/static/css/app.css">' }) } as Response;
    const cacheMatch = vi.fn(async (url: string) => url === '/dashboard' ? cachedPage
      : url === '/maps/catalog.json' ? null : { ok: true } as Response);
    const cache = { match: cacheMatch };
    const cacheKeys = vi.fn(async () => ['72h-shell-test']);
    const cacheStorage = {
      keys: cacheKeys, open: async () => cache,
    };
    Object.defineProperty(window, 'caches', { configurable: true, value: cacheStorage });
    Object.defineProperty(globalThis, 'caches', { configurable: true, value: cacheStorage });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
      getRegistration: async () => ({ active: { state: 'activated' } }),
    } });
    try {
      const page = await mount(sceneProps());
      await click(page.querySelector('[data-more-panel="offline"]')!);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
      expect(cacheKeys).toHaveBeenCalledOnce();
      expect(cacheMatch).toHaveBeenCalledWith('/dashboard');
      const evidenceStatus = page.querySelector('.offline-evidence-status')!;
      expect(evidenceStatus.textContent).toContain('Retrieved:');
      expect(evidenceStatus.textContent).not.toContain('Checked at:');
      expect(page.textContent).toContain('This screen is saved on this device');
      expect(page.textContent).toContain('Required files were found; offline operation still needs to be confirmed');
      expect(page.textContent).not.toContain('Judge / Demo');
      expect(page.textContent).not.toContain('Synthetic replay');
    } finally {
      if (cacheDescriptor) Object.defineProperty(window, 'caches', cacheDescriptor);
      else Reflect.deleteProperty(window, 'caches');
      if (globalCacheDescriptor) Object.defineProperty(globalThis, 'caches', globalCacheDescriptor);
      else Reflect.deleteProperty(globalThis, 'caches');
      if (serviceWorkerDescriptor) Object.defineProperty(navigator, 'serviceWorker', serviceWorkerDescriptor);
      else Reflect.deleteProperty(navigator, 'serviceWorker');
    }
  });

  it('keeps advanced route candidate UI deliberate and preserves its warning', async () => {
    const page = await mount(sceneProps({ view: 'plan' }));
    expect(page.querySelector('.route-preview-card')).toBeNull();
    await click([...page.querySelectorAll('button')].find(button => button.textContent === 'Review advanced candidates')!);
    expect(page.querySelector('.route-preview-card')).not.toBeNull();
    expect(page.textContent).toContain('this is not a safety guarantee');
    expect(page.textContent).toContain('Preview candidate map');
    await click(page.querySelector('.more-back')!);
    expect(document.activeElement).toBe(page.querySelector('[data-plan-panel="advanced"]'));
  });
});
