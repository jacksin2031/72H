// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {PlanExplanationPanel} from '../components/plan-explanation-panel';
import {movementLiveSnapshot,LIVE_NOW} from './live-fixtures';
vi.mock('next/link',()=>({default:({children,...props}:React.ComponentProps<'a'>)=><a {...props}>{children}</a>}));
const mounted:{root:ReturnType<typeof createRoot>;host:HTMLDivElement}[]=[];
afterEach(async()=>{for(const m of mounted.splice(0)){await act(async()=>m.root.unmount());m.host.remove();}vi.unstubAllGlobals();vi.restoreAllMocks();});
async function mount(snapshot=movementLiveSnapshot(),language:'zh-TW'|'ja'|'en'='zh-TW'){
 vi.spyOn(Date,'now').mockReturnValue(LIVE_NOW);const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push({root,host});
 await act(async()=>root.render(<PlanExplanationPanel snapshot={snapshot} language={language}/>));return {root,host,snapshot};
}
const payload=(snapshot:ReturnType<typeof movementLiveSnapshot>,text:string)=>{
 const plan=snapshot.plans.find(p=>p.id===snapshot.situation.current_plan_id)!;
 return {plan_id:plan.id,plan_version:plan.version,binding:'b'.repeat(64),language:'zh-TW',mode:'GEMINI_ADK_EXPLANATION',
  created_at:new Date(LIVE_NOW).toISOString(),expires_at:new Date(LIVE_NOW+10000).toISOString(),paragraphs:[text],limitations:['沒有新增移動授權'],
  evidence_ids:[],fact_ids:[],action_ids:[],explanation_has_authority:false,reason_code:null};
};
it('drops late model wording after a plan mutation instead of showing old guidance',async()=>{
 let finish!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
 const {host,root,snapshot}=await mount();const old=payload(snapshot,'OLD MODEL WORDING');
 const changed=structuredClone(snapshot);changed.plans.find(p=>p.id===changed.situation.current_plan_id)!.status='INVALIDATED';
 await act(async()=>root.render(<PlanExplanationPanel snapshot={changed} language="zh-TW"/>));
 await act(async()=>finish(new Response(JSON.stringify(old))));
 expect(host.textContent).not.toContain('OLD MODEL WORDING');expect(host.textContent).toContain('目前沒有有效計劃');
});
it('clears a validated explanation on browser offline and never calls the model while offline',async()=>{
 const snapshot=movementLiveSnapshot(),fetcher=vi.fn(async()=>new Response(JSON.stringify(payload(snapshot,'CURRENT MODEL WORDING'))));vi.stubGlobal('fetch',fetcher);
 const {host}=await mount(snapshot);expect(host.textContent).toContain('CURRENT MODEL WORDING');
 await act(async()=>window.dispatchEvent(new Event('offline')));
 expect(host.textContent).not.toContain('CURRENT MODEL WORDING');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('requests replay explanations with the replay session id',async()=>{
 const snapshot=movementLiveSnapshot(),fetcher=vi.fn(async(_url:string)=>new Response(JSON.stringify(payload(snapshot,'REPLAY WORDING'))));vi.stubGlobal('fetch',fetcher);
 const {session_id:_,...rest}=snapshot as typeof snapshot&{session_id?:string};
 const replay={...rest,replay:{id:'11111111-2222-4333-8444-555555555555',current_time:new Date(LIVE_NOW).toISOString()}};
 vi.spyOn(Date,'now').mockReturnValue(LIVE_NOW);const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push({root,host});
 await act(async()=>root.render(<PlanExplanationPanel snapshot={replay} language="zh-TW" scope="replay"/>));
 expect(fetcher).toHaveBeenCalledTimes(1);
 expect(String(fetcher.mock.calls[0][0])).toBe('/api/replay/11111111-2222-4333-8444-555555555555/explanation');
});
