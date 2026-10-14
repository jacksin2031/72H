// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulationDashboard } from '../components/simulation-dashboard';
import { SimulationProvider, useSimulationSession, type SimulationLaunch } from '../lib/simulation-session';
import { defaultDisasterTest } from '../lib/disaster-test';
import * as mockEnvelope from '../lib/mock-live-envelope';
import { seismicOriginsForMilestones, seismicWaveEndMs } from '../lib/seismic-wavefront';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/simulation' }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: SimulationLaunch = {
  input: { ...defaultDisasterTest, kind: 'EARTHQUAKE', severity: 4 },
  language: 'ja', accessKey: 'mock-test-secret-not-for-prod-reuse-48-characters',
  historicalCase: 'tohoku-2011', title: '東日本大震災',
  milestones: [{
    at_jst: '2011-03-11T14:46:00+09:00', kind: 'EARTHQUAKE',
    label: { ja: '地震', en: 'Earthquake', 'zh-TW': '地震' },
    source_url: 'https://www.jma.go.jp/', historic_observation: true, fed_to_safety_core: true,
  }],
  timeMode: 'ACCELERATED', acceleratedStart: '2011-03-11T13:46',
  acceleration: 600, startJst: '2011-03-11T14:46', endJst: '2011-03-11T14:46',
};

function Bootstrap({ launch=config }: { launch?:SimulationLaunch }) {
  const { startSimulation } = useSimulationSession();
  useEffect(() => startSimulation(launch), [startSimulation,launch]);
  return <SimulationDashboard />;
}

let root: Root | null = null;
let el: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  el?.remove();
  root = null; el = null;
  vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear();
  vi.restoreAllMocks();
});

describe('full-app simulation clock and isolated launch', () => {
  it('continues a finite wave clock after evaluation completes without additional API calls',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-11T11:00:00Z'));
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:404})));
    const launch={...config,timeMode:'FAST_RANGE' as const};
    // Clock unit fixture: API envelope/safety validation has separate tests.
    const snapshot={plans:[],plan_actions:[],evidence:[],situation:{current_plan_id:null}};
    const response={total_steps:1,ai_modes:[],snapshot,historical:{milestones:config.milestones,current_milestone:config.milestones[0]}} as unknown as mockEnvelope.MockLiveResponse;
    const request=vi.spyOn(mockEnvelope,'mockLiveRequest').mockResolvedValue(response);
    el=document.createElement('div');document.body.append(el);root=createRoot(el);
    await act(async()=>root!.render(<SimulationProvider><Bootstrap launch={launch}/></SimulationProvider>));
    expect(el.querySelector('.sim-v2-complete')).not.toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
    await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);});
    expect(el.querySelector('[data-testid=simulation-clock]')?.textContent).toContain('14:46:30');
    expect(el.querySelector('[data-testid=seismic-wave-legend]')?.getAttribute('data-wave-count')).toBe('2');
    const end=seismicWaveEndMs(seismicOriginsForMilestones(launch.historicalCase,launch.milestones))!;
    const duration=end-Date.parse(launch.milestones[0].at_jst);
    await act(async()=>{await vi.advanceTimersByTimeAsync(duration);});
    const stopped=el.querySelector('[data-testid=simulation-clock]')?.textContent;
    await act(async()=>{await vi.advanceTimersByTimeAsync(10_000);});
    expect(el.querySelector('[data-testid=simulation-clock]')?.textContent).toBe(stopped);
    expect(el.querySelector('[data-testid=seismic-wave-legend]')?.getAttribute('data-wave-count')).toBe('0');
    expect(request).toHaveBeenCalledTimes(2);
    await act(async()=>root!.unmount());root=null;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('enters simulated home, counts down without API, then calls Mock Live only at disaster time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T11:00:00Z'));
    const requests = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', requests);
    el = document.createElement('div'); document.body.append(el);
    root = createRoot(el);
    await act(async () => root!.render(<SimulationProvider><Bootstrap /></SimulationProvider>));
    expect(el.querySelector('[data-testid="simulation-dashboard"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="simulation-countdown"]')?.textContent).toContain('01:00:00');
    expect(el.querySelector('a[href^="tel:"]')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(requests.mock.calls.filter(([path]) => String(path).includes('/api/mock-live/'))).toHaveLength(0);
    expect(el.querySelector('[data-testid="simulation-countdown"]')?.textContent).toContain('00:10:00');
    await act(async () => { await vi.advanceTimersByTimeAsync(1010); });
    expect(requests.mock.calls.filter(([path]) => String(path).includes('/api/mock-live/'))).toHaveLength(1);
    expect(requests.mock.calls.some(([path]) => path === '/api/mock-live/start')).toBe(true);
    const request=requests.mock.calls.find(([path])=>path==='/api/mock-live/start')!;
    expect(JSON.parse(request[1]?.body as string)).toMatchObject({use_gemini:true,location_context:null,conditions:{}});
    expect(el.querySelector('[data-testid="simulation-clock"]')?.textContent).toContain('14:46');
    expect(localStorage.getItem('72h-live-session')).toBeNull();
  });
  it('without volatile context never displays a real Live dashboard or launches mock requests', async () => {
    const requests = vi.fn();
    vi.stubGlobal('fetch', requests);
    el = document.createElement('div'); document.body.append(el);
    root = createRoot(el);
    await act(async () => root!.render(<SimulationProvider><SimulationDashboard /></SimulationProvider>));
    expect(el.querySelector('[data-testid="simulation-expired"]')).not.toBeNull();
    expect(el.querySelector('.live-shell')).toBeNull();
    expect(requests.mock.calls.filter(([path]) => String(path).includes('/api/mock-live/'))).toHaveLength(0);
  });
});
