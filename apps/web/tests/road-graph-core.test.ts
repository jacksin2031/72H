// apps/web/tests/road-graph-core.test.ts
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {adjacencyValidationCountForTests,buildReferenceGraph,findRoadCandidates} from '../lib/road-graph-core';

const bounds={south:38.40,west:141.27,north:38.42,east:141.30};
const road={highway:'residential'};
const line=(n:number)=>({bounds,sources:[{pack_id:'t',retrieved_at:'2026-10-15T00:00:00Z',osm_base_timestamp:null}],
  nodes:Array.from({length:n},(_,i)=>({osm_id:i+1,lat:38.41,lng:141.28+i*0.001,tags:{}})),
  ways:[{osm_id:1,tags:road}],
  edges:Array.from({length:n-1},(_,i)=>({from_node_index:i,to_node_index:i+1,way_index:0,direction:'BIDIRECTIONAL' as const,distance_m:0}))});

describe('buildReferenceGraph',()=>{
  it('is always reference-only and recomputes edge lengths',()=>{
    const g=buildReferenceGraph(line(5));
    expect(g.role).toBe('ROAD_REFERENCE_ONLY');expect(g.movement_authorized).toBe(false);
    expect(g.edges[0].distance_m).toBeGreaterThan(80);
  });
  it('rejects nodes outside bounds, ineligible ways, disconnected nodes and oversize graphs',()=>{
    expect(()=>buildReferenceGraph({...line(3),nodes:[...line(3).nodes,{osm_id:99,lat:10,lng:10,tags:{}}]})).toThrow();
    expect(()=>buildReferenceGraph({...line(3),ways:[{osm_id:1,tags:{highway:'motorway'}}]})).toThrow();
    expect(()=>buildReferenceGraph(line(5),{maxNodes:4,maxEdges:100})).toThrow();
  });
});

describe('findRoadCandidates',()=>{
  it('finds a reference candidate along the line and never authorizes movement',()=>{
    const g=buildReferenceGraph(line(10));
    const r=findRoadCandidates(g,{lat:38.41,lng:141.28},{lat:38.41,lng:141.288});
    expect(r.reason).toBeNull();expect(r.candidates[0].distance_m).toBeGreaterThan(600);
    expect(r.map_layer).toBe('ROAD_REFERENCE_ONLY');expect(r.movement_authorized).toBe(false);
  });
  it('reports OUTSIDE_PACK_BOUNDS rather than inventing a line',()=>{
    const r=findRoadCandidates(buildReferenceGraph(line(4)),{lat:38.41,lng:141.28},{lat:35.0,lng:139.0});
    expect(r.candidates).toEqual([]);expect(r.reason).toBe('OUTSIDE_PACK_BOUNDS');
  });
});

