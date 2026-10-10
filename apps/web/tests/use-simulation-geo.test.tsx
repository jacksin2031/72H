// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSimulationGeo } from '../lib/use-simulation-geo';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const time=Date.parse('2026-10-10T13:00:00Z');
function Harness() {
 const geo=useSimulationGeo();
 return <div>
  <button type="button" onClick={geo.request}>get</button>
  <button type="button" onClick={geo.clear}>clear</button>
  <strong data-testid="state">{geo.state}</strong>
  <small data-testid="gps">{geo.location?.lat??'none'}</small>
 </div>;
}
let root:Root|null=null;
let el:HTMLDivElement|null=null;
afterEach(async()=>{
 if(root) await act(async()=>root!.unmount());
 el?.remove();root=null;el=null;vi.useRealTimers();vi.unstubAllGlobals();localStorage.clear();
});
const mount=async()=>{
 el=document.createElement('div');document.body.append(el);
 root=createRoot(el);
 await act(async()=>root!.render(<Harness/>));
};
describe('private opt-in GPS in synthetic drill',()=>{
 it('never requests geolocation before explicit user action and never persists or posts it',async()=>{
  vi.useFakeTimers();vi.setSystemTime(time);
  const locate=vi.fn((ok:(v:unknown)=>void)=>ok({timestamp:time,coords:{
    latitude:35.69,longitude:139.75,accuracy:20,
  }}));
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:locate}});
  const setter=vi.spyOn(Storage.prototype,'setItem');
  const network=vi.fn();vi.stubGlobal('fetch',network);
  await mount();
  expect(locate).not.toHaveBeenCalled();
  expect(el!.querySelector('[data-testid=gps]')?.textContent).toBe('none');
  await act(async()=>el!.querySelector('button')!.click());
  expect(locate).toHaveBeenCalledTimes(1);
  expect(el!.querySelector('[data-testid=gps]')?.textContent).toBe('35.69');
  expect(setter).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  await act(async()=>el!.querySelectorAll('button')[1].click());
  expect(el!.querySelector('[data-testid=gps]')?.textContent).toBe('none');
  setter.mockRestore();
 });
 it('drops GPS on accuracy failure and after two minutes',async()=>{
  vi.useFakeTimers();vi.setSystemTime(time);
  let accept:(v:unknown)=>void=()=>{};
  const locate=vi.fn((ok:(v:unknown)=>void)=>{accept=ok});
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:locate}});
  await mount();
  await act(async()=>el!.querySelector('button')!.click());
  await act(async()=>accept({timestamp:time,coords:{latitude:35.69,longitude:139.75,accuracy:1200}}));
  expect(el!.querySelector('[data-testid=state]')?.textContent).toBe('error');
  await act(async()=>el!.querySelector('button')!.click());
  await act(async()=>accept({timestamp:time,coords:{latitude:35.69,longitude:139.75,accuracy:20}}));
  expect(el!.querySelector('[data-testid=state]')?.textContent).toBe('ready');
  await act(async()=>vi.advanceTimersByTimeAsync(135000));
  expect(el!.querySelector('[data-testid=gps]')?.textContent).toBe('none');
 });
});
