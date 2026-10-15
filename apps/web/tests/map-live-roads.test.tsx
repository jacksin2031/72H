// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {loadRoadTilesAround,type RoadTileState} from '../lib/road-tiles';
import {loadJapanShelterCatalog,loadJapanShelterPrefecture} from '../lib/japan-shelters';
import {roadDestinations} from '../lib/road-destinations';
import {resolveDeviceArea} from '../lib/area-resolution';
import {loadEvacuationRoadGraph,ishinomakiReferenceGraph} from '../lib/evacuation-road-graph';

const NOW=Date.parse('2026-10-15T12:00:00+09:00');
const harness=vi.hoisted(()=>({map:[] as Record<string,unknown>[],entry:[] as Record<string,unknown>[],
  gps:null as null|{lat:number;lng:number;accuracy_m:number;captured_at:number;source:string}}));
vi.mock('next/link',()=>({default:({children,...p}:React.ComponentProps<'a'>)=><a {...p}>{children}</a>}));
vi.mock('@/components/simulation-reference-map',()=>({SimulationReferenceMap:(p:Record<string,unknown>)=>{harness.map.push(p);return null;}}));
vi.mock('@/components/official-hazard-panel',async orig=>({...await orig<typeof import('../components/official-hazard-panel')>(),OfficialHazardPanel:()=>null}));
vi.mock('@/components/japan-shelter-panel',()=>({JapanShelterPanel:()=>null}));
vi.mock('@/components/disaster-map-panel',()=>({DisasterMapPanel:()=>null}));
vi.mock('@/components/designated-places-panel',()=>({DesignatedPlacesPanel:()=>null}));
vi.mock('@/components/distress-entry',()=>({DistressEntry:(p:Record<string,unknown>)=>{harness.entry.push(p);return <p data-testid="help-content">help</p>;}}));
vi.mock('@/lib/use-simulation-geo',()=>({useSimulationGeo:()=>({location:harness.gps,state:harness.gps?'ready':'idle',clear:()=>{harness.gps=null;},request:()=>{}})}));
vi.mock('@/lib/use-disaster-map',()=>({useDisasterMap:()=>({})}));
vi.mock('@/lib/use-designated-places',async()=>{
  const {useState}=await import('react');
  return {useDesignatedPlaces:()=>{const [hazard,setHazard]=useState('ALL');
    return {places:[],pack:null,hazard,setHazard,opening:null,connected:true,now:Date.parse('2026-10-15T12:00:00+09:00'),resumeAt:null};}};
});
vi.mock('@/lib/official-hazards',async orig=>({...await orig<typeof import('../lib/official-hazards')>(),loadOfficialHazardPack:()=>new Promise(()=>{})}));
vi.mock('@/lib/continuity',()=>({loadLiveSnapshot:async()=>null,saveLiveSnapshot:async()=>{}}));
vi.mock('@/lib/road-tiles',()=>({loadRoadTilesAround:vi.fn(),tileIdFor:(lat:number,lng:number)=>`r${Math.floor(lat/0.02)}c${Math.floor(lng/0.025)}`}));
vi.mock('@/lib/japan-shelters',()=>({loadJapanShelterCatalog:vi.fn(),loadJapanShelterPrefecture:vi.fn()}));
vi.mock('@/lib/road-destinations',()=>({roadDestinations:vi.fn()}));
vi.mock('@/lib/area-resolution',()=>({resolveDeviceArea:vi.fn()}));
vi.mock('@/lib/evacuation-road-graph',async orig=>({...await orig<typeof import('../lib/evacuation-road-graph')>(),
  loadEvacuationRoadGraph:vi.fn(),ishinomakiReferenceGraph:vi.fn()}));
const {default:JapanMapPage}=await import('../app/map/page');
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

const tileGraph={bounds:{south:38.88,west:141.55,north:38.94,east:141.6}} as never;
const ishinomakiGraph={bounds:{south:38.42,west:141.28,north:38.45,east:141.32},marker:'ishinomaki'} as never;
const ready:RoadTileState={status:'READY',graph:tileGraph,missing:[],oldestRetrievedAt:'2026-10-01T00:00:00Z',stale:false,persisted:true};
const road=(i:number)=>({id:'r'+i,distance_m:900+i,coordinates:[[141.3,38.43],[141.31,38.44]] as [number,number][],origin_gap_m:1,destination_gap_m:1,road_names:[],
  role:'ROAD_REFERENCE_ONLY' as const,movement_authorized:false as const});
const place=(i:number)=>({id:'site'+i,name:'場所'+i,lat:38.43,lng:141.3,kind:'EMERGENCY_SITE',hazards:{tsunami:'DESIGNATED',earthquake:'DESIGNATED'}});
const disclaimer='道路參考線不是避難路線，最安全路線未判定。';
const count=(text:string,needle:string)=>text.split(needle).length-1;
let root:Root|null=null,host:HTMLDivElement|null=null;

