// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SimulationScreens,type SimulationSection} from '../components/simulation-screens';
import {Dashboard} from '../components/dashboard';
import {defaultDisasterTest} from '../lib/disaster-test';
import type {SimulationLaunch} from '../lib/simulation-session';
import type {DeviceLocation} from '../lib/use-device-location';
import type {Snapshot} from '../lib/contracts';
import {activeSnapshot} from './fixtures';
import {loadRoadTilesAround} from '../lib/road-tiles';
import {loadJapanShelterCatalog,loadJapanShelterPrefecture} from '../lib/japan-shelters';
import {roadDestinations} from '../lib/road-destinations';
import type {RoadDestination} from '../lib/road-destinations';

const roadCalls=vi.hoisted(()=>[] as {point:{lat:number;lng:number};signal?:AbortSignal}[]);
const mapCalls=vi.hoisted(()=>[] as Record<string,unknown>[]);
const destinationCalls=vi.hoisted(()=>[] as unknown[][]);
vi.mock('../lib/road-tiles',()=>({loadRoadTilesAround:vi.fn()}));
vi.mock('../lib/japan-shelters',()=>({loadJapanShelterCatalog:vi.fn(),loadJapanShelterPrefecture:vi.fn()}));
vi.mock('../lib/road-destinations',()=>({roadDestinations:vi.fn()}));
vi.mock('../lib/area-resolution',async orig=>({...await orig<typeof import('../lib/area-resolution')>(),
  resolveDeviceArea:vi.fn(async()=>({status:'RESOLVED',area_ids:['JP-MUNI-13101','JP-13','JP'],label:'千代田区'}))}));
