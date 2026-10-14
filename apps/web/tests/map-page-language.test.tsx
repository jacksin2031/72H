// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('next/link',()=>({default:({children,...p}:React.ComponentProps<'a'>)=><a {...p}>{children}</a>}));
vi.mock('@/components/simulation-reference-map',()=>({SimulationReferenceMap:()=>null}));
vi.mock('@/components/official-hazard-panel',()=>({OfficialHazardPanel:()=>null}));
vi.mock('@/components/japan-shelter-panel',()=>({JapanShelterPanel:()=>null}));
vi.mock('@/components/disaster-map-panel',()=>({DisasterMapPanel:()=>null}));
vi.mock('@/components/designated-places-panel',()=>({DesignatedPlacesPanel:()=>null}));
vi.mock('@/components/evacuation-route-panel',()=>({EvacuationRoutePanel:()=>null}));
vi.mock('@/lib/use-simulation-geo',()=>({useSimulationGeo:()=>({location:null,state:'idle',clear:()=>{},request:()=>{}})}));
vi.mock('@/lib/use-disaster-map',()=>({useDisasterMap:()=>({})}));
vi.mock('@/lib/use-designated-places',()=>({useDesignatedPlaces:()=>({places:[]})}));
vi.mock('@/lib/official-hazards',()=>({loadOfficialHazardPack:()=>new Promise(()=>{}),officialPlaceLocation:()=>null}));
import JapanMapPage from '../app/map/page';
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();localStorage.clear();});
it('map page honours the saved language and renders full bleed',async()=>{
  localStorage.setItem('72h-language','ja');
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<JapanMapPage/>));
  expect([...host.querySelectorAll('nav.ui-tabs a')].map(a=>a.textContent)).toEqual(['今','地図','その他']);
  expect(host.querySelector('main')?.className).toContain('ui-main-full');
});
