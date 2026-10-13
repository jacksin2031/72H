// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DistressPanel} from '../components/distress-panel';
import {distressText,tagText} from '../lib/distress';
import type {DistressStatus,DistressTag} from '../lib/contracts';
import type {DesignatedPlace} from '../lib/designated-places';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const t=distressText['zh-TW'],tags=tagText['zh-TW'];
const NOW=Date.parse('2026-10-13T08:00:00Z');
const site=(id:string,lat:number)=>({id:`emergency_site:${id}`,kind:'EMERGENCY_SITE',name:`測試場所${id}`,lat,lng:141.3,hazards:{tsunami:'DESIGNATED'}} as unknown as DesignatedPlace);
const places=[site('NEAR',38.4330),site('NEXT',38.4345)];
const origin={lat:38.43,lng:141.3,accuracy_m:10};
const empty={contacts:[],needsAssistance:false,mobilityLimited:false};
const status=(over:Partial<DistressStatus>={}):DistressStatus=>({level:'NONE',reports:[],trigger_evidence_ids:[],deadline_at:null,ai_escalated:false,synthetic:false,warning_class:null,last_official_at:null,trigger_expires_at:null,...over});
const tsunami=(minutes:number,over:Partial<DistressStatus>={})=>status({level:'OFFICIAL_TSUNAMI',trigger_evidence_ids:['ev-1'],deadline_at:new Date(NOW+minutes*60_000).toISOString(),...over});
const mounted:{root:ReturnType<typeof createRoot>;host:HTMLDivElement}[]=[];
const json=(body:unknown,code=200)=>new Response(JSON.stringify(body),{status:code,headers:{'Content-Type':'application/json'}});
let speak:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  try{localStorage.clear();}catch{/* */}
  speak=vi.fn();vi.stubGlobal('speechSynthesis',{speak,cancel:vi.fn()});
  vi.stubGlobal('SpeechSynthesisUtterance',class{text:string;lang='';constructor(text:string){this.text=text;}});
});
afterEach(async()=>{for(const m of mounted.splice(0)){await act(async()=>m.root.unmount());m.host.remove();}vi.useRealTimers();vi.unstubAllGlobals();});
const nav=(extra:Record<string,unknown>)=>{const o=Object.create(navigator);for(const [k,v] of Object.entries({onLine:true,...extra}))Object.defineProperty(o,k,{value:v,configurable:true});vi.stubGlobal('navigator',o);};
type Props=Parameters<typeof DistressPanel>[0];
function props(over:Partial<Props>={}):Props{
  return {snapshot:{distress:status(),replay:{id:'r1'}},language:'zh-TW',scope:'replay',location:origin,places,graph:null,sosProfile:empty,onSnapshot:vi.fn(),now:NOW,...over};
}
async function mount(p:Props){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push({root,host});
  await act(async()=>root.render(<DistressPanel {...p}/>));
  return {host,rerender:async(next:Props)=>act(async()=>root.render(<DistressPanel {...next}/>))};
}
const button=(host:HTMLElement,text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===text);
const primary=(host:HTMLElement)=>host.querySelector<HTMLElement>('[data-testid="distress-primary"]')!;
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,5));});

it('works offline with the seven buttons: local level-1 text, no extract, recording disabled with a reason',async()=>{
  nav({onLine:false});const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  const {host}=await mount(props());
  const tagButtons=(Object.values(tags) as string[]).map(label=>button(host,label));
  expect(tagButtons.every(b=>b&&!b.disabled)).toBe(true);
  await act(async()=>button(host,tags.WATER_RISING)!.click());
  await act(async()=>button(host,t.send)!.click());
  expect(primary(host).textContent).toContain(t.vertical);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(button(host,t.record)!.disabled).toBe(true);
  expect(host.textContent).toContain(t.voiceNeedsNetwork);
});

