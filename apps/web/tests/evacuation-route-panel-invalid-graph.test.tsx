// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';

vi.mock('../lib/evacuation-road-graph',async orig=>({...await orig<typeof import('../lib/evacuation-road-graph')>(),
  loadEvacuationRoadGraph:vi.fn(async()=>({manifest:{reviewed_at:'2026-10-13T16:13:38+09:00',review_due_at:'2027-01-11T16:13:38+09:00'},nodes:[],ways:[],edges:[]})),
  ishinomakiReferenceGraph:vi.fn(()=>{throw new Error('Road graph pack does not match the pinned Ishinomaki manifest');})}));
const {EvacuationRoutePanel}=await import('../components/evacuation-route-panel');

let root:ReturnType<typeof createRoot>|null=null,host:HTMLDivElement|null=null;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();root=null;host=null;});

it('shows "road data unverified", not "no route", when the loaded pack fails the reference-graph checks',async()=>{
  const state={hazard:'ALL',setHazard:()=>{},pack:null,opening:null,connected:true,now:Date.parse('2026-10-13T16:20:00+09:00'),resumeAt:null} as never;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<EvacuationRoutePanel language="zh-TW" state={state} origin={null} onOrigin={()=>{}} onFocus={()=>{}} onRoute={()=>{}}/>));
  await vi.waitFor(()=>expect(host!.textContent).not.toContain('正在核對道路資料'));
  expect(host.textContent).toContain('道路資料未配置或未能驗證');
  expect(host.textContent).not.toContain('未能產生道路候選');
  const trial=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='使用試點示例起點（非 GPS）')!;
  expect(trial.disabled).toBe(true);
});
