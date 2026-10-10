/**
 * Geospatial evidence screening, not an evacuation recommendation engine.
 * Epicentral surface distance is informative only: rupture extent, ground
 * conditions, measured local shaking, structures and aftershocks can dominate.
 * Tsunami risk cannot be excluded from epicentral/coastline distance or a single
 * elevation reading. No caller may derive "safe" or a verified route here.
 */
export type GeoPoint = { lat:number; lng:number };
export type LocationFix = GeoPoint & {
  accuracy_m:number; captured_at:number; source:'BROWSER_GEOLOCATION'|'MANUAL_EXERCISE';
};
export type Epicenter = GeoPoint & {
  case_id:string; source_url:string; observed_at_jst:string; magnitude:number; depth_km:number;
};
export const documentedEpicenters:Readonly<Record<string,Epicenter>> = Object.freeze({
  'kobe-1995':Object.freeze({
    lat:34.6,lng:135.033333,case_id:'kobe-1995',
    source_url:'https://www.data.jma.go.jp/eqev/data/1995_01_17_hyogonanbu/gaiyo.html',
    observed_at_jst:'1995-01-17T05:46:00+09:00',magnitude:7.3,depth_km:16,
  }),
  'kumamoto-2016':Object.freeze({
    lat:32.741667,lng:130.808333,case_id:'kumamoto-2016',
    source_url:'https://ds.data.jma.go.jp/svd/eqev/data/2016_04_14_kumamoto/index.html',
    observed_at_jst:'2016-04-14T21:26:00+09:00',magnitude:6.5,depth_km:11,
  }),
  'iburi-2018':Object.freeze({
    lat:42.69,lng:142.006667,case_id:'iburi-2018',
    source_url:'https://www.data.jma.go.jp/eqev/data/kyoshin/jishin/1809060307_hokkaido-iburi-tobu/index.html',
    observed_at_jst:'2018-09-06T03:07:59+09:00',magnitude:6.7,depth_km:37,
  }),
  'noto-2024':Object.freeze({
    lat:37.495,lng:137.27,case_id:'noto-2024',
    source_url:'https://www.data.jma.go.jp/eqev/data/kyoshin/jishin/2401011610_noto/index.html',
    observed_at_jst:'2024-01-01T16:10:22+09:00',magnitude:7.6,depth_km:16,
  }),
  'tohoku-2011':Object.freeze({
    lat:38.103333, lng:142.86, case_id:'tohoku-2011',
    source_url:'https://www.data.jma.go.jp/eqev/data/kyoshin/jishin/110311_tohokuchiho-taiheiyouoki/index.html',
    observed_at_jst:'2011-03-11T14:46:18+09:00',magnitude:9.0,depth_km:24,
  }),
});
export type RiskReason =
  | 'NO_LOCATION'|'INVALID_LOCATION'|'STALE_LOCATION'|'IMPRECISE_LOCATION'
  | 'NO_EPICENTER'|'DISTANCE_ONLY_NO_SHAKING_MODEL'
  | 'NO_VERIFIED_TSUNAMI_COVERAGE'|'HISTORICAL_TSUNAMI_WARNING';
