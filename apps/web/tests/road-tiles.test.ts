import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import {loadRoadTilesAround,tileIdFor,tilesAround,type TileStore} from '../lib/road-tiles';

const P={lat:38.41,lng:141.28};
const CENTRE='r1920c5651';
const EAST='r1920c5652';

async function sha(value:object){
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
}

function tileBounds(id:string){
  const match=/^r(\d+)c(\d+)$/.exec(id)!;
  const south=Number(match[1])*0.02,west=Number(match[2])*0.025;
  const round=(value:number)=>Math.round(value*1_000_000)/1_000_000;
  return [round(south-0.002),round(west-0.002),round(south+0.022),round(west+0.027)] as const;
}

async function tile(id:string,retrieved='2026-10-15T00:00:00+00:00'){
  const match=/^r(\d+)c(\d+)$/.exec(id)!;
  const row=Number(match[1]),col=Number(match[2]);
  const bounds=tileBounds(id);
  const shared=id===CENTRE||id===EAST;
  const nodeBase=shared?9_000_000_000_001:row*1_000_000_000+col*10+1;
  const wayId=shared?8_000_000_000_001:row*1_000_000_000+col*10+5;
  const nodes=shared
    ? [[nodeBase,38.41,141.299],[nodeBase+1,38.41,141.301]]
    : [[nodeBase,bounds[0]+0.01,bounds[1]+0.01],[nodeBase+1,bounds[0]+0.01,bounds[1]+0.011,{'highway':'crossing'}]];
  const body={schema_version:2,pack_id:`osm-tile-${id}-v1`,role:'ROAD_REFERENCE_ONLY',movement_authorized:false,built_at:retrieved,
    bounds,capacity:[20000,40000],counts:[2,1,1],
    source:{name:'OpenStreetMap contributors',endpoint:'https://overpass-api.de/api/interpreter',copyright_url:'https://www.openstreetmap.org/copyright',license:'ODbL-1.0',license_url:'https://opendatacommons.org/licenses/odbl/1-0/',osm_base_timestamp:null,retrieved_at:retrieved,raw_sha256:'0'.repeat(64),query_sha256:'0'.repeat(64)},
    nodes,ways:[[wayId,{highway:'residential','oneway:foot':'yes'}]],edges:[[0,1,0,1]]};
  return {...body,content_sha256:await sha(body)};
}

async function emptyTile(id:string,retrieved='2026-10-15T00:00:00+00:00'){
  const body={schema_version:2,pack_id:`osm-tile-${id}-v1`,role:'ROAD_REFERENCE_ONLY',movement_authorized:false,built_at:retrieved,
    bounds:tileBounds(id),capacity:[20000,40000],counts:[0,0,0],
    source:{name:'OpenStreetMap contributors',endpoint:'https://overpass-api.de/api/interpreter',copyright_url:'https://www.openstreetmap.org/copyright',license:'ODbL-1.0',license_url:'https://opendatacommons.org/licenses/odbl/1-0/',osm_base_timestamp:'2026-10-15T04:27:04Z',retrieved_at:retrieved,raw_sha256:'0'.repeat(64),query_sha256:'0'.repeat(64)},
    nodes:[],ways:[],edges:[]};
  return {...body,content_sha256:await sha(body)};
}
async function tileSnapshot(id:string,options:{reverseNodes?:boolean;bidirectional?:boolean}={}){
  const source=await tile(id);
  const {content_sha256:_contentSha,...body}=source;
  const nodes=options.reverseNodes?[...source.nodes].reverse():source.nodes;
  const ways=options.bidirectional
    ?(source.ways as [number,Record<string,string>][]).map(([osmId,tags])=>[osmId,{highway:tags.highway}] as const)
    :source.ways;
  const edges=options.bidirectional?[[0,1,0] as const]:[[0,1,0,1] as const];
  const snapshot={...body,nodes,ways,edges};
  return {...snapshot,content_sha256:await sha(snapshot)};
}

