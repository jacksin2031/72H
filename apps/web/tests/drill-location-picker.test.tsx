// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../lib/area-resolution',()=>({resolveDeviceArea:vi.fn(async()=>({status:'RESOLVED',area_ids:['JP-MUNI-04202','JP-04','JP'],label:'石巻市'}))}));
vi.mock('../components/simulation-reference-map',()=>({SimulationReferenceMap:(p:{onReferencePoint?:(x:{lat:number;lng:number})=>void})=>
  <button data-testid="fake-map" onClick={()=>p.onReferencePoint?.({lat:38.9,lng:141.57})}>map</button>}));
import {DrillLocationPicker} from '../components/drill-location-picker';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();localStorage.clear();});
const mount=async(props:Partial<React.ComponentProps<typeof DrillLocationPicker>>={})=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);const onChange=vi.fn();
  await act(async()=>root.render(<DrillLocationPicker language="zh-TW" caseId="tohoku-2011" value={null} onChange={onChange} {...props}/>));return onChange;};
const click=async(text:string)=>act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(text))!.click();});

it('offers the case presets and emits a USER_SELECTED location without coordinates',async()=>{
  const onChange=await mount();await click('石巻・門脇');
  const [point,location,label]=onChange.mock.calls.at(-1)!;
  expect(point).toMatchObject({source:'PRESET',preset_id:'tohoku-ishinomaki-kadonowaki'});
  expect(location).toMatchObject({source:'USER_SELECTED',area_ids:['JP-MUNI-04202','JP-04','JP']});expect(label).toBe('石巻市');
});
it('map pick requires confirming the tapped point',async()=>{
  const onChange=await mount();await click('在地圖上選點');
  await act(async()=>(host.querySelector('[data-testid=fake-map]') as HTMLButtonElement).click());
  expect(onChange).not.toHaveBeenCalled();await click('使用這個位置');
  expect(onChange.mock.calls.at(-1)![0]).toMatchObject({source:'MAP_PICK',lat:38.9,lng:141.57});
});
it('device location reads once and maps to USER_SELECTED with real accuracy',async()=>{
  const geolocate=vi.fn(async()=>({lat:38.43,lng:141.30,accuracy_m:10}));const onChange=await mount({geolocate});await click('我的目前位置');
  expect(geolocate).toHaveBeenCalledTimes(1);expect(onChange.mock.calls.at(-1)![1]).toMatchObject({source:'USER_SELECTED'});
});
it('collapses to one summary line once a point is chosen and never writes Live storage',async()=>{
  await mount({value:{lat:38.4196,lng:141.2946,source:'PRESET',preset_id:'tohoku-ishinomaki-kadonowaki',label:{ja:'石巻・門脇','zh-TW':'石巻・門脇',en:'x'}}});
  expect(host.textContent).toContain('石巻・門脇 · 演練位置');expect(host.querySelectorAll('button').length).toBeLessThanOrEqual(2);
  expect(Object.keys(localStorage)).toEqual([]);
});
it('shows a clear message when the point is outside Japan municipalities',async()=>{
  const {resolveDeviceArea}=await import('../lib/area-resolution');
  vi.mocked(resolveDeviceArea).mockResolvedValueOnce({status:'OUTSIDE',area_ids:[],label:''});
  const onChange=await mount();await click('石巻・門脇');
  expect(host.textContent).toContain('此位置不在日本的市區町村範圍內');expect(onChange).not.toHaveBeenCalled();
});
it('shows exactly one primary button only while the map view is open',async()=>{
  await mount();expect(host.querySelectorAll('.ui-btn-primary').length).toBe(0);
  await click('在地圖上選點');expect(host.querySelectorAll('.ui-btn-primary').length).toBe(1);
});
it('shows the unavailable message for UNAVAILABLE and AMBIGUOUS',async()=>{
  const {resolveDeviceArea}=await import('../lib/area-resolution');
  for(const status of ['UNAVAILABLE','AMBIGUOUS'] as const){
    vi.mocked(resolveDeviceArea).mockResolvedValueOnce({status,area_ids:[],label:''} as never);
    const onChange=await mount();await click('石巻・門脇');
    expect(host.textContent).toContain('無法判斷此位置所屬的市區町村');expect(onChange).not.toHaveBeenCalled();
    await act(async()=>root.unmount());host.remove();
  }
  await mount();
});
it('shows geoFailed when the device read fails',async()=>{
  const onChange=await mount({geolocate:async()=>{throw new Error('denied');}});await click('我的目前位置');
  expect(host.textContent).toContain('無法取得目前位置');expect(onChange).not.toHaveBeenCalled();
});
it('does not crash for an unknown case id and shows no presets',async()=>{
  await mount({caseId:'unknown-case' as never});expect(host.querySelectorAll('.ui-chip').length).toBe(0);expect(host.textContent).toContain('在地圖上選點');
});
it('clears the map-open flag on unmount',async()=>{
  const open=vi.fn();await mount({onMapOpenChange:open});await click('在地圖上選點');expect(open).toHaveBeenLastCalledWith(true);
  await act(async()=>root.unmount());expect(open).toHaveBeenLastCalledWith(false);
  host.remove();await mount();
});
