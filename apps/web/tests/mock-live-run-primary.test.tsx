// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()}),usePathname:()=>'/disaster-test'}));
vi.mock('../components/simulation-reference-map',()=>({SimulationReferenceMap:()=>null}));
vi.mock('../lib/area-resolution',()=>({resolveDeviceArea:vi.fn(async()=>({status:'RESOLVED',area_ids:['JP-MUNI-04202','JP-04','JP'],label:'石巻市'}))}));
import {MockLiveRun} from '../components/mock-live-run';
import {SimulationProvider} from '../lib/simulation-session';
import {defaultDisasterTest} from '../lib/disaster-test';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('never shows more than one primary button, including the launch button',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>[]})));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<SimulationProvider><MockLiveRun input={defaultDisasterTest} language="zh-TW" accessKey="k"/></SimulationProvider>));
  const primaries=()=>host.querySelectorAll('.ui-btn-primary, button.primary').length;
  expect(primaries()).toBe(1);
  await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('在地圖上選點'))!.click();});
  expect(primaries()).toBe(1);
  expect(host.querySelector('[data-testid=launch-full-simulation]')!.className).toContain('ui-btn-secondary');
});
