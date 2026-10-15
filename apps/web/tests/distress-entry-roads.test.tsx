// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {DistressStatus} from '../lib/contracts';
import {loadRoadTilesAround,type RoadTileState} from '../lib/road-tiles';
import {loadEvacuationRoadGraph,ishinomakiReferenceGraph} from '../lib/evacuation-road-graph';
import {fixFromDevicePosition} from '../lib/distress-guidance';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const panel=vi.hoisted(()=>[] as Record<string,unknown>[]);
vi.mock('../components/distress-panel',()=>({DistressPanel:(p:Record<string,unknown>)=>{panel.push(p);return null;}}));
vi.mock('../lib/designated-places',async orig=>({...await orig<typeof import('../lib/designated-places')>(),loadDesignatedPlaces:vi.fn(async()=>({})),selectDesignationPlaces:()=>({places:[],reason:'X'})}));
vi.mock('../lib/emergency-contacts',async orig=>({...await orig<typeof import('../lib/emergency-contacts')>(),loadSosProfile:vi.fn(async()=>({contacts:[],needsAssistance:false,mobilityLimited:false}))}));
vi.mock('../lib/road-tiles',async orig=>({...await orig<typeof import('../lib/road-tiles')>(),loadRoadTilesAround:vi.fn()}));
vi.mock('../lib/evacuation-road-graph',async orig=>({...await orig<typeof import('../lib/evacuation-road-graph')>(),loadEvacuationRoadGraph:vi.fn(),ishinomakiReferenceGraph:vi.fn()}));
const {DistressEntry}=await import('../components/distress-entry');
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

const tileGraph={marker:'tiles'} as never,ishinomakiGraph={marker:'ishinomaki'} as never;
const status=(level:DistressStatus['level']):DistressStatus=>({level,reports:[],trigger_evidence_ids:[],deadline_at:level==='OFFICIAL_TSUNAMI'?new Date(Date.now()+30*60_000).toISOString():null,ai_escalated:false,synthetic:false,warning_class:null,last_official_at:null,trigger_expires_at:null,stale_reason:null});
const ISHINOMAKI={lat:38.43,lng:141.3},KESENNUMA={lat:38.9,lng:141.57};
let root:Root|null=null,host:HTMLDivElement|null=null;

beforeEach(()=>{
  panel.length=0;
  vi.mocked(loadRoadTilesAround).mockReset().mockResolvedValue({status:'READY',graph:tileGraph,missing:[],oldestRetrievedAt:'2026-10-01T00:00:00Z',stale:false,persisted:true});
  vi.mocked(loadEvacuationRoadGraph).mockReset().mockResolvedValue({} as never);
  vi.mocked(ishinomakiReferenceGraph).mockReset().mockReturnValue(ishinomakiGraph);
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();root=null;host=null;});

async function render(point:{lat:number;lng:number},protect?:boolean,level:DistressStatus['level']='OFFICIAL_TSUNAMI'){
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  const fix={...point,accuracy_m:10,captured_at:Date.now()};
  await act(async()=>root!.render(<DistressEntry snapshot={{distress:status(level),replay:{id:'r1'}}} language="ja" scope="live"
    fix={fix} onSnapshot={vi.fn()} {...(protect===undefined?{}:{protectDeviceLocation:protect})}/>));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
  return panel.at(-1)!;
}

it.each([[undefined],[true]] as const)('protectDeviceLocation=%s (default true): real fix kept, embedded Ishinomaki graph used, no tile request',async protect=>{
  const props=await render(ISHINOMAKI,protect);
  expect(props.location).toMatchObject({lat:38.43,lng:141.3,accuracy_m:10});
  expect(props.graph).toBe(ishinomakiGraph);
  expect(loadEvacuationRoadGraph).toHaveBeenCalledTimes(1);
  expect(loadRoadTilesAround).not.toHaveBeenCalled();
});

it('protected fix outside the Ishinomaki bounds still gets the embedded graph (bounds are checked by reachability) and no tile request',async()=>{
  const props=await render(KESENNUMA,true);
  expect(props.graph).toBe(ishinomakiGraph);
  expect(loadRoadTilesAround).not.toHaveBeenCalled();
});

it('protected fix outside a tsunami level loads no road data',async()=>{
  const props=await render(ISHINOMAKI,true,'NONE');
  expect(props.graph).toBeNull();
  expect(loadEvacuationRoadGraph).not.toHaveBeenCalled();
  expect(loadRoadTilesAround).not.toHaveBeenCalled();
});