describe('buildReferenceGraph invariants',()=>{
  it('rejects an in-bounds node with no edge',()=>{
    expect(()=>buildReferenceGraph({...line(3),nodes:[...line(3).nodes,{osm_id:99,lat:38.41,lng:141.29,tags:{}}]})).toThrow();
  });
  it('rejects too many edges, duplicate OSM ids, bad edge references and over-1000 m segments',()=>{
    expect(()=>buildReferenceGraph(line(5),{maxNodes:100,maxEdges:3})).toThrow();
    const dup=line(3);
    expect(()=>buildReferenceGraph({...dup,nodes:dup.nodes.map(n=>({...n,osm_id:1}))})).toThrow();
    expect(()=>buildReferenceGraph({...line(3),edges:[...line(3).edges,{from_node_index:0,to_node_index:9,way_index:0,direction:'BIDIRECTIONAL' as const,distance_m:0}]})).toThrow();
    expect(()=>buildReferenceGraph({...line(3),edges:[...line(3).edges,{from_node_index:0,to_node_index:0,way_index:0,direction:'BIDIRECTIONAL' as const,distance_m:0}]})).toThrow();
    const far=line(2);
    expect(()=>buildReferenceGraph({...far,nodes:[far.nodes[0],{...far.nodes[1],lng:141.295}]})).toThrow();
  });
  it('ignores a supplied distance and never accepts a zero-length edge',()=>{
    const g=buildReferenceGraph({...line(3),edges:line(3).edges.map(e=>({...e,distance_m:5}))});
    expect(g.edges.every(e=>e.distance_m>80&&e.distance_m<100)).toBe(true);
    const same=line(2);
    expect(()=>buildReferenceGraph({...same,nodes:[same.nodes[0],{...same.nodes[1],lng:same.nodes[0].lng}]})).toThrow();
  });
  it('requires the pedestrian direction to match oneway:foot',()=>{
    const oneway=(tags:Record<string,string>,direction:'BIDIRECTIONAL'|'FORWARD'|'REVERSE')=>
      ()=>buildReferenceGraph({...line(3),ways:[{osm_id:1,tags:{...road,...tags}}],edges:line(3).edges.map(e=>({...e,direction}))});
    expect(oneway({'oneway:foot':'yes'},'FORWARD')).not.toThrow();
    expect(oneway({'oneway:foot':'-1'},'REVERSE')).not.toThrow();
    expect(oneway({'oneway:foot':'no'},'BIDIRECTIONAL')).not.toThrow();
    expect(oneway({'oneway:foot':'yes'},'BIDIRECTIONAL')).toThrow();
    expect(oneway({'oneway:foot':'-1'},'FORWARD')).toThrow();
    expect(oneway({},'FORWARD')).toThrow();
  });
  it('follows a FORWARD-only way in one direction only',()=>{
    const g=buildReferenceGraph({...line(5),ways:[{osm_id:1,tags:{...road,'oneway:foot':'yes'}}],edges:line(5).edges.map(e=>({...e,direction:'FORWARD' as const}))});
    expect(findRoadCandidates(g,{lat:38.41,lng:141.28},{lat:38.41,lng:141.284}).reason).toBeNull();
    expect(findRoadCandidates(g,{lat:38.41,lng:141.284},{lat:38.41,lng:141.28}).reason).toBe('DISCONNECTED_GRAPH');
  });
  it('rejects inverted bounds, missing or empty sources and limits above the ceiling',()=>{
    expect(()=>buildReferenceGraph({...line(3),bounds:{south:38.42,west:141.27,north:38.40,east:141.30}})).toThrow();
    expect(()=>buildReferenceGraph({...line(3),sources:[]})).toThrow();
    expect(()=>buildReferenceGraph({...line(3),sources:[{pack_id:'',retrieved_at:'x',osm_base_timestamp:null}]})).toThrow();
    expect(()=>buildReferenceGraph(line(3),{maxNodes:180_001,maxEdges:360_000})).toThrow();
  });
  it('accepts the tag limits the backend tile builder emits and rejects anything beyond them',()=>{
    const many=Object.fromEntries(Array.from({length:199},(_,i)=>[`k${i}`,'v']));
    const longKey='k'.repeat(100),longValue='\u{1F30A}'.repeat(1000); // 1000 code points, 2000 UTF-16 units
    expect(()=>buildReferenceGraph({...line(3),ways:[{osm_id:1,tags:{...road,...many}}]})).not.toThrow();
    expect(()=>buildReferenceGraph({...line(3),ways:[{osm_id:1,tags:{...road,[longKey]:longValue}}]})).not.toThrow();
    expect(()=>buildReferenceGraph({...line(3),ways:[{osm_id:1,tags:{...road,...many,extra:'v'}}]})).toThrow();
    expect(()=>buildReferenceGraph({...line(3),ways:[{osm_id:1,tags:{...road,[longKey+'k']:'v'}}]})).toThrow();
    expect(()=>buildReferenceGraph({...line(3),ways:[{osm_id:1,tags:{...road,name:longValue+'x'}}]})).toThrow();
    expect(()=>buildReferenceGraph({...line(3),ways:[{osm_id:1,tags:{...road,name:5 as unknown as string}}]})).toThrow();
    const nodes=line(3).nodes.map((n,i)=>i===1?{...n,tags:{...many,extra:'v',extra2:'v'}}:n); // 201 tags
    expect(()=>buildReferenceGraph({...line(3),nodes})).toThrow();
  });
  it('builds a graph from the committed backend tile sample',()=>{
    type Tile={pack_id:string;built_at:string;bounds:[number,number,number,number];source:{retrieved_at:string;osm_base_timestamp:string};
      nodes:([number,number,number]|[number,number,number,Record<string,string>])[];ways:[number,Record<string,string>][];edges:([number,number,number]|[number,number,number,1|2])[]};
    const tile=JSON.parse(readFileSync(new URL('./fixtures/road-tile-r1920c5651.json',import.meta.url),'utf8')) as Tile;
    const [south,west,north,east]=tile.bounds;
    const g=buildReferenceGraph({bounds:{south,west,north,east},
      sources:[{pack_id:tile.pack_id,retrieved_at:tile.source.retrieved_at,osm_base_timestamp:tile.source.osm_base_timestamp}],
      nodes:tile.nodes.map(([osm_id,lat,lng,tags])=>({osm_id,lat,lng,tags:tags??{}})),
      ways:tile.ways.map(([osm_id,tags])=>({osm_id,tags})),
      edges:tile.edges.map(([from_node_index,to_node_index,way_index,code])=>({from_node_index,to_node_index,way_index,
        direction:code===1?'FORWARD' as const:code===2?'REVERSE' as const:'BIDIRECTIONAL' as const,distance_m:0}))});
    expect(g.nodes).toHaveLength(4);expect(g.movement_authorized).toBe(false);
    const r=findRoadCandidates(g,{lat:38.405,lng:141.28},{lat:38.411,lng:141.289});
    expect(r.reason).toBeNull();expect(r.candidates[0].road_names).toEqual(['fixture footway']);
  });
  it('returns a frozen graph',()=>{
    const g=buildReferenceGraph(line(3));
    expect(Object.isFrozen(g)).toBe(true);expect(Object.isFrozen(g.edges)).toBe(true);
  });
});

