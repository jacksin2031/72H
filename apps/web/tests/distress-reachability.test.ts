import {describe,expect,it} from 'vitest';
import {adviceCandidates,DISTRESS_PARAMS,resolveTsunamiGuidance} from '../lib/distress-reachability';
import type {DesignatedPlace} from '../lib/designated-places';

const NOW=Date.parse('2026-10-13T08:00:00Z');
const site=(id:string,lat:number,lng:number):DesignatedPlace=>({id:`emergency_site:${id}`,kind:'EMERGENCY_SITE',name:`site ${id}`,lat,lng,
  hazards:{tsunami:'DESIGNATED',earthquake:'NOT_DESIGNATED',flood:'NOT_DESIGNATED',landslide:'NOT_DESIGNATED',storm_surge:'NOT_DESIGNATED',large_fire:'NOT_DESIGNATED',inland_flood:'NOT_DESIGNATED',volcano:'NOT_DESIGNATED'}} as unknown as DesignatedPlace);
// 0.001° 緯度約等於 111 m
const origin={lat:38.4300,lng:141.3000,accuracy_m:10};
const near=site('NEAR',38.4330,141.3000); // 直線約 333 m
const far=site('FAR',38.4500,141.3000);  // 直線約 2224 m

describe('resolveTsunamiGuidance',()=>{
  it('goes to a site when straight-line x1.5 at 1.0 m/s fits before the deadline',()=>{
    const g=resolveTsunamiGuidance({origin,deadlineAt:NOW+10*60_000,now:NOW,tags:[],places:[near,far],graph:null});
    expect(g.kind).toBe('GO_TO_SITE');
    if(g.kind==='GO_TO_SITE'){expect(g.candidates.map(c=>c.place_id)).toEqual(['emergency_site:NEAR']);
      expect(g.candidates[0].walk_seconds).toBeCloseTo(333.6*1.5/1.0,-1);expect(g.candidates[0].via_road).toBe(false);}
  });
  it('halves walking speed for mobility, injury or dependents',()=>{
    expect(resolveTsunamiGuidance({origin,deadlineAt:NOW+600_000,now:NOW,tags:[],places:[near],graph:null}).kind).toBe('GO_TO_SITE');
    for(const tag of ['MOBILITY_LIMITED','INJURED','WITH_DEPENDENTS'] as const){
      expect(resolveTsunamiGuidance({origin,deadlineAt:NOW+600_000,now:NOW,tags:[tag],places:[near],graph:null}))
        .toMatchObject({kind:'VERTICAL_NOW',reason:'NO_REACHABLE_SITE'});
    }
  });
  it('switches to vertical evacuation when no time remains or arrival passed',()=>{
    expect(resolveTsunamiGuidance({origin,deadlineAt:NOW,now:NOW,tags:[],places:[near],graph:null})).toMatchObject({kind:'VERTICAL_NOW',reason:'NO_TIME'});
  });
  it('switches to vertical evacuation without a usable location',()=>{
    expect(resolveTsunamiGuidance({origin:null,deadlineAt:NOW+600_000,now:NOW,tags:[],places:[near],graph:null})).toMatchObject({kind:'VERTICAL_NOW',reason:'NO_LOCATION'});
    expect(resolveTsunamiGuidance({origin:{...origin,accuracy_m:150},deadlineAt:NOW+600_000,now:NOW,tags:[],places:[near],graph:null})).toMatchObject({kind:'VERTICAL_NOW',reason:'NO_LOCATION'});
  });
  it('adds GPS accuracy to distance when accuracy is worse than 50 m',()=>{
    const sharp=resolveTsunamiGuidance({origin,deadlineAt:NOW+3_600_000,now:NOW,tags:[],places:[near],graph:null});
    const blurry=resolveTsunamiGuidance({origin:{...origin,accuracy_m:80},deadlineAt:NOW+3_600_000,now:NOW,tags:[],places:[near],graph:null});
    if(sharp.kind!=='GO_TO_SITE'||blurry.kind!=='GO_TO_SITE')throw new Error('expected sites');
    expect(blurry.candidates[0].distance_m-sharp.candidates[0].distance_m).toBeCloseTo(80,0);
  });
  it('honours exclusions and reports when the pack has no tsunami sites',()=>{
    expect(resolveTsunamiGuidance({origin,deadlineAt:NOW+600_000,now:NOW,tags:[],places:[near],graph:null,excluded:['emergency_site:NEAR']})).toMatchObject({kind:'VERTICAL_NOW',reason:'NO_REACHABLE_SITE'});
    expect(resolveTsunamiGuidance({origin,deadlineAt:NOW+600_000,now:NOW,tags:[],places:[],graph:null})).toMatchObject({kind:'VERTICAL_NOW',reason:'NO_SITES_IN_PACK'});
  });
  it('never exposes coordinates to AI advice payloads',()=>{
    const g=resolveTsunamiGuidance({origin,deadlineAt:NOW+600_000,now:NOW,tags:[],places:[near],graph:null});
    const payload=JSON.stringify(adviceCandidates(g));
    expect(payload).not.toContain('38.43');expect(payload).not.toContain('141.3');
    expect(adviceCandidates(g)[0]).toEqual({place_id:'emergency_site:NEAR',name:'site NEAR',walk_minutes:Math.round(333.6*1.5/60)});
  });
  it('keeps the parameters from the spec',()=>{
    expect(DISTRESS_PARAMS).toMatchObject({walkMps:1.0,slowWalkMps:0.5,detourFactor:1.5,lowAccuracyM:50,maxAccuracyM:100});
  });
});
