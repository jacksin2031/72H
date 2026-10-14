// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {OfficialHazardPanel} from '../components/official-hazard-panel';
import type {HazardPack,OfficialPlace} from '../lib/official-hazards';

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|null=null,container:HTMLDivElement|null=null;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());container?.remove();root=null;container=null;vi.unstubAllGlobals();vi.restoreAllMocks();});
const places:OfficialPlace[]=[{id:'TEST-emergency',name:'Emergency test',address:'Test only',lat:38,lng:141,kind:'EMERGENCY_SITE',
  hazards:{flood:'UNKNOWN',landslide:'UNKNOWN',storm_surge:'UNKNOWN',earthquake:'DESIGNATED',tsunami:'DESIGNATED',large_fire:'UNKNOWN',inland_flood:'UNKNOWN',volcano:'UNKNOWN'},notes:'Fixture only',source_id:'test',open_status:'UNKNOWN'}];
places.push({...places[0],id:'TEST-shelter',name:'Shelter test',kind:'SHELTER'});
const pack:HazardPack={manifest:{schema_version:1,dataset_id:'TEST_ONLY',region_name:'Test only',area_id:'JP-04',reviewed_at:'2026-10-01T00:00:00Z',review_due_at:'2027-10-01T00:00:00Z',positional_accuracy_m:25,positional_accuracy_kind:'MAX_BOUND',coverage_status:'PARTIAL',
  assets:[],sources:[{id:'test',title:'Fixture only',url:'https://www.gsi.go.jp/',basis_date:null,published_at:null,retrieved_at:'2026-10-01T00:00:00Z',raw_sha256:'a'.repeat(64),license_url:'https://www.gsi.go.jp/',notes:'Fixture only'}]},
  inundation:{type:'FeatureCollection',features:[]},places,coverage:null};
async function render(value:HazardPack|null,bulletin?:unknown){
  const gps=vi.fn(),onPlace=vi.fn();
  vi.stubGlobal('fetch',vi.fn(async()=>bulletin?new Response(JSON.stringify(bulletin)):new Response('',{status:503})));
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<OfficialHazardPanel language="zh-TW" pack={value} loading={false} error={!value} point={null}
    onRetry={()=>{}} onGPS={gps} onClear={()=>{}} onFocus={()=>{}} onPlace={onPlace} gpsState="idle"/>));
  return {gps,onPlace};
}
it('keeps opening/route uncertainty visible and filters designation independently from shelter identity',async()=>{
  const {gps}=await render(pack);
  expect(gps).not.toHaveBeenCalled();
  expect(container!.textContent).toContain('安全性：無法判定');
  expect(container!.textContent).toContain('目前開放：未核實');
  expect(container!.textContent).toContain('路線：未核實');
  expect(container!.querySelector('h1,h2,aside')).toBeNull(); // sheet content: no own title or card frame
  const filter=container!.querySelector<HTMLInputElement>('.hazard-filter input')!;
  await act(async()=>filter.click());
  expect(container!.querySelector('.hazard-place-list')!.textContent).toContain('Emergency test');
  expect(container!.querySelector('.hazard-place-list')!.textContent).not.toContain('Shelter test');
  const button=[...container!.querySelectorAll('button')].find(x=>x.textContent==='使用目前 GPS 查詢')!;
  await act(async()=>button.click());expect(gps).toHaveBeenCalledOnce();
  expect(container!.querySelector('a[href*="maps.google"]')).toBeNull();
  expect(container!.textContent).toContain('未取得有效且新鮮');
});
it('does not render selectable places or a geographic clearance after a corrupt or missing pack',async()=>{
  const {gps}=await render(null);
  expect(container!.querySelector('.hazard-place-list')).toBeNull();
  expect(container!.querySelector('[role=alert]')!.textContent).toContain('無法驗證');
  expect(container!.textContent).toContain('安全性：無法判定');
  expect(gps).not.toHaveBeenCalled();
});

