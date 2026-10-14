// @vitest-environment jsdom
// The 311 exercise under a synthetic official tsunami trigger: envelope validity after a help report, the Now hero and the help panel.
// Fixtures are real Mock Live API responses (services/agent-api/tests/fixtures_gen_311_envelope.py), not hand-written snapshots.
import React,{act} from 'react';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mockLiveResponseSchema,type MockLiveResponse} from '../lib/mock-live-envelope';
import {SimulationScreens} from '../components/simulation-screens';
import {DistressPanel} from '../components/distress-panel';
import {distressText} from '../lib/distress';
import {exerciseHeroText} from '../lib/now-status';
import {defaultDisasterTest} from '../lib/disaster-test';
import {simulationAdviceText} from '../lib/simulation-advice';
import type {SimulationLaunch} from '../lib/simulation-session';

vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock('../components/simulation-reference-map',()=>({SimulationReferenceMap:()=>null}));
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

const read=(name:string)=>JSON.parse(readFileSync(resolve(__dirname,'fixtures',name),'utf8'));
const final=()=>mockLiveResponseSchema.parse(read('mock-live-311-final.json'));
const afterReport=()=>mockLiveResponseSchema.parse(read('mock-live-311-after-report.json'));
const serverNow=(state:MockLiveResponse)=>Date.parse(state.snapshot.situation.updated_at);
const t=distressText['zh-TW'];

let root:Root|null=null;let el:HTMLDivElement|null=null;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());el?.remove();root=null;el=null;vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function mount(node:React.ReactNode){el=document.createElement('div');document.body.append(el);root=createRoot(el);await act(async()=>root!.render(node));}

describe('recorded 311 envelope (P3)',()=>{
  it('accepts the completed response and the same-session response after a help report',()=>{
    const before=mockLiveResponseSchema.safeParse(read('mock-live-311-final.json'));
    expect(before.success).toBe(true);
    const after=mockLiveResponseSchema.safeParse(read('mock-live-311-after-report.json'));
    if(!after.success)console.log(after.error.issues);
    expect(after.success).toBe(true);
  });
  it('binds the current assessment to the new plan and keeps the superseded one and all plan versions',()=>{
    const before=final(),after=afterReport();
    expect(after.movement_assessment?.plan_id).toBe(after.snapshot.situation.current_plan_id);
    expect(after.movement_assessment_history.map(a=>a.step)).toEqual([1,2,3,4]);
    expect(after.movement_assessment_superseded).toContainEqual(before.movement_assessment);
    expect(after.snapshot.plans.map(p=>p.id).slice(0,before.snapshot.plans.length)).toEqual(before.snapshot.plans.map(p=>p.id));
  });
  it('still rejects an assessment bound to another plan (the client check is not loosened)',()=>{
    const raw=read('mock-live-311-after-report.json');
    raw.movement_assessment={...raw.movement_assessment,plan_id:'plan_v1'};
    raw.movement_assessment_history[raw.movement_assessment_history.length-1]=raw.movement_assessment;
    expect(mockLiveResponseSchema.safeParse(raw).success).toBe(false);
  });
});

describe('exerciseHeroText',()=>{
  const messages={awaiting:'AWAITING',waiting:'WAITING'};
  const base={started:true,now:0,language:'zh-TW' as const,planNowIntent:null,safetyCoreNowText:'',adviceText:simulationAdviceText['zh-TW'].UNKNOWN,messages};
  it('puts the Safety Core tsunami instruction above an UNKNOWN Gemini assessment',()=>{
    const state=final();
    expect(exerciseHeroText({...base,distress:state.snapshot.distress,now:serverNow(state)})).toBe(t.vertical);
  });
  it('keeps the protective instruction (never a destination) for a tsunami NOW plan whose trigger has expired',()=>{
    const state=final();
    const later=Date.parse(state.snapshot.distress.trigger_expires_at!)+1;
    expect(exerciseHeroText({...base,distress:state.snapshot.distress,now:later,planNowIntent:'tsunami_evacuate_now'})).toBe(t.vertical);
  });
  it('prefers an allowed Safety Core NOW action and otherwise leaves the Gemini reference in place',()=>{
    const state=afterReport();
    expect(exerciseHeroText({...base,distress:state.snapshot.distress,now:serverNow(state),safetyCoreNowText:'CORE'})).toBe('CORE');
    expect(exerciseHeroText({...base,distress:null})).toBe(simulationAdviceText['zh-TW'].UNKNOWN);
    expect(exerciseHeroText({...base,distress:null,started:false})).toBe('AWAITING');
  });
});