vi.mock('../components/simulation-reference-map',()=>({SimulationReferenceMap:(p:Record<string,unknown>)=>{mapCalls.push(p);return <div data-testid="stub-map"/>;}}));
vi.mock('next/link',()=>({default:({children,...p}:React.ComponentProps<'a'>)=><a {...p}>{children}</a>}));
vi.mock('../lib/use-power',async()=>{const {derivePower}=await import('../lib/vnext');return {usePower:()=>({power:derivePower(75,false),level:null,override:'AUTO',choose:()=>{}})};});
vi.mock('../lib/use-device-location',()=>{
  const location:DeviceLocation={position:null,state:'unavailable',freshness:'UNAVAILABLE',now:0,consent:false,ready:true,busy:false,
    failed:false,permissionDenied:false,permissionGranted:false,storageUnavailable:false,locate:async()=>null,retain:()=>{}};
  return {useDeviceLocation:()=>location};
});
vi.mock('../lib/continuity',async orig=>({...await orig<typeof import('../lib/continuity')>(),loadSnapshot:async()=>null,saveSnapshot:async()=>{}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

const quake={at_jst:'2011-03-11T14:46:00+09:00',kind:'EARTHQUAKE',label:{ja:'地震',en:'Earthquake','zh-TW':'地震'},source_url:'https://www.jma.go.jp/',historic_observation:true,fed_to_safety_core:true};
const tsunami={...quake,at_jst:'2011-03-11T14:49:00+09:00',kind:'TSUNAMI_WARNING',label:{ja:'津波警報',en:'Tsunami warning','zh-TW':'海嘯警報'},fed_to_safety_core:false};
const point1={lat:38.4196,lng:141.2946,source:'PRESET' as const,preset_id:'tohoku-ishinomaki-kadonowaki',label:{ja:'石巻・門脇','zh-TW':'石巻・門脇',en:'Ishinomaki Kadonowaki'}};
const point2={...point1,lat:38.9,lng:141.57,preset_id:null,source:'MAP_PICK' as const};
const config:SimulationLaunch={input:{...defaultDisasterTest,kind:'EARTHQUAKE'},language:'zh-TW',accessKey:'local-test-access-key',
  historicalCase:'tohoku-2011',title:'311 東日本大震災',milestones:[quake,tsunami],timeMode:'REALTIME',acceleratedStart:'2011-03-11T13:46',
  acceleration:600,startJst:'2011-03-11T14:46',endJst:'2011-03-11T14:49'};
const readyTiles={status:'READY' as const,graph:{} as never,missing:[],oldestRetrievedAt:'2026-08-01T00:00:00Z',stale:false,persisted:true};
const destinations=Array.from({length:5},(_,i)=>({place:{id:'p'+i,name:'場所'+i} as never,straight_m:1000+i,
  road:i<4?{id:'r'+i,distance_m:1200+i,coordinates:[[141.29,38.42],[141.30,38.43]],origin_gap_m:1,destination_gap_m:1,road_names:[],role:'ROAD_REFERENCE_ONLY' as const,movement_authorized:false as const}:null,reason:null}));

let root:Root|null=null;let host:HTMLDivElement|null=null;let served:Snapshot;let fetchCalls:string[]=[];
function ScreenHarness({launch,done=2,state=null}:{launch:SimulationLaunch;done?:number;state?:unknown}){
  const [tab,setTab]=useState<SimulationSection>('map');
  return <SimulationScreens config={launch} phase="running" tab={tab} setTab={setTab} time={Date.parse('2011-03-11T14:49:00+09:00')}
    speed={1} done={done} state={state as never} processing={false} error="" leave={()=>{}}/>;
}
async function renderScreen(launch:SimulationLaunch=config,done=2,state:unknown=null){
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<ScreenHarness launch={launch} done={done} state={state}/>));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,260));});
  return host;
}
async function renderDashboard(){
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<Dashboard view="demo"/>));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
  return host;
}
beforeEach(()=>{
  roadCalls.length=0;mapCalls.length=0;destinationCalls.length=0;fetchCalls=[];
  vi.mocked(loadRoadTilesAround).mockReset().mockImplementation(async(point,opts)=>{
    roadCalls.push({point,signal:opts?.signal});return readyTiles;
  });
  vi.mocked(loadJapanShelterCatalog).mockReset().mockResolvedValue({} as never);
  vi.mocked(loadJapanShelterPrefecture).mockReset().mockResolvedValue([]);
  vi.mocked(roadDestinations).mockReset().mockImplementation((_graph,origin,_places,hazard)=>{
    destinationCalls.push([_graph,origin,_places,hazard]);return {destinations:destinations as unknown as RoadDestination[],none:false};
  });
  served=activeSnapshot();
  localStorage.setItem('72h-session','session');localStorage.setItem('72h-language','zh-TW');
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const path=String(input);fetchCalls.push(`${init?.method??'GET'} ${path}`);
    if(path.startsWith('/api/replay/session'))return {ok:true,status:200,json:async()=>served} as unknown as Response;
    if(path.endsWith('/explanation'))return {ok:false,status:503,text:async()=>'{}',json:async()=>({})} as unknown as Response;
    return {ok:false,status:404,json:async()=>({}),text:async()=>''} as unknown as Response;
  }));
});
afterEach(async()=>{
  if(root)await act(async()=>root!.unmount());
  root=null;host?.remove();host=null;localStorage.clear();vi.unstubAllGlobals();
});

it('focuses the selected drill point, turns on the road layer, and draws at most three reference routes',async()=>{
  const page=await renderScreen({...config,drillPoint:point1,locationContext:{source:'USER_SELECTED',area_ids:['JP-MUNI-04202','JP-04','JP'],label:'石巻市'} as never});
  expect(mapCalls.at(-1)).toMatchObject({focusPoint:{lat:point1.lat,lng:point1.lng,zoom:14}});
  const chip=[...page.querySelectorAll<HTMLButtonElement>('.map-chips button')].find(button=>button.textContent?.includes('道路參考'));
  expect(chip?.getAttribute('aria-pressed')).toBe('true');
  expect((mapCalls.at(-1)?.referenceRoutes as unknown[]).length).toBe(3);
  expect((mapCalls.at(-1)?.referenceRoutes as {role:string;movement_authorized:boolean}[]).every(route=>route.role==='ROAD_REFERENCE_ONLY'&&route.movement_authorized===false)).toBe(true);
  expect(destinationCalls.at(-1)?.[3]).toBe('tsunami');
  expect(roadCalls[0]?.point).toEqual({lat:point1.lat,lng:point1.lng});
  expect(loadJapanShelterPrefecture).toHaveBeenCalledWith(expect.anything(),'04',expect.any(AbortSignal));
});

