// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {SimulationLocationControls} from '../components/simulation-location-controls';
import {SimulationScreens} from '../components/simulation-screens';
import {defaultSimulationConditions,simulationAssessmentSchema,simulationLimits,type SimulationLocation} from '../lib/simulation-advice';
import {defaultDisasterTest} from '../lib/disaster-test';
import type {MockLiveResponse} from '../lib/mock-live-envelope';
import type {DrillPoint} from '../lib/drill-location';
import * as area from '../lib/area-resolution';
import {SimulationAdvicePanel} from '../components/simulation-advice-panel';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock('../components/simulation-reference-map',()=>({SimulationReferenceMap:()=>null}));
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|null=null;let el:HTMLDivElement|null=null;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());el?.remove();root=null;el=null;vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mount(node:React.ReactNode){el=document.createElement('div');document.body.append(el);root=createRoot(el);await act(async()=>root!.render(node));}

it('keeps basic assistance visible even without model or location evidence',async()=>{
  await mount(<SimulationAdvicePanel advice={null} language="zh-TW" cannotMove/>);
  expect(el!.querySelector('[data-testid=simulation-location-decision]')?.textContent).toContain('無法判定');
  expect(el!.querySelector('[data-testid=simulation-basic-assistance]')?.textContent).toContain('請求協助');
  expect(el!.querySelector('[data-testid=simulation-ai-mode]')?.textContent).toContain('尚未執行');
});

it('resolves opt-in current location locally and exposes only canonical area IDs to launch',async()=>{
  const now=Date.now();
  const locate=vi.fn((ok:(v:unknown)=>void)=>ok({timestamp:now,coords:{latitude:38.43,longitude:141.30,accuracy:10}}));
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:locate}});
  const resolver=vi.spyOn(area,'resolveDeviceArea').mockResolvedValue({status:'RESOLVED',area_ids:['JP-MUNI-04202','JP-04','JP'],label:'石巻市'});
  const save=vi.spyOn(Storage.prototype,'setItem');const network=vi.fn();vi.stubGlobal('fetch',network);
  const received=vi.fn();
  function Harness(){const [location,set]=useState<SimulationLocation|null>(null);const [point,setPoint]=useState<DrillPoint|null>(null);
    return <SimulationLocationControls language="zh-TW" location={location} conditions={defaultSimulationConditions} caseId="tohoku-2011" drillPoint={point}
    onLocation={v=>{set(v);received(v);}} onDrillPoint={setPoint} onConditions={()=>{}}/>;}
  await mount(<Harness/>);expect(locate).not.toHaveBeenCalled();
  await act(async()=>[...el!.querySelectorAll('button')].find(b=>b.textContent?.includes('我的目前位置'))!.click());
  expect(locate).toHaveBeenCalledTimes(1);
  expect(resolver).toHaveBeenCalledWith({latitude:38.43,longitude:141.30,accuracy_m:0});
  expect(received).toHaveBeenLastCalledWith(expect.objectContaining({area_ids:['JP-MUNI-04202','JP-04','JP'],source:'GPS'}));
  expect(network).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});

it('suppresses old Gemini advice while processing, after offline and after reconnect',async()=>{
  const now=Date.now();const assessment=simulationAssessmentSchema.parse({authority:'SIMULATION_REFERENCE_ONLY',version:'a'.repeat(64),session_id:'TEST',step:1,plan_id:null,
    decision:'STAY_PROTECT',allowed_decisions:['STAY_PROTECT','UNKNOWN'],area_ids:['JP-04','JP'],area_label:'宮城県',location_source:'USER_SELECTED',
    location_observed_at:new Date(now).toISOString(),created_at:new Date(now).toISOString(),expires_at:new Date(now+300000).toISOString(),
    facts:[{id:'LOCATION',value:'TEST_ONLY'}],fact_ids:['LOCATION'],limitation_ids:simulationLimits,ai_mode:'GEMINI_ADK',reason_code:null,route_authorized:false,safe_location_verified:false});
  const state={current_step:1,ai_modes:[],snapshot:{session_id:'TEST',plans:[],plan_actions:[],evidence:[],situation:{current_plan_id:null}},movement_assessment:assessment} as unknown as MockLiveResponse;
  const config={input:defaultDisasterTest,language:'zh-TW' as const,accessKey:'TEST',historicalCase:null,title:'TEST',milestones:[],timeMode:'FAST_RANGE' as const,acceleration:600 as const,acceleratedStart:'',startJst:'',endJst:'',conditions:defaultSimulationConditions};
  const props={config,phase:'completed' as const,tab:'home' as const,setTab:vi.fn(),time:now,speed:1,state,done:1,error:'',leave:vi.fn()};
  await mount(<SimulationScreens {...props} processing={false}/>);
  expect(el!.querySelector('[data-testid=simulation-location-decision]')?.textContent).toBe('原地防護');
  await act(async()=>root!.render(<SimulationScreens {...props} processing/>));
  expect(el!.querySelector('[data-testid=simulation-location-decision]')?.textContent).toContain('無法判定');
  await act(async()=>root!.render(<SimulationScreens {...props} processing={false}/>));
  await act(async()=>window.dispatchEvent(new Event('offline')));
  await act(async()=>window.dispatchEvent(new Event('online')));
  expect(el!.querySelector('[data-testid=simulation-location-decision]')?.textContent).toContain('無法判定');
  expect(el!.querySelector('[data-testid=simulation-ai-mode]')?.textContent).toContain('最近一次執行');
  expect(el!.querySelector('[data-testid=simulation-advice-unavailable]')?.textContent).toContain('無法判定');
});