it('records at most 30 s, releases the mic, and only reports AI tags after the person confirms them',async()=>{
  nav({});
  const track={stop:vi.fn()},stream={getTracks:()=>[track]};
  nav({mediaDevices:{getUserMedia:vi.fn(async()=>stream)}});
  class Rec{static isTypeSupported=(m:string)=>m==='audio/webm';state='inactive';mimeType='audio/webm';
    ondataavailable:((e:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;
    start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array([1,2,3])],{type:'audio/webm'})});this.onstop?.();}}
  vi.stubGlobal('MediaRecorder',Rec);
  const fetchMock=vi.fn(async(url:string,_init?:RequestInit)=>url==='/api/distress/extract'
    ?json({tags:['WATER_RISING','WITH_DEPENDENTS'],route_blocked_hint:null,mode:'GEMINI',reason_code:null}):json({ok:true}));
  vi.stubGlobal('fetch',fetchMock);
  const onSnapshot=vi.fn();
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  const {host}=await mount(props({onSnapshot}));
  await act(async()=>button(host,t.record)!.click());
  expect(button(host,t.stopRecording)).toBeTruthy();
  await act(async()=>{vi.advanceTimersByTime(29_999);});
  expect(track.stop).not.toHaveBeenCalled();
  await act(async()=>{vi.advanceTimersByTime(1);});
  expect(track.stop).toHaveBeenCalled();
  vi.useRealTimers();
  await vi.waitFor(()=>expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(2));
  await settle();
  const boxes=[...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(boxes.every(b=>!b.checked)).toBe(true);
  expect(fetchMock.mock.calls.filter(c=>String(c[0]).endsWith('/distress'))).toHaveLength(0);
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body)).audio_mime).toBe('audio/webm');
  expect(host.textContent).not.toContain(t.analyzing);
  for(const b of boxes)await act(async()=>b.click());
  await act(async()=>button(host,t.confirm)!.click());
  const report=fetchMock.mock.calls.find(c=>c[0]==='/api/replay/r1/distress');
  expect(JSON.parse(String(report![1]!.body))).toEqual({tags:['WATER_RISING','WITH_DEPENDENTS'],input_mode:'VOICE'});
  await settle();expect(onSnapshot).toHaveBeenCalledWith({ok:true});
});

it('official tsunami with time left: go to the nearest site, countdown, road-candidate notice, never claims safety',async()=>{
  nav({});vi.stubGlobal('fetch',vi.fn(async()=>json({},503)));
  const {host}=await mount(props({snapshot:{distress:tsunami(15),replay:{id:'r1'}}}));
  await vi.waitFor(()=>expect(primary(host).textContent).toContain(t.goTo.replace('{name}','測試場所NEAR')));
  const text=primary(host).textContent!;
  expect(text).toContain(t.countdown);expect(text).toContain('15:00');expect(text).toContain(t.roadCandidateNotice);
  const clone=host.cloneNode(true) as HTMLElement;clone.querySelectorAll('[data-testid="distress-disclaimer"]').forEach(n=>n.remove());
  expect(clone.textContent).not.toContain('安全');
  expect(host.querySelector('[data-testid="distress-disclaimer"]')?.textContent).toBe(t.notGuaranteed);
});

it('official tsunami with the deadline now: vertical evacuation',async()=>{
  nav({});vi.stubGlobal('fetch',vi.fn(async()=>json({},503)));
  const {host}=await mount(props({snapshot:{distress:tsunami(0),replay:{id:'r1'}}}));
  await settle();
  expect(primary(host).textContent).toContain(t.verticalNow);
  expect(primary(host).textContent).toContain(t.reasonNoTime);
});

it('labels synthetic distress as an exercise',async()=>{
  nav({});vi.stubGlobal('fetch',vi.fn(async()=>json({},503)));
  const {host}=await mount(props({snapshot:{distress:tsunami(15,{synthetic:true}),replay:{id:'r1'}}}));
  expect(host.querySelector('[data-testid="distress-exercise"]')?.textContent).toBe(t.exercise);
});

it('reads the instruction aloud once per level change, on replay, and never after mute',async()=>{
  nav({onLine:false});vi.stubGlobal('fetch',vi.fn());
  const base=props();const {host,rerender}=await mount(base);
  expect(speak).not.toHaveBeenCalled();
  const reported={...base,snapshot:{distress:status({level:'USER_REPORTED'}),replay:{id:'r1'}}};
  await rerender(reported);expect(speak).toHaveBeenCalledTimes(1);
  expect((speak.mock.calls[0][0] as {text:string;lang:string})).toMatchObject({text:t.vertical,lang:'zh-TW'});
  await rerender({...reported});expect(speak).toHaveBeenCalledTimes(1);
  await act(async()=>button(host,t.replay)!.click());expect(speak).toHaveBeenCalledTimes(2);
  await act(async()=>button(host,t.mute)!.click());
  expect(localStorage.getItem('72h-distress-speech')).toBe('0');
  await rerender({...base,snapshot:{distress:tsunami(0),replay:{id:'r1'}}});await settle();
  expect(speak).toHaveBeenCalledTimes(2);
});

