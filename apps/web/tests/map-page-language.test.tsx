// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const mapProps:Record<string,unknown>[]=[];
vi.mock('next/link',()=>({default:({children,...p}:React.ComponentProps<'a'>)=><a {...p}>{children}</a>}));
vi.mock('@/components/simulation-reference-map',()=>({SimulationReferenceMap:(p:Record<string,unknown>)=>{mapProps.push(p);return null;}}));
vi.mock('@/components/official-hazard-panel',()=>({OfficialHazardPanel:()=>null}));
vi.mock('@/components/japan-shelter-panel',()=>({JapanShelterPanel:()=>null}));
vi.mock('@/components/disaster-map-panel',()=>({DisasterMapPanel:()=>null}));
vi.mock('@/components/designated-places-panel',()=>({DesignatedPlacesPanel:()=>null}));
vi.mock('@/components/evacuation-route-panel',()=>({EvacuationRoutePanel:()=><p data-testid="route-panel">route</p>}));
vi.mock('@/lib/use-simulation-geo',()=>({useSimulationGeo:()=>({location:null,state:'idle',clear:()=>{},request:()=>{}})}));
vi.mock('@/lib/use-disaster-map',()=>({useDisasterMap:()=>({})}));
vi.mock('@/lib/use-designated-places',()=>({useDesignatedPlaces:()=>({places:[]})}));
vi.mock('@/lib/official-hazards',async original=>({...await original<typeof import('../lib/official-hazards')>(),loadOfficialHazardPack:()=>new Promise(()=>{}),officialPlaceLocation:()=>null}));
const helpCache=vi.hoisted(()=>({snapshot:null as import('../lib/contracts').LiveSnapshot|null,saved:[] as import('../lib/contracts').LiveSnapshot[],adopt:null as ((raw:unknown)=>void)|null}));
vi.mock('@/lib/continuity',()=>({loadLiveSnapshot:async()=>helpCache.snapshot?{snapshot:helpCache.snapshot}:null,saveLiveSnapshot:async(s:import('../lib/contracts').LiveSnapshot)=>{helpCache.saved.push(s);}}));
vi.mock('@/components/distress-entry',()=>({DistressEntry:(p:{onSnapshot:(raw:unknown)=>void})=>{helpCache.adopt=p.onSnapshot;return <p data-testid="help-content">help</p>}}));
import JapanMapPage from '../app/map/page';
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{helpCache.snapshot=null;helpCache.saved.length=0;helpCache.adopt=null;history.replaceState({},'', '/');await act(async()=>root.unmount());host.remove();localStorage.clear();mapProps.length=0;});
async function render(){
  try{if(!localStorage.getItem('72h-language'))localStorage.setItem('72h-language','zh-TW');}catch{}
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<JapanMapPage/>));
}
const count=(text:string,needle:string)=>text.split(needle).length-1;
it('map page honours the saved language and renders full bleed',async()=>{
  localStorage.setItem('72h-language','ja');
  await render();
  expect([...host.querySelectorAll('nav.ui-tabs a')].map(a=>a.textContent)).toEqual(['今','地図','その他']);
  expect(host.querySelector('main')?.className).toContain('ui-main-full');
  const h1=host.querySelector('h1');
  expect(h1?.textContent).toBe('日本全国の参考地図');
  expect(h1?.className).toBe('ui-visually-hidden');
});
it('lays the map out as one screen: four layer chips, one legend line, one sheet, region picker, no historical picker',async()=>{
  await render();
  expect(host.querySelectorAll('.map-screen')).toHaveLength(1);
  expect([...host.querySelectorAll('.map-chips .ui-chip')].map(c=>c.textContent)).toEqual(['浸水想定','避難場所','海嘯預報區','震度地域']);
  expect([...host.querySelectorAll('.map-chips .ui-chip')].map(c=>c.getAttribute('aria-pressed'))).toEqual(['true','true','true','false']);
  expect(host.querySelectorAll('.map-legend')).toHaveLength(1);
  expect(host.querySelectorAll('.ui-sheet')).toHaveLength(1);
  expect(host.querySelector('.ui-sheet-head')?.textContent).toBe('已載入 0 處指定避難場所');
  expect(host.querySelector('.map-region select[aria-label="地圖地區"]')).not.toBeNull();
  expect(host.querySelector('select[aria-label="歷史地震"]')).toBeNull();
  expect(mapProps.at(-1)).toMatchObject({protectDeviceLocation:true,legend:'none',regionPicker:false,epicenter:null});
});
it('shows exactly one not-for-navigation / not-a-safety-determination note, in the legend line, whatever the layers',async()=>{
  await render();
  const note='僅供參考：不可作避難導航，也不是安全判定';
  await act(async()=>(host.querySelector('.ui-sheet-head') as HTMLButtonElement).click());
  expect(count(host.textContent??'',note)).toBe(1);
  expect(host.querySelector('.map-legend')?.textContent).toContain(note);
  expect(host.querySelector('.map-legend')?.textContent).toContain('避難場所：官方指定，開放未核實');
  // No verified pack / bulletin loaded: the legend must not claim an inundation layer or a current bulletin.
  expect(host.querySelector('.map-legend')?.textContent).not.toContain('浸水想定');
  expect(host.querySelector('.map-legend')?.textContent).toContain('海嘯預報區：未取得可核實電文');
  expect(host.querySelector('.map-legend')?.textContent).not.toMatch(/最新|期限內電文/);
  for(const chip of [...host.querySelectorAll<HTMLButtonElement>('.map-chips .ui-chip')])if(chip.getAttribute('aria-pressed')==='true')await act(async()=>chip.click());
  expect(host.querySelector('.map-legend')?.textContent).toBe(note);
  expect(count(host.textContent??'',note)).toBe(1);
});
it('sheet lists titled sections and adds the road-candidate section only after a point is chosen',async()=>{
  await render();
  await act(async()=>(host.querySelector('.ui-sheet-head') as HTMLButtonElement).click());
  expect([...host.querySelectorAll('.ui-section-title')].map(e=>e.textContent)).toEqual(['避難場所','官方資料']);
  expect(host.querySelector('[data-testid=route-panel]')).toBeNull();
  const onReferencePoint=mapProps.at(-1)!.onReferencePoint as (p:{lat:number;lng:number})=>void;
  await act(async()=>onReferencePoint({lat:38.43,lng:141.3}));
  expect([...host.querySelectorAll('.ui-section-title')].map(e=>e.textContent)).toEqual(['道路候選','避難場所','官方資料']);
  expect(host.querySelector('[data-testid=route-panel]')).not.toBeNull();
});
it('real sheet panels carry no navigation note of their own (the legend line is the only one)',async()=>{
  const {readFileSync}=await import('node:fs');const {resolve}=await import('node:path');
  for(const f of ['official-hazard-panel','japan-shelter-panel','designated-places-panel','disaster-map-panel','evacuation-route-panel']){
    const src=readFileSync(resolve(__dirname,`../components/${f}.tsx`),'utf8');
    expect(src,f).not.toMatch(/導航|ナビ|[Nn]avigation/);
  }
});
it('before the saved language is read it renders the shell and the hidden h1 but no language text, so no zh-TW frame flashes for a ja or en user',async()=>{
  const {renderToString}=await import('react-dom/server');
  const html=renderToString(<JapanMapPage/>);
  expect(html).toContain('ui-app');
  expect(html).toContain('ui-tabs');
  expect(html).toMatch(/<h1 class="ui-visually-hidden"><\/h1>/);
  expect(html).toContain('map-screen');
  // No zh-TW (or any language's) words: tab labels, title, chips, legend and sheet are all suppressed.
  for(const text of ['現在','地圖','更多','全日本參考地圖','浸水想定','避難場所','僅供參考','主選單'])expect(html,text).not.toContain(text);
});
it('a storage error while reading the saved language still renders the full map shell (falls back to Japanese)',async()=>{
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('blocked');});
  await render();
  expect(host.querySelector('.ui-app')).not.toBeNull();
  expect([...host.querySelectorAll('nav.ui-tabs a')].map(a=>a.textContent)).toEqual(['今','地図','その他']);
  expect(host.querySelector('h1.ui-visually-hidden')?.textContent).toBe('日本全国の参考地図');
  expect(host.querySelectorAll('.map-chips .ui-chip')).toHaveLength(4);
  vi.restoreAllMocks();
});

