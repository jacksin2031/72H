import {z} from 'zod';
import {buildReferenceGraph,type RoadReferenceGraph} from './road-graph-core';

const TILE_LAT_DEG=0.02;
const TILE_LNG_DEG=0.025;
const TILE_BUFFER_DEG=0.002;
const LAT_RANGE={min:20,max:46} as const;
const LNG_RANGE={min:122,max:154} as const;
const MAX_TILE_BYTES=1_500_000;
const MAX_TILE_NODES=20_000;
const MAX_TILE_WAYS=8_000;
const MAX_TILE_EDGES=40_000;
const CACHE_TTL_MS=30*24*60*60*1000;
const TILE_ENDPOINT='/api/roads/tile';
const ROAD_SESSION_ID=globalThis.crypto.randomUUID();

export interface TileStore {
  get(id:string):Promise<unknown|null>;
  put(id:string,value:unknown,signal?:AbortSignal):Promise<void>;
}

export type RoadTileState=
  | {status:'READY';graph:RoadReferenceGraph;missing:string[];oldestRetrievedAt:string;stale:boolean;persisted:boolean}
  | {status:'UNAVAILABLE';reason:'OFFLINE_NO_DATA'|'TOO_DENSE'|'TEMPORARILY_UNAVAILABLE'|'INVALID_DATA'|'NO_ROADS'};

type RoadPoint=Readonly<{lat:number;lng:number}>;
type LoadOptions=Readonly<{
  signal?:AbortSignal;
  fetchTile?:(id:string,signal?:AbortSignal)=>Promise<Response>;
  store?:TileStore;
  now?:Date;
  online?:boolean;
}>;

type TileNode=[number,number,number] | [number,number,number,Record<string,string>];
type TileWay=[number,Record<string,string>];
type TileEdge=[number,number,number] | [number,number,number,1|2];
type RoadTile={
  schema_version:2;
  pack_id:string;
  role:'ROAD_REFERENCE_ONLY';
  movement_authorized:false;
  built_at:string;
  bounds:[number,number,number,number];
  capacity:[20000,40000];
  counts:[number,number,number];
  source:{
    name:'OpenStreetMap contributors';
    endpoint:'https://overpass-api.de/api/interpreter';
    copyright_url:'https://www.openstreetmap.org/copyright';
    license:'ODbL-1.0';
    license_url:'https://opendatacommons.org/licenses/odbl/1-0/';
    osm_base_timestamp:string|null;
    retrieved_at:string;
    raw_sha256:string;
    query_sha256:string;
  };
  nodes:TileNode[];
  ways:TileWay[];
  edges:TileEdge[];
  content_sha256:string;
};

type ValidTile={tile:RoadTile};
type FetchOutcome=
  | {kind:'ready';value:ValidTile}
  | {kind:'missing'}
  | {kind:'too-dense'}
  | {kind:'invalid'};

const codePointString=(limit:number)=>z.string().refine((value)=>[...value].length<=limit,`Must be at most ${limit} Unicode code points`);
const tagsSchema=z.record(codePointString(100),codePointString(1000))
  .refine((tags)=>Object.keys(tags).length<=200,'Too many OSM tags');
const nodeSchema=z.union([
  z.tuple([z.number().int().positive().safe(),z.number().finite(),z.number().finite()]),
  z.tuple([z.number().int().positive().safe(),z.number().finite(),z.number().finite(),tagsSchema]),
]);
const waySchema=z.tuple([z.number().int().positive().safe(),tagsSchema]);
const edgeSchema=z.union([
  z.tuple([z.number().int().nonnegative(),z.number().int().nonnegative(),z.number().int().nonnegative()]),
  z.tuple([z.number().int().nonnegative(),z.number().int().nonnegative(),z.number().int().nonnegative(),z.union([z.literal(1),z.literal(2)])]),
]);
const sha256Schema=z.string().regex(/^[a-f0-9]{64}$/);
const tileSchema=z.object({
  schema_version:z.literal(2),
  pack_id:z.string().regex(/^osm-tile-r(?:0|[1-9][0-9]{0,3})c(?:0|[1-9][0-9]{0,3})-v1$/),
  role:z.literal('ROAD_REFERENCE_ONLY'),
  movement_authorized:z.literal(false),
  built_at:z.string().datetime({offset:true}),
  bounds:z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()]),
  capacity:z.tuple([z.literal(MAX_TILE_NODES),z.literal(MAX_TILE_EDGES)]),
  counts:z.tuple([
    z.number().int().nonnegative().max(MAX_TILE_NODES),
    z.number().int().nonnegative().max(MAX_TILE_WAYS),
    z.number().int().nonnegative().max(MAX_TILE_EDGES),
  ]),
  source:z.object({
    name:z.literal('OpenStreetMap contributors'),
    endpoint:z.literal('https://overpass-api.de/api/interpreter'),
    copyright_url:z.literal('https://www.openstreetmap.org/copyright'),
    license:z.literal('ODbL-1.0'),
    license_url:z.literal('https://opendatacommons.org/licenses/odbl/1-0/'),
    osm_base_timestamp:z.string().datetime({offset:true}).nullable(),
    retrieved_at:z.string().datetime({offset:true}),
    raw_sha256:sha256Schema,
    query_sha256:sha256Schema,
  }).strict(),
  nodes:z.array(nodeSchema).max(MAX_TILE_NODES),
  ways:z.array(waySchema).max(MAX_TILE_WAYS),
  edges:z.array(edgeSchema).max(MAX_TILE_EDGES),
  content_sha256:sha256Schema,
}).strict();

