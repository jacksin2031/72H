// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,expect,it} from 'vitest';
import {SimulationRiskPanel} from '../components/simulation-risk-panel';
import {documentedEpicenters,screenGeoExposure} from '../lib/geospatial-exposure';

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const now=Date.parse('2026-10-10T13:00:00Z');
async function render(active:boolean){
 const node=document.createElement('div');document.body.append(node);
 const root=createRoot(node);
 const assessment=screenGeoExposure({
  now,location:{lat:35.6895,lng:139.6917,accuracy_m:18,captured_at:now,source:'BROWSER_GEOLOCATION'},
  epicenter:documentedEpicenters['tohoku-2011'],tsunamiWarningActive:active,
 });
 await act(async()=>root.render(<SimulationRiskPanel language="zh-TW" assessment={assessment}
  gpsState="ready" gpsError="" requestLocation={()=>{}} clearLocation={()=>{}}/>));
 return {node,root};
}
describe('tsunami UI cannot certify safe locations from distance',()=>{
 it('explicitly tells the user that a historical warning has occurred only after playback',async()=>{
  const before=await render(false);
  expect(before.node.textContent).toContain('模擬的海嘯警報尚未發生');
  expect(before.node.textContent).toContain('無法判定');
  expect(before.node.querySelector('.sim-risk-tsunami-on')).toBeNull();
  await act(async()=>before.root.unmount());before.node.remove();
  const after=await render(true);
  expect(after.node.textContent).toContain('歷史模擬海嘯警報已發生');
  expect(after.node.querySelector('.sim-risk-tsunami-on')).not.toBeNull();
  expect(after.node.textContent).toContain('未有可核實的開放狀態');
  expect(after.node.textContent).toContain('不能推算震度或證明安全');
  expect(after.node.querySelector('a[href^="tel:"]')).toBeNull();
  await act(async()=>after.root.unmount());after.node.remove();
 });
});
