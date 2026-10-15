// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {RoadReferenceSection,roadPeekText,roadReferenceRoutes,useRoadReference,type RoadReference} from '../components/road-reference-section';
import {loadRoadTilesAround,type RoadTileState} from '../lib/road-tiles';
import {loadJapanShelterCatalog,loadJapanShelterPrefecture} from '../lib/japan-shelters';
import {roadDestinations,type RoadHazard} from '../lib/road-destinations';

vi.mock('../lib/road-tiles',()=>({loadRoadTilesAround:vi.fn()}));
vi.mock('../lib/japan-shelters',()=>({loadJapanShelterCatalog:vi.fn(),loadJapanShelterPrefecture:vi.fn()}));
vi.mock('../lib/road-destinations',()=>({roadDestinations:vi.fn()}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

const ready:RoadTileState={status:'READY',graph:{marker:'tiles'} as never,missing:[],oldestRetrievedAt:'2026-10-01T00:00:00Z',stale:false,persisted:true};
const P1={lat:38.4196,lng:141.2946};
const P2={lat:38.9,lng:141.57};
let root:Root|null=null,host:HTMLDivElement|null=null;
let latest:RoadReference|null=null;
const signals:AbortSignal[]=[];
let restoreServiceWorker=()=>{};

function installServiceWorker(register:()=>Promise<ServiceWorkerRegistration>){
  let controller:ServiceWorker|null=null;
  const worker=new EventTarget() as unknown as ServiceWorkerContainer;
  const registerSpy=vi.fn(register);
  Object.defineProperties(worker,{controller:{get:()=>controller},register:{value:registerSpy}});
  const previous=Object.getOwnPropertyDescriptor(navigator,'serviceWorker');
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:worker});
  restoreServiceWorker=()=>{
    if(previous)Object.defineProperty(navigator,'serviceWorker',previous);
    else Reflect.deleteProperty(navigator,'serviceWorker');
  };
  return {worker,registerSpy,setController(value:ServiceWorker){controller=value;worker.dispatchEvent(new Event('controllerchange'));}};
}

function Probe({point,hazard,prefecture}:{point:{lat:number;lng:number}|null;hazard:RoadHazard;prefecture:string|null}){
  latest=useRoadReference(point,hazard,prefecture);
  return null;
}
function SectionProbe({point,hazard,prefecture}:{point:{lat:number;lng:number}|null;hazard:RoadHazard;prefecture:string|null}){
  const reference=useRoadReference(point,hazard,prefecture);
  latest=reference;
  return <RoadReferenceSection language="zh-TW" exercise={false} hazard={hazard} reference={reference}/>;
}
async function render(point:{lat:number;lng:number}|null,hazard:RoadHazard,prefecture:string|null){
  if(!root){host=document.createElement('div');document.body.append(host);root=createRoot(host);}
  // A fresh object every render, as the real callers pass.
  await act(async()=>root!.render(<Probe point={point?{...point}:null} hazard={hazard} prefecture={prefecture}/>));
}
async function renderSection(point:{lat:number;lng:number}|null,hazard:RoadHazard,prefecture:string|null){
  if(!root){host=document.createElement('div');document.body.append(host);root=createRoot(host);}
  await act(async()=>root!.render(<SectionProbe point={point?{...point}:null} hazard={hazard} prefecture={prefecture}/>));
}
const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,300));});

beforeEach(()=>{
  latest=null;signals.length=0;
  vi.mocked(loadRoadTilesAround).mockReset().mockImplementation(async(_point,opts)=>{if(opts?.signal)signals.push(opts.signal);return ready;});
  vi.mocked(loadJapanShelterCatalog).mockReset().mockResolvedValue({} as never);
  vi.mocked(loadJapanShelterPrefecture).mockReset().mockImplementation(async(_catalog,code)=>[{id:'place-'+code}] as never);
  vi.mocked(roadDestinations).mockReset().mockImplementation((_graph,_origin,places,hazard)=>({none:false,
    destinations:[{place:{id:`${hazard}:${(places[0] as {id:string}).id}`,name:'x'} as never,straight_m:1,road:null,reason:null}]}));
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();root=null;host=null;restoreServiceWorker();vi.unstubAllEnvs();vi.useRealTimers();});

const destinationId=()=>(latest?.result?.destinations[0]?.place as {id:string}|undefined)?.id;