const unsupported:RoadTileState={status:'UNAVAILABLE',reason:'OFFLINE_NO_DATA'};

function throwIfAborted(signal?:AbortSignal):void{
  if(signal?.aborted)throw signal.reason??new DOMException('The operation was aborted','AbortError');
}

function roundGrid(value:number):number{return Math.round(value*1_000_000)/1_000_000;}

export function tileIdFor(lat:number,lng:number):string{
  return `r${Math.floor(lat/TILE_LAT_DEG)}c${Math.floor(lng/TILE_LNG_DEG)}`;
}

export function tilesAround(lat:number,lng:number):string[]{
  const row=Math.floor(lat/TILE_LAT_DEG),col=Math.floor(lng/TILE_LNG_DEG);
  const tiles:string[]=[];
  for(let rowOffset=-1;rowOffset<=1;rowOffset+=1){
    for(let colOffset=-1;colOffset<=1;colOffset+=1)tiles.push(`r${row+rowOffset}c${col+colOffset}`);
  }
  return tiles;
}

function isJapanPoint(point:RoadPoint):boolean{
  return Number.isFinite(point.lat)&&Number.isFinite(point.lng)
    &&point.lat>=LAT_RANGE.min&&point.lat<=LAT_RANGE.max
    &&point.lng>=LNG_RANGE.min&&point.lng<=LNG_RANGE.max;
}

function expectedTileBounds(id:string):[number,number,number,number]|null{
  const match=/^r(0|[1-9][0-9]{0,3})c(0|[1-9][0-9]{0,3})$/.exec(id);
  if(!match)return null;
  const row=Number(match[1]),col=Number(match[2]);
  const south=roundGrid(row*TILE_LAT_DEG),west=roundGrid(col*TILE_LNG_DEG);
  const north=roundGrid(south+TILE_LAT_DEG),east=roundGrid(west+TILE_LNG_DEG);
  if(south<LAT_RANGE.min||north>LAT_RANGE.max||west<LNG_RANGE.min||east>LNG_RANGE.max)return null;
  return [roundGrid(south-TILE_BUFFER_DEG),roundGrid(west-TILE_BUFFER_DEG),roundGrid(north+TILE_BUFFER_DEG),roundGrid(east+TILE_BUFFER_DEG)];
}

async function sha256(value:string):Promise<string>{
  if(!globalThis.crypto?.subtle)throw new Error('SHA-256 is unavailable');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),(byte)=>byte.toString(16).padStart(2,'0')).join('');
}

function tileGraph(tile:RoadTile):RoadReferenceGraph{
  const [south,west,north,east]=tile.bounds;
  return buildReferenceGraph({
    bounds:{south,west,north,east},
    sources:[{pack_id:tile.pack_id,retrieved_at:tile.source.retrieved_at,osm_base_timestamp:tile.source.osm_base_timestamp}],
    nodes:tile.nodes.map(([osm_id,lat,lng,tags])=>({osm_id,lat,lng,tags:tags??{}})),
    ways:tile.ways.map(([osm_id,tags])=>({osm_id,tags})),
    edges:tile.edges.map(([from_node_index,to_node_index,way_index,directionCode])=>({
      from_node_index,to_node_index,way_index,
      direction:directionCode===1?'FORWARD' as const:directionCode===2?'REVERSE' as const:'BIDIRECTIONAL' as const,
      distance_m:0,
    })),
  });
}

