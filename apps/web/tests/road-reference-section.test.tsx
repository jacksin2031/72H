// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it} from 'vitest';
import {RoadReferenceSection,roadPeekText,type RoadReference} from '../components/road-reference-section';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();});
const render=async(el:React.ReactElement)=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(el));};
const ready=(n:number,stale=false,persisted=true):RoadReference=>({state:'READY',retry:()=>{},tiles:{status:'READY',graph:{} as never,missing:[],oldestRetrievedAt:'2026-08-01T00:00:00Z',stale,persisted},
  result:{none:false,destinations:Array.from({length:n},(_,i)=>({place:{id:'p'+i,name:'場所'+i} as never,straight_m:1200+i,road:i<3?{distance_m:1500,coordinates:[],id:'candidate-'+i,origin_gap_m:1,destination_gap_m:1,road_names:[],role:'ROAD_REFERENCE_ONLY' as const,movement_authorized:false as const}:null,reason:null}))}} as RoadReference);

it('provides localized loading, no-point, and hazard-specific peek text',()=>{
  expect(roadPeekText('ja','tsunami',{state:'LOADING',tiles:null,result:null,retry:()=>{}})).toBe('道路データを取得中…');
  expect(roadPeekText('en','earthquake',{state:'IDLE',tiles:null,result:null,retry:()=>{}})).toBe('Select a point to show road references');
  expect(roadPeekText('zh-TW','tsunami',ready(5))).toBe('附近 5 處海嘯適用指定場所 · 道路參考');
  expect(roadPeekText('zh-TW','earthquake',ready(2))).toBe('附近 2 處地震適用指定場所 · 道路參考');
});

it('surfaces unavailable road tiles in the collapsed peek before place counts',()=>{
  const tooDense={...ready(5),tiles:{status:'UNAVAILABLE' as const,reason:'TOO_DENSE' as const}};
  const offline={...ready(5),tiles:{status:'UNAVAILABLE' as const,reason:'OFFLINE_NO_DATA' as const}};
  expect(roadPeekText('zh-TW','tsunami',tooDense)).toBe('此地區道路資料過於密集，無法顯示參考線');
  expect(roadPeekText('en','tsunami',offline)).toBe('No road reference data for this area (offline)');
});

it('lists place and reference distances, one disclaimer, attribution, and the exercise tag',async()=>{
  await render(<RoadReferenceSection language="zh-TW" exercise hazard="tsunami" reference={ready(5)}/>);
  expect(host.textContent).toContain('場所0 · 直線 1.2 km · 道路 1.5 km（參考）');
  expect(host.textContent).toContain('場所4 · 直線 1.2 km · 道路 —');
  expect(host.textContent!.split('道路參考線不是避難路線，最安全路線未判定。').length-1).toBe(1);
  expect(host.textContent).toContain('© OpenStreetMap contributors');expect(host.textContent).toContain('演練');
  expect(host.textContent).not.toMatch(/開放中|安全路線[:：]/);
});

it('shows stale age, partial and persistence states, and dense/offline tile messages',async()=>{
  await render(<RoadReferenceSection language="zh-TW" exercise={false} hazard="tsunami" reference={ready(1,true,false)}/>);
  expect(host.textContent).toContain('資料較舊（取得於 2026-08-01）');
  expect(host.textContent).toContain('無法離線保存');
  await act(async()=>root.render(<RoadReferenceSection language="zh-TW" exercise={false} hazard="tsunami" reference={{state:'READY',retry:()=>{},result:{none:false,destinations:[]},tiles:{status:'READY',graph:{} as never,missing:['r1c1'],oldestRetrievedAt:'2026-08-01T00:00:00Z',stale:false,persisted:true}}}/>));
  expect(host.textContent).toContain('部分道路資料未下載');
  await act(async()=>root.render(<RoadReferenceSection language="zh-TW" exercise={false} hazard="tsunami" reference={{state:'READY',retry:()=>{},result:null,tiles:{status:'UNAVAILABLE',reason:'TOO_DENSE'}}}/>));
  expect(host.textContent).toContain('此地區道路資料過於密集，無法顯示參考線');
  await act(async()=>root.render(<RoadReferenceSection language="en" exercise={false} hazard="tsunami" reference={{state:'READY',retry:()=>{},result:null,tiles:{status:'UNAVAILABLE',reason:'OFFLINE_NO_DATA'}}}/>));
  expect(host.textContent).toContain('No road reference data for this area (offline)');
});

it('error offers a retry button',async()=>{
  let retried=false;
  await render(<RoadReferenceSection language="zh-TW" exercise hazard="tsunami" reference={{state:'ERROR',retry:()=>{retried=true;},result:null,tiles:null}}/>);
  await act(async()=>(host.querySelector('.ui-btn-secondary') as HTMLButtonElement).click());expect(retried).toBe(true);
});
