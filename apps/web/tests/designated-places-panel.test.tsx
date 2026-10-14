// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it,vi,afterEach} from 'vitest';

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|null=null,host:HTMLDivElement|null=null;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();root=null;host=null;vi.unstubAllGlobals();vi.restoreAllMocks();});
async function render(){
  const module=await import('../components/designated-places-panel').catch(()=>null);
  const hook=await import('../lib/use-designated-places').catch(()=>null);
  expect(module,'Designation panel missing').not.toBeNull();expect(hook,'Designation hook missing').not.toBeNull();
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.startsWith('/hazards/')?new Response(readFileSync(resolve('public'+path))):
    new Response(JSON.stringify({mode:'LIVE_REFERENCE',area_id:'JP-MUNI-04202',generated_at:new Date().toISOString(),fetched_at:null,source_status:'UNCONFIGURED',records:[],authority:'REFERENCE_ONLY',safe_location_verified:false,route_authorized:false}))));
  const Panel=module!.DesignatedPlacesPanel;
  function Fixture(){const state=hook!.useDesignatedPlaces();return <><output data-testid="mapped">{state.places.length}</output><Panel language="zh-TW" state={state} onPlace={()=>{}}/></>;}
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<Fixture/>));
  // Real asset promises + SHA verification complete asynchronously.
  await vi.waitFor(()=>expect(host!.querySelector('[data-testid="mapped"]')!.textContent).toBe('395'));
  await act(async()=>{});
}
it('filters map and list together, distinguishes roles and retains opening uncertainty',async()=>{
  await render();expect(host!.textContent).toContain('目前開放：未核實');
  expect(host!.querySelector('h1,h2')).toBeNull(); // sheet content: the Section supplies the title
  const select=host!.querySelector<HTMLSelectElement>('select[aria-label="災害類別"]')!;
  await act(async()=>{select.value='tsunami';select.dispatchEvent(new Event('change',{bubbles:true}));});
  const count=Number(host!.querySelector('[data-testid="mapped"]')!.textContent);
  expect(count).toBeGreaterThan(0);expect(count).toBeLessThan(300);
  expect(host!.querySelector('.hazard-place-list')!.textContent).not.toContain('指定避難所 ·');
  expect(host!.textContent).toContain('路線：未核實');
});
it('GeoJSON missing common IDs and an unavailable earthquake tile stay explicit',async()=>{
  await render();const format=host!.querySelector<HTMLSelectElement>('select[aria-label="場所資料格式"]')!;
  await act(async()=>{format.value='GeoJSON';format.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(host!.textContent).toContain('沒有共通 ID');
  expect(host!.querySelector('[data-testid="mapped"]')!.textContent).toBe('159');
  const hazard=host!.querySelector<HTMLSelectElement>('select[aria-label="災害類別"]')!;
  await act(async()=>{hazard.value='earthquake';hazard.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(host!.querySelector('[data-testid="mapped"]')!.textContent).toBe('0');
  expect(host!.textContent).toContain('404');expect(host!.textContent).toContain('不能推論沒有場所');
});