it('pins SOS above the primary instruction when needed, below otherwise',async()=>{
  nav({onLine:false});vi.stubGlobal('fetch',vi.fn());
  const before=(host:HTMLElement)=>!!(host.querySelector('.sos-panel')!.compareDocumentPosition(primary(host))&Node.DOCUMENT_POSITION_FOLLOWING);
  let {host}=await mount(props({snapshot:{distress:status({level:'USER_REPORTED'}),replay:{id:'r1'}},sosProfile:{...empty,needsAssistance:true}}));
  expect(before(host)).toBe(true);
  ({host}=await mount(props()));
  expect(before(host)).toBe(false);
});

const advice=(over:Record<string,unknown>)=>({advice:{candidate_order:[],excluded:[],suggest_sos:false,emphasis_clause_ids:[],raised_level:false,rejected_fields:[],mode:'GEMINI',reason_code:null,...over},snapshot:{next:true}});
it('applies AI exclusion deterministically and labels it; keeps the order on deterministic fallback',async()=>{
  nav({});
  let fetchMock=vi.fn(async(_u:string,_i?:RequestInit)=>json(advice({excluded:['emergency_site:NEAR']})));vi.stubGlobal('fetch',fetchMock);
  const onSnapshot=vi.fn();
  let {host}=await mount(props({snapshot:{distress:tsunami(15,{reports:[{id:'d1',tags:['ROUTE_BLOCKED_REPORTED' as DistressTag],input_mode:'BUTTON',reported_at:new Date(NOW).toISOString(),source:'USER_REPORTED'}]}),replay:{id:'r1'}},onSnapshot}));
  await vi.waitFor(()=>expect(primary(host).textContent).toContain(t.goTo.replace('{name}','測試場所NEXT')));
  expect(primary(host).querySelector('[data-testid="distress-ai-label"]')?.textContent).toBe(t.aiSuggestion);
  const call=fetchMock.mock.calls.find(c=>c[0]==='/api/replay/r1/distress/advice')!;
  expect(JSON.parse(String(call[1]!.body))).toEqual({language:'zh-TW',candidates:[{place_id:'emergency_site:NEAR',name:'測試場所NEAR',walk_minutes:9},{place_id:'emergency_site:NEXT',name:'測試場所NEXT',walk_minutes:13}],route_blocked_hint:null});
  expect(fetchMock.mock.calls.filter(c=>String(c[0]).endsWith('/advice'))).toHaveLength(1);
  expect(onSnapshot).toHaveBeenCalledWith({next:true});
  fetchMock=vi.fn(async()=>json(advice({mode:'DETERMINISTIC_FALLBACK',reason_code:'BUDGET'})));vi.stubGlobal('fetch',fetchMock);
  ({host}=await mount(props({snapshot:{distress:tsunami(15),replay:{id:'r2'}}})));
  await vi.waitFor(()=>expect(host.textContent).toContain(t.aiUnavailable));
  expect(primary(host).textContent).toContain(t.goTo.replace('{name}','測試場所NEAR'));
  expect(primary(host).querySelector('[data-testid="distress-ai-label"]')).toBeNull();
});

it('releases the microphone on unmount and never sends the partial recording',async()=>{
  const track={stop:vi.fn()},stream={getTracks:()=>[track]};
  nav({mediaDevices:{getUserMedia:vi.fn(async()=>stream)}});
  class Rec{static isTypeSupported=()=>false;state='inactive';mimeType='';ondataavailable:((e:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;
    start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array([1])])});this.onstop?.();}}
  vi.stubGlobal('MediaRecorder',Rec);
  const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  const {host}=await mount(props());
  await act(async()=>button(host,t.record)!.click());
  const m=mounted.pop()!;await act(async()=>m.root.unmount());m.host.remove();
  expect(track.stop).toHaveBeenCalled();await settle();expect(fetchMock).not.toHaveBeenCalled();
});