function isEmptyTile(tile:RoadTile):boolean{
  return tile.nodes.length===0&&tile.ways.length===0&&tile.edges.length===0;
}
async function validateTile(value:unknown,id:string):Promise<ValidTile|null>{
  const parsed=tileSchema.safeParse(value);
  if(!parsed.success)return null;
  const tile=parsed.data;
  if(tile.pack_id!==`osm-tile-${id}-v1`
    ||tile.counts[0]!==tile.nodes.length||tile.counts[1]!==tile.ways.length||tile.counts[2]!==tile.edges.length
    ||tile.built_at!==tile.source.retrieved_at)return null;
  const expectedBounds=expectedTileBounds(id);
  if(!expectedBounds||tile.bounds.some((value,index)=>value!==expectedBounds[index]))return null;
  try{
    const {content_sha256,...body}=value as RoadTile;
    const canonical=JSON.stringify(body);
    if(new TextEncoder().encode(canonical).byteLength>MAX_TILE_BYTES||await sha256(canonical)!==content_sha256)return null;
    if(!isEmptyTile(tile))tileGraph(tile);
  }catch{return null;}
  return {tile};
}

async function readBoundedJson(response:Response,signal?:AbortSignal):Promise<unknown>{
  const contentLength=response.headers.get('content-length');
  if(contentLength&&Number.isFinite(Number(contentLength))&&Number(contentLength)>MAX_TILE_BYTES)throw new Error('Tile exceeds byte limit');
  if(!response.body){
    const bytes=new Uint8Array(await response.arrayBuffer());
    throwIfAborted(signal);
    if(bytes.byteLength>MAX_TILE_BYTES)throw new Error('Tile exceeds byte limit');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
  }
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];
  let length=0;
  const cancelOnAbort=()=>{void reader.cancel(signal?.reason).catch(()=>undefined);};
  if(signal?.aborted)cancelOnAbort();
  else signal?.addEventListener('abort',cancelOnAbort,{once:true});
  try{
    while(true){
      throwIfAborted(signal);
      const {done,value}=await reader.read();
      if(done)break;
      length+=value.byteLength;
      if(length>MAX_TILE_BYTES){await reader.cancel();throw new Error('Tile exceeds byte limit');}
      chunks.push(value);
    }
  }finally{signal?.removeEventListener('abort',cancelOnAbort);reader.releaseLock();}
  throwIfAborted(signal);
  const bytes=new Uint8Array(length);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
}

function defaultFetchTile(id:string,signal?:AbortSignal):Promise<Response>{
  return fetch(`${TILE_ENDPOINT}/${id}`,{
    cache:'no-store',signal,
    headers:{'X-Road-Session':ROAD_SESSION_ID},
  });
}

class IndexedDbTileStore implements TileStore{
  private dbPromise:Promise<IDBDatabase|null>|null=null;
  private readonly fallback=new Map<string,unknown>();
  private readonly persistentIds=new Set<string>();

  isPersistent(ids:readonly string[]):boolean{
    return ids.length>0&&ids.every((id)=>this.persistentIds.has(id)&&!this.fallback.has(id));
  }

