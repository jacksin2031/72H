import {expect,it} from 'vitest';
import {resolveTsunamiGuidance} from '../lib/distress-reachability';
import {applyDeadline,effectiveDistressLevel,formatCountdown,orderCandidates,reachFor,reachKey,roundOrigin,speechLang,usableDistressOrigin} from '../lib/distress-guidance';
import type {DesignatedPlace} from '../lib/designated-places';

const NOW=Date.parse('2026-10-13T08:00:00Z');
const site=(id:string,lat:number,lng:number)=>({id:`emergency_site:${id}`,kind:'EMERGENCY_SITE',name:`site ${id}`,lat,lng,
  hazards:{tsunami:'DESIGNATED'}} as unknown as DesignatedPlace);
const places=[site('NEAR',38.4330,141.3),site('MID',38.4370,141.3),site('FAR',38.45,141.3)];
const origin={lat:38.43,lng:141.3,accuracy_m:10};

it('splits reachability into an expensive deadline-free part and a cheap deadline filter with identical results',()=>{
  const cases=[
    {origin,tags:[] as const,deadlineAt:NOW+10*60_000},{origin,tags:['INJURED'] as const,deadlineAt:NOW+10*60_000},
    {origin,tags:[] as const,deadlineAt:NOW},{origin,tags:[] as const,deadlineAt:NOW+60_000},
    {origin:null,tags:[] as const,deadlineAt:NOW+60_000},{origin:{...origin,accuracy_m:80},tags:[] as const,deadlineAt:NOW+3_600_000},
  ];
  for(const c of cases)for(const excluded of [undefined,['emergency_site:NEAR'],['emergency_site:NEAR','emergency_site:MID','emergency_site:FAR']]){
    const input={origin:c.origin,tags:c.tags,places,graph:null,excluded};
    expect(applyDeadline(reachFor(input),c.deadlineAt,NOW)).toEqual(resolveTsunamiGuidance({...input,deadlineAt:c.deadlineAt,now:NOW}));
  }
  expect(applyDeadline(reachFor({origin,tags:[],places:[],graph:null}),NOW+60_000,NOW)).toMatchObject({kind:'VERTICAL_NOW',reason:'NO_SITES_IN_PACK'});
});
it('rounds the origin for memoization, never optimistically on accuracy',()=>{
  expect(roundOrigin({lat:38.430049,lng:141.300051,accuracy_m:11})).toEqual({lat:38.43,lng:141.3001,accuracy_m:20});
  expect(roundOrigin(null)).toBeNull();
  expect(reachKey({lat:38.43,lng:141.3,accuracy_m:20},['TRAPPED','INJURED'],['b','a'])).toBe(reachKey({lat:38.43,lng:141.3,accuracy_m:20},['INJURED','TRAPPED'],['a','b']));
});
it('applies the AI candidate order only to known candidates, keeping the rest in deterministic order',()=>{
  const c=(id:string)=>({place_id:id,name:id,distance_m:1,walk_seconds:1,via_road:false});
  expect(orderCandidates([c('a'),c('b'),c('c')],['c','zzz']).map(x=>x.place_id)).toEqual(['c','a','b']);
  expect(orderCandidates([c('a'),c('b')],[]).map(x=>x.place_id)).toEqual(['a','b']);
});
it('uses only a recent device fix as origin',()=>{
  const fix={lat:38.43,lng:141.3,accuracy_m:12,captured_at:NOW-60_000};
  expect(usableDistressOrigin(fix,NOW)).toEqual({lat:38.43,lng:141.3,accuracy_m:12});
  expect(usableDistressOrigin({...fix,captured_at:NOW-3*60_000},NOW)).toBeNull();
  expect(usableDistressOrigin({...fix,captured_at:NOW+60_000},NOW)).toBeNull();
  expect(usableDistressOrigin({...fix,captured_at:NOW-3*60_000,manual:true},NOW)).toEqual({lat:38.43,lng:141.3,accuracy_m:12});
  expect(usableDistressOrigin(null,NOW)).toBeNull();
});
it('formats the countdown, derives a local level floor, and maps speech languages',()=>{
  expect(formatCountdown(15*60_000)).toBe('15:00');expect(formatCountdown(61_500)).toBe('01:01');expect(formatCountdown(-5)).toBe('00:00');
  expect(formatCountdown(2*3_600_000+5_000)).toBe('2:00:05');
  expect(effectiveDistressLevel('NONE',[])).toBe('NONE');expect(effectiveDistressLevel('NONE',['TRAPPED'])).toBe('USER_REPORTED');
  expect(effectiveDistressLevel('OFFICIAL_TSUNAMI',[])).toBe('OFFICIAL_TSUNAMI');
  expect([speechLang('ja'),speechLang('en'),speechLang('zh-TW')]).toEqual(['ja-JP','en-US','zh-TW']);
});
import {skewedNow} from '../lib/distress-guidance';
it('uses the server clock as a floor and never lets a slow device clock add time',()=>{
  const server=NOW,received=NOW-300_000;// device was 5 min behind when the snapshot arrived
  expect(skewedNow(NOW-300_000,server,received)).toBe(NOW);
  expect(skewedNow(NOW-240_000,server,received)).toBe(NOW+60_000);
  expect(skewedNow(NOW+10_000,server,NOW+10_000)).toBe(NOW+10_000);
  expect(skewedNow(NOW,null,null)).toBe(NOW);
});
import {dropExcluded} from '../lib/distress-guidance';
it('drops excluded sites from a reused result and falls back to vertical when none remain',()=>{
  const c=(id:string)=>({place_id:id,name:id,distance_m:1,walk_seconds:1,via_road:false});
  const g={kind:'GO_TO_SITE' as const,candidates:[c('a'),c('b')],deadlineAt:1};
  expect(dropExcluded(g,['a'])).toEqual({...g,candidates:[c('b')]});
  expect(dropExcluded(g,['a','b'])).toEqual({kind:'VERTICAL_NOW',reason:'EXCLUDED_BY_REPORT',deadlineAt:1});
});
import {degradeExpiredOfficial,keepsLocationFresh} from '../lib/distress-guidance';
it('downgrades a cached OFFICIAL_TSUNAMI to OFFICIAL_STALE once the device clock reaches trigger_expires_at',()=>{
  const base={level:'OFFICIAL_TSUNAMI' as const,reports:[],trigger_evidence_ids:['ev-1'],deadline_at:new Date(NOW+20*60_000).toISOString(),ai_escalated:false,synthetic:false,
    warning_class:'MAJOR_WARNING' as const,last_official_at:new Date(NOW-60_000).toISOString(),trigger_expires_at:new Date(NOW+5*60_000).toISOString()};
  expect(degradeExpiredOfficial(base,NOW+5*60_000-1)).toBe(base);
  const stale=degradeExpiredOfficial(base,NOW+5*60_000);
  expect(stale).toMatchObject({level:'OFFICIAL_STALE',deadline_at:null,last_official_at:base.last_official_at,warning_class:'MAJOR_WARNING'});
  expect(degradeExpiredOfficial({...base,trigger_expires_at:null},NOW+3_600_000)).toMatchObject({level:'OFFICIAL_TSUNAMI'});
  const reported={...base,level:'USER_REPORTED' as const};
  expect(degradeExpiredOfficial(reported,NOW+3_600_000)).toBe(reported);
});
it('keeps the device location fresh only for official tsunami levels',()=>{
  expect(keepsLocationFresh('OFFICIAL_TSUNAMI')).toBe(true);expect(keepsLocationFresh('OFFICIAL_STALE')).toBe(true);
  expect(keepsLocationFresh('USER_REPORTED')).toBe(false);expect(keepsLocationFresh('NONE')).toBe(false);
});
import {locationRefreshNetworkAllowed} from '../lib/distress-guidance';
it('lets the same-area location refresh through power-saving modes only during official tsunami levels',()=>{
  expect(locationRefreshNetworkAllowed(true,'NONE')).toBe(true);
  expect(locationRefreshNetworkAllowed(false,'NONE')).toBe(false);
  expect(locationRefreshNetworkAllowed(false,'USER_REPORTED')).toBe(false);
  expect(locationRefreshNetworkAllowed(false,'OFFICIAL_TSUNAMI')).toBe(true);
  expect(locationRefreshNetworkAllowed(false,'OFFICIAL_STALE')).toBe(true);
});
it('reports EXCLUDED_BY_REPORT only while an excluded site would still be reachable before the deadline',()=>{
  const all=['emergency_site:NEAR','emergency_site:MID','emergency_site:FAR'];
  const reach=reachFor({origin,tags:[],places,graph:null,excluded:all});
  expect(applyDeadline(reach,NOW+10*60_000,NOW)).toMatchObject({kind:'VERTICAL_NOW',reason:'EXCLUDED_BY_REPORT'});
  expect(applyDeadline(reach,NOW+60_000,NOW)).toMatchObject({kind:'VERTICAL_NOW',reason:'NO_REACHABLE_SITE'});
});
