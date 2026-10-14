// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {expect,it,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {useDesignatedPlaces} from '../lib/use-designated-places';
import {placeOpening} from '../lib/designated-places';

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const base=Date.parse('2026-10-12T11:00:00Z');let clock=base;
let root:Root|null=null,host:HTMLDivElement|null=null;
const identity={id:'emergency_site:E0420200002201',identity_kind:'OFFICIAL_COMMON_ID_PER_ROLE' as const,municipality_code:'04202'};
const data=(generated=clock,fetched=clock)=>({mode:'LIVE_REFERENCE',area_id:'JP-MUNI-04202',generated_at:new Date(generated).toISOString(),fetched_at:new Date(fetched).toISOString(),
  source_status:'AVAILABLE',records:[{destination_id:identity.id,status:'OPEN',reason:'VERIFIED',source_key:'TEST_ONLY',source_url:'https://www.city.ishinomaki.lg.jp/TEST_ONLY',
    published_at:new Date(base-30_000).toISOString(),received_at:new Date(base).toISOString(),expires_at:new Date(base+270_000).toISOString(),evidence_ids:['TEST_REPORT'],restrictions:[],safe_location_verified:false,route_authorized:false}],
  authority:'REFERENCE_ONLY',safe_location_verified:false,route_authorized:false});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();root=null;host=null;vi.unstubAllGlobals();vi.restoreAllMocks();clock=base;});
async function mount(api:()=>Promise<Response>){
  vi.spyOn(Date,'now').mockImplementation(()=>clock);
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.startsWith('/hazards/')?new Response(readFileSync(resolve('public'+path))):api()));
  function Fixture(){const s=useDesignatedPlaces();const opening=placeOpening(identity,s.opening,s.connected,s.now,s.resumeAt);return <output>{opening.status} · {opening.reason} · {opening.record?.published_at}</output>;}
  host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<Fixture/>));
}
it('retains old opening provenance offline but requires a post-interruption source fetch to restore it',async()=>{
  await mount(async()=>new Response(JSON.stringify(data(clock,base))));
  expect(host!.textContent).toContain('OPEN');
  clock+=10_000;await act(async()=>window.dispatchEvent(new Event('offline')));
  expect(host!.textContent).toContain('UNKNOWN · OFFLINE');expect(host!.textContent).toContain('2026-10-12T10:59:30');
  await act(async()=>window.dispatchEvent(new Event('online')));
  expect(host!.textContent).toContain('UNKNOWN');expect(host!.textContent).toContain('UNVERIFIED_SCOPE_OR_RECONNECT');
});
it('ignores late opening responses after an offline interruption and rejects future API clocks',async()=>{
  let finish:(r:Response)=>void=()=>{};await mount(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>{window.dispatchEvent(new Event('offline'));finish(new Response(JSON.stringify(data())));});
  expect(host!.textContent).toContain('UNKNOWN');expect(host!.textContent).not.toContain('OPEN ·');
  await act(async()=>root!.unmount());root=null;host?.remove();
  await mount(async()=>new Response(JSON.stringify(data(clock+60_000))));
  expect(host!.textContent).toContain('UNKNOWN');expect(host!.textContent).not.toContain('OPEN ·');
});
