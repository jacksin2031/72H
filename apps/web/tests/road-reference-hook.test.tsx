// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useRoadReference,type RoadReference} from '../components/road-reference-section';
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

function Probe({point,hazard,prefecture}:{point:{lat:number;lng:number}|null;hazard:RoadHazard;prefecture:string|null}){
  latest=useRoadReference(point,hazard,prefecture);
  return null;
}
async function render(point:{lat:number;lng:number}|null,hazard:RoadHazard,prefecture:string|null){
  if(!root){host=document.createElement('div');document.body.append(host);root=createRoot(host);}
  // A fresh object every render, as the real callers pass.
  await act(async()=>root!.render(<Probe point={point?{...point}:null} hazard={hazard} prefecture={prefecture}/>));
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
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();root=null;host=null;});

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

it('without a prefecture the reference is an error, and retry reloads',async()=>{
  await render(P1,'tsunami',null);
  await settle();
  expect(latest?.state).toBe('ERROR');
  await render(P1,'tsunami','04');
  await settle();
  expect(latest?.state).toBe('READY');
  const calls=vi.mocked(loadRoadTilesAround).mock.calls.length;
  await act(async()=>latest!.retry());
  await settle();
  expect(vi.mocked(loadRoadTilesAround).mock.calls.length).toBe(calls+1);
});
