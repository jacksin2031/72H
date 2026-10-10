// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulationReferenceMap } from '../components/simulation-reference-map';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove(); root=null; container=null;
  vi.unstubAllGlobals();
});

describe('isolated simulation reference map', () => {
  it('fails closed on missing verified country coastline without requesting GPS or untrusted data', async () => {
    const fetcher=vi.fn(async (_url: string | URL, _init?: RequestInit) => ({ok:false,status:404}));
    const gps=vi.fn();
    vi.stubGlobal('fetch',fetcher);
    Object.defineProperty(window.navigator, 'geolocation', { configurable:true, value:{getCurrentPosition:gps} });
    container=document.createElement('div');document.body.append(container);
    root=createRoot(container);
    await act(async()=>{root!.render(<SimulationReferenceMap language="zh-TW"/>);});
    await act(async()=>{await Promise.resolve();});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/maps/japan-land-50m.geojson');
    expect(gps).not.toHaveBeenCalled();
    expect(container.textContent).toContain('不會顯示未經核實的地圖');
    expect(container.textContent).toContain('海岸線只代表海陸邊界');
    expect([...container.querySelectorAll('button')].every(x=>x.disabled)).toBe(true);
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.querySelector('a[href*="maps.google"]')).toBeNull();
  });
  it('shows land/sea legend and GSI source attribution but never invented hazards', async () => {
    const fetcher=vi.fn(async (_url: string | URL, _init?: RequestInit) => ({ok:false,status:404}));
    vi.stubGlobal('fetch',fetcher);
    container=document.createElement('div');document.body.append(container);
    root=createRoot(container);
    await act(async()=>{root!.render(<SimulationReferenceMap language="en" compact/>);});
    await act(async()=>{await Promise.resolve();});
    expect(container.textContent).toContain('NOT a tsunami risk map');
    expect(container.textContent).toContain('Coastlines show geography');
    expect(container.querySelectorAll('.sim-map-pin, .map-route-point')).toHaveLength(0);
    expect(container.querySelector('.sim-map-controls')).toBeNull();
    expect(container.querySelector('[data-testid=japan-land-sea-legend]')?.textContent).toContain('Sea');
    expect(container.querySelector('[data-testid=japan-land-sea-legend]')?.textContent).toContain('Land');
    expect(container.querySelector('a[href*="maps.gsi.go.jp"]')).not.toBeNull();
  });
});