  private open():Promise<IDBDatabase|null>{
    if(this.dbPromise)return this.dbPromise;
    if(typeof indexedDB==='undefined')return Promise.resolve(null);
    this.dbPromise=new Promise((resolve)=>{
      try{
        const request=indexedDB.open('72h-roads',1);
        request.onupgradeneeded=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains('tiles'))db.createObjectStore('tiles');
        };
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>resolve(null);
        request.onblocked=()=>resolve(null);
      }catch{resolve(null);}
    });
    return this.dbPromise;
  }

  async get(id:string):Promise<unknown|null>{
    const db=await this.open();
    if(!db){this.persistentIds.delete(id);return this.fallback.get(id)??null;}
    try{
      const value=await new Promise<unknown>((resolve,reject)=>{
        const request=db.transaction('tiles','readonly').objectStore('tiles').get(id);
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
      });
      if(value!==null&&value!==undefined){
        if(this.fallback.has(id)){
          const fallback=await validateTile(this.fallback.get(id),id);
          if(fallback){
            const stored=await validateTile(value,id);
            const fallbackRetrieved=Date.parse(fallback.tile.source.retrieved_at);
            const storedRetrieved=stored?Date.parse(stored.tile.source.retrieved_at):Number.NaN;
            const databaseSupersedesFallback=!!stored&&Number.isFinite(fallbackRetrieved)&&Number.isFinite(storedRetrieved)
              &&(storedRetrieved>fallbackRetrieved
                ||(storedRetrieved===fallbackRetrieved&&stored.tile.content_sha256===fallback.tile.content_sha256));
            if(!databaseSupersedesFallback){
              this.persistentIds.delete(id);
              return fallback.tile;
            }
            this.fallback.delete(id);
            this.persistentIds.add(id);
            return stored.tile;
          }else this.fallback.delete(id);
        }
        this.persistentIds.add(id);
        return value;
      }
      this.persistentIds.delete(id);
      return this.fallback.get(id)??null;
    }catch{
      this.persistentIds.delete(id);return this.fallback.get(id)??null;
    }
  }

  async put(id:string,value:unknown,signal?:AbortSignal):Promise<void>{
    throwIfAborted(signal);
    const db=await this.open();
    throwIfAborted(signal);
    if(!db){this.persistentIds.delete(id);this.fallback.set(id,value);return;}
    try{
      await new Promise<void>((resolve,reject)=>{
        const transaction=db.transaction('tiles','readwrite');
        let settled=false;
        const cleanup=()=>signal?.removeEventListener('abort',onAbort);
        const resolveOnce=()=>{
          if(settled)return;
          settled=true;cleanup();this.fallback.delete(id);this.persistentIds.add(id);resolve();
        };
        const rejectOnce=(error:unknown)=>{
          if(settled)return;
          settled=true;cleanup();reject(error);
        };
        const onAbort=()=>{try{transaction.abort();}catch{/* The transaction may already have committed. */}};
        transaction.oncomplete=resolveOnce;
        transaction.onerror=()=>rejectOnce(transaction.error??new Error('IndexedDB tile write failed'));
        transaction.onabort=()=>rejectOnce(signal?.aborted
          ?signal.reason??new DOMException('The operation was aborted','AbortError')
          :transaction.error??new Error('IndexedDB tile write aborted'));
        signal?.addEventListener('abort',onAbort,{once:true});
        if(signal?.aborted){onAbort();return;}
        try{transaction.objectStore('tiles').put(value,id);}
        catch(error){onAbort();rejectOnce(error);}
      });
    }catch{
      if(signal?.aborted)throwIfAborted(signal);
      this.persistentIds.delete(id);this.fallback.set(id,value);
    }
    throwIfAborted(signal);
  }
}

const defaultStore=new IndexedDbTileStore();

function sameTags(left:Record<string,string>,right:Record<string,string>):boolean{
  const leftKeys=Object.keys(left).sort(),rightKeys=Object.keys(right).sort();
  return leftKeys.length===rightKeys.length&&leftKeys.every((key,index)=>key===rightKeys[index]&&left[key]===right[key]);
}

type PhysicalDirection='BIDIRECTIONAL'|'LOW_TO_HIGH'|'HIGH_TO_LOW';

function physicalDirection(direction:'BIDIRECTIONAL'|'FORWARD'|'REVERSE',fromId:number,toId:number):PhysicalDirection{
  if(direction==='BIDIRECTIONAL')return 'BIDIRECTIONAL';
  const allowedFrom=direction==='FORWARD'?fromId:toId;
  return allowedFrom<Math.max(fromId,toId)?'LOW_TO_HIGH':'HIGH_TO_LOW';
}