it('does not ask the AI for advice at level NONE, and reports buttons online with BUTTON mode',async()=>{
  nav({});const fetchMock=vi.fn(async(_u:string,_i?:RequestInit)=>json({ok:1}));vi.stubGlobal('fetch',fetchMock);
  const {host}=await mount(props());await settle();
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async()=>button(host,tags.TRAPPED)!.click());await act(async()=>button(host,t.send)!.click());
  const report=fetchMock.mock.calls.find(c=>c[0]==='/api/replay/r1/distress')!;
  expect(JSON.parse(String(report[1]!.body))).toEqual({tags:['TRAPPED'],input_mode:'BUTTON'});
  // TRAPPED pins SOS above the instruction immediately, even before the server answers.
  expect(host.querySelector('.sos-panel')!.compareDocumentPosition(primary(host))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('shows a microphone-unavailable line when permission is denied',async()=>{
  nav({mediaDevices:{getUserMedia:vi.fn(async()=>{throw new DOMException('no','NotAllowedError');})}});
  vi.stubGlobal('MediaRecorder',class{});vi.stubGlobal('fetch',vi.fn());
  const {host}=await mount(props());
  await act(async()=>button(host,t.record)!.click());await settle();
  expect(host.textContent).toContain(t.micUnavailable);
});

it('announces only the instruction; the countdown is a silent timer',async()=>{
  nav({});vi.stubGlobal('fetch',vi.fn(async()=>json({},503)));
  const {host}=await mount(props({snapshot:{distress:tsunami(15),replay:{id:'r1'}}}));
  await vi.waitFor(()=>expect(primary(host).textContent).toContain('測試場所NEAR'));
  expect(primary(host).getAttribute('aria-live')).toBeNull();
  expect(host.querySelector('.distress-primary-text')!.getAttribute('aria-live')).toBe('assertive');
  const timer=host.querySelector('.distress-countdown')!;
  expect(timer.getAttribute('role')).toBe('timer');expect(timer.getAttribute('aria-live')).toBe('off');
});

it('never lets a slow device clock add time: live uses the server time as a floor',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW-5*60_000);
  nav({});vi.stubGlobal('fetch',vi.fn(async()=>json({},503)));
  const {host}=await mount(props({scope:'live',now:undefined,
    snapshot:{distress:tsunami(15),session_id:'l1',situation:{updated_at:new Date(NOW).toISOString(),latest_evidence_at:null}}}));
  await vi.waitFor(()=>expect(primary(host).textContent).toContain('測試場所NEAR'));
  expect(primary(host).textContent).toContain('15:00');expect(primary(host).textContent).not.toContain('20:00');
});

it('keeps the previous instruction while recomputing after the origin moves (no computing flash)',async()=>{
  nav({});vi.stubGlobal('fetch',vi.fn(async()=>json({},503)));
  const base=props({snapshot:{distress:tsunami(15),replay:{id:'r1'}}});
  const {host,rerender}=await mount(base);
  await vi.waitFor(()=>expect(primary(host).textContent).toContain('測試場所NEAR'));
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  await rerender({...base,location:{lat:38.4302,lng:141.3,accuracy_m:10}});
  expect(primary(host).textContent).not.toContain(t.computing);
  expect(primary(host).textContent).toContain('測試場所NEAR');
  await act(async()=>{vi.advanceTimersByTime(5);});
  vi.useRealTimers();
  expect(primary(host).textContent).toContain('測試場所NEAR');
});