it('uses earthquake designation for Kumamoto and honours official tsunami state',async()=>{
  const kumamoto={...config,historicalCase:'kumamoto-2016',milestones:[{...quake,at_jst:'2016-04-14T21:26:00+09:00'}],drillPoint:point2,
    locationContext:{source:'USER_SELECTED',area_ids:['JP-43','JP'],label:'熊本県'} as never};
  await renderScreen(kumamoto,1);
  expect(destinationCalls.at(-1)?.[3]).toBe('earthquake');
  if(root)await act(async()=>root!.unmount());root=null;host?.remove();host=null;
  const official={snapshot:{session_id:'s',situation:{current_plan_id:null},plans:[],plan_actions:[],evidence:[],distress:{level:'OFFICIAL_TSUNAMI'}},current_step:0,movement_assessment:null};
  await renderScreen({...config,milestones:[quake],drillPoint:point1,locationContext:{source:'USER_SELECTED',area_ids:['JP-04','JP'],label:'石巻市'} as never},1,official);
  expect(destinationCalls.at(-1)?.[3]).toBe('tsunami');
});

it('does not load tiles without a drill point and shows the no-point peek',async()=>{
  const page=await renderScreen({...config,drillPoint:null},2);
  expect(roadCalls).toHaveLength(0);
  expect(page.querySelector('.ui-sheet-head')?.textContent).toContain('請選擇一個點以顯示道路參考線');
  const chip=[...page.querySelectorAll<HTMLButtonElement>('.map-chips button')].find(button=>button.textContent?.includes('道路參考'));
  expect(chip?.getAttribute('aria-pressed')).toBe('false');
});

it('aborts the previous tile load when the selected point changes',async()=>{
  vi.mocked(loadRoadTilesAround).mockImplementation((point,opts)=>{
    roadCalls.push({point,signal:opts?.signal});
    return roadCalls.length===1?new Promise(()=>{}):Promise.resolve(readyTiles);
  });
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  const first={...config,drillPoint:point1,locationContext:{source:'USER_SELECTED',area_ids:['JP-04','JP'],label:'石巻市'} as never};
  await act(async()=>root!.render(<ScreenHarness launch={first}/>));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,260));});
  const firstSignal=roadCalls[0]?.signal;
  await act(async()=>root!.render(<ScreenHarness launch={{...first,drillPoint:point2,locationContext:{source:'USER_SELECTED',area_ids:['JP-04','JP'],label:'石巻市'} as never}}/>));
  expect(firstSignal?.aborted).toBe(true);
});

it('debounces rapid point changes so only the final point starts a request',async()=>{
  vi.useFakeTimers();
  try{
    host=document.createElement('div');document.body.append(host);root=createRoot(host);
    const launch=(drillPoint:NonNullable<SimulationLaunch['drillPoint']>)=>({...config,drillPoint,locationContext:{source:'USER_SELECTED',area_ids:['JP-04','JP'],label:'石巻市'} as never});
    await act(async()=>root!.render(<ScreenHarness launch={launch(point1)}/>));
    await act(async()=>{await vi.advanceTimersByTimeAsync(100);});
    await act(async()=>root!.render(<ScreenHarness launch={launch(point2)}/>));
    await act(async()=>{await vi.advanceTimersByTimeAsync(249);});
    expect(roadCalls).toHaveLength(0);
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
    expect(roadCalls).toHaveLength(1);
    expect(roadCalls[0]?.point).toEqual({lat:point2.lat,lng:point2.lng});
  }finally{vi.useRealTimers();}
});

