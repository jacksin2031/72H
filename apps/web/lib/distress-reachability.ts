import type {DistressTag} from './contracts';
import type {DesignatedPlace} from './designated-places';
import {selectEvacuationDestinations} from './evacuation-route-assessment';
import {EVACUATION_ROAD_BOUNDS,findEvacuationRoadCandidates,type RoadGraphPack} from './evacuation-road-graph';

/** Deterministic, device-local. Distance is never a safety ranking. */
export const DISTRESS_PARAMS={walkMps:1.0,slowWalkMps:0.5,detourFactor:1.5,lowAccuracyM:50,maxAccuracyM:100,maxCandidates:12} as const;
const SLOW_TAGS:readonly DistressTag[]=['MOBILITY_LIMITED','INJURED','WITH_DEPENDENTS'];
export type ReachCandidate={place_id:string;name:string;distance_m:number;walk_seconds:number;via_road:boolean};
export type TsunamiGuidance={kind:'GO_TO_SITE';candidates:ReachCandidate[];deadlineAt:number}
 |{kind:'VERTICAL_NOW';reason:'NO_TIME'|'NO_REACHABLE_SITE'|'NO_LOCATION'|'NO_SITES_IN_PACK';deadlineAt:number};

function haversine(a:{lat:number;lng:number},b:{lat:number;lng:number}){
 const r=Math.PI/180,dLat=(b.lat-a.lat)*r,dLng=(b.lng-a.lng)*r;
 const h=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;
 return 2*6_371_008.8*Math.asin(Math.min(1,Math.sqrt(h)));
}
const inBounds=(p:{lat:number;lng:number})=>p.lat>=EVACUATION_ROAD_BOUNDS.south&&p.lat<=EVACUATION_ROAD_BOUNDS.north&&p.lng>=EVACUATION_ROAD_BOUNDS.west&&p.lng<=EVACUATION_ROAD_BOUNDS.east;

export function resolveTsunamiGuidance(input:{origin:{lat:number;lng:number;accuracy_m:number|null}|null;deadlineAt:number;now:number;
 tags:readonly DistressTag[];places:readonly DesignatedPlace[];graph:RoadGraphPack|null;excluded?:readonly string[]}):TsunamiGuidance{
 const {origin,deadlineAt,now}=input;
 const available=(deadlineAt-now)/1000;
 if(!Number.isFinite(available)||available<=0)return {kind:'VERTICAL_NOW',reason:'NO_TIME',deadlineAt};
 if(!origin||!Number.isFinite(origin.lat)||!Number.isFinite(origin.lng)||origin.accuracy_m===null||!(origin.accuracy_m>=0)||origin.accuracy_m>DISTRESS_PARAMS.maxAccuracyM)
  return {kind:'VERTICAL_NOW',reason:'NO_LOCATION',deadlineAt};
 const sites=selectEvacuationDestinations(input.places,'tsunami');
 if(!sites.length)return {kind:'VERTICAL_NOW',reason:'NO_SITES_IN_PACK',deadlineAt};
 const excluded=new Set(input.excluded??[]);
 const finite=(p:{lat:number;lng:number})=>Number.isFinite(p.lat)&&Number.isFinite(p.lng);
 const speed=input.tags.some(t=>SLOW_TAGS.includes(t))?DISTRESS_PARAMS.slowWalkMps:DISTRESS_PARAMS.walkMps;
 const penalty=origin.accuracy_m>DISTRESS_PARAMS.lowAccuracyM?origin.accuracy_m:0;
 const nearest=sites.filter(s=>!excluded.has(s.id)&&finite(s)).map(s=>({s,straight:haversine(origin,s)}))
  .sort((a,b)=>a.straight-b.straight).slice(0,DISTRESS_PARAMS.maxCandidates);
 const candidates:ReachCandidate[]=[];
 for(const {s,straight} of nearest){
  let distance=straight*DISTRESS_PARAMS.detourFactor,viaRoad=false;
  if(input.graph&&inBounds(origin)&&inBounds(s)){
   const road=findEvacuationRoadCandidates(input.graph,origin,s);
   const best=road.candidates[0];
   if(best){distance=best.distance_m+best.origin_gap_m+best.destination_gap_m;viaRoad=true;}
   // Graph applies but says no walkable path: never fall back to optimistic straight-line.
   else if(road.reason==='DISCONNECTED_GRAPH'||road.reason==='IMPLAUSIBLE_DISTANCE')continue;
  }
  distance+=penalty;
  const walk=distance/speed;
  if(walk<=available)candidates.push({place_id:s.id,name:s.name,distance_m:distance,walk_seconds:walk,via_road:viaRoad});
 }
 if(!candidates.length)return {kind:'VERTICAL_NOW',reason:'NO_REACHABLE_SITE',deadlineAt};
 candidates.sort((a,b)=>a.walk_seconds-b.walk_seconds);
 return {kind:'GO_TO_SITE',candidates,deadlineAt};
}

export function adviceCandidates(g:TsunamiGuidance){
 return g.kind==='GO_TO_SITE'?g.candidates.map(c=>({place_id:c.place_id,name:c.name.slice(0,80),walk_minutes:Math.min(240,Math.ceil(c.walk_seconds/60))})):[];
}