it('gives the right reason when online without a session, shows analyzing, AI-heard and last-verified offline',async()=>{
  nav({});vi.stubGlobal('fetch',vi.fn());
  let {host}=await mount(props({snapshot:null}));
  expect(host.textContent).toContain(t.noSession);expect(host.textContent).not.toContain(t.voiceNeedsNetwork);
  let release!:(r:Response)=>void;
  vi.stubGlobal('fetch',vi.fn((url:string)=>url==='/api/distress/extract'?new Promise<Response>(r=>{release=r;}):Promise.resolve(json({},503))));
  ({host}=await mount(props()));
  const area=host.querySelector('textarea')!;
  await act(async()=>{const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;set.call(area,'水が来た');area.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>button(host,t.analyze)!.click());
  expect(host.textContent).toContain(t.analyzing);
  await act(async()=>{release(json({tags:['WATER_RISING'],route_blocked_hint:'橋が落ちた',mode:'GEMINI',reason_code:null}));});
  await vi.waitFor(()=>expect(host.textContent).toContain(`${t.aiHeard}「橋が落ちた」`));
  expect(host.textContent).not.toContain(t.analyzing);
  nav({onLine:false});
  ({host}=await mount(props({snapshot:{distress:status(),replay:{id:'r1'},situation:{updated_at:new Date(NOW).toISOString(),latest_evidence_at:new Date(NOW-60_000).toISOString()}}})));
  expect(host.querySelector('[data-testid="distress-last-verified"]')?.textContent).toContain(t.lastVerified);
});

import {formatClock} from '../lib/distress';
const official={warning_class:'MAJOR_WARNING' as const,last_official_at:new Date(NOW-10*60_000).toISOString(),trigger_expires_at:new Date(NOW+5*60_000).toISOString()};
it('shows the official basis and issue time under the primary instruction while online',async()=>{
  nav({});vi.stubGlobal('fetch',vi.fn(async()=>json({},503)));
  const {host}=await mount(props({snapshot:{distress:tsunami(15,official),replay:{id:'r1'}}}));
  await vi.waitFor(()=>expect(primary(host).textContent).toContain('測試場所NEAR'));
  const basis=primary(host).querySelector('[data-testid="distress-basis"]')!;
  expect(basis.textContent).toBe(t.basis.replace('{warning}',t.warningMajor).replace('{time}',formatClock(NOW-10*60_000)));
  expect(basis.textContent).toContain('依據：氣象廳 大津波警報 · 發布 ');
});
it('OFFICIAL_STALE: vertical evacuation plus a data-expired notice with the last confirmed time, never a site',async()=>{
  nav({});vi.stubGlobal('fetch',vi.fn(async()=>json({},503)));
  const {host}=await mount(props({snapshot:{distress:status({level:'OFFICIAL_STALE',trigger_evidence_ids:['ev-1'],...official}),replay:{id:'r1'}}}));
  await settle();
  const text=primary(host).textContent!;
  expect(text).toContain(t.vertical);expect(text).not.toContain('測試場所');expect(text).not.toContain(t.countdown);
  expect(primary(host).querySelector('[data-testid="distress-stale"]')!.textContent).toBe(t.staleNotice.replace('{time}',formatClock(NOW-10*60_000)));
  expect(t.staleNotice).toContain('官方資料已超過有效時間，最後確認');
});
it('never shows a site past trigger_expires_at, even from a cached OFFICIAL_TSUNAMI snapshot',async()=>{
  nav({onLine:false});vi.stubGlobal('fetch',vi.fn());
  const {host}=await mount(props({now:NOW+5*60_000,snapshot:{distress:tsunami(15,official),replay:{id:'r1'}}}));
  await settle();
  const text=primary(host).textContent!;
  expect(text).not.toContain('測試場所');expect(text).not.toContain(t.countdown);
  expect(text).toContain(t.vertical);
  expect(primary(host).querySelector('[data-testid="distress-stale"]')).toBeTruthy();
});

const blocked=[{id:'d1',tags:['ROUTE_BLOCKED_REPORTED' as DistressTag],input_mode:'BUTTON' as const,reported_at:new Date(NOW).toISOString(),source:'USER_REPORTED' as const}];
it('keeps the deterministic nearest site as the primary instruction; AI order only reorders the other candidates',async()=>{
  nav({});vi.stubGlobal('fetch',vi.fn(async()=>json(advice({candidate_order:['emergency_site:NEXT','emergency_site:NEAR']}))));
  const {host}=await mount(props({snapshot:{distress:tsunami(15),replay:{id:'r1'}},places:[...places,site('THIRD',38.4350)]}));
  await vi.waitFor(()=>expect(host.querySelector('[data-testid="distress-other-ai"]')).toBeTruthy());
  expect(primary(host).textContent).toContain(t.goTo.replace('{name}','測試場所NEAR'));
  expect(primary(host).querySelector('[data-testid="distress-ai-label"]')).toBeNull();
  const others=[...host.querySelectorAll('.distress-details li')].map(li=>li.textContent);
  expect(others[0]).toContain('測試場所NEXT');expect(others[1]).toContain('測試場所THIRD');
  expect(host.querySelector('[data-testid="distress-other-ai"]')!.textContent).toBe(t.aiSuggestion);
});
it('ignores an AI exclusion on the device without the blocked-route report',async()=>{
  nav({});vi.stubGlobal('fetch',vi.fn(async()=>json(advice({excluded:['emergency_site:NEAR']}))));
  const {host}=await mount(props({snapshot:{distress:tsunami(15),replay:{id:'r1'}}}));
  await settle();await settle();
  expect(primary(host).textContent).toContain(t.goTo.replace('{name}','測試場所NEAR'));
  expect(primary(host).querySelector('[data-testid="distress-ai-label"]')).toBeNull();
});
it('explains vertical evacuation when every reachable site was excluded on the report, labelled as AI',async()=>{
  nav({});vi.stubGlobal('fetch',vi.fn(async()=>json(advice({excluded:['emergency_site:NEAR','emergency_site:NEXT']}))));
  const {host}=await mount(props({snapshot:{distress:tsunami(15,{reports:blocked}),replay:{id:'r1'}}}));
  await vi.waitFor(()=>expect(primary(host).textContent).toContain(t.reasonExcludedByReport));
  expect(primary(host).textContent).toContain(t.verticalNow);
  expect(primary(host).querySelector('[data-testid="distress-ai-label"]')?.textContent).toBe(t.aiSuggestion);
  expect(t.reasonExcludedByReport.startsWith('依你回報的封路，AI 建議排除')).toBe(true);
});
