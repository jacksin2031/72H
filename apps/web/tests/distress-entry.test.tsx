// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import type {DistressStatus} from '../lib/contracts';

vi.mock('../lib/designated-places',async orig=>({...await orig<typeof import('../lib/designated-places')>(),loadDesignatedPlaces:vi.fn(async()=>({})),selectDesignationPlaces:()=>({places:[],reason:'X'})}));
vi.mock('../lib/evacuation-road-graph',async orig=>({...await orig<typeof import('../lib/evacuation-road-graph')>(),loadEvacuationRoadGraph:vi.fn(async()=>{throw Error('offline');})}));
vi.mock('../lib/emergency-contacts',async orig=>({...await orig<typeof import('../lib/emergency-contacts')>(),loadSosProfile:vi.fn(async()=>({contacts:[],needsAssistance:false,mobilityLimited:false}))}));
const {DistressEntry,LOCATION_REFRESH_MS}=await import('../components/distress-entry');

(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
const status=(level:DistressStatus['level']):DistressStatus=>({level,reports:[],trigger_evidence_ids:[],deadline_at:level==='OFFICIAL_TSUNAMI'?new Date(Date.now()+30*60_000).toISOString():null,ai_escalated:false,synthetic:false});

it('refreshes the location before it expires while a tsunami level is shown, and stops afterwards',async()=>{
  vi.useFakeTimers({toFake:['setInterval','clearInterval','setTimeout','clearTimeout','Date']});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
  const o=Object.create(navigator);Object.defineProperty(o,'onLine',{value:false,configurable:true});vi.stubGlobal('navigator',o);
  expect(LOCATION_REFRESH_MS).toBeLessThan(120_000);
  const refresh=vi.fn(),host=document.createElement('div'),root=createRoot(host);
  const render=(level:DistressStatus['level'])=>act(async()=>root.render(<DistressEntry snapshot={{distress:status(level),replay:{id:'r1'}}} language="ja" scope="replay"
    fix={{lat:38.43,lng:141.3,accuracy_m:10,captured_at:Date.now()}} onSnapshot={vi.fn()} refreshLocation={refresh}/>));
  await render('OFFICIAL_TSUNAMI');
  expect(refresh).not.toHaveBeenCalled();
  await act(async()=>{vi.advanceTimersByTime(LOCATION_REFRESH_MS);});
  expect(refresh).toHaveBeenCalledTimes(1);
  await render('OFFICIAL_TSUNAMI');// the refreshed fix arrives
  await act(async()=>{vi.advanceTimersByTime(LOCATION_REFRESH_MS);});
  expect(refresh).toHaveBeenCalledTimes(2);
  await render('NONE');
  await act(async()=>{vi.advanceTimersByTime(3*LOCATION_REFRESH_MS);});
  // No periodic refresh outside a tsunami level; only the single once-per-opening request when the fix goes stale.
  expect(refresh).toHaveBeenCalledTimes(3);
  await act(async()=>{vi.advanceTimersByTime(5*LOCATION_REFRESH_MS);});
  expect(refresh).toHaveBeenCalledTimes(3);
  await act(async()=>root.unmount());
});

it('asks once for a fix when none is usable',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
  const refresh=vi.fn(),host=document.createElement('div'),root=createRoot(host);
  await act(async()=>root.render(<DistressEntry snapshot={null} language="en" scope="live" fix={null} onSnapshot={vi.fn()} refreshLocation={refresh}/>));
  await act(async()=>root.render(<DistressEntry snapshot={null} language="en" scope="live" fix={null} onSnapshot={vi.fn()} refreshLocation={refresh}/>));
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async()=>root.unmount());
});