function mergeTiles(tiles:readonly RoadTile[]):RoadReferenceGraph{
  const nodesById=new Map<number,TileNode>();
  const waysById=new Map<number,TileWay>();
  for(const tile of tiles){
    for(const node of tile.nodes){
      const existing=nodesById.get(node[0]);
      if(existing){
        const existingTags=existing[3]??{},incomingTags=node[3]??{};
        if(existing[1]!==node[1]||existing[2]!==node[2]||!sameTags(existingTags,incomingTags))throw new Error('Conflicting duplicate road node');
      }else nodesById.set(node[0],node);
    }
    for(const way of tile.ways){
      const existing=waysById.get(way[0]);
      if(existing&&!sameTags(existing[1],way[1]))throw new Error('Conflicting duplicate road way');
      if(!existing)waysById.set(way[0],way);
    }
  }

  const nodes=[...nodesById.values()];
  const ways=[...waysById.values()];
  const nodeIndex=new Map(nodes.map((node,index)=>[node[0],index]));
  const wayIndex=new Map(ways.map((way,index)=>[way[0],index]));
  const edgeByKey=new Map<string,{from_node_index:number;to_node_index:number;way_index:number;direction:'BIDIRECTIONAL'|'FORWARD'|'REVERSE';distance_m:number}>();
  const directionByPhysicalEdge=new Map<string,PhysicalDirection>();
  const bounds=tiles.map((tile)=>tile.bounds);
  for(const tile of tiles){
    for(const [from,to,localWay,directionCode] of tile.edges){
      const fromId=tile.nodes[from]?.[0],toId=tile.nodes[to]?.[0],wayId=tile.ways[localWay]?.[0];
      const fromIndex=nodeIndex.get(fromId),toIndex=nodeIndex.get(toId),globalWayIndex=wayIndex.get(wayId);
      if(fromIndex===undefined||toIndex===undefined||globalWayIndex===undefined)throw new Error('Merged road reference is missing');
      const direction=directionCode===1?'FORWARD':directionCode===2?'REVERSE':'BIDIRECTIONAL';
      const lowId=Math.min(fromId,toId),highId=Math.max(fromId,toId);
      const key=`${wayId}:${lowId}:${highId}`;
      const physicalAllowed=physicalDirection(direction,fromId,toId);
      const existing=edgeByKey.get(key);
      if(existing){if(directionByPhysicalEdge.get(key)!==physicalAllowed)throw new Error('Conflicting duplicate road edge direction');continue;}
      edgeByKey.set(key,{from_node_index:fromIndex,to_node_index:toIndex,way_index:globalWayIndex,direction,distance_m:0});
      directionByPhysicalEdge.set(key,physicalAllowed);
    }
  }

  return buildReferenceGraph({
    bounds:{
      south:Math.min(...bounds.map((value)=>value[0])),
      west:Math.min(...bounds.map((value)=>value[1])),
      north:Math.max(...bounds.map((value)=>value[2])),
      east:Math.max(...bounds.map((value)=>value[3])),
    },
    nodes:nodes.map(([osm_id,lat,lng,tags])=>({osm_id,lat,lng,tags:tags??{}})),
    ways:ways.map(([osm_id,tags])=>({osm_id,tags})),
    edges:[...edgeByKey.values()],
    sources:tiles.map((tile)=>({pack_id:tile.pack_id,retrieved_at:tile.source.retrieved_at,osm_base_timestamp:tile.source.osm_base_timestamp})),
  });
}

function ageIsFresh(retrievedAt:string,now:number):boolean{
  const retrieved=Date.parse(retrievedAt);
  return Number.isFinite(retrieved)&&now-retrieved<=CACHE_TTL_MS;
}

function readyState(tiles:readonly RoadTile[],missing:string[],now:number,persisted:boolean):RoadTileState{
  if(tiles.length===0)throw new Error('No verified road tiles are available');
  const oldest=tiles.reduce((result,tile)=>Date.parse(tile.source.retrieved_at)<Date.parse(result)?tile.source.retrieved_at:result,tiles[0].source.retrieved_at);
  return {
    status:'READY',graph:mergeTiles(tiles),missing,oldestRetrievedAt:oldest,
    stale:!ageIsFresh(oldest,now),persisted,
  };
}