it('ignores a late result from an aborted point load',async()=>{
  let finishFirst:(value:typeof readyTiles)=>void=()=>{};
  vi.mocked(loadRoadTilesAround).mockImplementationOnce(()=>new Promise(resolve=>{finishFirst=resolve;}))
    .mockResolvedValueOnce({...readyTiles,graph:{marker:'new-point'} as never});
  vi.mocked(roadDestinations).mockImplementation((graph,origin,places,hazard)=>{
    destinationCalls.push([graph,origin,places,hazard]);
    const marker=(graph as {marker?:string}|null)?.marker;
    const results=marker==='new-point'?destinations.slice(0,2):destinations;
    return {destinations:results as unknown as RoadDestination[],none:false};
  });
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  const first={...config,drillPoint:point1,locationContext:{source:'USER_SELECTED',area_ids:['JP-04','JP'],label:'石巻市'} as never};
  const second={...first,drillPoint:point2};
  await act(async()=>root!.render(<ScreenHarness launch={first}/>));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,260));});
  await act(async()=>root!.render(<ScreenHarness launch={second}/>));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,260));});
  expect(host.querySelector('.ui-sheet-head')?.textContent).toContain('附近 2 處海嘯適用指定場所');
  expect(destinationCalls).toHaveLength(1);

  await act(async()=>finishFirst({...readyTiles,graph:{marker:'old-point'} as never}));
  expect(destinationCalls).toHaveLength(1);
  expect(host.querySelector('.ui-sheet-head')?.textContent).toContain('附近 2 處海嘯適用指定場所');
});

it('/demo keeps replay area and GPS separate from an exercise point and renders the road-reference sheet',async()=>{
  const page=await renderDashboard();
  const map=[...page.querySelectorAll<HTMLButtonElement>('nav.ui-tabs button')][1];
  await act(async()=>map.click());
  expect(page.querySelector('.map-chips')?.textContent).toContain('道路參考');
  expect(page.querySelector('.ui-sheet-head')?.textContent).toContain('請選擇一個點以顯示道路參考線');
  expect(roadCalls).toHaveLength(0);
  expect(mapCalls.at(-1)).toMatchObject({focusPoint:null,referenceRoutes:[]});
});

const disclaimer='道路參考線不是避難路線，最安全路線未判定。';
const occurrences=(text:string|null|undefined,needle:string)=>(text??'').split(needle).length-1;

it('keeps the road disclaimer and OSM attribution visible exactly once in map chrome while the sheet is closed',async()=>{
  const page=await renderScreen({...config,drillPoint:point1,locationContext:{source:'USER_SELECTED',area_ids:['JP-04','JP'],label:'石巻市'} as never});
  expect(page.querySelector('.ui-sheet-head')?.getAttribute('aria-expanded')).toBe('false');
  expect(page.querySelector('.ui-sheet-body')).toBeNull();
  expect(occurrences(page.querySelector('.map-notice')?.textContent,disclaimer)).toBe(1);
  expect(occurrences(page.textContent,disclaimer)).toBe(1);
  expect(occurrences(page.textContent,'© OpenStreetMap contributors')).toBe(1);
  await act(async()=>(page.querySelector('.ui-sheet-head') as HTMLButtonElement).click());
  expect(page.querySelector('.ui-sheet-body')).not.toBeNull();
  expect(occurrences(page.textContent,disclaimer)).toBe(1);
  expect(occurrences(page.textContent,'© OpenStreetMap contributors')).toBe(1);
  // Lines off: the chrome notice goes away and the open section carries the single copy instead.
  const chip=[...page.querySelectorAll<HTMLButtonElement>('.map-chips button')].find(button=>button.textContent?.includes('道路參考'))!;
  await act(async()=>chip.click());
  expect(page.querySelector('.map-notice')).toBeNull();
  expect(occurrences(page.textContent,disclaimer)).toBe(1);
});

