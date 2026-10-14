// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {webcrypto} from 'node:crypto';
import {EvacuationRoutePanel} from '../components/evacuation-route-panel';
import {useDesignatedPlaces} from '../lib/use-designated-places';
import type {HazardLocation} from '../lib/official-hazards';
import type {RoadCandidate} from '../lib/evacuation-road-graph';
let root:ReturnType<typeof createRoot>|null=null,host:HTMLDivElement|null=null;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();root=null;host=null;vi.unstubAllGlobals();vi.restoreAllMocks();});
it('calculates actual pinned roads to a tsunami-designated site locally and preserves all missing safety checks',async()=>{
 vi.stubGlobal('crypto',webcrypto);vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-13T16:20:00+09:00'));
 const fetcher=vi.fn(async(path:string)=>path.startsWith('/roads/')||path.startsWith('/hazards/')?new Response(new Uint8Array(readFileSync(resolve('public'+path)))):
  new Response(JSON.stringify({mode:'LIVE_REFERENCE',area_id:'JP-MUNI-04202',generated_at:new Date(Date.now()).toISOString(),fetched_at:null,source_status:'UNCONFIGURED',records:[],authority:'REFERENCE_ONLY',safe_location_verified:false,route_authorized:false})));
 vi.stubGlobal('fetch',fetcher);
 function Fixture(){const state=useDesignatedPlaces(),[origin,setOrigin]=useState<HazardLocation|null>(null),[route,setRoute]=useState<RoadCandidate|null>(null);
  return <><EvacuationRoutePanel language="zh-TW" state={state} origin={origin} onOrigin={p=>setOrigin({...p,source:'MAP_POINT',captured_at:Date.now(),accuracy_m:0})} onFocus={()=>{}} onRoute={setRoute}/><output>{route?.coordinates.length??0}</output></>;}
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<Fixture/>));
 await vi.waitFor(()=>expect(host!.textContent).not.toContain('正在核對道路資料'));
 await vi.waitFor(()=>expect(host!.querySelectorAll('option').length).toBeGreaterThan(8));
 const hazard=host.querySelector<HTMLSelectElement>('select[aria-label="避難路線災害類別"]')!;
 await act(async()=>{hazard.value='tsunami';hazard.dispatchEvent(new Event('change',{bubbles:true}));});
 const destination=host.querySelector<HTMLSelectElement>('select[aria-label="該災害指定緊急避難場所"]')!;
 await vi.waitFor(()=>expect([...destination.options].some(o=>o.value==='emergency_site:E0420200008201')).toBe(true));
 await act(async()=>{destination.value='emergency_site:E0420200008201';destination.dispatchEvent(new Event('change',{bubbles:true}));});
 const button=(text:string)=>[...host!.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!;
 await act(async()=>button('使用試點示例起點（非 GPS）').click());
 await act(async()=>button('計算本機道路候選').click());
 expect(host.querySelectorAll('article').length).toBeGreaterThan(0);expect(host.textContent).toContain('最安全路線：未判定');
 expect(host.textContent).toContain('災後道路通行');expect(host.textContent).toContain('最後接駁未核實');
 await act(async()=>button('查看此道路候選').click());expect(Number(host.querySelector('output')!.textContent)).toBeGreaterThan(2);
 await act(async()=>{hazard.value='earthquake';hazard.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(host.querySelector('output')!.textContent).toBe('0');
 expect(fetcher.mock.calls.every(([url])=>!url.includes('38.433')&&!url.includes('141.303')&&!url.includes('?'))).toBe(true);
});
