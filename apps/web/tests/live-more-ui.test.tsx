// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveNowScreenVisible, liveTakeoverBandLabel, MobileScene, MoreHub } from '../components/live-dashboard';
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
    onRefresh: () => {}, onRouteSearch: async () => true, link: 'https://example.test/app', now: LIVE_NOW, connection: 'offline' as const,
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

/** Opens a More row (English labels). */
async function openRow(page: HTMLElement, label: string) {
  const row = [...page.querySelectorAll<HTMLElement>('.ui-row')].find(item => item.querySelector('.ui-row-label')?.textContent === label);
  expect(row, label).toBeDefined();
  await click(row!);
}
const backButton = (page: HTMLElement) => page.querySelector<HTMLButtonElement>('.more-sub > .ui-btn-secondary')!;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove(); container = null;
  sessionStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('mobile More and Plan navigation', () => {
  it('lists the nine settings rows as a plain list, with no legacy destination cards or lab disclosure', async () => {
    const page = await mount(sceneProps());
    expect([...page.querySelectorAll('.ui-row .ui-row-label')].map(e => e.textContent)).toEqual([
      'Language', 'Appearance', 'Power mode', 'Emergency contacts', 'Location & privacy', 'Notifications', 'Sources', 'Exercises & demo', 'About']);
    expect(page.querySelectorAll('.more-destination')).toHaveLength(0);
    expect(page.querySelector('.more-lab-entry')).toBeNull();
    expect(page.querySelector('.live-more-scene')).toBeNull();
  });

  it('keeps the disaster simulator under Exercises & demo, labelled as an exercise', async () => {
    const page = await mount(sceneProps());
    await openRow(page, 'Exercises & demo');
    expect([...page.querySelectorAll('a.ui-row')].map(a => a.getAttribute('href'))).toEqual(['/demo', '/simulation', '/disaster-test']);
    expect(page.querySelector('.ui-tag-exercise')?.textContent).toBe('Exercise');
    expect(page.querySelector('select[aria-label="Historical earthquake"]')).not.toBeNull();
  });

  it('collapses location diagnostics while keeping the accurate area and GPS action visible', async () => {
    const page = await mount(sceneProps());
    await openRow(page, 'Location & privacy');
    const details = page.querySelector<HTMLDetailsElement>('.more-location-meta');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toContain('Location details');
    expect(page.querySelector('.more-location-card button.primary')).not.toBeNull();
  });

  it('puts an empty plan into one concise state without mounting three blank category cards', async () => {
    const props = sceneProps({ view: 'plan' });
    props.snapshot!.plan_actions = [];
    const page = await mount(props);
    expect(page.querySelectorAll('.action-panel')).toHaveLength(0);
    expect(page.querySelectorAll('[data-now="hero"]')).toHaveLength(1);
    expect(page.querySelector('[data-now="next"]')).toBeNull();
    expect(page.querySelector('[data-now="avoid"]')).toBeNull();
    const tools = page.querySelector<HTMLDetailsElement>('[data-now="basis"] details.plan-tools');
    expect(tools).not.toBeNull();
    expect(tools?.open).toBe(false);
    expect(tools?.querySelector('summary')?.textContent).toBe('History and advanced options');
  });

  it('keeps language selection in the Language subpage only, with a check on the current language', async () => {
    const chooseLanguage = vi.fn();
    const page = await mount(sceneProps({ chooseLanguage }));
    expect(page.querySelector('select')).toBeNull();
    await openRow(page, 'Language');
    const rows = [...page.querySelectorAll<HTMLElement>('.ui-row')];
    expect(rows.map(r => r.querySelector('.ui-row-label')?.textContent)).toEqual(['日本語', 'English', '繁體中文']);
    expect(rows.map(r => r.querySelector('.ui-row-tail')?.textContent ?? '')).toEqual(['', '✓', '']);
    await click(rows[2]);
    expect(chooseLanguage).toHaveBeenCalledWith('zh-TW');
  });

  it('has no language select (or any select) on the main More list', async () => {
    const page = await mount(sceneProps());
    expect(page.querySelector('select')).toBeNull();
    expect(page.querySelector('.live-language, .settings-language')).toBeNull();
  });

  it('switches appearance from the Appearance subpage', async () => {
    const chooseTheme = vi.fn();
    const page = await mount(sceneProps({ chooseTheme }));
    await openRow(page, 'Appearance');
    const rows = [...page.querySelectorAll<HTMLElement>('.ui-row')];
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('.ui-row-tail')?.textContent).toBe('✓');
    await click(rows[2]);
    expect(chooseTheme).toHaveBeenCalledWith('contrast');
  });

  it('keeps More compact: nine rows, no card or footer on the list, emergency numbers under About', async () => {
    const page = await mount(sceneProps());
    expect(page.querySelectorAll('.ui-row')).toHaveLength(9);
    expect(page.querySelector('.more-location-card')).toBeNull();
    expect(page.querySelector('.more-emergency-footer')).toBeNull();
    expect(page.querySelectorAll('button.primary, .ui-btn-primary')).toHaveLength(0);
    expect(page.textContent).not.toContain('Judge / Demo');
    expect(page.textContent).not.toContain('Continue on mobile');
    expect(page.querySelector('.route-preview-card')).toBeNull();
    await openRow(page, 'Location & privacy');
    expect(page.querySelectorAll('.more-location-card button.primary')).toHaveLength(1);
    expect(page.textContent).toContain('Area selected by you');
    await click(backButton(page));
    await openRow(page, 'About');
    expect(page.textContent).toContain('Emergency basics');
    expect(page.querySelector('.emergency-contact a[href="tel:119"]')).not.toBeNull();
    // Mobile has no handoff card, even when a handoff link exists.
    expect(page.querySelector('.handoff-card')).toBeNull();
    expect(page.textContent).not.toContain('Continue on mobile');
    expect(page.querySelector('a.primary')).toBeNull();
    expect(page.querySelector('.ui-row-value')?.textContent).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('opens Notifications by default on the notifications view and hides the list', async () => {
    const page = await mount(sceneProps({ view: 'notifications' }));
    expect(page.querySelector('.live-notifications')).not.toBeNull();
    expect(page.querySelector('.more-title')).toBeNull();
    await click(backButton(page));
    expect(page.querySelectorAll('.ui-row')).toHaveLength(9);
  });

  it('retains a session-scoped profile draft across More back navigation and keeps it after save failure', async () => {
    const props = sceneProps({ onProfileUpdate: async () => false });
    const page = await mount(props);
    await openRow(page, 'Location & privacy');
    await click([...page.querySelectorAll('button')].find(button => button.textContent === 'Edit settings')!);
    const accommodation = page.querySelector('.live-profile-form input:not([type="checkbox"])') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setValue.call(accommodation, 'Local QA draft'); accommodation.dispatchEvent(new Event('input', { bubbles: true })); });
    const draftKey = `72h-live-profile-draft:${props.snapshot!.session_id}`;
    expect(sessionStorage.getItem(draftKey)).toContain('Local QA draft');
    await click(backButton(page));
    expect(document.activeElement).toBe(page.querySelectorAll('.ui-row')[4]);
    await openRow(page, 'Location & privacy');
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
    await openRow(page, 'Location & privacy');
    expect(page.textContent).toContain('could not be updated');
    await click(page.querySelector('.more-location-card button.primary')!);
    expect(locate).toHaveBeenCalledOnce();
    expect(localChecked).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(page.textContent).toContain('GPS was checked on this device only');
    expect(page.textContent).toContain('Area selected by you');

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
    await openRow(page, 'Location & privacy');
    expect(page.querySelector('.device-location input[type="checkbox"]')).not.toBeNull();
    expect((page.querySelector('.device-location input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    expect(page.querySelector('.device-location button')).toBeNull();
    expect(backButton(page)).not.toBeNull();
  });

  it('disables the single More GPS action while a device location request is active', async () => {
    const base = sceneProps();
    const page = await mount(sceneProps({ deviceLocation: { ...base.deviceLocation, busy: true } }));
    await openRow(page, 'Location & privacy');
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
      await openRow(page, 'About');
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
    const tools = page.querySelector<HTMLDetailsElement>('details.plan-tools')!;
    expect(tools.open).toBe(false);
    expect(page.querySelector('.route-preview-card')).toBeNull();
    await act(async () => { tools.open = true; tools.dispatchEvent(new Event('toggle')); });
    expect(page.querySelector('.route-preview-card')).not.toBeNull();
    expect(page.querySelector('.route-preview-card')!.closest('details')).toBe(tools);
    expect(page.textContent).toContain('this is not a safety guarantee');
    expect(page.textContent).toContain('Preview candidate map');
  });
});

describe('Now screen in the live mobile scene', () => {
  function withPlan(props: ReturnType<typeof sceneProps>) {
    const snapshot = props.snapshot!;
    const now = snapshot.plan_actions[0];
    snapshot.plan_actions = [now,
      { ...now, id: 'action-live-next', category: 'NEXT', text: 'Tell your family where you are.', risk_level: 'LOW' },
      { ...now, id: 'action-live-avoid', category: 'AVOID', text: 'Do not go near the coast.', risk_level: 'LOW' }];
    return { ...props, projection: projectLiveSnapshot(snapshot, LIVE_NOW, props.connection, derivePower(75, false)) };
  }

  it.each(['dashboard', 'plan', 'sources'] as const)('renders one hero instruction first on the %s view, with basis, help, next and avoid', async view => {
    const props = withPlan(sceneProps({ view, connection: 'online' }));
    const page = await mount({ ...props, help: <button type="button" className="help-probe">I need help</button> });
    const order = [...page.querySelectorAll('[data-now]')].map(item => item.getAttribute('data-now'));
    expect(order).toEqual(['hero', 'basis', 'help', 'next', 'avoid', 'updated']);
    const hero = page.querySelector('[data-now="hero"]')!;
    expect(hero.tagName).toBe('H1');
    expect(hero.textContent).toBe(props.projection!.primaryAction!.text);
    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(page.querySelector('.now-card')).toBeNull();
    expect(page.querySelector('[data-now="basis"] .now-meta')?.textContent).toBe('JMA_DISASTER_XML · published 11:59');
    expect(page.querySelector('[data-now="help"] .help-probe')).not.toBeNull();
    expect(page.querySelector('[data-now="next"]')?.textContent).toContain('Tell your family where you are.');
    expect(page.querySelector('[data-now="avoid"]')?.textContent).toContain('Do not go near the coast.');
    expect(page.querySelector('[data-now="updated"]')?.textContent).toBe('Updated 11:59');
    const details = page.querySelector<HTMLDetailsElement>('[data-now="basis"] details#basis')!;
    expect(details.open).toBe(view !== 'dashboard');
    expect(details.querySelector('.plan-history')).not.toBeNull();
    expect(details.querySelector('.live-review-list')).not.toBeNull();
    expect(details.querySelector('.plan-history')!.compareDocumentPosition(details.querySelector('.live-review-list')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the AI explanation (with its label) inside the basis details', async () => {
    const page = await mount(withPlan(sceneProps({ view: 'plan', connection: 'online' })));
    const panel = page.querySelector('[data-now="basis"] [data-testid="plan-explanation-panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector('[data-testid="plan-explanation-mode"]')?.textContent).toBeTruthy();
  });

  it('does not mount the AI explanation (or its network request) while the basis details are closed', async () => {
    const page = await mount(withPlan(sceneProps({ view: 'dashboard', connection: 'online' })));
    expect(page.querySelector('[data-testid="plan-explanation-panel"]')).toBeNull();
    const details = page.querySelector<HTMLDetailsElement>('details#basis')!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); });
    expect(page.querySelector('[data-testid="plan-explanation-panel"]')).not.toBeNull();
  });

  it('shows the offline last-verified time and a warning tone while offline', async () => {
    const page = await mount(withPlan(sceneProps({ view: 'dashboard', connection: 'offline' })));
    expect(page.querySelector('[data-now="updated"]')?.textContent).toBe('Offline · last verified 11:59');
    expect(page.querySelector('[data-now="hero"]')?.classList.contains('now-hero-warn')).toBe(true);
  });

  it('includes the date when the last verified time is not from today', async () => {
    const props = withPlan(sceneProps({ view: 'dashboard', connection: 'offline' }));
    const page = await mount({ ...props, now: LIVE_NOW + 2 * 24 * 60 * 60_000 });
    expect(page.querySelector('[data-now="updated"]')?.textContent).toBe('Offline · last verified 10/6 11:59');
  });

  it('says there are no active alerts only when there is no plan, no active event and the source is current', async () => {
    const props = sceneProps({ view: 'dashboard', connection: 'online' });
    const snapshot = props.snapshot!;
    snapshot.plans = []; snapshot.plan_actions = [];
    snapshot.situation = { ...snapshot.situation, current_plan_id: null, active_event_ids: [] };
    const projection = projectLiveSnapshot(snapshot, LIVE_NOW, 'online', derivePower(75, false));
    const page = await mount({ ...props, snapshot, projection });
    expect(page.querySelector('[data-now="hero"]')?.textContent).toBe('No active alerts');
    await act(async () => { root!.render(<MobileScene {...props} snapshot={snapshot} connection="offline"
      projection={projectLiveSnapshot(snapshot, LIVE_NOW, 'offline', derivePower(75, false))} />); });
    expect(page.querySelector('[data-now="hero"]')?.textContent).not.toBe('No active alerts');
  });

  it('uses the danger tone for a critical protection takeover and keeps help reachable', async () => {
    const props = withPlan(sceneProps({ view: 'dashboard', connection: 'online' }));
    const projection = { ...props.projection!, presentation: { ...props.projection!.presentation, mode: 'EMERGENCY_PROTECT' as const } };
    const page = await mount({ ...props, projection, help: <button type="button" className="help-probe">I need help</button> });
    expect(page.querySelector('[data-now="hero"]')?.classList.contains('now-hero-danger')).toBe(true);
    expect(page.querySelector('[data-now="help"] .help-probe')).not.toBeNull();
  });

  it('gives the takeover band the same protective text as the hero when a location gate suppresses an evacuation instruction', async () => {
    const props = withPlan(sceneProps({ view: 'dashboard', connection: 'online' }));
    const shelterText = 'Go to the designated shelter shown in the current plan.';
    expect(props.snapshot!.spatial_guidance.current_action_kind).toBe('EVACUATE');
    const projection = { ...props.projection!, presentation: { ...props.projection!.presentation, mode: 'EMERGENCY_PROTECT' as const } };
    const band = (locationSync: boolean) => liveTakeoverBandLabel({ view: 'dashboard', snapshot: props.snapshot!, projection,
      locationSync, connection: 'online', messages: props.messages });
    expect(band(false)).toBe(shelterText);
    const page = await mount({ ...props, projection, locationSync: { phase: 'pending', update: null } });
    const hero = page.querySelector('[data-now="hero"]')!.textContent;
    expect(hero).toBe('Protect yourself first');
    expect(band(true)).toBe(hero);
    expect(band(true)).not.toContain(shelterText);
  });

  it('says "last verified" rather than "updated" when online but not verified or stale', async () => {
    const props = withPlan(sceneProps({ view: 'dashboard', connection: 'online' }));
    const page = await mount({ ...props, projection: { ...props.projection!, networkState: 'RECONNECTING' as const } });
    expect(page.querySelector('[data-now="updated"]')?.textContent).toBe('Last verified 11:59');
    await act(async () => { root!.render(<MobileScene {...props} projection={{ ...props.projection!, stale: true }} />); });
    expect(page.querySelector('[data-now="updated"]')?.textContent).toBe('Last verified 11:59');
  });

  it('does not say "No active alerts" while a distress level is active', async () => {
    const props = sceneProps({ view: 'dashboard', connection: 'online' });
    const snapshot = props.snapshot!;
    snapshot.plans = []; snapshot.plan_actions = [];
    snapshot.situation = { ...snapshot.situation, current_plan_id: null, active_event_ids: [] };
    const projection = projectLiveSnapshot(snapshot, LIVE_NOW, 'online', derivePower(75, false));
    const page = await mount({ ...props, snapshot, projection });
    expect(page.querySelector('[data-now="hero"]')?.textContent).toBe('No active alerts');
    const reported = { ...snapshot, distress: { ...snapshot.distress, level: 'USER_REPORTED' as const } };
    await act(async () => { root!.render(<MobileScene {...props} snapshot={reported} projection={projectLiveSnapshot(reported, LIVE_NOW, 'online', derivePower(75, false))} />); });
    expect(page.querySelector('[data-now="hero"]')?.textContent).not.toBe('No active alerts');
  });

  it('does not render the Now screen on More', async () => {
    const page = await mount(sceneProps({ view: 'more' }));
    expect(page.querySelector('[data-now]')).toBeNull();
  });
});

describe('liveNowScreenVisible', () => {
  it('matches where the scenes render the Now screen, so help is never lost', () => {
    const v = (role: string, view: string, hasData: boolean, mode: string | undefined, locationSync: boolean) =>
      liveNowScreenVisible({ role, view, hasData, mode, locationSync });
    expect(v('mobile', 'dashboard', true, 'MONITORING', false)).toBe(true);
    expect(v('mobile', 'plan', true, 'MONITORING', false)).toBe(true);
    expect(v('mobile', 'sources', true, 'MONITORING', false)).toBe(true);
    expect(v('mobile', 'more', true, 'MONITORING', false)).toBe(false);
    expect(v('mobile', 'notifications', true, 'MONITORING', false)).toBe(false);
    expect(v('mobile', 'dashboard', false, undefined, false)).toBe(false);
    expect(v('mobile', 'dashboard', true, 'MONITORING', true)).toBe(false);
    expect(v('mobile', 'dashboard', true, 'EMERGENCY_PROTECT', true)).toBe(true);
    expect(v('mobile', 'plan', true, 'EMERGENCY_PROTECT', true)).toBe(false);
    expect(v('desktop', 'sources', true, 'MONITORING', false)).toBe(true);
    expect(v('desktop', 'dashboard', true, 'EMERGENCY_PROTECT', true)).toBe(false);
    expect(v('unknown', 'dashboard', true, 'MONITORING', false)).toBe(false);
  });
});

describe('More hub: privacy sentence and desktop wiring', () => {
  function hubProps(overrides: Partial<React.ComponentProps<typeof MoreHub>> = {}) {
    const { view, snapshot, language, messages, projection, deviceLocation, power, level, override, choose, theme, chooseTheme, busy,
      onProfileUpdate, onRefresh, now, connection, check, setCheck, notifications, dismissNotification, sessionLost, canStart, locationSync,
      onRetryLocation, onLocalLocationChecked, onChooseArea } = sceneProps();
    return { view, snapshot: snapshot!, projection: projection!, language, messages, deviceLocation, power, level, override, choose, theme, chooseTheme,
      busy, onProfileUpdate, onRefresh, link: null, now, connection, check, setCheck, notifications, dismissNotification, sessionLost, canStart,
      locationSync, onRetryLocation, onLocalLocationChecked, onChooseArea, ...overrides };
  }
  async function mountHub(props: React.ComponentProps<typeof MoreHub>) {
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => { root!.render(<MoreHub {...props} />); });
    return container;
  }

  it('shows one short privacy sentence, the controls outside the disclosure, and the full explanation inside it', async () => {
    const page = await mountHub(hubProps());
    await openRow(page, 'Location & privacy');
    const disclosure = page.querySelector('details.ui-disclosure')!;
    expect(page.textContent).toContain('Exact coordinates stay on this device.');
    expect(disclosure.textContent).toContain(liveMoreMessages.en.locationPrivacy ?? liveMessages.en.locationPrivacy);
    // The long text is only inside the disclosure.
    const full = liveMessages.en.locationPrivacy;
    expect(page.textContent!.split(full).length - 1).toBe(1);
    expect(disclosure.contains(page.querySelector('.device-location'))).toBe(false);
    expect(page.querySelector('.device-location input[type="checkbox"]')).not.toBeNull();
  });

  it('desktop: full safety-check response buttons live in Location & privacy; consent only without the flag', async () => {
    const waiting = { ...initialSafetyCheck(), consent: true, status: 'AWAITING_RESPONSE' as const, eventKey: 'k', requestedAt: LIVE_NOW, attempts: 1 };
    let page = await mountHub(hubProps({ check: waiting, fullSafetyCheck: true }));
    await openRow(page, 'Location & privacy');
    expect(page.querySelectorAll('.check-buttons button')).toHaveLength(3);
    await act(async () => root!.unmount()); container!.remove();
    page = await mountHub(hubProps({ check: waiting }));
    await openRow(page, 'Location & privacy');
    expect(page.querySelector('.check-buttons')).toBeNull();
    expect(page.querySelector('.check-card input[type="checkbox"]')).not.toBeNull();
  });

  it('shows the handoff card only when the hub is given a link (desktop)', async () => {
    const page = await mountHub(hubProps({ link: 'https://example.test/app' }));
    await openRow(page, 'About');
    expect(page.querySelector('.handoff-card')).not.toBeNull();
  });

  it('the online GPS button calls the location-update callback, not the session refresh', async () => {
    const onRetryLocation = vi.fn(); const onRefresh = vi.fn();
    const base = hubProps();
    const page = await mountHub(hubProps({ connection: 'online', canStart: true, onRetryLocation, onRefresh, deviceLocation: { ...base.deviceLocation, ready: true } }));
    await openRow(page, 'Location & privacy');
    await click(page.querySelector('.more-location-card button.primary')!);
    expect(onRetryLocation).toHaveBeenCalledOnce();
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