it('shows the NO_ROADS state in the collapsed peek without lines',async()=>{
  vi.mocked(loadRoadTilesAround).mockImplementation(async(point,opts)=>{roadCalls.push({point,signal:opts?.signal});return {status:'UNAVAILABLE',reason:'NO_ROADS'};});
  const page=await renderScreen({...config,drillPoint:point1,locationContext:{source:'USER_SELECTED',area_ids:['JP-04','JP'],label:'石巻市'} as never});
  expect(page.querySelector('.ui-sheet-head')?.textContent).toBe('此地區沒有可用的道路資料');
  expect(mapCalls.at(-1)?.referenceRoutes).toEqual([]);
});

it('/demo chooses a volatile local point with the drill picker, then focuses it, loads roads and draws reference routes',async()=>{
  const page=await renderDashboard();
  const mapTab=[...page.querySelectorAll<HTMLButtonElement>('nav.ui-tabs button')][1];
  await act(async()=>mapTab.click());
  const profileBefore=JSON.stringify(served.profile);
  const chip=()=>[...page.querySelectorAll<HTMLButtonElement>('.map-chips button')].find(button=>button.textContent?.includes('道路參考'))!;
  expect(chip().getAttribute('aria-pressed')).toBe('false');
  expect(page.querySelector('.map-notice')).toBeNull();
  // The chip is not a no-op without a point: it opens the sheet at the point picker.
  await act(async()=>chip().click());
  expect(page.querySelector('.ui-sheet-head')?.getAttribute('aria-expanded')).toBe('true');
  const button=(label:string)=>[...page.querySelectorAll<HTMLButtonElement>('.ui-sheet-body button')].find(b=>b.textContent===label)!;
  expect(button('在地圖上選點')).toBeTruthy();
  expect(page.querySelector('.ui-sheet-body')?.textContent).not.toContain('請選擇一個點以顯示道路參考線');
  const callsBeforePick=fetchCalls.length;
  await act(async()=>button('在地圖上選點').click());
  const pickerMap=mapCalls.filter(call=>typeof call.onReferencePoint==='function').at(-1)!;
  await act(async()=>(pickerMap.onReferencePoint as (p:{lat:number;lng:number})=>void)({lat:35.6812,lng:139.7671}));
  await act(async()=>button('使用這個位置').click());
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,260));});
  expect(roadCalls.map(call=>call.point)).toEqual([{lat:35.6812,lng:139.7671}]);
  expect(loadJapanShelterPrefecture).toHaveBeenCalledWith(expect.anything(),'13',expect.any(AbortSignal));
  const mainMap=mapCalls.filter(call=>call.onReferencePoint===undefined).at(-1)!;
  expect(mainMap).toMatchObject({focusPoint:{lat:35.6812,lng:139.7671,zoom:14}});
  expect((mainMap.referenceRoutes as {role:string;movement_authorized:boolean}[]).length).toBe(3);
  expect((mainMap.referenceRoutes as {role:string;movement_authorized:boolean}[]).every(route=>route.role==='ROAD_REFERENCE_ONLY'&&route.movement_authorized===false)).toBe(true);
  expect(chip().getAttribute('aria-pressed')).toBe('true');
  expect(page.querySelector('.ui-sheet-head')?.textContent).toContain('處');
  expect(occurrences(page.textContent,disclaimer)).toBe(1);
  expect(occurrences(page.querySelector('.map-notice')?.textContent,disclaimer)).toBe(1);
  expect(occurrences(page.textContent,'© OpenStreetMap contributors')).toBe(1);
  // Volatile and local: the replay profile and SOS/distress location are untouched, nothing is persisted.
  expect(JSON.stringify(served.profile)).toBe(profileBefore);
  expect(fetchCalls.slice(callsBeforePick).filter(call=>!call.startsWith('GET'))).toEqual([]);
  expect(Object.values({...localStorage}).join(' ')).not.toContain('139.7671');
  // Toggling the chip now hides the lines and moves the notice back into the open section.
  await act(async()=>chip().click());
  expect(chip().getAttribute('aria-pressed')).toBe('false');
  expect(mapCalls.filter(call=>call.onReferencePoint===undefined).at(-1)?.referenceRoutes).toEqual([]);
  expect(page.querySelector('.map-notice')).toBeNull();
  expect(occurrences(page.textContent,disclaimer)).toBe(1);
});
