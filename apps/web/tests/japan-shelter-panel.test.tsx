// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {resolve} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {JapanShelterPanel} from '../components/japan-shelter-panel';

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|null=null,container:HTMLDivElement|null=null;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());container?.remove();root=null;container=null;vi.unstubAllGlobals();});
async function render(corrupt=false){
  vi.stubGlobal('crypto',webcrypto);
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>new Response(corrupt?'[]':readFileSync(resolve('public',path.slice(1))))));
  const onPlaces=vi.fn(),onPlace=vi.fn(),onRegion=vi.fn();
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<JapanShelterPanel language="zh-TW" onPlaces={onPlaces} onPlace={onPlace} onRegion={onRegion}/>));
  await act(async()=>{await new Promise(r=>setTimeout(r,40));});
  return {onPlaces,onPlace,onRegion};
}
it('shows all 47 prefectures without fetching every pack or asking for GPS',async()=>{
  await render();
  expect(container!.querySelectorAll('[data-testid=shelter-prefecture] option')).toHaveLength(48);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(container!.textContent).toContain('目前開放及路線：未核實');
  expect(container!.textContent).toContain('指定避難所');
  expect(container!.querySelector('.national-shelter-list')).toBeNull();
});
it('loads selected-region points, bounds and a paged accessible list while preserving designation roles',async()=>{
  const {onPlaces,onRegion,onPlace}=await render();
  const select=container!.querySelector<HTMLSelectElement>('[data-testid=shelter-prefecture]')!;
  await act(async()=>{select.value='47';select.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,100));});
  expect(onRegion).toHaveBeenCalled();
  expect(onPlaces.mock.calls.at(-1)![0].length).toBeGreaterThan(0);
  expect(container!.querySelectorAll('.national-shelter-list > li')).toHaveLength(12);
  expect(container!.textContent).toContain('目前開放：未核實');
  const kind=container!.querySelector<HTMLSelectElement>('[data-testid=shelter-kind]')!;
  await act(async()=>{kind.value='SHELTER';kind.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(onPlaces.mock.calls.at(-1)![0].every((p:{kind:string})=>p.kind==='SHELTER')).toBe(true);
  const placeButton=container!.querySelector<HTMLButtonElement>('.national-shelter-list button')!;
  await act(async()=>placeButton.click());expect(onPlace).toHaveBeenCalledOnce();
  expect(container!.querySelector('a[href*="maps.google"]')).toBeNull();
});
it('shows retry and no selectable places when manifest verification fails',async()=>{
  const {onPlaces}=await render(true);
  expect(container!.querySelector('[role=alert]')!.textContent).toContain('無法驗證');
  expect(container!.querySelector('.national-shelter-list')).toBeNull();
  expect(onPlaces.mock.calls.at(-1)![0]).toEqual([]);
});
