import type {DistressStatus,DistressTag,Language} from './contracts';
import type {DesignatedPlace} from './designated-places';
import {resolveTsunamiGuidance,type ReachCandidate,type TsunamiGuidance} from './distress-reachability';
import type {RoadGraphPack} from './evacuation-road-graph';
import {LIVE_LOCATION_MS} from './last-known-location';

/** Pure helpers for the distress panel. All safety decisions stay deterministic. */
export type DistressOrigin={lat:number;lng:number;accuracy_m:number|null};
type ReachInput={origin:DistressOrigin|null;tags:readonly DistressTag[];places:readonly DesignatedPlace[];graph:RoadGraphPack|null;excluded?:readonly string[]};
const FAR_DEADLINE=1e15;

/** Expensive part (road graph search) without a deadline, so it can be memoized while the clock ticks. */
export function reachFor(input:ReachInput):TsunamiGuidance{
 return resolveTsunamiGuidance({...input,now:0,deadlineAt:FAR_DEADLINE});
}
/** Cheap part: same result as resolveTsunamiGuidance({...input,deadlineAt,now}). */
export function applyDeadline(reach:TsunamiGuidance,deadlineAt:number,now:number):TsunamiGuidance{
 const available=(deadlineAt-now)/1000;
 if(!Number.isFinite(available)||available<=0)return {kind:'VERTICAL_NOW',reason:'NO_TIME',deadlineAt};
 if(reach.kind==='VERTICAL_NOW')return {...reach,deadlineAt};
 const candidates=reach.candidates.filter(c=>c.walk_seconds<=available);
 return candidates.length?{kind:'GO_TO_SITE',candidates,deadlineAt}:{kind:'VERTICAL_NOW',reason:'NO_REACHABLE_SITE',deadlineAt};
}
/** ~11 m position buckets; accuracy is rounded up (never more optimistic than measured). */
export function roundOrigin(o:DistressOrigin|null):DistressOrigin|null{
 if(!o)return null;
 return {lat:Number(o.lat.toFixed(4)),lng:Number(o.lng.toFixed(4)),accuracy_m:o.accuracy_m===null?null:Math.ceil(o.accuracy_m/10)*10};
}
export function reachKey(o:DistressOrigin|null,tags:readonly DistressTag[],excluded:readonly string[]=[]):string{
 return JSON.stringify([o?[o.lat,o.lng,o.accuracy_m]:null,[...new Set(tags)].sort(),[...new Set(excluded)].sort()]);
}
/** AI order applies only to known candidates; unknown ids are ignored, the rest keep their deterministic order. */
export function orderCandidates(candidates:readonly ReachCandidate[],order:readonly string[]):ReachCandidate[]{
 const rank=new Map<string,number>();for(const id of order)if(!rank.has(id))rank.set(id,rank.size);
 return candidates.map((c,i)=>({c,i,r:rank.get(c.place_id)??Infinity})).sort((a,b)=>a.r-b.r||a.i-b.i).map(x=>x.c);
}
/** Same freshness rule as evacuation-route origins: GPS older than 2 minutes or from the future is not used. */
export function usableDistressOrigin(fix:{lat:number;lng:number;accuracy_m:number|null;captured_at:number;manual?:boolean}|null,wallNow:number):DistressOrigin|null{
 if(!fix||![fix.lat,fix.lng,fix.captured_at].every(Number.isFinite))return null;
 if(!fix.manual&&(fix.captured_at>wallNow+5000||wallNow-fix.captured_at>LIVE_LOCATION_MS))return null;
 return {lat:fix.lat,lng:fix.lng,accuracy_m:fix.accuracy_m};
}
export function fixFromDevicePosition(p:{latitude:number;longitude:number;accuracy_m:number;captured_at:number}|null){
 return p?{lat:p.latitude,lng:p.longitude,accuracy_m:p.accuracy_m,captured_at:p.captured_at}:null;
}
/** Floors: never shows more time than remains. */
export function formatCountdown(ms:number):string{
 const s=Math.max(0,Math.floor(ms/1000)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60,p=(n:number)=>String(n).padStart(2,'0');
 return h?`${h}:${p(m)}:${p(sec)}`:`${p(m)}:${p(sec)}`;
}
/** A person's own report raises the floor to level 1 locally (offline too); only the server can set OFFICIAL_TSUNAMI. */
export function effectiveDistressLevel(level:DistressStatus['level'],localTags:readonly DistressTag[]):DistressStatus['level']{
 return level==='NONE'&&localTags.length?'USER_REPORTED':level;
}
export function speechLang(language:Language){return language==='ja'?'ja-JP':language==='en'?'en-US':'zh-TW';}