export type SeismicExposure = {
  status:'UNDETERMINED';
  surface_distance_km:number|null;
  min_distance_km:number|null;
  max_distance_km:number|null;
  reasons:RiskReason[];
  source_url:string|null;
  safe_location_verified:false;
  route_authorized:false;
};
export type TsunamiExposure = {
  status:'UNDETERMINED';
  warning_active:boolean;
  reasons:RiskReason[];
  inundation_depth_m:null;
  elevation_m:null;
  safe_location_verified:false;
  route_authorized:false;
};
export type GeospatialAssessment={
  user_location:LocationFix|null; epicenter:Epicenter|null;
  seismic:SeismicExposure;tsunami:TsunamiExposure;
  assessed_at:number;is_exercise:true;
};
const EARTH_RADIUS_KM=6371.0088;
const MAX_LOCATION_AGE_MS=2*60_000;
const MAX_ACCURACY_M=1000;
export function validPoint(value:unknown):value is GeoPoint{
 if(!value||typeof value!=='object')return false;
 const p=value as Record<string,unknown>;
 return typeof p.lat==='number'&&Number.isFinite(p.lat)&&p.lat>=-90&&p.lat<=90
   &&typeof p.lng==='number'&&Number.isFinite(p.lng)&&p.lng>=-180&&p.lng<=180;
}
export function greatCircleKm(a:GeoPoint,b:GeoPoint):number{
 if(!validPoint(a)||!validPoint(b))throw Error('Invalid coordinate');
 const radians=Math.PI/180;
 const dLat=(b.lat-a.lat)*radians;
 const dLng=(b.lng-a.lng)*radians;
 const h=Math.sin(dLat/2)**2+Math.cos(a.lat*radians)*Math.cos(b.lat*radians)*Math.sin(dLng/2)**2;
 return EARTH_RADIUS_KM*2*Math.atan2(Math.sqrt(Math.max(0,h)),Math.sqrt(Math.max(0,1-h)));
}
export function screenGeoExposure({
  location,epicenter,tsunamiWarningActive,now
}:{
  location:LocationFix|null;epicenter:Epicenter|null;
  tsunamiWarningActive:boolean;now:number;
}):GeospatialAssessment {
 const issues:RiskReason[]=[];
 if(!location)issues.push('NO_LOCATION');
 else if(!validPoint(location)||!Number.isFinite(location.accuracy_m)||location.accuracy_m<0
   ||!Number.isFinite(location.captured_at)||!Number.isFinite(now)||location.captured_at>now)
   issues.push('INVALID_LOCATION');
 else if(location.source==='BROWSER_GEOLOCATION'&&now-location.captured_at>MAX_LOCATION_AGE_MS)
   issues.push('STALE_LOCATION');
 else if(location.accuracy_m>MAX_ACCURACY_M)issues.push('IMPRECISE_LOCATION');
 const usableLocation=issues.length===0?location:null;
 const seismicReasons:RiskReason[]=[...issues];
 if(!epicenter||!validPoint(epicenter))seismicReasons.push('NO_EPICENTER');
 else seismicReasons.push('DISTANCE_ONLY_NO_SHAKING_MODEL');
 let distance:number|null=null;
 if(usableLocation&&epicenter&&validPoint(epicenter))distance=greatCircleKm(usableLocation,epicenter);
 const spread=usableLocation?.accuracy_m??0;
 const seismic:SeismicExposure={
  status:'UNDETERMINED',surface_distance_km:distance===null?null:Math.round(distance*10)/10,
  min_distance_km:distance===null?null:Math.round(Math.max(0,distance-spread/1000)*10)/10,
  max_distance_km:distance===null?null:Math.round((distance+spread/1000)*10)/10,
  reasons:seismicReasons,source_url:epicenter?.source_url??null,
  safe_location_verified:false,route_authorized:false,
 };
 const tsunami: TsunamiExposure={
   status:'UNDETERMINED',warning_active:tsunamiWarningActive,
   reasons:[...issues,'NO_VERIFIED_TSUNAMI_COVERAGE',...(tsunamiWarningActive?['HISTORICAL_TSUNAMI_WARNING' as const]:[])],
   inundation_depth_m:null,elevation_m:null,
   safe_location_verified:false,route_authorized:false,
 };
 return {
   user_location:usableLocation,epicenter:epicenter&&validPoint(epicenter)?epicenter:null,
   seismic,tsunami,assessed_at:now,is_exercise:true,
 };
}
/** Tsunami warning is exposed only at or after its played historical milestone.
 * Other earthquake aftershocks can follow without clearing a tsunami warning.
 */
export function historicTsunamiWarningStarted(
 milestones:readonly {kind:string}[],processedCount:number
):boolean{
 return milestones.slice(0,Math.max(0,processedCount)).some(item=>
   item.kind==='TSUNAMI_WARNING'||item.kind==='TSUNAMI_UPGRADE');
}

export const kumamotoSecondEarthquake:Epicenter=Object.freeze({
  lat:32.753333,lng:130.761667,case_id:'kumamoto-2016',
  source_url:'https://ds.data.jma.go.jp/svd/eqev/data/2016_04_14_kumamoto/index.html',
  observed_at_jst:'2016-04-16T01:25:00+09:00',magnitude:7.3,depth_km:12,
});
/** Do not present a future second earthquake before its played milestone. */
export function epicenterForPlayedMilestones(caseId:string|null,milestones:readonly {kind:string}[],processedCount:number):Epicenter|null{
  const origin=caseId?documentedEpicenters[caseId]:null;
  if(!origin)return null;
  if(caseId==='kumamoto-2016' && milestones.slice(0,Math.max(0,processedCount)).filter(m=>m.kind==='EARTHQUAKE').length>=2)
    return kumamotoSecondEarthquake;
  return origin;
}
