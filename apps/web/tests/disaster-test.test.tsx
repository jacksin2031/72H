// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulationProvider } from '../lib/simulation-session';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/disaster-test' }));
import { DisasterTestLab } from '../components/disaster-test-lab';
import { defaultDisasterTest, disasterPresets, projectDisasterTest } from '../lib/disaster-test';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null; container = null;
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('isolated disaster test lab', () => {
  it('keeps all synthetic scenarios fail-closed even with recent simulated evidence and network', () => {
    expect(defaultDisasterTest.evidence).toBe('FRESH');
    for (const preset of disasterPresets) {
      const projection = projectDisasterTest(preset.input);
      expect(projection.mapEnabled).toBe(false);
      expect(projection.movementAuthorized).toBe(false);
      expect(projection.notificationsSent).toBe(false);
      expect(projection.liveSessionModified).toBe(false);
    }
    const output = projectDisasterTest({ ...defaultDisasterTest, severity: 4, network: 'ONLINE', evidence: 'FRESH' });
    expect(output.movementAuthorized).toBe(false);
    expect(output.presentationMode).toBe('EMERGENCY_PROTECT');
  });
  it('uses real derivePower thresholds instead of faking battery policy', () => {
    expect(projectDisasterTest({ ...defaultDisasterTest, battery: 31 }).power.mode).toBe('NORMAL');
    expect(projectDisasterTest({ ...defaultDisasterTest, battery: 30 }).power.mode).toBe('CONSERVE');
    expect(projectDisasterTest({ ...defaultDisasterTest, battery: 15 }).power.mode).toBe('EMERGENCY_POWER');
    expect(projectDisasterTest({ ...defaultDisasterTest, battery: 5 }).power.mode).toBe('SURVIVAL');
    expect(projectDisasterTest({ ...defaultDisasterTest, battery: null }).power.batteryKnown).toBe(false);
  });
  it('shows simulated safety-check and emergency protection only for severe levels', () => {
    expect(projectDisasterTest({ ...defaultDisasterTest, severity: 2 }).requiresSafetyCheck).toBe(false);
    expect(projectDisasterTest({ ...defaultDisasterTest, severity: 3 }).presentationMode).toBe('SAFETY_CHECK');
    expect(projectDisasterTest({ ...defaultDisasterTest, severity: 4 }).critical).toBe(true);
    expect(projectDisasterTest({ ...defaultDisasterTest, severity: 4, battery: 3 }).presentationMode).toBe('SURVIVAL');
  });
  it('renders accessible controls without mutating real Live sessions', async () => {
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => []})));
    await act(async () => { root!.render(<SimulationProvider><DisasterTestLab /></SimulationProvider>); });
    expect(container.querySelector('[data-testid="disaster-test-lab"]')).not.toBeNull();
    // Marked as an exercise exactly like the live screens: the 演練 band (ja: 演習) plus the exercise Tag on the Now preview.
    expect(container.querySelector('.ui-band-exercise')?.textContent).toBe('演習');
    expect(container.querySelector('[data-testid="simulation-now"] .ui-tag-exercise')?.textContent).toBe('演習');
    expect(container.querySelector('[data-testid="simulation-now"]')).not.toBeNull();
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(1);
    const selects = container.querySelectorAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(6);
    const buttons = [...container.querySelectorAll('button')];
    const critical = buttons.find(button => button.textContent?.includes('重大') || button.textContent?.includes('Critical') || button.textContent?.includes('重大'));
    const select = container.querySelector<HTMLSelectElement>('[data-testid="severity"]')!;
    await act(async () => { select.value = '4'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelector('[data-testid="lab-safety-check"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="safety-gates"]')?.textContent).not.toBe('');
    expect(critical === undefined || critical instanceof HTMLButtonElement).toBe(true);
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
  });
});