it('a hazard change after tiles have loaded re-derives destinations without any new tile load (R21)',async()=>{
  await render(P1,'earthquake','04');
  await settle();
  expect(latest?.state).toBe('READY');
  expect(destinationId()).toBe('earthquake:place-04');
  expect(loadRoadTilesAround).toHaveBeenCalledTimes(1);

  await render(P1,'tsunami','04');
  await settle();
  expect(loadRoadTilesAround).toHaveBeenCalledTimes(1);
  expect(signals[0]?.aborted).toBe(false);
  expect(latest?.state).toBe('READY');
  expect(latest?.tiles).toBe(ready);
  expect(destinationId()).toBe('tsunami:place-04');
  expect(vi.mocked(roadDestinations).mock.calls.at(-1)?.[3]).toBe('tsunami');
  expect(vi.mocked(roadDestinations).mock.calls.at(-1)?.[0]).toBe(ready.status==='READY'?ready.graph:null);
});

it('a hazard change while tiles are still loading neither aborts nor restarts the tile load',async()=>{
  let finish:(value:RoadTileState)=>void=()=>{};
  vi.mocked(loadRoadTilesAround).mockImplementation((_point,opts)=>{if(opts?.signal)signals.push(opts.signal);return new Promise(resolve=>{finish=resolve;});});
  await render(P1,'earthquake','04');
  await settle();
  expect(loadRoadTilesAround).toHaveBeenCalledTimes(1);
  await render(P1,'tsunami','04');
  await settle();
  expect(signals[0]?.aborted).toBe(false);
  expect(loadRoadTilesAround).toHaveBeenCalledTimes(1);
  expect(latest?.state).toBe('LOADING');
  await act(async()=>finish(ready));
  expect(latest?.state).toBe('READY');
  expect(destinationId()).toBe('tsunami:place-04');
});

it('a prefecture change reloads designated places only, never tiles',async()=>{
  await render(P1,'tsunami','04');
  await settle();
  expect(destinationId()).toBe('tsunami:place-04');
  await render(P1,'tsunami','03');
  await settle();
  expect(loadRoadTilesAround).toHaveBeenCalledTimes(1);
  expect(signals[0]?.aborted).toBe(false);
  expect(vi.mocked(loadJapanShelterPrefecture).mock.calls.at(-1)?.[1]).toBe('03');
  expect(latest?.state).toBe('READY');
  expect(destinationId()).toBe('tsunami:place-03');
});

it('a point change still debounces, aborts the previous load and refetches (R16)',async()=>{
  vi.useFakeTimers();
  try{
    vi.mocked(loadRoadTilesAround).mockImplementation((_point,opts)=>{if(opts?.signal)signals.push(opts.signal);return new Promise(()=>{});});
    await render(P1,'tsunami','04');
    await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
    expect(loadRoadTilesAround).toHaveBeenCalledTimes(1);
    await render(P2,'tsunami','04');
    expect(signals[0]?.aborted).toBe(true);
    await act(async()=>{await vi.advanceTimersByTimeAsync(249);});
    expect(loadRoadTilesAround).toHaveBeenCalledTimes(1);
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
    expect(loadRoadTilesAround).toHaveBeenCalledTimes(2);
    expect(vi.mocked(loadRoadTilesAround).mock.calls[1][0]).toEqual(P2);
  }finally{vi.useRealTimers();}
});

it('without a prefecture the reference is an error and no tile is requested; a prefecture then starts the load (R22)',async()=>{
  await render(P1,'tsunami',null);
  await settle();
  expect(latest?.state).toBe('ERROR');
  expect(loadRoadTilesAround).not.toHaveBeenCalled();
  await render(P1,'tsunami','04');
  await settle();
  expect(latest?.state).toBe('READY');
  expect(loadRoadTilesAround).toHaveBeenCalledTimes(1);
  await render(P1,'earthquake','03');
  await settle();
  expect(loadRoadTilesAround).toHaveBeenCalledTimes(1);
  expect(loadJapanShelterPrefecture).toHaveBeenCalledTimes(2);
});

it('a partial READY result offers the secondary retry, which reloads tiles for the same point (R22)',async()=>{
  const partial:RoadTileState={...ready,missing:['r1919c5650']} as RoadTileState;
  vi.mocked(loadRoadTilesAround).mockReset().mockResolvedValueOnce(partial).mockResolvedValueOnce(ready);
  await render(P1,'tsunami','04');
  await settle();
  const section=document.createElement('div');document.body.append(section);
  const sectionRoot=createRoot(section);
  const draw=()=>act(async()=>sectionRoot.render(<RoadReferenceSection language="zh-TW" exercise={false} hazard="tsunami" reference={latest!}/>));
  try{
    await draw();
    expect(section.textContent).toContain('部分道路資料未下載');
    const retry=[...section.querySelectorAll('button')].find((button)=>button.textContent==='重試');
    expect(retry).toBeTruthy();
    expect(loadJapanShelterCatalog).toHaveBeenCalledTimes(1);
    await act(async()=>retry!.click());
    await settle();
    expect(loadRoadTilesAround).toHaveBeenCalledTimes(2);
    expect(vi.mocked(loadRoadTilesAround).mock.calls[1][0]).toEqual(P1);
    expect(loadJapanShelterCatalog).toHaveBeenCalledTimes(1);
    await draw();
    expect(section.textContent).not.toContain('部分道路資料未下載');
    expect([...section.querySelectorAll('button')].some((button)=>button.textContent==='重試')).toBe(false);
  }finally{await act(async()=>sectionRoot.unmount());section.remove();}
});

