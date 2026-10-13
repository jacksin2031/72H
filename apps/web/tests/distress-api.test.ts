import {afterEach,expect,it,vi} from 'vitest';
import {extractDistress,reportDistress,requestAdvice} from '../lib/distress-api';

afterEach(()=>vi.unstubAllGlobals());
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const ok={tags:['WATER_RISING','WATER_RISING','TRAPPED'],route_blocked_hint:'橋がない',mode:'GEMINI',reason_code:null};

it('returns validated, de-duplicated tags and the hint',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>json(ok)));
  expect(await extractDistress({sessionId:'s1',language:'ja',text:'水が来た'})).toEqual({tags:['WATER_RISING','TRAPPED'],hint:'橋がない'});
});
it('returns null for unknown tags',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>json({...ok,tags:['SAFE_HERE']})));
  expect(await extractDistress({sessionId:'s1',language:'ja',text:'x'})).toBeNull();
});
it('returns null for 413, 503 and UNAVAILABLE',async()=>{
  for(const status of [413,503]){
    vi.stubGlobal('fetch',vi.fn(async()=>json({detail:'x'},status)));
    expect(await extractDistress({sessionId:'s1',language:'ja',text:'x'})).toBeNull();
  }
  vi.stubGlobal('fetch',vi.fn(async()=>json({...ok,tags:[],mode:'UNAVAILABLE'})));
  expect(await extractDistress({sessionId:'s1',language:'ja',text:'x'})).toBeNull();
});
it('never calls fetch for audio larger than 1 MB',async()=>{
  const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  expect(await extractDistress({sessionId:'s1',language:'ja',audio:new Blob([new Uint8Array(1_000_001)],{type:'audio/webm'})})).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
it('sends only session_id, language and text, or audio_base64 + audio_mime',async()=>{
  const fetchMock=vi.fn(async(_url:string,_init:RequestInit)=>json(ok));vi.stubGlobal('fetch',fetchMock);
  await extractDistress({sessionId:'s1',language:'zh-TW',text:'  水淹進來  '});
  expect(fetchMock.mock.calls[0][0]).toBe('/api/distress/extract');
  expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({session_id:'s1',language:'zh-TW',text:'水淹進來'});
  await extractDistress({sessionId:'s1',language:'en',audio:new Blob([new Uint8Array([1,2,3])],{type:'audio/mp4;codecs=mp4a'})});
  expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual({session_id:'s1',language:'en',audio_base64:'AQID',audio_mime:'audio/mp4'});
});
it('reports distress with the drill key only for mock-live and returns raw JSON',async()=>{
  const fetchMock=vi.fn(async(_url:string,_init:RequestInit)=>json({raw:true}));vi.stubGlobal('fetch',fetchMock);
  expect(await reportDistress('mock-live','abc',['TRAPPED'],'BUTTON','k'.repeat(32))).toEqual({raw:true});
  expect(fetchMock.mock.calls[0][0]).toBe('/api/mock-live/abc/distress');
  expect((fetchMock.mock.calls[0][1].headers as Record<string,string>)['X-Drill-Key']).toBe('k'.repeat(32));
  expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({tags:['TRAPPED'],input_mode:'BUTTON'});
  await reportDistress('replay','r1',['INJURED'],'VOICE');
  expect((fetchMock.mock.calls[1][1].headers as Record<string,string>)['X-Drill-Key']).toBeUndefined();
  vi.stubGlobal('fetch',vi.fn(async()=>json({},500)));
  expect(await reportDistress('live','l1',['INJURED'],'TEXT')).toBeNull();
});
const advice={candidate_order:['emergency_site:A'],excluded:[],suggest_sos:false,emphasis_clause_ids:['MOVE_UP_NOW'],raised_level:false,rejected_fields:[],mode:'GEMINI',reason_code:null};
it('validates advice strictly and passes the snapshot through raw',async()=>{
  const fetchMock=vi.fn(async(_url:string,_init:RequestInit)=>json({advice,snapshot:{s:1}}));vi.stubGlobal('fetch',fetchMock);
  const body={language:'ja' as const,candidates:[{place_id:'emergency_site:A',name:'A',walk_minutes:3}],route_blocked_hint:null};
  expect(await requestAdvice('live','l1',body)).toEqual({advice,snapshot:{s:1}});
  expect(fetchMock.mock.calls[0][0]).toBe('/api/live/l1/distress/advice');
  expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual(body);
  vi.stubGlobal('fetch',vi.fn(async()=>json({advice:{...advice,mode:'MAGIC'},snapshot:{}})));
  expect(await requestAdvice('live','l1',body)).toBeNull();
  vi.stubGlobal('fetch',vi.fn(async()=>json({advice:{...advice,extra:1},snapshot:{}})));
  expect(await requestAdvice('live','l1',body)).toBeNull();
});
it('sends the drill key with mock-live extraction only',async()=>{
  const f=vi.fn(async(_u:string,_i?:RequestInit)=>new Response(JSON.stringify({tags:[],route_blocked_hint:'x',mode:'GEMINI',reason_code:null}),{status:200}));
  vi.stubGlobal('fetch',f);
  await extractDistress({sessionId:'m1',language:'ja',text:'x',scope:'mock-live',accessKey:'k'.repeat(40)});
  await extractDistress({sessionId:'r1',language:'ja',text:'x',scope:'replay',accessKey:'k'.repeat(40)});
  expect((f.mock.calls[0][1]!.headers as Record<string,string>)['X-Drill-Key']).toBe('k'.repeat(40));
  expect((f.mock.calls[1][1]!.headers as Record<string,string>)['X-Drill-Key']).toBeUndefined();
});
