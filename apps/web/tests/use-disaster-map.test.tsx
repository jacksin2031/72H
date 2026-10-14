// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useDisasterMap} from '../lib/use-disaster-map';
import {mapFixture,now} from './fixtures/disaster-map';
vi.mock('../lib/disaster-map',async importOriginal=>({...await importOriginal<typeof import('../lib/disaster-map')>(),loadForecastLinePack:vi.fn(async()=>null)}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|null=null,host:HTMLDivElement|null=null,state:ReturnType<typeof useDisasterMap>|null=null,online=true;
function Harness(){state=useDisasterMap();return <div>{state.connected?'connected':'unverified'}</div>;}
beforeEach(()=>{online=true;vi.useFakeTimers();vi.setSystemTime(now);localStorage.clear();vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();root=null;host=null;state=null;vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();localStorage.clear();});
async function mount(){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<Harness/>));}
it('keeps old reference and age on network loss without uploading GPS or renewing TTL',async()=>{
 const fetcher=vi.fn(async(_path:string)=>new Response(JSON.stringify(mapFixture())));vi.stubGlobal('fetch',fetcher);await mount();
 expect(state!.connected).toBe(true);expect(fetcher.mock.calls[0][0]).toBe('/api/reference/disaster-map');
 const original=state!.data;online=false;await act(async()=>window.dispatchEvent(new Event('offline')));
 expect(state!.connected).toBe(false);expect(state!.data).toEqual(original);
 await act(async()=>vi.advanceTimersByTime(900000));
 expect(state!.now).toBe(now+900000);expect(state!.data!.reports[0].bulletin.evidence_expires_at).toBe(original!.reports[0].bulletin.evidence_expires_at);
 expect(fetcher).toHaveBeenCalledOnce();expect(localStorage.getItem('72h-public-disaster-map-v1')).toContain('LIVE_REFERENCE');
});
it('restores validated public cache as unverified and rejects a late response after disconnect/reconnect',async()=>{
 const cached=mapFixture();localStorage.setItem('72h-public-disaster-map-v1',JSON.stringify(cached));online=false;
 let resolveOld:(value:Response)=>void=()=>{};
 const pending=new Promise<Response>(resolve=>{resolveOld=resolve;});
 const newer=mapFixture();newer.generated_at=new Date(now+1000).toISOString();
 const fetcher=vi.fn().mockImplementationOnce(()=>pending).mockResolvedValue(new Response(JSON.stringify(newer)));vi.stubGlobal('fetch',fetcher);
 await mount();expect(state!.data).toEqual(cached);expect(state!.connected).toBe(false);expect(fetcher).not.toHaveBeenCalled();
 online=true;await act(async()=>window.dispatchEvent(new Event('online')));expect(state!.connected).toBe(false);
 online=false;await act(async()=>window.dispatchEvent(new Event('offline')));
 online=true;await act(async()=>window.dispatchEvent(new Event('online')));expect(state!.connected).toBe(true);
 await act(async()=>resolveOld(new Response(JSON.stringify(cached))));
 expect(state!.data!.generated_at).toBe(newer.generated_at);expect(state!.connected).toBe(true);
});
it('preserves uncertainty after corrupt cache, backend failure and older returned snapshot',async()=>{
 localStorage.setItem('72h-public-disaster-map-v1','{"safe_location_verified":true}');
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('bad',{status:503})));await mount();expect(state!.data).toBeNull();expect(state!.connected).toBe(false);
});
it('does not let a future or newer restored cache block a valid live refresh',async()=>{
 const cached=mapFixture();cached.generated_at='2099-01-01T00:00:00Z';localStorage.setItem('72h-public-disaster-map-v1',JSON.stringify(cached));
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(mapFixture()))));await mount();
 expect(state!.connected).toBe(true);expect(state!.data!.generated_at).toBe(mapFixture().generated_at);
});
it('rejects a future API response without publishing or caching it as current',async()=>{
 const future=mapFixture();future.generated_at='2099-01-01T00:00:00Z';
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(future))));await mount();
 expect(state!.data).toBeNull();expect(state!.connected).toBe(false);expect(localStorage.getItem('72h-public-disaster-map-v1')).toBeNull();
});
it('does not mark a reconnect current from an API response reusing a pre-interruption source fetch',async()=>{
 const cached=mapFixture();cached.sources.forEach(s=>{s.recovery!.last_successful_fetch_at=new Date(now).toISOString();});
 let response=cached;vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(response))));await mount();expect(state!.connected).toBe(true);
 online=false;await act(async()=>window.dispatchEvent(new Event('offline')));await act(async()=>vi.advanceTimersByTime(10000));
 online=true;await act(async()=>window.dispatchEvent(new Event('online')));expect(state!.connected).toBe(false);
 response=mapFixture();response.generated_at=new Date(now+10000).toISOString();response.sources.forEach(s=>{s.recovery!.last_successful_fetch_at=new Date(now+10000).toISOString();});
 await act(async()=>vi.advanceTimersByTime(60000));expect(state!.connected).toBe(true);
});