function stateForTiles(tiles:readonly RoadTile[],missing:string[],now:number,persisted:boolean,online:boolean):RoadTileState{
  if(tiles.length>0&&tiles.every(isEmptyTile)){
    return missing.length===0
      ?{status:'UNAVAILABLE',reason:'NO_ROADS'}
      :{status:'UNAVAILABLE',reason:online?'TEMPORARILY_UNAVAILABLE':'OFFLINE_NO_DATA'};
  }
  return readyState(tiles,missing,now,persisted);
}
export async function loadRoadTilesAround(point:RoadPoint,opts:LoadOptions={}):Promise<RoadTileState>{
  throwIfAborted(opts.signal);
  if(!isJapanPoint(point))return {status:'UNAVAILABLE',reason:'INVALID_DATA'};
  const ids=tilesAround(point.lat,point.lng);
  const centre=tileIdFor(point.lat,point.lng);
  if(!expectedTileBounds(centre))return {status:'UNAVAILABLE',reason:'INVALID_DATA'};
  const store=opts.store??defaultStore;
  const now=(opts.now??new Date()).getTime();
  const online=opts.online??(typeof navigator==='undefined'||navigator.onLine);
  const cached=new Map<string,ValidTile>();
  const pending:string[]=[];
  const missing=new Set<string>();

  for(const id of ids){
    throwIfAborted(opts.signal);
    if(!expectedTileBounds(id)){missing.add(id);continue;}
    let stored:unknown|null=null;
    try{stored=await store.get(id);}catch{stored=null;}
    throwIfAborted(opts.signal);
    if(stored!==null){
      const valid=await validateTile(stored,id);
      throwIfAborted(opts.signal);
      if(valid)cached.set(id,valid);
    }
    const previous=cached.get(id);
    if(!online){if(!previous)missing.add(id);continue;}
    if(!previous||!ageIsFresh(previous.tile.source.retrieved_at,now))pending.push(id);
  }

  if(!online){
    if(!cached.has(centre))return unsupported;
    const usedIds=ids.filter((id)=>cached.has(id));
    const used=usedIds.map((id)=>cached.get(id)!.tile);
    try{return stateForTiles(used,[...missing],now,store===defaultStore&&defaultStore.isPersistent(usedIds),false);}
    catch{return {status:'UNAVAILABLE',reason:'INVALID_DATA'};}
  }

  const outcomes=new Map<string,FetchOutcome>();
  let cursor=0;
  const fetchTile=opts.fetchTile??defaultFetchTile;
  const worker=async()=>{
    while(true){
      throwIfAborted(opts.signal);
      const index=cursor++;
      if(index>=pending.length)return;
      const id=pending[index];
      let response:Response;
      try{response=await fetchTile(id,opts.signal);}
      catch(error){throwIfAborted(opts.signal);outcomes.set(id,{kind:'missing'});continue;}
      throwIfAborted(opts.signal);
      if(response.status===413){outcomes.set(id,{kind:'too-dense'});continue;}
      if(response.status===429||response.status>=500){outcomes.set(id,{kind:'missing'});continue;}
      if(!response.ok){outcomes.set(id,{kind:'invalid'});continue;}
      let value:unknown;
      try{value=await readBoundedJson(response,opts.signal);}
      catch(error){throwIfAborted(opts.signal);outcomes.set(id,{kind:'invalid'});continue;}
      const valid=await validateTile(value,id);
      throwIfAborted(opts.signal);
      outcomes.set(id,valid?{kind:'ready',value:valid}:{kind:'invalid'});
    }
  };
  await Promise.all(Array.from({length:Math.min(3,pending.length)},()=>worker()));
  throwIfAborted(opts.signal);

  if([...outcomes.values()].some((outcome)=>outcome.kind==='too-dense'))return {status:'UNAVAILABLE',reason:'TOO_DENSE'};
  if([...outcomes.values()].some((outcome)=>outcome.kind==='invalid'))return {status:'UNAVAILABLE',reason:'INVALID_DATA'};

  const selected=new Map(cached);
  for(const id of pending){
    const outcome=outcomes.get(id);
    if(outcome?.kind==='ready')selected.set(id,outcome.value);
    else if(id!==centre){missing.add(id);}
  }
  if(!selected.has(centre))return {status:'UNAVAILABLE',reason:'TEMPORARILY_UNAVAILABLE'};

  const usedIds=ids.filter((id)=>selected.has(id));
  const used=usedIds.map((id)=>selected.get(id)!.tile);
  let result:RoadTileState;
  try{result=stateForTiles(used,[...missing],now,store===defaultStore&&defaultStore.isPersistent(usedIds),true);}
  catch{return {status:'UNAVAILABLE',reason:'INVALID_DATA'};}

  for(const [id,outcome] of outcomes){
    throwIfAborted(opts.signal);
    if(outcome.kind==='ready'){
      try{await store.put(id,outcome.value.tile,opts.signal);}
      catch{throwIfAborted(opts.signal);/* A storage failure leaves the verified in-memory result usable. */}
      throwIfAborted(opts.signal);
    }
  }
  throwIfAborted(opts.signal);
  if(store===defaultStore&&result.status==='READY')result={...result,persisted:defaultStore.isPersistent(usedIds)};
  return result;
}
