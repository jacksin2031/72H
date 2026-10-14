// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { documentedEpicenters } from '../lib/geospatial-exposure';
import { SimulationReferenceMap } from '../components/simulation-reference-map';
import type {OfficialPlace} from '../lib/official-hazards';

const mapHarness=vi.hoisted(()=>({coordinates:[] as number[][],removed:0,operations:[] as string[]}));
vi.mock('maplibre-gl',()=>({
  setWorkerCount:vi.fn(),setWorkerUrl:vi.fn(),
  Map:class {
    layers=new Set(['gsi-topographic']);sources=new Set(['gsi-standard']);
    scrollZoom={disable:vi.fn()};boxZoom={disable:vi.fn()};dragRotate={disable:vi.fn()};
    dragPan={disable:vi.fn(),enable:vi.fn()};touchZoomRotate={disable:vi.fn(),enable:vi.fn(),disableRotation:vi.fn()};
    once(_name:string,callback:()=>void){callback();} on(){} off(){} resize(){} fitBounds(){mapHarness.operations.push('country');} remove(){}
    getZoom(){return 9;} easeTo(){mapHarness.operations.push('center');}
    getLayer(id:string){return this.layers.has(id);} getSource(id:string){return this.sources.has(id);}
    removeLayer(id:string){this.layers.delete(id);mapHarness.operations.push('remove-layer:'+id);}
    removeSource(id:string){this.sources.delete(id);mapHarness.operations.push('remove-source:'+id);}
    addSource(id:string){this.sources.add(id);mapHarness.operations.push('add-source:'+id);}
    addLayer(layer:{id:string}){this.layers.add(layer.id);mapHarness.operations.push('add-layer:'+layer.id);}
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
  it('renders regional designation points without an inundation pack and removes them when the selection clears',async()=>{
    const bytes=readFileSync(resolve(__dirname,'../public/maps/japan-land-50m.geojson'));
    vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes)));
    const place:OfficialPlace={id:'SHELTER_TEST',name:'Test only',address:null,lat:26.2,lng:127.7,kind:'SHELTER',notes:'',source_id:'shelters',open_status:'UNKNOWN',
      hazards:{flood:'UNKNOWN',landslide:'UNKNOWN',storm_surge:'UNKNOWN',earthquake:'UNKNOWN',tsunami:'UNKNOWN',large_fire:'UNKNOWN',inland_flood:'UNKNOWN',volcano:'UNKNOWN'}};
    mapHarness.operations=[];container=document.createElement('div');document.body.append(container);root=createRoot(container);
    await act(async()=>root!.render(<SimulationReferenceMap language="zh-TW" referencePlaces={[place]} showPlaces/>));
    await act(async()=>{await new Promise(r=>setTimeout(r,50));});
    expect(mapHarness.operations).toContain('add-source:official-places');
    expect(mapHarness.operations).toContain('add-layer:official-places-points');
    expect(mapHarness.operations).not.toContain('add-source:official-inundation');
    await act(async()=>root!.render(<SimulationReferenceMap language="zh-TW" referencePlaces={[]} showPlaces/>));
    expect(mapHarness.operations).toContain('remove-source:official-places');
  });
  it('removes detailed tile requests before centering on device GPS and resets the view before restoring tiles',async()=>{
    const bytes=readFileSync(resolve(__dirname,'../public/maps/japan-land-50m.geojson'));
    vi.stubGlobal('crypto',webcrypto);
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})));
    mapHarness.operations=[];
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
    await act(async()=>root!.render(<SimulationReferenceMap language="zh-TW" protectDeviceLocation/>));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
    mapHarness.operations=[];
    const gps={lat:38.4,lng:141.3,accuracy_m:20,captured_at:Date.now(),source:'BROWSER_GEOLOCATION' as const};
    await act(async()=>root!.render(<SimulationReferenceMap language="zh-TW" protectDeviceLocation userLocation={gps}/>));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
    expect(mapHarness.operations).toEqual(['remove-layer:gsi-topographic','remove-source:gsi-standard','center']);
    expect(container.textContent).toContain('避免詳細圖磚洩漏位置');
    mapHarness.operations=[];
    await act(async()=>root!.render(<SimulationReferenceMap language="zh-TW" protectDeviceLocation/>));
    expect(mapHarness.operations.slice(0,3)).toEqual(['country','add-source:gsi-standard','add-layer:gsi-topographic']);
  });
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

  it('keeps a short warning and attribution visible while detailed map notes remain collapsible', async () => {
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:404})));
    container=document.createElement('div');document.body.append(container);
    root=createRoot(container);
    await act(async()=>{root!.render(<SimulationReferenceMap language="zh-TW"/>);});
    const info=container.querySelector('.sim-map-information');
    const quick=info?.querySelector('.sim-map-quick-caution');
    const details=info?.querySelector<HTMLDetailsElement>('[data-testid=japan-map-details]');
    expect(quick?.textContent).toContain('不可作避難導航');
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain('不代表震動影響範圍');
    expect(info?.querySelector('a[href*="maps.gsi.go.jp"]')).not.toBeNull();
    await act(async()=>{details?.querySelector('summary')?.click();});
    expect(details?.open).toBe(true);
    await act(async()=>{details?.querySelector('summary')?.click();});
    expect(details?.open).toBe(false);
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
