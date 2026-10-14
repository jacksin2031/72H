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
vi.mock('@/lib/official-hazards',()=>({loadOfficialHazardPack:()=>new Promise(()=>{}),officialPlaceLocation:()=>null}));
import JapanMapPage from '../app/map/page';
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();localStorage.clear();mapProps.length=0;});
async function render(){
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
  expect(host.querySelector('.ui-sheet-head')?.textContent).toBe('附近 0 處指定避難場所');
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
  expect(host.querySelector('.map-legend')?.textContent).toContain('浸水想定');
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