beforeEach(()=>{
  harness.map.length=0;harness.entry.length=0;harness.gps=null;
  vi.spyOn(Date,'now').mockReturnValue(NOW);
  localStorage.setItem('72h-language','zh-TW');
  vi.mocked(loadRoadTilesAround).mockReset().mockResolvedValue(ready);
  vi.mocked(loadJapanShelterCatalog).mockReset().mockResolvedValue({} as never);
  vi.mocked(loadJapanShelterPrefecture).mockReset().mockResolvedValue([0,1,2,3,4].map(place) as never);
  vi.mocked(resolveDeviceArea).mockReset().mockResolvedValue({status:'RESOLVED',area_ids:['JP-MUNI-04205','JP-04','JP'],label:'気仙沼市'});
  vi.mocked(roadDestinations).mockReset().mockImplementation((graph,_origin,places)=>({none:places.length===0,
    destinations:places.slice(0,5).map((p,i)=>({place:p,straight_m:1000+i,road:graph&&i<3?road(i):null,reason:null}))}));
  vi.mocked(loadEvacuationRoadGraph).mockReset().mockResolvedValue({manifest:{reviewed_at:'2026-10-13T16:13:38+09:00',review_due_at:'2027-01-11T16:13:38+09:00',
    pack_id:'ishinomaki-central-v1',asset_sha256:'0'.repeat(64),pilot_starting_point:{lat:38.433,lng:141.303},source:{osm_base_timestamp:'2026-10-13T00:00:00Z'}}} as never);
  vi.mocked(ishinomakiReferenceGraph).mockReset().mockReturnValue(ishinomakiGraph);
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();root=null;host=null;localStorage.clear();vi.restoreAllMocks();});

async function render(){
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<JapanMapPage/>));
  await act(async()=>{await Promise.resolve();});
}
const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,300));});
const lastMap=()=>harness.map.at(-1)!;
async function choosePoint(lat:number,lng:number){
  await act(async()=>(lastMap().onReferencePoint as (p:{lat:number;lng:number})=>void)({lat,lng}));
}
async function chooseHazard(value:string){
  const select=host!.querySelector<HTMLSelectElement>('select[aria-label="避難路線災害類別"]')!;
  await act(async()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});
}
const routes=()=>lastMap().referenceRoutes as unknown[]|undefined;
const roadSection=()=>host!.querySelector('[data-testid=road-reference]')!.textContent??'';

it('loads road tiles around a chosen Kesennuma point with the prefecture resolved from that point, and shows the disclaimer once',async()=>{
  await render();
  await choosePoint(38.9,141.57);
  await chooseHazard('tsunami');
  await settle();
  expect(loadRoadTilesAround).toHaveBeenCalledTimes(1);
  expect(vi.mocked(loadRoadTilesAround).mock.calls[0][0]).toEqual({lat:38.9,lng:141.57});
  expect(vi.mocked(resolveDeviceArea).mock.calls.at(-1)![0]).toMatchObject({latitude:38.9,longitude:141.57});
  expect(vi.mocked(loadJapanShelterPrefecture).mock.calls[0][1]).toBe('04');
  expect(vi.mocked(roadDestinations).mock.calls.at(-1)![0]).toBe(tileGraph);
  expect(routes()).toHaveLength(3);
  expect(lastMap().referenceRoute).toBeNull();
  await act(async()=>(host!.querySelector('.ui-sheet-head') as HTMLButtonElement).click());
  expect(count(host!.textContent??'',disclaimer)).toBe(1);
  expect(count(host!.textContent??'','© OpenStreetMap contributors')).toBe(1);
  expect(host!.querySelector('.map-notice')?.textContent).toContain(disclaimer);
  // Outside the Ishinomaki pilot bounds the pilot example-origin button is not offered.
  expect([...host!.querySelectorAll('button')].some(b=>b.textContent==='使用試點示例起點（非 GPS）')).toBe(false);
});

it('protected GPS alone never loads road tiles and asks for a chosen point; help keeps the real GPS fix and protection',async()=>{
  harness.gps={lat:38.9,lng:141.57,accuracy_m:12,captured_at:NOW,source:'GPS'};
  await render();
  await chooseHazard('tsunami');
  await settle();
  expect(loadRoadTilesAround).not.toHaveBeenCalled();
  expect(loadEvacuationRoadGraph).toHaveBeenCalledTimes(1);// the embedded pilot pack is a static asset, not a GPS-derived request
  expect(roadSection()).toContain('請選擇一個點以顯示道路參考線');
  expect(routes()).toEqual([]);
  await act(async()=>host!.querySelector<HTMLButtonElement>('.ui-help-pin')!.click());
  const entry=harness.entry.at(-1)!;
  expect(entry.protectDeviceLocation).toBe(true);
  expect(entry.fix).toMatchObject({lat:38.9,lng:141.57,accuracy_m:12});
});

