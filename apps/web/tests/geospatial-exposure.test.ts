import {describe,expect,it} from 'vitest';
import {
 documentedEpicenters,epicenterForPlayedMilestones,greatCircleKm,historicTsunamiWarningStarted,
 screenGeoExposure,type LocationFix,
} from '../lib/geospatial-exposure';

const now=Date.parse('2026-10-10T12:00:00Z');
const tokyo:LocationFix={lat:35.69,lng:139.75,accuracy_m:20,captured_at:now,source:'BROWSER_GEOLOCATION'};
const assess=(location:LocationFix|null=tokyo,caseId='tohoku-2011',warning=false)=>
 screenGeoExposure({location,epicenter:documentedEpicenters[caseId]??null,tsunamiWarningActive:warning,now});
describe('hazard-aware distance screening never grants unverified safety',()=>{
 it('computes finite great-circle surface distance without proxying safety',()=>{
  const p=documentedEpicenters['tohoku-2011'];
  const distance=greatCircleKm(tokyo,p);
  expect(distance).toBeGreaterThan(350);
  expect(distance).toBeLessThan(500);
  const a=assess();
  expect(a.seismic.status).toBe('UNDETERMINED');
  expect(a.seismic.safe_location_verified).toBe(false);
  expect(a.seismic.route_authorized).toBe(false);
  expect(a.seismic.source_url).toContain('jma.go.jp');
  expect(a.seismic.reasons).toContain('DISTANCE_ONLY_NO_SHAKING_MODEL');
  expect(a.seismic.min_distance_km).toBeLessThanOrEqual(a.seismic.surface_distance_km!);
  expect(a.seismic.max_distance_km).toBeGreaterThanOrEqual(a.seismic.surface_distance_km!);
 });
 it('neither very large nor zero epicenter distance is a safety clearance',()=>{
  for(const point of [
   {lat:38.103333,lng:142.86,accuracy_m:0,captured_at:now,source:'MANUAL_EXERCISE' as const},
   {lat:25.03,lng:121.56,accuracy_m:5,captured_at:now,source:'MANUAL_EXERCISE' as const},
  ]) {
   const result=assess(point);
   expect(result.seismic.surface_distance_km).not.toBeNull();
   expect(result.seismic.safe_location_verified).toBe(false);
   expect(result.tsunami.safe_location_verified).toBe(false);
   expect(result.tsunami.route_authorized).toBe(false);
  }
 });
 it('missing location or invalid coordinates fail closed',()=>{
  expect(assess(null).seismic.surface_distance_km).toBeNull();
  for(const input of [{...tokyo,lat:91},{...tokyo,lng:181},{...tokyo,accuracy_m:-1},{...tokyo,accuracy_m:Infinity},{...tokyo,captured_at:now+1}]){
   const result=assess(input);
   expect(result.user_location).toBeNull();
   expect(result.seismic.surface_distance_km).toBeNull();
   expect(result.seismic.safe_location_verified).toBe(false);
  }
 });
 it('rejects stale and unreliable GPS rather than displaying false precision',()=>{
  const stale=assess({...tokyo,captured_at:now-120001});
  expect(stale.seismic.reasons).toContain('STALE_LOCATION');
  expect(stale.seismic.surface_distance_km).toBeNull();
  const imprecise=assess({...tokyo,accuracy_m:5000});
  expect(imprecise.seismic.reasons).toContain('IMPRECISE_LOCATION');
  expect(imprecise.seismic.surface_distance_km).toBeNull();
 });
 it('never treats absence of tsunami warning as proof against inundation',()=>{
  const result=assess(tokyo,'tohoku-2011',false);
  expect(result.tsunami.warning_active).toBe(false);
  expect(result.tsunami.status).toBe('UNDETERMINED');
  expect(result.tsunami.reasons).toContain('NO_VERIFIED_TSUNAMI_COVERAGE');
  expect(result.tsunami.elevation_m).toBeNull();
  expect(result.tsunami.inundation_depth_m).toBeNull();
  expect(result.tsunami.safe_location_verified).toBe(false);
 });
 it('marks historical tsunami warning only after actually played',()=>{
  const milestones=[{kind:'EARTHQUAKE'},{kind:'TSUNAMI_WARNING'},{kind:'TSUNAMI_UPGRADE'},{kind:'AFTERSHOCK'}];
  expect(historicTsunamiWarningStarted(milestones,0)).toBe(false);
  expect(historicTsunamiWarningStarted(milestones,1)).toBe(false);
  expect(historicTsunamiWarningStarted(milestones,2)).toBe(true);
  expect(historicTsunamiWarningStarted(milestones,4)).toBe(true);
  const tsunami=assess(tokyo,'tohoku-2011',true).tsunami;
  expect(tsunami.reasons).toContain('HISTORICAL_TSUNAMI_WARNING');
  expect(tsunami.status).toBe('UNDETERMINED');
  expect(tsunami.safe_location_verified).toBe(false);
 });
 it('all five historic cases have their own official epicenter; never extrapolate coordinates',()=>{
  for(const key of ['tohoku-2011','kobe-1995','kumamoto-2016','iburi-2018','noto-2024']){
   const p=documentedEpicenters[key];
   expect(Number.isFinite(p.lat)).toBe(true);
   expect(Number.isFinite(p.lng)).toBe(true);
   expect(p.source_url).toMatch(/^https:\/\//);
   expect(assess(tokyo,key).seismic.surface_distance_km).not.toBeNull();
  }
  expect(assess(tokyo,'nonexistent').seismic.surface_distance_km).toBeNull();
 });
 it('Kumamoto second event cannot leak into pre-event or first-shock screens',()=>{
  const milestones=[{kind:'EARTHQUAKE'},{kind:'EARTHQUAKE'}];
  expect(epicenterForPlayedMilestones('kumamoto-2016',milestones,0)?.magnitude).toBe(6.5);
  expect(epicenterForPlayedMilestones('kumamoto-2016',milestones,1)?.magnitude).toBe(6.5);
  expect(epicenterForPlayedMilestones('kumamoto-2016',milestones,2)?.magnitude).toBe(7.3);
  expect(epicenterForPlayedMilestones(null,milestones,2)).toBeNull();
 });
 it('distance uses great circle rather than degree differences',()=>{
  expect(greatCircleKm({lat:0,lng:0},{lat:0,lng:0})).toBe(0);
  expect(greatCircleKm({lat:0,lng:0},{lat:0,lng:1})).toBeCloseTo(111.195,2);
  expect(()=>greatCircleKm({lat:999,lng:0},{lat:0,lng:0})).toThrow();
 });
});