it('shows unknown facility precision without claiming a zero-error position',async()=>{
  await render(pack);
  await act(async()=>root!.render(<OfficialHazardPanel language="zh-TW" pack={pack} loading={false} error={false}
    point={{lat:38,lng:141,accuracy_m:null,captured_at:Date.now(),source:'OFFICIAL_PLACE'}}
    onRetry={()=>{}} onGPS={()=>{}}
    onClear={()=>{}} onFocus={()=>{}} onPlace={()=>{}} gpsState="idle"/>));
  const query=container!.querySelector('[data-testid="official-hazard-assessment"]')!.textContent;
  expect(query).toContain('場所座標精度：未提供');expect(query).not.toContain('±0');
  expect(query).toContain('不能判定');
});

it('assesses a newly selected point against current time before the next freshness timer tick',async()=>{
  let clock=Date.parse('2026-10-11T08:00:00Z');
  vi.spyOn(Date,'now').mockImplementation(()=>clock);
  await render(pack);
  clock+=10000;
  await act(async()=>root!.render(<OfficialHazardPanel language="zh-TW" pack={pack} loading={false} error={false}
    point={{lat:38,lng:141,accuracy_m:0,captured_at:clock,source:'MAP_POINT'}}
    onRetry={()=>{}} onGPS={()=>{}}
    onClear={()=>{}} onFocus={()=>{}} onPlace={()=>{}} gpsState="idle"/>));
  expect(container!.textContent).toContain('沒有足夠調查覆蓋證據');
  expect(container!.textContent).not.toContain('定位已過期或精度不足');
});

it('downgrades a stale official bulletin even if the response incorrectly labels it CURRENT',async()=>{
  await render(pack,{mode:'LIVE_REFERENCE',event_type:'TSUNAMI',status:'ACTIVE',source_status:'CURRENT',safety_authority:'NONE',
    source:{source_id:'jma-bosai-xml',product_code:'VTSE41',name:'Test only',url:'https://www.jma.go.jp/',published_at:new Date(Date.now()-30*60000).toISOString(),fetched_at:new Date().toISOString(),operation:'ISSUE',serial:'1'},
    forecast_areas:[{area_code:'210',area_name:'Test only',status:'ACTIVE',warning_class:'WARNING',max_height:{value_m:3,expression:'NUMERIC',description:'Test only'},arrival_at:null}]});
  expect(container!.querySelector('.hazard-live')!.textContent).toContain('官方電文已過期');
  expect(container!.textContent).toContain('安全性：無法判定');
});

it('exposes a fresh active area before the place list and never treats cancellation as point clearance',async()=>{
  const bulletin={mode:'LIVE_REFERENCE',event_type:'TSUNAMI',status:'ACTIVE',source_status:'CURRENT',safety_authority:'NONE',
    source:{source_id:'jma-bosai-xml',product_code:'VTSE41',name:'Test only',url:'https://www.jma.go.jp/',published_at:new Date().toISOString(),fetched_at:new Date().toISOString(),operation:'ISSUE',serial:'1'},
    forecast_areas:[{area_code:'210',area_name:'Test area',status:'ACTIVE',warning_class:'WARNING',max_height:{value_m:3,expression:'NUMERIC',description:'Test only'},arrival_at:null}]};
  await render(pack,bulletin);
  const live=container!.querySelector('.hazard-live')!;
  expect(live.querySelector('[role=alert]')!.textContent).toContain('Test area · 海嘯警報');
  expect(live.compareDocumentPosition(container!.querySelector('.hazard-place-list')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(live.querySelector('details')!.open).toBe(false);
  await act(async()=>root!.unmount());root=null;container?.remove();
  await render(pack,{...bulletin,status:'CANCELLED',source:{...bulletin.source,operation:'CANCEL'},forecast_areas:[]});
  expect(container!.querySelector('.hazard-live [role=status]')!.textContent).toContain('不代表本地已核實安全');
  expect(container!.textContent).toContain('安全性：無法判定');
});
