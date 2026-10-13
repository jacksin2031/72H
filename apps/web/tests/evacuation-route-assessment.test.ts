import {expect,it} from 'vitest';
import {selectEvacuationDestinations,assessEvacuationRouteReadiness} from '../lib/evacuation-route-assessment';
import catalog from '../public/hazards/gsi-ishinomaki-places-v1/catalog-19d3a0fb072e2d3e.json';
import type {DesignatedPlace} from '../lib/designated-places';

const places=catalog as DesignatedPlace[];
it('uses emergency-site hazard designation, never ordinary shelter proximity',()=>{
 const selected=selectEvacuationDestinations(places,'tsunami');
 expect(selected.length).toBeGreaterThan(0);
 expect(selected.every(p=>p.kind==='EMERGENCY_SITE'&&p.hazards.tsunami==='DESIGNATED')).toBe(true);
 expect(selectEvacuationDestinations(places,'earthquake').every(p=>p.hazards.earthquake==='DESIGNATED')).toBe(true);
 expect(selectEvacuationDestinations(places,'ALL')).toEqual([]);
});
it('a road candidate and official designation cannot establish a safest route or movement authority',()=>{
 const p=selectEvacuationDestinations(places,'tsunami')[0],now=Date.now();
 const result=assessEvacuationRouteReadiness({place:p,hazard:'tsunami',origin:{lat:38.43,lng:141.3,source:'MAP_POINT',captured_at:now,accuracy_m:0},
  catalogCurrent:true,opening:null,connected:true,now,resumeAt:0,roadCandidateCount:2,graphCurrent:true});
 expect(result.status).toBe('UNDETERMINED');expect(result.safest_route_id).toBeNull();expect(result.movement_authorized).toBe(false);
 expect(result.checks.find(x=>x.id==='OPENING')?.status).toBe('UNKNOWN');
 expect(result.checks.find(x=>x.id==='ROAD_CONDITIONS')?.status).toBe('UNKNOWN');
 expect(result.checks.find(x=>x.id==='MOVEMENT_AUTHORITY')?.status).toBe('UNKNOWN');
});
it('rejects stale GPS, expired catalog and wrong-hazard destinations',()=>{
 const now=Date.now(),shelter=places.find(p=>p.kind==='SHELTER')!;
 const result=assessEvacuationRouteReadiness({place:shelter,hazard:'earthquake',origin:{lat:38.43,lng:141.3,source:'GPS',captured_at:now-120001,accuracy_m:5},
  catalogCurrent:false,opening:null,connected:false,now,resumeAt:now,roadCandidateCount:0,graphCurrent:false});
 expect(result.checks.find(x=>x.id==='ORIGIN')?.status).toBe('BLOCKED');
 expect(result.checks.find(x=>x.id==='DESIGNATION')?.status).toBe('BLOCKED');
 expect(result.checks.find(x=>x.id==='ROAD_GEOMETRY')?.status).toBe('UNKNOWN');
 expect(result.movement_authorized).toBe(false);
});
