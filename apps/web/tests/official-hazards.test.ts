import { describe, expect, it, vi, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { assessOfficialHazards, officialPlaceLocation, officialPlaceSchema, hazardManifestSchema, isTsunamiDesignated, loadOfficialHazardPack, type HazardPack, type HazardLocation } from '../lib/official-hazards';

const now=Date.parse('2026-10-12T00:00:00Z');
const fix=(lng:number,lat:number,accuracy_m=0):HazardLocation&{source:'MAP_POINT';accuracy_m:number}=>({lng,lat,accuracy_m,captured_at:now,source:'MAP_POINT'});
const square=(w:number,s:number,e:number,n:number):[number,number][]=>[[w,s],[e,s],[e,n],[w,n],[w,s]];
const pack:HazardPack={manifest:{schema_version:1,dataset_id:'TEST_ONLY',region_name:'Synthetic geometry test',area_id:'JP-04',
  reviewed_at:'2026-10-11T00:00:00Z',review_due_at:'2027-01-09T00:00:00Z',positional_accuracy_m:25,positional_accuracy_kind:'MAX_BOUND',coverage_status:'PARTIAL',sources:[],assets:[]},
  inundation:{type:'FeatureCollection',features:[{type:'Feature',properties:{id:'test-1',source_id:'test-only',depth_label:'3–5m test'},
    geometry:{type:'Polygon',coordinates:[square(141,38,141.02,38.02),square(141.005,38.005,141.015,38.015)]}}]},places:[],coverage:null};
afterEach(()=>vi.unstubAllGlobals());

describe('official scenario geometry never certifies safety',()=>{
  it('does not invent a zero-error precision for an official facility reference coordinate',()=>{
    expect(typeof officialPlaceLocation).toBe('function');
    const location=officialPlaceLocation({lat:141,lng:38},now);
    expect(location.source).toBe('OFFICIAL_PLACE');expect(location.accuracy_m).toBeNull();
    const valid=officialPlaceLocation({lat:38.002,lng:141.002},now);
    expect(assessOfficialHazards(pack,valid,now)).toMatchObject({status:'UNKNOWN',reason:'SOURCE_LOCATION_ACCURACY_UNKNOWN',route_authorized:false});
  });
  it('retains polygon holes and incomplete survey coverage',()=>{
    expect(assessOfficialHazards(pack,fix(141.002,38.002),now).status).toBe('INSIDE_KNOWN');
    const hole=assessOfficialHazards(pack,fix(141.01,38.01),now);
    expect(hole.status).toBe('UNKNOWN');expect(hole.reason).toBe('NO_VERIFIED_SURVEY_COVERAGE');
    expect(assessOfficialHazards(pack,fix(139,35),now).status).toBe('UNKNOWN');
  });
  it('treats exact edges and accuracy crossing holes as uncertain',()=>{
    expect(assessOfficialHazards(pack,fix(141,38.01),now).status).toBe('BOUNDARY_UNCERTAIN');
    expect(assessOfficialHazards(pack,fix(141.004,38.01,120),now).status).toBe('BOUNDARY_UNCERTAIN');
  });
  it('queries MultiPolygon islands independently',()=>{
    const multi:HazardPack={...pack,inundation:{type:'FeatureCollection',features:[{...pack.inundation.features[0],geometry:{type:'MultiPolygon',coordinates:[[square(141,38,141.02,38.02)],[square(141.1,38.1,141.12,38.12)]]}}]}};
    expect(assessOfficialHazards(multi,fix(141.11,38.11),now).status).toBe('INSIDE_KNOWN');
    expect(assessOfficialHazards(multi,fix(141.05,38.05),now).status).toBe('UNKNOWN');
  });
  it('preserves conflicting depth classes without inventing a precise water level',()=>{
    const conflicting={...pack,inundation:{type:'FeatureCollection' as const,features:[pack.inundation.features[0],{...pack.inundation.features[0],properties:{...pack.inundation.features[0].properties,id:'test-2',depth_label:'5–10m test'}}]}};
    const result=assessOfficialHazards(conflicting,fix(141.002,38.002),now);
    expect(result.status).toBe('BOUNDARY_UNCERTAIN');expect(result.depth_labels).toHaveLength(2);
  });
  it('allows a nonintersection statement only inside separate verified survey coverage',()=>{
    const reviewed:HazardPack={...pack,manifest:{...pack.manifest,coverage_status:'VERIFIED'},coverage:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[square(140,37,142,39)]}}]}};
    const result=assessOfficialHazards(reviewed,fix(141.5,38.5),now);
    expect(result.status).toBe('OUTSIDE_KNOWN');expect(result.safe_location_verified).toBe(false);expect(result.route_authorized).toBe(false);
    expect(assessOfficialHazards(reviewed,fix(140,38),now).status).toBe('UNKNOWN');
  });
  it('fails closed on absent, old, future, invalid or imprecise location and expired review',()=>{
    expect(assessOfficialHazards(pack,null,now).status).toBe('UNKNOWN');
    for(const input of [{...fix(141,38),lat:91},{...fix(141,38),accuracy_m:-1},{...fix(141,38),accuracy_m:1001},
      {...fix(141,38),source:'GPS' as const,captured_at:now-120001},{...fix(141,38),captured_at:now+5001}]){
      expect(assessOfficialHazards(pack,input,now).status).toBe('UNKNOWN');
    }
    const deadline=Date.parse(pack.manifest.review_due_at);
    expect(assessOfficialHazards(pack,{...fix(141.002,38.002),captured_at:deadline},deadline).reason).toBe('DATA_REVIEW_EXPIRED');
  });
  it('all geographic outcomes preserve false authorization',()=>{
    for(const point of [null,fix(141.002,38.002),fix(141,38),fix(139,35)]){
      expect(assessOfficialHazards(pack,point,now)).toMatchObject({safe_location_verified:false,route_authorized:false});
    }
  });
  it('does not treat a source standard deviation or unknown accuracy as a guaranteed bound',()=>{
    for(const positional_accuracy_kind of ['STANDARD_DEVIATION','UNKNOWN'] as const){
      const uncertain={...pack,manifest:{...pack.manifest,positional_accuracy_kind}};
      expect(assessOfficialHazards(uncertain,fix(141.002,38.002),now)).toMatchObject({status:'BOUNDARY_UNCERTAIN',reason:'SOURCE_ACCURACY_NOT_BOUND',depth_labels:['3–5m test']});
      expect(assessOfficialHazards(uncertain,fix(139,35),now).status).toBe('UNKNOWN');
    }
  });
});