it('I5: unsaved language defaults to Japanese and a valid query takes precedence',async()=>{
  const spy=vi.spyOn(Storage.prototype,'getItem').mockReturnValue(null);
  await render();
  expect(host.querySelector('h1')?.textContent).toBe('日本全国の参考地図');
  history.replaceState({},'', '/map?language=en');
  await act(async()=>root.unmount());host.remove();
  await render();
  expect(host.querySelector('h1')?.textContent).toBe('All Japan reference map');
  spy.mockRestore();
});
it('I2: Map has one help entry, opens accessible help without a session, and returns focus on close',async()=>{
  await render();
  const pin=host.querySelector<HTMLButtonElement>('.ui-help-pin')!;pin.focus();
  await act(async()=>pin.click());
  expect(host.querySelector('[role=dialog] [data-testid=help-content]')).not.toBeNull();
  expect(host.querySelector('.ui-help-pin:not([hidden])')).toBeNull();
  await act(async()=>host.querySelector<HTMLButtonElement>('[role=dialog] button')!.click());
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('.ui-help-pin'));
});

it('Map reports persist only a validated same-session response that does not move backwards',async()=>{
  const {movementLiveSnapshot}=await import('./live-fixtures');
  const original=movementLiveSnapshot();helpCache.snapshot=original;
  await render();
  await act(async()=>host.querySelector<HTMLButtonElement>('.ui-help-pin')!.click());
  const older={...original,situation:{...original.situation,updated_at:new Date(Date.parse(original.situation.updated_at)-1000).toISOString()}};
  await act(async()=>helpCache.adopt!(older));expect(helpCache.saved).toHaveLength(0);
  await act(async()=>helpCache.adopt!({...original,session_id:'22222222-2222-4222-8222-222222222222'}));expect(helpCache.saved).toHaveLength(0);
  const next={...original,situation:{...original.situation,updated_at:new Date(Date.parse(original.situation.updated_at)+1000).toISOString()}};
  await act(async()=>helpCache.adopt!(next));
  expect(helpCache.saved).toHaveLength(1);expect(helpCache.saved[0].session_id).toBe(original.session_id);expect(helpCache.saved[0].situation.updated_at).toBe(next.situation.updated_at);
});
