import {expect,it,vi} from 'vitest';
import type {DesignatedPlace} from '../lib/designated-places';

const road=vi.hoisted(()=>({reason:'OUTSIDE_PACK_BOUNDS' as string}));
vi.mock('../lib/evacuation-road-graph',async orig=>({...await orig<typeof import('../lib/evacuation-road-graph')>(),
  findEvacuationRoadCandidates:()=>({candidates:[],reason:road.reason})}));
const {resolveTsunamiGuidance}=await import('../lib/distress-reachability');
const {EVACUATION_ROAD_BOUNDS}=await import('../lib/evacuation-road-graph');

const NOW=Date.parse('2026-10-13T08:00:00Z');
const lat=(EVACUATION_ROAD_BOUNDS.south+EVACUATION_ROAD_BOUNDS.north)/2,lng=(EVACUATION_ROAD_BOUNDS.west+EVACUATION_ROAD_BOUNDS.east)/2;
const near={id:'emergency_site:NEAR',kind:'EMERGENCY_SITE',name:'near',lat:lat+0.002,lng,hazards:{tsunami:'DESIGNATED'}} as unknown as DesignatedPlace;
const run=()=>resolveTsunamiGuidance({origin:{lat,lng,accuracy_m:10},deadlineAt:NOW+3_600_000,now:NOW,tags:[],places:[near],graph:{} as never});

it('falls back to straight-line only for allow-listed "graph not applicable" reasons',()=>{
  for(const reason of ['OUTSIDE_PACK_BOUNDS','INVALID_GRAPH','ORIGIN_TOO_FAR_FROM_ROAD','DESTINATION_TOO_FAR_FROM_ROAD','SAME_GRAPH_NODE']){
    road.reason=reason;expect(run().kind).toBe('GO_TO_SITE');
  }
  for(const reason of ['DISCONNECTED_GRAPH','IMPLAUSIBLE_DISTANCE','INVALID_COORDINATE','SOME_FUTURE_REASON']){
    road.reason=reason;expect(run()).toMatchObject({kind:'VERTICAL_NOW',reason:'NO_REACHABLE_SITE'});
  }
});