describe('official catalog validation',()=>{
  const place={id:'TEST_ONLY',name:'Test site',address:null,lat:38,lng:141,kind:'EMERGENCY_SITE',
    hazards:{flood:'UNKNOWN',landslide:'UNKNOWN',storm_surge:'UNKNOWN',earthquake:'DESIGNATED',tsunami:'DESIGNATED',large_fire:'UNKNOWN',inland_flood:'UNKNOWN',volcano:'UNKNOWN'},
    source_id:'test-only',notes:'test only',open_status:'UNKNOWN'};
  it('distinguishes emergency hazard designation from shelter identity without claiming opening',()=>{
    const emergency=officialPlaceSchema.parse(place);expect(isTsunamiDesignated(emergency)).toBe(true);
    expect(isTsunamiDesignated({...emergency,kind:'SHELTER'})).toBe(false);
    expect(isTsunamiDesignated({...emergency,hazards:{...emergency.hazards,tsunami:'UNKNOWN'}})).toBe(false);
    expect(officialPlaceSchema.safeParse({...place,open_status:'OPEN'}).success).toBe(false);
    expect(officialPlaceSchema.safeParse({...place,hazards:{...place.hazards,tsunami:'yes'}}).success).toBe(false);
  });
  it('rejects foreign asset paths and dishonest local review intervals',()=>{
    const manifest={...pack.manifest,sources:[{id:'test-only',title:'Test only',url:'https://www.gsi.go.jp/',basis_date:null,published_at:null,
      retrieved_at:'2026-10-11T00:00:00Z',raw_sha256:'a'.repeat(64),license_url:'https://www.gsi.go.jp/',notes:'test only'}],
      assets:[{path:'/hazards/test/inundation.geojson',bytes:100,sha256:'a'.repeat(64),kind:'inundation'}, {path:'/hazards/test/places.json',bytes:100,sha256:'a'.repeat(64),kind:'places'}]};
    expect(hazardManifestSchema.safeParse(manifest).success).toBe(true);
    expect(hazardManifestSchema.safeParse({...manifest,positional_accuracy_m:undefined}).success).toBe(false);
    expect(hazardManifestSchema.safeParse({...manifest,positional_accuracy_kind:undefined}).success).toBe(false);
    expect(hazardManifestSchema.safeParse({...manifest,assets:[{...manifest.assets[0],path:'https://other.example/private.json'},manifest.assets[1]]}).success).toBe(false);
    expect(hazardManifestSchema.safeParse({...manifest,review_due_at:manifest.reviewed_at}).success).toBe(false);
  });
  it('does not accept a substituted or missing manifest',async()=>{
    vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}')));
    await expect(loadOfficialHazardPack()).rejects.toThrow('integrity');
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:404})));
    await expect(loadOfficialHazardPack()).rejects.toThrow('unavailable');
  });
});
