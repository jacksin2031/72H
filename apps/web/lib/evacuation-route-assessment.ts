import type {HazardLocation} from './official-hazards';
import {placeOpening,type DesignatedPlace,type DesignationHazard,type OpeningResponse} from './designated-places';

export type EvacuationCheckId='ORIGIN'|'DESIGNATION'|'OPENING'|'ROAD_GEOMETRY'|'ROAD_CONDITIONS'|'HAZARD_COVERAGE'|'MOVEMENT_AUTHORITY';
export type EvacuationCheck={id:EvacuationCheckId;status:'REFERENCE_VERIFIED'|'BLOCKED'|'UNKNOWN'};
export function selectEvacuationDestinations(places:readonly DesignatedPlace[],hazard:DesignationHazard){
 return hazard==='ALL'?[]:places.filter(p=>p.kind==='EMERGENCY_SITE'&&p.hazards[hazard]==='DESIGNATED');
}
export function usableEvacuationOrigin(origin:HazardLocation|null,now:number){
 return !!origin&&origin.source!=='OFFICIAL_PLACE'&&Number.isFinite(now)&&
  [origin.lat,origin.lng,origin.captured_at,origin.accuracy_m].every(x=>typeof x==='number'&&Number.isFinite(x))&&
  Math.abs(origin.lat)<=90&&Math.abs(origin.lng)<=180&&origin.captured_at<=now&&
  origin.accuracy_m!==null&&origin.accuracy_m>=0&&origin.accuracy_m<=100&&
  (origin.source!=='GPS'||now-origin.captured_at<=120000);
}
/** Read-only checks. A designation/open report/road line cannot satisfy hazard,
 * road-condition or movement authority. Never returns a safest-route verdict. */
export function assessEvacuationRouteReadiness(input:{place:DesignatedPlace|null;hazard:DesignationHazard;origin:HazardLocation|null;
 catalogCurrent:boolean;opening:OpeningResponse|null;connected:boolean;now:number;resumeAt:number;roadCandidateCount:number;graphCurrent:boolean}){
 const {place,hazard,now}=input;
 const designated=!!place&&input.catalogCurrent&&hazard!=='ALL'&&place.kind==='EMERGENCY_SITE'&&place.hazards[hazard]==='DESIGNATED';
 const opening=place?placeOpening(place,input.opening,input.connected,now,input.resumeAt):null;
 const checks:EvacuationCheck[]=[
  {id:'ORIGIN',status:usableEvacuationOrigin(input.origin,now)?'REFERENCE_VERIFIED':input.origin?'BLOCKED':'UNKNOWN'},
  {id:'DESIGNATION',status:designated?'REFERENCE_VERIFIED':place?'BLOCKED':'UNKNOWN'},
  {id:'OPENING',status:opening?.status==='OPEN'?'REFERENCE_VERIFIED':opening?.status==='CLOSED'?'BLOCKED':'UNKNOWN'},
  {id:'ROAD_GEOMETRY',status:input.graphCurrent&&input.roadCandidateCount>0?'REFERENCE_VERIFIED':'UNKNOWN'},
  {id:'ROAD_CONDITIONS',status:'UNKNOWN'},
  {id:'HAZARD_COVERAGE',status:'UNKNOWN'},
  {id:'MOVEMENT_AUTHORITY',status:'UNKNOWN'},
 ];
 return {status:'UNDETERMINED' as const,safest_route_id:null,movement_authorized:false as const,checks};
}