it('protected fix with an embedded pack that fails verification gets graph null, still without tiles',async()=>{
  vi.mocked(ishinomakiReferenceGraph).mockImplementation(()=>{throw new Error('pin mismatch');});
  const props=await render(ISHINOMAKI,true);
  expect(props.graph).toBeNull();
  expect(loadRoadTilesAround).not.toHaveBeenCalled();
});

it('Now/live path: a device GPS fix with the live call-site props uses the embedded graph and never requests road tiles',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  const fix=fixFromDevicePosition({latitude:38.43,longitude:141.3,accuracy_m:15,captured_at:Date.now()});
  // Exactly the props live-dashboard.tsx passes (no protectDeviceLocation, so the protected default applies).
  await act(async()=>root!.render(<DistressEntry snapshot={{distress:status('OFFICIAL_TSUNAMI'),replay:{id:'r1'}}} language="ja" scope="live" fix={fix} onSnapshot={vi.fn()}
    refreshLocation={undefined}/>));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
  const props=panel.at(-1)!;
  expect(props.location).toMatchObject({lat:38.43,lng:141.3,accuracy_m:15});
  expect(props.graph).toBe(ishinomakiGraph);
  expect(loadRoadTilesAround).not.toHaveBeenCalled();
});

it('no DistressEntry call site opts out of location protection',()=>{
  for(const file of ['components/live-dashboard.tsx','components/dashboard.tsx','components/simulation-screens.tsx','app/map/page.tsx']){
    const src=readFileSync(resolve(__dirname,'..',file),'utf8');
    expect(src,file).toContain('<DistressEntry');
    expect(src,file).not.toMatch(/protectDeviceLocation=\{false\}/);
  }
});

it('an explicitly unprotected fix during a tsunami level uses the tiles around it',async()=>{
  const props=await render(KESENNUMA,false);
  expect(vi.mocked(loadRoadTilesAround).mock.calls[0][0]).toEqual(KESENNUMA);
  expect(props.graph).toBe(tileGraph);
  expect(props.location).toMatchObject(KESENNUMA);
  expect(loadEvacuationRoadGraph).not.toHaveBeenCalled();
});

it('an unprotected fix outside a tsunami level loads no road data',async()=>{
  const props=await render(KESENNUMA,false,'NONE');
  expect(props.graph).toBeNull();
  expect(loadRoadTilesAround).not.toHaveBeenCalled();
});

it.each(['TEMPORARILY_UNAVAILABLE','OFFLINE_NO_DATA'] as const)('%s inside the Ishinomaki bounds falls back to the verified embedded pack',async reason=>{
  vi.mocked(loadRoadTilesAround).mockResolvedValue({status:'UNAVAILABLE',reason});
  const props=await render(ISHINOMAKI,false);
  expect(loadEvacuationRoadGraph).toHaveBeenCalledTimes(1);
  expect(props.graph).toBe(ishinomakiGraph);
});

it('a temporary outage outside the Ishinomaki bounds gets no embedded fallback',async()=>{
  vi.mocked(loadRoadTilesAround).mockResolvedValue({status:'UNAVAILABLE',reason:'TEMPORARILY_UNAVAILABLE'});
  const props=await render(KESENNUMA,false);
  expect(loadEvacuationRoadGraph).not.toHaveBeenCalled();
  expect(props.graph).toBeNull();
});

it.each(['TOO_DENSE','INVALID_DATA','NO_ROADS'] as const)('%s inside the bounds is never replaced by the embedded pack',async reason=>{
  vi.mocked(loadRoadTilesAround).mockResolvedValue({status:'UNAVAILABLE',reason} as RoadTileState);
  const props=await render(ISHINOMAKI,false);
  expect(loadEvacuationRoadGraph).not.toHaveBeenCalled();
  expect(props.graph).toBeNull();
});

it('an embedded pack that fails verification leaves no graph',async()=>{
  vi.mocked(loadRoadTilesAround).mockResolvedValue({status:'UNAVAILABLE',reason:'OFFLINE_NO_DATA'});
  vi.mocked(ishinomakiReferenceGraph).mockImplementation(()=>{throw new Error('pin mismatch');});
  const props=await render(ISHINOMAKI,false);
  expect(props.graph).toBeNull();
});
