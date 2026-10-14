// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulationScreens, type SimulationSection } from '../components/simulation-screens';
import { defaultDisasterTest } from '../lib/disaster-test';
import type { SimulationLaunch } from '../lib/simulation-session';

vi.mock('../components/simulation-reference-map', () => ({
  SimulationReferenceMap: () => <div data-testid="stub-map">Verified reference map placeholder</div>,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const quake = {
  at_jst: '2011-03-11T14:46:00+09:00',
  kind: 'EARTHQUAKE',
  label: { ja:'地震', en:'Earthquake', 'zh-TW':'地震' },
  source_url:'https://www.jma.go.jp/',
  historic_observation:true, fed_to_safety_core:true,
};
const tsunami = {
  ...quake, at_jst:'2011-03-11T14:49:00+09:00',
  kind:'TSUNAMI_WARNING',fed_to_safety_core:false,
  label:{ ja:'津波警報',en:'Tsunami warning','zh-TW':'海嘯警報' },
};
const config:SimulationLaunch = {
  input:{...defaultDisasterTest,kind:'EARTHQUAKE'},language:'zh-TW',
  accessKey:'local-test-access-key',
  historicalCase:'tohoku-2011', title:'311 東日本大震災',
  milestones:[quake,tsunami],timeMode:'REALTIME',acceleratedStart:'2011-03-11T13:46',
  acceleration:600,startJst:'2011-03-11T14:46',endJst:'2011-03-11T14:49',
};
function Harness({done=1}:{done?:number}) {
  const [tab,setTab]=useState<SimulationSection>('map');
  return <SimulationScreens config={config} phase="running" tab={tab} setTab={setTab}
    time={Date.parse('2011-03-11T14:49:00+09:00')} speed={1} done={done}
    state={null} processing={false} error="" leave={()=>{}}/>;
}
let root:Root|null=null;let el:HTMLDivElement|null=null;
afterEach(async()=>{
 if(root) await act(async()=>root!.unmount());
 root=null;el?.remove();el=null;
 vi.unstubAllGlobals();
});
async function render(done:number){
 el=document.createElement('div');document.body.append(el);
 root=createRoot(el);
 await act(async()=>root!.render(<Harness done={done}/>));
 // The exercise map uses the shared MapScreen sheet (same component as /map).
 const sheet=el.querySelector<HTMLElement>('[data-testid="simulation-map-screen"] .ui-sheet');
 const button=el.querySelector<HTMLButtonElement>('[data-testid="simulation-map-screen"] .ui-sheet-head');
 if(!sheet||!button)throw Error('Map risk panel or toggle absent');
 return {sheet,button};
}
describe('P2.1 map-first risk panel',()=>{
 it('defaults to compact map view and expands into a fully detailed GPS/risk panel on demand',async()=>{
  const {sheet,button}=await render(1);
  expect(sheet.hasAttribute('data-open')).toBe(false);
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(el!.querySelector('[data-testid=simulation-risk-panel]')).toBeNull();
  expect(sheet.textContent).toContain('安全性：無法判定');
  expect(sheet.textContent).toContain('沒有已核實避難所或安全路線');
  await act(async()=>button.click());
  expect(sheet.hasAttribute('data-open')).toBe(true);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(el!.querySelector('[data-testid=simulation-risk-panel]')).not.toBeNull();
  expect(el!.querySelector('[data-testid=simulation-request-gps]')).not.toBeNull();
  expect(el!.querySelector('a[href^="tel:"]')).toBeNull();
  await act(async()=>button.click());
  expect(sheet.hasAttribute('data-open')).toBe(false);
  expect(el!.querySelector('[data-testid=simulation-risk-panel]')).toBeNull();
 });
 it('a played tsunami warning is conspicuous even when the bottom sheet is collapsed',async()=>{
  const {sheet,button}=await render(2);
  expect(button.getAttribute('aria-expanded')).toBe('false');
  // Conspicuous like a live alert: the red band names the played level, and the collapsed sheet line says safety is unverified.
  const band=el!.querySelector('.ui-band-danger');
  expect(band).not.toBeNull();
  expect(band?.getAttribute('role')).toBe('status');
  expect(band?.textContent).toContain('海嘯警報');
  const status=sheet.querySelector('.ui-sheet-head');
  expect(status?.textContent).toContain('歷史海嘯警報已發生');
  expect(status?.textContent).toContain('尚未確認避難安全');
  expect(el!.querySelector('[data-testid=simulation-risk-panel]')).toBeNull();
  expect(sheet.hasAttribute('data-open')).toBe(false);
 });
});

it('I2: simulation Map and More can open help before a session exists, with the same mounted panel',async()=>{
  await render(1);
  await act(async()=>el!.querySelector<HTMLButtonElement>('.ui-help-pin:not([hidden])')!.click());
  const panel=el!.querySelector('[role=dialog]')!;
  expect(panel).not.toBeNull();
  await act(async()=>el!.querySelectorAll<HTMLButtonElement>('nav.ui-tabs button')[2].click());
  expect(el!.querySelector('[role=dialog]')).toBe(panel);
  await act(async()=>panel.querySelector<HTMLButtonElement>('button')!.click());
  expect(el!.querySelector('.ui-help-pin:not([hidden])')).not.toBeNull();
  expect(el!.querySelector('[data-testid=simulation-settings]')).not.toBeNull();
});