function launch(state:MockLiveResponse):SimulationLaunch{
  return {input:{...defaultDisasterTest,kind:'EARTHQUAKE'},language:'zh-TW',accessKey:'local-test-access-key',historicalCase:'tohoku-2011',
    title:'311',milestones:state.historical!.milestones,timeMode:'FAST_RANGE',acceleratedStart:'',acceleration:600,startJst:'',endJst:'',
    conditions:{site:'COASTAL_LOWLAND',shaking:'AFTER',building:'UNKNOWN',shelter:'UNKNOWN',high_ground:'UNKNOWN',route:'UNKNOWN'}};
}

describe('/simulation Now hero (behaviour 4)',()=>{
  it('shows the Safety Core tsunami instruction while the Gemini assessment is UNKNOWN, and keeps the 演練 band',async()=>{
    const state=final();
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(serverNow(state));
    expect(state.snapshot.distress.level).toBe('OFFICIAL_TSUNAMI');
    expect(state.movement_assessment?.decision).toBe('UNKNOWN');
    await mount(<SimulationScreens config={launch(state)} phase="completed" tab="home" setTab={vi.fn()} time={serverNow(state)} speed={1}
      state={state} done={state.current_step} processing={false} error="" leave={vi.fn()}/>);
    const hero=el!.querySelector('[data-now=hero]')!;
    expect(hero.textContent).toBe(t.vertical);
    expect(hero.className).toContain('now-hero-danger');
    expect(el!.textContent).toContain('演練');
    // NEXT / AVOID are the tsunami follow-ups, not the return-trip template.
    expect(el!.querySelector('[data-now=next]')?.textContent).toContain('高處');
    expect(el!.textContent).not.toContain('返程');
    // The Gemini assessment block stays as a supplementary reference.
    expect(el!.querySelector('[data-testid=simulation-location-decision]')?.textContent).toContain('無法判定');
  });
});

describe('help panel under the synthetic trigger (behaviour 5)',()=>{
  it('leads with the tsunami instruction before any report, labelled as an exercise',async()=>{
    const state=final();
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
    await mount(<DistressPanel snapshot={state.snapshot} language="zh-TW" scope="mock-live" accessKey="k" location={null} places={[]} graph={null}
      sosProfile={{contacts:[],needsAssistance:false,mobilityLimited:false}} onSnapshot={vi.fn()} now={serverNow(state)}/>);
    const primary=el!.querySelector('[data-testid=distress-primary] .distress-primary-text')!.textContent!;
    expect(primary).not.toContain(t.chooseSituation);
    expect([t.vertical,t.verticalNow]).toContain(primary.trim());
    expect(el!.querySelector('[data-testid=distress-exercise]')).not.toBeNull();
    expect(el!.querySelector('[data-testid=distress-basis]')?.textContent).toMatch(/^演練／模擬 · /);
  });
});

describe('Live client contract with tsunami evidence',()=>{
  it('accepts evidence backed by the projected tsunami official source, and still rejects an unprojected source key',async()=>{
    const {liveSnapshotSchema}=await import('../lib/contracts');
    const raw=read('mock-live-311-final.json').snapshot;
    // The same structural substitution the Mock Live contract uses; Live itself never carries synthetic data.
    const live={...raw,source:{...raw.source,source_url:'https://example.invalid/jma'},
      destination_source:{...raw.destination_source,source_url:'https://example.invalid/d'},route_source:{...raw.route_source,source_url:'https://example.invalid/r'},
      official_sources:raw.official_sources.map((s:{source_url:string})=>({...s,source_url:'https://example.invalid/o'})),
      events:raw.events.map((e:object)=>({...e,is_synthetic:false})),evidence:raw.evidence.map((e:object)=>({...e,is_synthetic:false}))};
    expect(live.evidence.some((e:{source_key:string})=>e.source_key==='jma-live-tsunami')).toBe(true);
    expect(liveSnapshotSchema.safeParse(live).success).toBe(true);
    const orphan={...live,official_sources:live.official_sources.filter((s:{source_key:string})=>s.source_key!=='jma-live-tsunami')};
    expect(liveSnapshotSchema.safeParse(orphan).success).toBe(false);
  });
});