describe('findRoadCandidates fails closed on a tampered graph',()=>{
  it('rejects a graph whose authority or role was changed after building',()=>{
    const g=buildReferenceGraph(line(5));
    const o={lat:38.41,lng:141.28},d={lat:38.41,lng:141.284};
    expect(findRoadCandidates({...g,movement_authorized:true} as never,o,d).reason).toBe('INVALID_GRAPH');
    expect(findRoadCandidates({...g,role:'ROUTE'} as never,o,d).reason).toBe('INVALID_GRAPH');
    expect(findRoadCandidates({...g,ways:[{osm_id:1,tags:{highway:'motorway'}}]},o,d).reason).toBe('INVALID_GRAPH');
    expect(findRoadCandidates({...g,nodes:[...g.nodes,{osm_id:99,lat:38.41,lng:141.29,tags:{}}]},o,d).reason).toBe('INVALID_GRAPH');
    expect(findRoadCandidates({} as never,o,d).reason).toBe('INVALID_GRAPH');
    expect(findRoadCandidates(g,{lat:Number.NaN,lng:141.28},d).reason).toBe('INVALID_COORDINATE');
  });
});

describe('findRoadCandidates tamper coverage',()=>{
  const o={lat:38.41,lng:141.28},d={lat:38.41,lng:141.284};
  it('rejects a spread copy whose edge direction no longer matches oneway:foot',()=>{
    const g=buildReferenceGraph(line(5));
    expect(findRoadCandidates({...g,edges:g.edges.map(e=>({...e,direction:'FORWARD' as const}))},o,d).reason).toBe('INVALID_GRAPH');
  });
  it('rejects a spread copy whose nodes were moved so an edge exceeds 1000 m',()=>{
    const g=buildReferenceGraph({...line(3),bounds:{south:38.40,west:141.27,north:38.42,east:141.33}});
    const stretched=g.nodes.map((n,i)=>i===2?{...n,lng:141.325}:n);
    expect(findRoadCandidates({...g,nodes:stretched},o,d).reason).toBe('INVALID_GRAPH');
  });
  it('returns INVALID_GRAPH, not a TypeError, for sparse node, way or edge arrays',()=>{
    const g=buildReferenceGraph(line(5));
    const holed=<T,>(list:readonly T[],at:number)=>{const copy=[...list];delete copy[at];return copy;};
    expect(findRoadCandidates({...g,nodes:holed(g.nodes,4)},o,d).reason).toBe('INVALID_GRAPH');
    expect(findRoadCandidates({...g,ways:[...g.ways,undefined as never]},o,d).reason).toBe('INVALID_GRAPH');
    const sparseWays=[...g.ways];sparseWays.length=2; // hole at index 1, never referenced by an edge
    expect(findRoadCandidates({...g,ways:sparseWays},o,d).reason).toBe('INVALID_GRAPH');
    expect(findRoadCandidates({...g,edges:holed(g.edges,1)},o,d).reason).toBe('INVALID_GRAPH');
  });
  it('rejects sparse arrays when building',()=>{
    const input=line(3);
    const ways=[...input.ways];ways.length=2;
    expect(()=>buildReferenceGraph({...input,ways})).toThrow();
    const sources=[...input.sources];sources.length=2;
    expect(()=>buildReferenceGraph({...input,sources})).toThrow();
  });
});