function fakeIndexedDb(options:{commitDelayMs?:number;failPutKey?:string}={}){
  const values=new Map<string,unknown>();
  const failedKeys=new Set<string>();
  const delay=options.commitDelayMs??1;
  let abortCount=0;
  let firstPutResolved=false;
  let resolveFirstPut!:(key:string)=>void;
  const firstPutStarted=new Promise<string>((resolve)=>{resolveFirstPut=resolve;});
  const database={
    objectStoreNames:{contains:()=>true},
    transaction:()=>{
      let aborted=false;
      let timer:ReturnType<typeof setTimeout>|undefined;
      const transaction:{
        error:unknown;
        oncomplete:(()=>void)|null;
        onerror:(()=>void)|null;
        onabort:(()=>void)|null;
        abort:()=>void;
        objectStore:()=>{
          get:(key:IDBValidKey)=>unknown;
          put:(value:unknown,key?:IDBValidKey)=>unknown;
        };
      }={
        error:null,
        oncomplete:null,
        onerror:null,
        onabort:null,
        abort:()=>{
          abortCount+=1;aborted=true;
          if(timer!==undefined)clearTimeout(timer);
          queueMicrotask(()=>transaction.onabort?.());
        },
        objectStore:()=>({
          get:(key)=>{
            const request:{result:unknown;onsuccess:(()=>void)|null}={result:undefined,onsuccess:null};
            queueMicrotask(()=>{request.result=values.get(String(key));request.onsuccess?.();});
            return request;
          },
          put:(value,key='')=>{
            const id=String(key);
            if(!firstPutResolved){firstPutResolved=true;resolveFirstPut(id);}
            timer=setTimeout(()=>{
              if(aborted)return;
              if(id===options.failPutKey&&!failedKeys.has(id)){
                failedKeys.add(id);transaction.error=new Error('transient IndexedDB put failure');transaction.onerror?.();return;
              }
              values.set(id,value);transaction.oncomplete?.();
            },delay);
            return {};
          },
        }),
      };
      return transaction as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;
  const factory={
    open:()=>{
      const request:{result:IDBDatabase;onsuccess:(()=>void)|null}={result:database,onsuccess:null};
      queueMicrotask(()=>request.onsuccess?.());
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
  return {factory,values,firstPutStarted,get abortCount(){return abortCount;}};
}

const memStore=()=>{
  const m=new Map<string,unknown>();
  const store:TileStore={get:async(key)=>m.get(key)??null,put:async(key,value)=>{m.set(key,value);}};
  return {m,store};
};

function committedTile(name:string){
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`,import.meta.url),'utf8')) as Record<string,unknown>;
}

describe('tile ids',()=>{
  it('maps a point to its grid tile and returns a row-major 3×3 neighbourhood',()=>{
    expect(tileIdFor(P.lat,P.lng)).toBe(CENTRE);
    expect(tilesAround(P.lat,P.lng)).toEqual([
      'r1919c5650','r1919c5651','r1919c5652',
      'r1920c5650',CENTRE,EAST,
      'r1921c5650','r1921c5651','r1921c5652',
    ]);
  });
});

describe('loadRoadTilesAround',()=>{
  it('downloads at most three tiles concurrently, validates and merges without adjacent-tile ID collisions',async()=>{
    const {m,store}=memStore();let active=0,maxActive=0;
    const fetchTile=vi.fn(async(id:string)=>{
      active+=1;maxActive=Math.max(maxActive,active);
      await new Promise((resolve)=>setTimeout(resolve,1));
      const response=Response.json(await tile(id));active-=1;return response;
    });
    const result=await loadRoadTilesAround(P,{fetchTile,store,now:new Date('2026-10-16T00:00:00Z'),online:true});
    expect(result.status).toBe('READY');expect(fetchTile).toHaveBeenCalledTimes(9);expect(m.size).toBe(9);expect(maxActive).toBeLessThanOrEqual(3);
    if(result.status==='READY'){
      expect(result.graph.role).toBe('ROAD_REFERENCE_ONLY');expect(result.graph.movement_authorized).toBe(false);
      expect(result.graph.nodes).toHaveLength(16);expect(result.graph.ways).toHaveLength(8);expect(result.graph.edges).toHaveLength(8);
      expect(result.graph.edges.every((edge)=>edge.direction==='FORWARD')).toBe(true);
      expect(result.graph.sources).toHaveLength(9);expect(result.missing).toEqual([]);expect(result.stale).toBe(false);
      expect(result.oldestRetrievedAt).toBe('2026-10-15T00:00:00+00:00');expect(result.persisted).toBe(false);
    }
  });

  it('rejects reverse-oriented duplicate one-way snapshots whose allowed arcs oppose',async()=>{
    const {store}=memStore();
    const fetchTile=vi.fn(async(id:string)=>Response.json(id===EAST
      ?await tileSnapshot(id,{reverseNodes:true})
      :await tile(id)));
    await expect(loadRoadTilesAround(P,{fetchTile,store,online:true})).resolves.toEqual({status:'UNAVAILABLE',reason:'INVALID_DATA'});
  });

  it('collapses reverse-oriented bidirectional snapshots into one physical edge',async()=>{
    const {store}=memStore();
    const fetchTile=vi.fn(async(id:string)=>Response.json(id===CENTRE||id===EAST
      ?await tileSnapshot(id,{reverseNodes:id===EAST,bidirectional:true})
      :await tile(id)));
    const result=await loadRoadTilesAround(P,{fetchTile,store,online:true});
    expect(result.status).toBe('READY');
    if(result.status==='READY'){
      expect(result.graph.edges).toHaveLength(8);
      expect(result.graph.edges.filter((edge)=>result.graph.ways[edge.way_index].osm_id===8_000_000_000_001)).toHaveLength(1);
    }
  });

  it('accepts and converts the committed backend-generated tile with its backend SHA-256',async()=>{
    const {store}=memStore();
    const real=committedTile('road-tile-r1920c5651.json');
    const fetchTile=vi.fn(async(id:string)=>Response.json(id===CENTRE?real:await tile(id)));
    const result=await loadRoadTilesAround(P,{fetchTile,store,now:new Date('2026-10-16T00:00:00Z'),online:true});
    expect(result.status).toBe('READY');
    if(result.status==='READY'){
      expect(result.graph.nodes.some((node)=>node.tags.highway==='crossing')).toBe(true);
      expect(result.graph.sources.find((source)=>source.pack_id===`osm-tile-${CENTRE}-v1`)?.osm_base_timestamp).toBe('2026-10-15T00:00:00Z');
    }
  });

  it('accepts a backend tile with null base timestamp, oneway codes, and 1000 Unicode code points',async()=>{
    const {store}=memStore();
    const real=committedTile('road-tile-r1920c5651-oneway-null-base.json');
    const fetchTile=vi.fn(async(id:string)=>Response.json(id===CENTRE?real:await tile(id)));
    const result=await loadRoadTilesAround(P,{fetchTile,store,now:new Date('2026-10-16T00:00:00Z'),online:true});
    expect(result.status).toBe('READY');
    if(result.status==='READY'){
      expect(result.graph.sources.find((source)=>source.pack_id===`osm-tile-${CENTRE}-v1`)?.osm_base_timestamp).toBeNull();
      expect(result.graph.edges.some((edge)=>edge.direction==='FORWARD')).toBe(true);
      const name=result.graph.ways.find((way)=>way.osm_id===201)?.tags.name??'';
      expect(name).toHaveLength(2000);expect([...name]).toHaveLength(1000);
    }
  });

  it('rejects and does not store a tile whose hash does not match',async()=>{
    const {m,store}=memStore();
    const fetchTile=vi.fn(async(id:string)=>Response.json({...await tile(id),content_sha256:'f'.repeat(64)}));
    const result=await loadRoadTilesAround(P,{fetchTile,store,online:true});
    expect(result).toEqual({status:'UNAVAILABLE',reason:'INVALID_DATA'});expect(m.size).toBe(0);
  });

  it('reuses fresh stored tiles without fetching',async()=>{
    const {store}=memStore();
    for(const id of tilesAround(P.lat,P.lng))await store.put(id,await tile(id));
    const fetchTile=vi.fn();
    const result=await loadRoadTilesAround(P,{fetchTile,store,now:new Date('2026-10-16T00:00:00Z'),online:true});
    expect(fetchTile).not.toHaveBeenCalled();expect(result.status).toBe('READY');
  });

  it('offline uses stored tiles only and reports missing neighbours',async()=>{
    const {store}=memStore();
    for(const id of tilesAround(P.lat,P.lng).slice(3,6))await store.put(id,await tile(id));
    const fetchTile=vi.fn();const result=await loadRoadTilesAround(P,{fetchTile,store,online:false});
    expect(fetchTile).not.toHaveBeenCalled();expect(result.status).toBe('READY');
    if(result.status==='READY')expect(result.missing).toHaveLength(6);
  });

  it('requires the centre tile when offline, even if neighbouring tiles are cached',async()=>{
    const {store}=memStore();
    for(const id of tilesAround(P.lat,P.lng).filter((value)=>value!==CENTRE).slice(0,2))await store.put(id,await tile(id));
    await expect(loadRoadTilesAround(P,{store,online:false})).resolves.toEqual({status:'UNAVAILABLE',reason:'OFFLINE_NO_DATA'});
  });

  it('returns OFFLINE_NO_DATA when no cached tiles exist',async()=>{
    const {store}=memStore();
    await expect(loadRoadTilesAround(P,{store,online:false})).resolves.toEqual({status:'UNAVAILABLE',reason:'OFFLINE_NO_DATA'});
  });

  it('a 429 for a non-centre tile produces a partial READY result with that tile missing',async()=>{
    const {store}=memStore();const missing='r1919c5650';
    const fetchTile=vi.fn(async(id:string)=>id===missing?new Response('',{status:429}):Response.json(await tile(id)));
    const result=await loadRoadTilesAround(P,{fetchTile,store,online:true});
    expect(result.status).toBe('READY');
    if(result.status==='READY')expect(result.missing).toEqual([missing]);
  });

  it('returns TEMPORARILY_UNAVAILABLE when the online centre request fails without a cached centre',async()=>{
    const {store}=memStore();
    const fetchTile=vi.fn(async(id:string)=>id===CENTRE?new Response('',{status:503}):Response.json(await tile(id)));
    await expect(loadRoadTilesAround(P,{fetchTile,store,online:true})).resolves.toEqual({status:'UNAVAILABLE',reason:'TEMPORARILY_UNAVAILABLE'});
  });

  it('uses a stale cached centre after an online failure and labels stale fallback data',async()=>{
    const {store}=memStore();await store.put(CENTRE,await tile(CENTRE,'2026-08-01T00:00:00+00:00'));
    const fetchTile=vi.fn(async(id:string)=>id===CENTRE?new Response('',{status:503}):Response.json(await tile(id)));
    const result=await loadRoadTilesAround(P,{fetchTile,store,now:new Date('2026-10-15T00:00:00Z'),online:true});
    expect(result.status).toBe('READY');
    if(result.status==='READY'){
      expect(result.stale).toBe(true);expect(result.oldestRetrievedAt).toBe('2026-08-01T00:00:00+00:00');
      expect(result.missing).toEqual([]);
    }
  });

  it('marks expired tiles stale and records a failed non-centre refresh as missing',async()=>{
    const {store}=memStore();const ids=tilesAround(P.lat,P.lng);
    for(const id of ids)await store.put(id,await tile(id,'2026-08-01T00:00:00+00:00'));
    const missing=ids[0];const fetchTile=vi.fn(async(id:string)=>{
      if(id===missing||id===CENTRE)return new Response('',{status:503});
      return Response.json(await tile(id));
    });
    const result=await loadRoadTilesAround(P,{fetchTile,store,now:new Date('2026-10-15T00:00:00Z'),online:true});
    expect(result.status).toBe('READY');
    if(result.status==='READY'){
      expect(result.stale).toBe(true);expect(result.oldestRetrievedAt.startsWith('2026-08-01')).toBe(true);
      expect(result.missing).toEqual([missing]);
    }
  });

  it('a too-dense response from any tile makes the whole load unavailable',async()=>{
    const {m,store}=memStore();
    const fetchTile=vi.fn(async(id:string)=>id===EAST?new Response('{"detail":"ROAD_TILE_TOO_DENSE"}',{status:413}):Response.json(await tile(id)));
    await expect(loadRoadTilesAround(P,{fetchTile,store,online:true})).resolves.toEqual({status:'UNAVAILABLE',reason:'TOO_DENSE'});
    expect(m.size).toBe(0);
  });

  it('sends only tile IDs and one module-scoped X-Road-Session UUID on default fetches',async()=>{
    const {store}=memStore();const fetchMock=vi.fn(async(input:RequestInfo|URL,_init?:RequestInit)=>{
      const match=/\/api\/roads\/tile\/(r\d+c\d+)$/.exec(String(input));
      if(!match)throw new Error('Unexpected road tile URL');
      return Response.json(await tile(match[1]));
    });
    vi.stubGlobal('fetch',fetchMock);
    try{
      const result=await loadRoadTilesAround(P,{store,online:true});
      expect(result.status).toBe('READY');expect(fetchMock).toHaveBeenCalledTimes(9);
      const sessions=fetchMock.mock.calls.map(([,init])=>new Headers(init?.headers).get('X-Road-Session'));
      expect(sessions.every((value)=>value!==null&&/^[0-9a-f-]{36}$/i.test(value))).toBe(true);
      expect(new Set(sessions).size).toBe(1);
    }finally{vi.unstubAllGlobals();}
  });

  it('an aborted load stops without writing any fetched tile',async()=>{
    const {m,store}=memStore();const abort=new AbortController();
    const fetchTile=vi.fn(async(_id:string,signal?:AbortSignal)=>{
      abort.abort(new Error('cancelled'));
      if(signal?.aborted)throw signal.reason;
      return Response.json(await tile(CENTRE));
    });
    await expect(loadRoadTilesAround(P,{signal:abort.signal,fetchTile,store,online:true})).rejects.toThrow();
    expect(m.size).toBe(0);
  });

  it('aborts a pending default IndexedDB transaction before its tile commits',async()=>{
    vi.resetModules();
    const roads=await import('../lib/road-tiles');
    const idb=fakeIndexedDb({commitDelayMs:50});
    vi.stubGlobal('indexedDB',idb.factory);
    try{
      const abort=new AbortController();
      const load=roads.loadRoadTilesAround(P,{signal:abort.signal,fetchTile:async(id)=>Response.json(await tile(id)),online:true});
      await idb.firstPutStarted;
      abort.abort(new Error('cancelled during IndexedDB put'));
      await expect(load).rejects.toThrow('cancelled during IndexedDB put');
      expect(idb.abortCount).toBe(1);
      expect(idb.values.size).toBe(0);
    }finally{vi.unstubAllGlobals();}
  });

  it('keeps a newer verified fallback over an older database tile after a transient put failure',async()=>{
    vi.resetModules();
    const roads=await import('../lib/road-tiles');
    const idb=fakeIndexedDb({failPutKey:EAST});
    idb.values.set(EAST,await tile(EAST,'2026-08-01T00:00:00+00:00'));
    vi.stubGlobal('indexedDB',idb.factory);
    try{
      const fetchTile=async(id:string)=>Response.json(await tile(id));
      const first=await roads.loadRoadTilesAround(P,{fetchTile,now:new Date('2026-10-16T00:00:00Z'),online:true});
      expect(first.status).toBe('READY');
      if(first.status==='READY')expect(first.persisted).toBe(false);
      expect((idb.values.get(EAST) as Awaited<ReturnType<typeof tile>>).source.retrieved_at).toBe('2026-08-01T00:00:00+00:00');

      const offline=await roads.loadRoadTilesAround(P,{fetchTile:vi.fn(),now:new Date('2026-10-16T00:00:00Z'),online:false});
      expect(offline.status).toBe('READY');
      if(offline.status==='READY'){
        expect(offline.missing).toEqual([]);
        expect(offline.graph.sources.find((source)=>source.pack_id===`osm-tile-${EAST}-v1`)?.retrieved_at).toBe('2026-10-15T00:00:00+00:00');
        expect(offline.persisted).toBe(false);
        expect(offline.stale).toBe(false);
      }

      idb.values.set(EAST,await tile(EAST,'2026-10-16T00:00:00+00:00'));
      const newerDatabase=await roads.loadRoadTilesAround(P,{fetchTile:vi.fn(),now:new Date('2026-10-17T00:00:00Z'),online:false});
      expect(newerDatabase.status).toBe('READY');
      if(newerDatabase.status==='READY'){
        expect(newerDatabase.graph.sources.find((source)=>source.pack_id===`osm-tile-${EAST}-v1`)?.retrieved_at).toBe('2026-10-16T00:00:00+00:00');
        expect(newerDatabase.persisted).toBe(true);
      }

      const recovered=await roads.loadRoadTilesAround(P,{fetchTile:async(id)=>Response.json(await tile(id,'2026-11-16T00:00:00+00:00')),
        now:new Date('2026-11-17T00:00:00Z'),online:true});
      expect(recovered.status).toBe('READY');
      if(recovered.status==='READY')expect(recovered.persisted).toBe(true);
    }finally{vi.unstubAllGlobals();}
  });
  it('accepts a backend-generated empty water tile as coverage beside non-empty roads',async()=>{
    const {m,store}=memStore();
    const real=committedTile('road-tile-r1919c5651-empty.json');
    const emptyId='r1919c5651';
    const fetchTile=vi.fn(async(id:string)=>Response.json(id===emptyId?real:await tile(id)));
    const result=await loadRoadTilesAround(P,{fetchTile,store,now:new Date('2026-10-16T00:00:00Z'),online:true});
    expect(result.status).toBe('READY');expect(m.size).toBe(9);
    if(result.status==='READY'){
      expect(result.graph.sources.some((source)=>source.pack_id==='osm-tile-r1919c5651-v1'&&source.osm_base_timestamp==='2026-10-15T04:27:04Z')).toBe(true);
      expect(result.graph.nodes).toHaveLength(14);
      expect(result.graph.ways).toHaveLength(7);
      expect(result.graph.edges).toHaveLength(7);
      expect(result.missing).toEqual([]);
    }
    const offlineFetch=vi.fn();
    const offline=await loadRoadTilesAround(P,{fetchTile:offlineFetch,store,online:false});
    expect(offline.status).toBe('READY');expect(offlineFetch).not.toHaveBeenCalled();
    if(offline.status==='READY'){
      expect(offline.graph.sources.some((source)=>source.pack_id==='osm-tile-r1919c5651-v1')).toBe(true);
      expect(offline.graph.nodes).toHaveLength(14);
    }
  });

  it('reports NO_ROADS for a completely verified empty neighbourhood and reuses it offline',async()=>{
    const {m,store}=memStore();
    const fetchTile=vi.fn(async(id:string)=>Response.json(await emptyTile(id)));
    const online=await loadRoadTilesAround(P,{fetchTile,store,online:true});
    expect(online).toEqual({status:'UNAVAILABLE',reason:'NO_ROADS'});
    expect(fetchTile).toHaveBeenCalledTimes(9);expect(m.size).toBe(9);

    const offlineFetch=vi.fn();
    const offline=await loadRoadTilesAround(P,{fetchTile:offlineFetch,store,online:false});
    expect(offline).toEqual({status:'UNAVAILABLE',reason:'NO_ROADS'});
    expect(offlineFetch).not.toHaveBeenCalled();
  });

  it('rejects a rehashed partially empty tile that cannot form a valid reference graph',async()=>{
    const {m,store}=memStore();
    const real=committedTile('road-tile-r1919c5651-empty.json');
    const {content_sha256:_hash,...body}=real as Record<string,unknown>&{content_sha256:string};
    const mixed={...body,counts:[0,1,0],ways:[[123,{highway:'residential'}]]};
    const invalid={...mixed,content_sha256:await sha(mixed)};
    const fetchTile=vi.fn(async(id:string)=>Response.json(id==='r1919c5651'?invalid:await tile(id)));
    await expect(loadRoadTilesAround(P,{fetchTile,store,online:true})).resolves.toEqual({status:'UNAVAILABLE',reason:'INVALID_DATA'});
    expect(m.size).toBe(0);
  });
  it('does not claim NO_ROADS for an online empty-centre neighbourhood with missing tiles',async()=>{
    const {m,store}=memStore();
    const fetchTile=vi.fn(async(id:string)=>id===CENTRE?Response.json(await emptyTile(id)):new Response('',{status:503}));
    await expect(loadRoadTilesAround(P,{fetchTile,store,online:true})).resolves.toEqual({status:'UNAVAILABLE',reason:'TEMPORARILY_UNAVAILABLE'});
    expect(m.size).toBe(1);
  });
  it('does not call an incomplete empty offline cache a complete no-roads result',async()=>{
    const {store}=memStore();
    await store.put(CENTRE,await emptyTile(CENTRE));
    const fetchTile=vi.fn();
    await expect(loadRoadTilesAround(P,{fetchTile,store,online:false})).resolves.toEqual({status:'UNAVAILABLE',reason:'OFFLINE_NO_DATA'});
    expect(fetchTile).not.toHaveBeenCalled();
  });
});

describe('in-flight tile dedupe (R21)',()=>{
  const NORTH={lat:38.43,lng:141.28};// one row north of P: its 3×3 shares six tiles with P's
  const row=(r:number)=>[5650,5651,5652].map((c)=>`r${r}c${c}`);
  const tick=()=>new Promise((resolve)=>setTimeout(resolve,30));
  function gatedFetch(){
    const gates=new Map<string,{promise:Promise<void>;open:()=>void}>();
    const gate=(id:string)=>{
      let entry=gates.get(id);
      if(!entry){let open:()=>void=()=>{};const promise=new Promise<void>((resolve)=>{open=resolve;});entry={promise,open};gates.set(id,entry);}
      return entry;
    };
    const signals:AbortSignal[]=[];
    const fetchTile=vi.fn(async(id:string,signal?:AbortSignal)=>{
      if(signal)signals.push(signal);
      await gate(id).promise;
      return Response.json(await tile(id));
    });
    return {fetchTile,signals,release:(...ids:string[])=>ids.forEach((id)=>gate(id).open())};
  }
  const requested=(fetchTile:{mock:{calls:unknown[][]}})=>fetchTile.mock.calls.map(([id])=>id as string);

  it('two concurrent loads of the same 3×3 fetch each tile id once and both resolve READY',async()=>{
    const {m,store}=memStore();
    const {fetchTile,release}=gatedFetch();
    const first=loadRoadTilesAround(P,{fetchTile,store,online:true,now:new Date('2026-10-16T00:00:00Z')});
    const second=loadRoadTilesAround(P,{fetchTile,store,online:true,now:new Date('2026-10-16T00:00:00Z')});
    await tick();
    release(...tilesAround(P.lat,P.lng));
    const [a,b]=await Promise.all([first,second]);
    expect(a.status).toBe('READY');expect(b.status).toBe('READY');
    expect(fetchTile).toHaveBeenCalledTimes(9);
    expect(new Set(requested(fetchTile)).size).toBe(9);
    expect(m.size).toBe(9);
  });

  it('two concurrent loads of overlapping 3×3 sets fetch every shared tile id once',async()=>{
    const {store}=memStore();
    const {fetchTile,release}=gatedFetch();
    const south=loadRoadTilesAround(P,{fetchTile,store,online:true,now:new Date('2026-10-16T00:00:00Z')});
    const north=loadRoadTilesAround(NORTH,{fetchTile,store,online:true,now:new Date('2026-10-16T00:00:00Z')});
    await tick();
    expect(requested(fetchTile).sort()).toEqual([...row(1919),...row(1920)].sort());
    release(...row(1919));await tick();// the south load moves on to row 1920, already in flight for the north load
    expect(fetchTile).toHaveBeenCalledTimes(6);
    release(...row(1920));await tick();// both loads now need row 1921
    expect(fetchTile).toHaveBeenCalledTimes(9);
    release(...row(1921));await tick();
    release(...row(1922));
    const [a,b]=await Promise.all([south,north]);
    expect(a.status).toBe('READY');expect(b.status).toBe('READY');
    expect(fetchTile).toHaveBeenCalledTimes(12);
    expect(new Set(requested(fetchTile)).size).toBe(12);
  });

  it('a shared fetch survives the abort of one of its two consumers; the aborted one never receives the result',async()=>{
    const {m,store}=memStore();
    const {fetchTile,signals,release}=gatedFetch();
    const abortA=new AbortController(),abortB=new AbortController();
    const a=loadRoadTilesAround(P,{fetchTile,store,online:true,signal:abortA.signal,now:new Date('2026-10-16T00:00:00Z')});
    const b=loadRoadTilesAround(P,{fetchTile,store,online:true,signal:abortB.signal,now:new Date('2026-10-16T00:00:00Z')});
    const aOutcome=a.then(()=>'resolved',(error:unknown)=>error);
    await tick();
    expect(fetchTile).toHaveBeenCalledTimes(3);
    abortA.abort(new Error('point moved'));
    expect(signals.every((signal)=>!signal.aborted)).toBe(true);
    release(...tilesAround(P.lat,P.lng));
    await expect(b).resolves.toMatchObject({status:'READY',missing:[]});
    expect(await aOutcome).toEqual(new Error('point moved'));
    expect(fetchTile).toHaveBeenCalledTimes(9);
    expect(new Set(requested(fetchTile)).size).toBe(9);
    expect(m.size).toBe(9);
  });

  it('aborting the last consumer of a shared fetch aborts it, and a later load fetches afresh',async()=>{
    const {store}=memStore();
    const {fetchTile,signals,release}=gatedFetch();
    const abort=new AbortController();
    const first=loadRoadTilesAround(P,{fetchTile,store,online:true,signal:abort.signal}).catch(()=>'aborted');
    await tick();
    abort.abort(new Error('gone'));
    expect(signals).toHaveLength(3);
    expect(signals.every((signal)=>signal.aborted)).toBe(true);
    expect(await first).toBe('aborted');
    release(...tilesAround(P.lat,P.lng));
    const next=await loadRoadTilesAround(P,{fetchTile,store,online:true,now:new Date('2026-10-16T00:00:00Z')});
    expect(next.status).toBe('READY');
    expect(fetchTile).toHaveBeenCalledTimes(12);
  });
});
