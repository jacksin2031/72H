// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { documentedEpicenters } from '../lib/geospatial-exposure';
import { SimulationReferenceMap } from '../components/simulation-reference-map';
import { tohokuWaveOrigins, type WavefrontData } from '../lib/seismic-wavefront';
import {REFERENCE_VECTOR_LAYERS} from '../lib/reference-map-style';
import {mapFixture,linePack,now} from './fixtures/disaster-map';
import type {IntensityRegionPack} from '../lib/intensity-regions';

const mapHarness=vi.hoisted(()=>({coordinates:[] as number[][],removed:0,operations:[] as string[],waveFrames:[] as WavefrontData[],referenceFrames:[] as Array<{id:string;data:unknown}>}));
vi.mock('maplibre-gl',()=>({
  setWorkerCount:vi.fn(),setWorkerUrl:vi.fn(),
  Map:class {
    layers:Set<string>;sources:Set<string>;
    constructor(options:{style:{layers:{id:string}[];sources:Record<string,unknown>}}){
      this.layers=new Set(options.style.layers.map(l=>l.id));this.sources=new Set(Object.keys(options.style.sources));
    }
    waveSource:{setData:(data:WavefrontData)=>void}|null=null;
    scrollZoom={disable:vi.fn()};boxZoom={disable:vi.fn()};dragRotate={disable:vi.fn()};
    dragPan={disable:vi.fn(),enable:vi.fn()};touchZoomRotate={disable:vi.fn(),enable:vi.fn(),disableRotation:vi.fn()};
    once(_name:string,callback:()=>void){callback();} on(){} off(){} resize(){} fitBounds(){mapHarness.operations.push('country');} remove(){}
    getZoom(){return 9;} easeTo(){mapHarness.operations.push('center');}
    getLayer(id:string){return this.layers.has(id);} getSource(id:string){return id==='seismic-wavefronts'?this.waveSource:this.sources.has(id);}
    removeLayer(id:string){this.layers.delete(id);mapHarness.operations.push('remove-layer:'+id);}
    removeSource(id:string){this.sources.delete(id);mapHarness.operations.push('remove-source:'+id);}
    addSource(id:string,options?:{data:WavefrontData}){this.sources.add(id);mapHarness.operations.push('add-source:'+id);
      if(id.startsWith('official-'))mapHarness.referenceFrames.push({id,data:options?.data});
      if(id==='seismic-wavefronts'){mapHarness.waveFrames.push(options!.data);this.waveSource={setData:data=>mapHarness.waveFrames.push(data)};}}
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
  it('keeps regional maxima as scope labels and changes warning styling once on expiry/offline, not every age tick',async()=>{
    const bytes=readFileSync(resolve(__dirname,'../public/maps/japan-land-50m.geojson'));
    vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})));
    const data=mapFixture(),eq=structuredClone(data.reports[0]);eq.bulletin.product='VXSE53';eq.bulletin.group_id='c'.repeat(24);eq.bulletin.report_id=`${'c'.repeat(24)}--${'b'.repeat(24)}`;eq.forecast_areas=[];
    eq.observations=[{granularity:'REGION',measurement:'MAXIMUM',code:'100',name:'石狩地方北部',intensity:'5+',prefecture_code:'01'}];data.reports.push(eq);
    const regions:IntensityRegionPack={manifest:{...linePack.manifest,codes:{'100':'石狩地方北部','101':'石狩地方中部'}},features:[{type:'Feature',properties:{code:'100',name:'石狩地方北部',anchor:[141,43]},
      geometry:{type:'Polygon',coordinates:[[[141,43],[142,43],[142,44],[141,43]]]}},
      {type:'Feature',properties:{code:'101',name:'石狩地方中部',anchor:[141,42]},geometry:{type:'Polygon',coordinates:[[[141,42],[142,42],[142,43],[141,42]]]}}]};
    mapHarness.referenceFrames=[];mapHarness.operations=[];
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
    const render=(time:number,connected=true)=><SimulationReferenceMap language="zh-TW" disasterReference={data} forecastLinePack={linePack} intensityRegionPack={regions}
      referenceConnected={connected} referenceNow={time} showForecastLines showIntensityRegions/>;
    await act(async()=>root!.render(render(now)));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
    const current=mapHarness.referenceFrames.find(f=>f.id==='official-intensity-scope-labels')!.data as {features:Array<{geometry:{type:string};properties:{scope:string;label:string}}>};
    expect(current.features[0].geometry.type).toBe('Point');expect(current.features[0].properties.scope).toBe('REGION_MAXIMUM_NOT_POINT_MEASUREMENT');
    expect(current.features[0].properties.label).toContain('地域最大 5+');
    expect(current.features[1].properties.label).toContain('未判定');expect(current.features[1].properties.scope).toBe('REGION_UNDETERMINED_NOT_POINT_MEASUREMENT');
    await act(async()=>root!.render(render(now+1000)));
    expect(mapHarness.operations.filter(o=>o==='add-source:official-forecast-lines')).toHaveLength(1);
    expect(mapHarness.operations.filter(o=>o==='add-source:official-intensity-regions')).toHaveLength(1);
    await act(async()=>root!.render(render(now+2000,false)));
    const old=mapHarness.referenceFrames.filter(f=>f.id==='official-forecast-lines').at(-1)!.data as {features:Array<{properties:{state:string}}>};
    expect(old.features[0].properties.state).toBe('STALE');
    const archived=mapHarness.referenceFrames.filter(f=>f.id==='official-intensity-scope-labels').at(-1)!.data as typeof current;
    expect(archived.features[0].properties.label).toContain('過去');
    expect(container.querySelector('[data-testid=japan-land-sea-legend]')?.textContent).toContain('非逐點實測');
  });
  it('updates one geospatial source from event time and retains elapsed distance after remount',async()=>{
    const bytes=readFileSync(resolve(__dirname,'../public/maps/japan-land-50m.geojson'));
    vi.stubGlobal('crypto',webcrypto);
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})));
    const seismicOrigins=[tohokuWaveOrigins[0]], at=Date.parse(seismicOrigins[0].observed_at_jst);
    mapHarness.waveFrames=[];mapHarness.operations=[];
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
    await act(async()=>root!.render(<SimulationReferenceMap language="zh-TW" seismicOrigins={seismicOrigins} seismicTime={at-1}/>));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
    expect(mapHarness.waveFrames.at(-1)?.features).toHaveLength(0);
    await act(async()=>root!.render(<SimulationReferenceMap language="zh-TW" seismicOrigins={seismicOrigins} seismicTime={at+30_000}/>));
    const initial=mapHarness.waveFrames.at(-1)!.features[0].properties.radius_km;
    await act(async()=>root!.render(<SimulationReferenceMap language="zh-TW" seismicOrigins={seismicOrigins} seismicTime={at+90_000}/>));
    const later=mapHarness.waveFrames.at(-1)!;
    expect(later.features[0].properties.radius_km).toBeGreaterThan(initial);
    expect(mapHarness.operations.filter(x=>x==='add-source:seismic-wavefronts')).toHaveLength(1);
    expect(container.querySelector('[data-testid=seismic-wave-legend]')?.textContent).toContain('波前估算');
    await act(async()=>root!.unmount());root=createRoot(container);
    await act(async()=>root!.render(<SimulationReferenceMap language="zh-TW" seismicOrigins={seismicOrigins} seismicTime={at+90_000}/>));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
    expect(mapHarness.waveFrames.at(-1)).toEqual(later);
  });
  it('protects GPS by default in every map, removing all online detail before centering and resetting before restoring',async()=>{
    const bytes=readFileSync(resolve(__dirname,'../public/maps/japan-land-50m.geojson'));
    vi.stubGlobal('crypto',webcrypto);
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})));
    mapHarness.operations=[];
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
    await act(async()=>root!.render(<SimulationReferenceMap language="zh-TW"/>));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
    mapHarness.operations=[];
    const gps={lat:38.4,lng:141.3,accuracy_m:20,captured_at:Date.now(),source:'BROWSER_GEOLOCATION' as const};
    await act(async()=>root!.render(<SimulationReferenceMap language="zh-TW" userLocation={gps}/>));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
    expect(mapHarness.operations).toEqual([...REFERENCE_VECTOR_LAYERS.map(l=>'remove-layer:'+l.id),'remove-source:gsi-reference','center']);
    expect(container.textContent).toContain('避免詳細圖磚洩漏位置');
    mapHarness.operations=[];
    await act(async()=>root!.render(<SimulationReferenceMap language="zh-TW"/>));
    expect(mapHarness.operations).toEqual(['country','add-source:gsi-reference',...REFERENCE_VECTOR_LAYERS.map(l=>'add-layer:'+l.id)]);
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
    expect(container.textContent).toContain('不代表實測波形');
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
    expect(details?.textContent).toContain('不代表實測波形');
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