it('retries a failed designated-place pack without reloading the same point tiles',async()=>{
  const partial:RoadTileState={...ready,missing:['r1919c5650']} as RoadTileState;
  vi.mocked(loadRoadTilesAround).mockReset().mockResolvedValue(partial);
  vi.mocked(loadJapanShelterCatalog).mockRejectedValueOnce(new Error('offline cache miss')).mockResolvedValueOnce({} as never);
  await renderSection(P1,'tsunami','04');
  await settle();
  expect(latest?.state).toBe('ERROR');
  expect(host?.textContent).toContain('無法取得此地區道路資料');
  const retry=[...host!.querySelectorAll('button')].find((button)=>button.textContent==='重試');
  expect(retry).toBeTruthy();
  expect(loadRoadTilesAround).toHaveBeenCalledTimes(1);
  await act(async()=>retry!.click());
  await settle();
  expect(loadJapanShelterCatalog).toHaveBeenCalledTimes(2);
  expect(loadRoadTilesAround).toHaveBeenCalledTimes(1);
  expect(latest?.state).toBe('READY');
});

it('keeps OFFLINE_NO_DATA visible when place loading fails and emits no road lines',async()=>{
  vi.mocked(loadRoadTilesAround).mockResolvedValue({status:'UNAVAILABLE',reason:'OFFLINE_NO_DATA'});
  vi.mocked(loadJapanShelterCatalog).mockRejectedValue(new Error('offline cache miss'));
  await render(P1,'tsunami','04');
  await settle();
  expect(latest?.tiles).toEqual({status:'UNAVAILABLE',reason:'OFFLINE_NO_DATA'});
  expect(roadPeekText('zh-TW','tsunami',latest!)).toBe('此地區沒有道路參考資料（離線）');
  expect(roadReferenceRoutes(latest!,true)).toEqual([]);
});

it('shows OFFLINE_NO_DATA without a misleading retry when the place pack also fails offline',async()=>{
  vi.mocked(loadRoadTilesAround).mockResolvedValue({status:'UNAVAILABLE',reason:'OFFLINE_NO_DATA'});
  vi.mocked(loadJapanShelterCatalog).mockRejectedValue(new Error('offline cache miss'));
  await renderSection(P1,'tsunami','04');
  await settle();
  expect(host?.textContent).toContain('此地區沒有道路參考資料（離線）');
  expect(host?.textContent).not.toContain('無法取得此地區道路資料');
  expect([...host!.querySelectorAll('button')].some((button)=>button.textContent==='重試')).toBe(false);
});

it('waits for a newly registered service worker to control a direct drill before loading public packs',async()=>{
  vi.stubEnv('NODE_ENV','production');
  const registration=installServiceWorker(async()=>({} as ServiceWorkerRegistration));
  await render(P1,'tsunami','04');
  await settle();
  expect(registration.registerSpy).toHaveBeenCalledWith('/sw.js');
  expect(loadJapanShelterCatalog).not.toHaveBeenCalled();
  registration.setController({} as ServiceWorker);
  await settle();
  expect(loadJapanShelterCatalog).toHaveBeenCalledTimes(1);
});

it('continues online pack loading if service worker registration fails',async()=>{
  vi.stubEnv('NODE_ENV','production');
  const registration=installServiceWorker(async()=>{throw new Error('service worker unavailable');});
  await render(P1,'tsunami','04');
  await settle();
  expect(registration.registerSpy).toHaveBeenCalledWith('/sw.js');
  expect(loadJapanShelterCatalog).toHaveBeenCalledTimes(1);
});

it('falls back to online pack loading when a fresh service worker never claims the page',async()=>{
  vi.useFakeTimers();
  vi.stubEnv('NODE_ENV','production');
  const registration=installServiceWorker(async()=>({} as ServiceWorkerRegistration));
  await render(P1,'tsunami','04');
  await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  expect(registration.registerSpy).toHaveBeenCalledWith('/sw.js');
  expect(loadJapanShelterCatalog).not.toHaveBeenCalled();
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
  expect(loadJapanShelterCatalog).toHaveBeenCalledTimes(1);
});