describe('validated adjacency cache',()=>{
  const o={lat:38.41,lng:141.28},d={lat:38.41,lng:141.284};
  it('validates and builds adjacency once per built graph',()=>{
    const g=buildReferenceGraph(line(5));
    const before=adjacencyValidationCountForTests();
    const first=findRoadCandidates(g,o,d);
    const second=findRoadCandidates(g,o,{lat:38.41,lng:141.283});
    expect(adjacencyValidationCountForTests()-before).toBe(1);
    expect(first.reason).toBeNull();expect(second.reason).toBeNull();
    expect(findRoadCandidates(g,o,d)).toEqual(first);
    expect(adjacencyValidationCountForTests()-before).toBe(1);
  });
  it('re-validates spread copies and hand-built graphs on every call, so tampering still fails closed',()=>{
    const g=buildReferenceGraph(line(5));
    findRoadCandidates(g,o,d);
    const before=adjacencyValidationCountForTests();
    const copy={...g};
    expect(findRoadCandidates(copy,o,d).reason).toBeNull();
    expect(findRoadCandidates(copy,o,d).reason).toBeNull();
    expect(adjacencyValidationCountForTests()-before).toBe(2);
    expect(findRoadCandidates({...g,movement_authorized:true} as never,o,d).reason).toBe('INVALID_GRAPH');
    expect(findRoadCandidates({...g,ways:[{osm_id:1,tags:{highway:'motorway'}}]},o,d).reason).toBe('INVALID_GRAPH');
    expect(findRoadCandidates({...g,edges:g.edges.map(e=>({...e,direction:'REVERSE' as const}))},o,d).reason).toBe('INVALID_GRAPH');
    // The cached original is unaffected by the tampered copies.
    expect(findRoadCandidates(g,o,d).reason).toBeNull();
  });
  it('cannot be tampered with in place because the built graph is deep-frozen',()=>{
    const g=buildReferenceGraph(line(3));
    expect(Object.isFrozen(g.nodes[0])).toBe(true);expect(Object.isFrozen(g.ways[0].tags)).toBe(true);
    expect(Object.isFrozen(g.bounds)).toBe(true);expect(Object.isFrozen(g.edges[0])).toBe(true);
  });
});
