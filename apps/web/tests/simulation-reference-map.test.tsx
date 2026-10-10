// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { documentedEpicenters } from '../lib/geospatial-exposure';
import { SimulationReferenceMap } from '../components/simulation-reference-map';

const mapHarness=vi.hoisted(()=>({coordinates:[] as number[][],removed:0}));
vi.mock('maplibre-gl',()=>({
  setWorkerCount:vi.fn(),setWorkerUrl:vi.fn(),
  Map:class {
    scrollZoom={disable:vi.fn()};boxZoom={disable:vi.fn()};dragRotate={disable:vi.fn()};
    dragPan={disable:vi.fn(),enable:vi.fn()};touchZoomRotate={disable:vi.fn(),enable:vi.fn(),disableRotation:vi.fn()};
    once(_name:string,callback:()=>void){callback();} on(){} off(){} resize(){} fitBounds(){} remove(){}
  },
  Marker:class {
    element:HTMLElement;constructor({element}:{element:HTMLElement}){this.element=element;}
    setLngLat(point:number[]){mapHarness.coordinates.push(point);return this;} addTo(){return this;}
    getElement(){return this.element;} remove(){mapHarness.removed++;}
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove(); root=null; container=null;
  vi.unstubAllGlobals();
});

describe('isolated simulation reference map', () => {
  it('anchors the historical earthquake at the documented coordinates and releases it on unmount',async()=>{
    const bytes=readFileSync(resolve(__dirname,'../public/maps/japan-land-50m.geojson'));
    vi.stubGlobal('crypto',webcrypto);
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})));
    mapHarness.coordinates=[];mapHarness.removed=0;
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
    await act(async()=>{root!.render(<SimulationReferenceMap language="zh-TW" epicenter={documentedEpicenters['tohoku-2011']}/>);});
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
    expect(mapHarness.coordinates).toEqual([[142.86,38.103333]]);
    expect(container.querySelector('[data-testid=japan-map-epicenter]')).not.toBeNull();
    expect(container.textContent).toContain('不代表震動影響範圍');
    await act(async()=>root!.unmount());root=null;
    expect(mapHarness.removed).toBeGreaterThan(0);
  });

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