it('inside Ishinomaki bounds a temporarily unavailable tile set falls back to the verified embedded road pack',async()=>{
  vi.mocked(loadRoadTilesAround).mockResolvedValue({status:'UNAVAILABLE',reason:'TEMPORARILY_UNAVAILABLE'});
  await render();
  await choosePoint(38.43,141.30);
  await chooseHazard('tsunami');
  await settle();
  expect(loadRoadTilesAround).toHaveBeenCalledWith({lat:38.43,lng:141.30},expect.anything());
  expect(vi.mocked(roadDestinations).mock.calls.some(call=>call[0]===ishinomakiGraph)).toBe(true);
  expect(routes()).toHaveLength(3);
  expect(roadSection()).toContain('改用已核對的內建石卷道路資料');
  expect(roadSection()).toContain('道路 0.9 km');
});

it('offline-without-data inside the bounds also falls back, but a point outside the bounds does not',async()=>{
  vi.mocked(loadRoadTilesAround).mockResolvedValue({status:'UNAVAILABLE',reason:'OFFLINE_NO_DATA'});
  await render();
  await choosePoint(38.43,141.30);
  await chooseHazard('earthquake');
  await settle();
  expect(routes()).toHaveLength(3);
  vi.mocked(roadDestinations).mockClear();
  await choosePoint(38.9,141.57);
  await settle();
  expect(vi.mocked(roadDestinations).mock.calls.some(call=>call[0]===ishinomakiGraph)).toBe(false);
  expect(routes()).toEqual([]);
  expect(roadSection()).toContain('此地區沒有道路參考資料（離線）');
});

it.each([
  ['TOO_DENSE','此地區道路資料過於密集，無法顯示參考線'],
  ['INVALID_DATA','無法取得此地區道路資料'],
  ['NO_ROADS','此地區沒有可用的道路資料'],
] as const)('%s is never replaced by the embedded Ishinomaki pack',async(reason,message)=>{
  vi.mocked(loadRoadTilesAround).mockResolvedValue({status:'UNAVAILABLE',reason});
  await render();
  await choosePoint(38.43,141.30);
  await chooseHazard('tsunami');
  await settle();
  expect(vi.mocked(roadDestinations).mock.calls.some(call=>call[0]===ishinomakiGraph)).toBe(false);
  expect(routes()).toEqual([]);
  expect(roadSection()).toContain(message);
  expect(roadSection()).not.toContain('內建石卷道路資料');
  if(reason==='NO_ROADS')expect([...host!.querySelector('[data-testid=road-reference]')!.querySelectorAll('button')].some(b=>b.textContent==='重試')).toBe(false);
});

it('switching from a supported to an unsupported hazard clears the lines, fetches nothing and never becomes tsunami',async()=>{
  await render();
  await choosePoint(38.9,141.57);
  await chooseHazard('tsunami');
  await settle();
  expect(routes()).toHaveLength(3);
  vi.mocked(loadRoadTilesAround).mockClear();vi.mocked(roadDestinations).mockClear();
  await chooseHazard('flood');
  await settle();
  expect(loadRoadTilesAround).not.toHaveBeenCalled();
  expect(roadDestinations).not.toHaveBeenCalled();
  expect(routes()).toEqual([]);
  expect(roadSection()).toContain('此災害類別沒有道路參考線（只支援海嘯及地震）');
  expect(roadSection()).not.toMatch(/海嘯適用指定場所|場所0/);
});

it('switching to an unsupported hazard aborts a pending road request',async()=>{
  let signal:AbortSignal|undefined;
  vi.mocked(loadRoadTilesAround).mockImplementation((_point,opts)=>{signal=opts?.signal;return new Promise(()=>{});});
  await render();
  await choosePoint(38.9,141.57);
  await chooseHazard('earthquake');
  await settle();
  expect(signal?.aborted).toBe(false);
  await chooseHazard('landslide');
  expect(signal?.aborted).toBe(true);
  expect(routes()).toEqual([]);
});

it('without a chosen hazard the road reference asks for tsunami or earthquake and requests nothing',async()=>{
  await render();
  await choosePoint(38.9,141.57);
  await settle();
  expect(loadRoadTilesAround).not.toHaveBeenCalled();
  expect(roadSection()).toContain('請選擇海嘯或地震以顯示道路參考線');
});
