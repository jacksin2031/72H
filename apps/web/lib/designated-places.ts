import {z} from 'zod';
import {officialPlaceSchema,hazardKeys} from './official-hazards';
import {checkedMapAsset} from './disaster-map';
import pin from './gsi-place-pin.json';

const instant=z.iso.datetime({offset:true}),sha=z.string().regex(/^[a-f0-9]{64}$/);
const sourceStates=z.enum(['MISSING_OR_NULL','SCHEMA_ABSENT_NOT_DESIGNATED','EXPLICIT_ONE','EXPLICIT_BLANK']);
const rawValue=z.union([z.string().max(16),z.number().finite(),z.null()]);
const place=officialPlaceSchema.extend({common_id:z.string().min(1).max(88).nullable(),
  identity_kind:z.enum(['OFFICIAL_COMMON_ID_PER_ROLE','SNAPSHOT_FEATURE_ONLY']),municipality_code:z.string().regex(/^\d{5}$/).nullable(),
  source_format:z.enum(['CSV','GeoJSON']),other_role_same_address:z.boolean().nullable(),acceptance:z.string().max(1000),necessary_matters:z.string().max(2000),
  hazard_source_states:z.object(Object.fromEntries(hazardKeys.map(k=>[k,sourceStates])) as Record<typeof hazardKeys[number],typeof sourceStates>),
  hazard_raw_values:z.object(Object.fromEntries(hazardKeys.map(k=>[k,rawValue])) as Record<typeof hazardKeys[number],typeof rawValue>),
}).superRefine((p,ctx)=>{
  if(p.source_format==='CSV'?(p.identity_kind!=='OFFICIAL_COMMON_ID_PER_ROLE'||!p.common_id||p.municipality_code!=='04202'||p.id!==`${p.kind.toLowerCase()}:${p.common_id}`):
    (p.identity_kind!=='SNAPSHOT_FEATURE_ONLY'||p.common_id!==null||p.municipality_code!==null||!/^geo:[a-f0-9]{64}:\d+$/.test(p.id)))ctx.addIssue({code:'custom',message:'Invalid designation identity'});
  for(const k of hazardKeys){
    const state=p.hazard_source_states[k],raw=p.hazard_raw_values[k];
    const wanted=state==='EXPLICIT_ONE'?'DESIGNATED':state==='EXPLICIT_BLANK'||state==='SCHEMA_ABSENT_NOT_DESIGNATED'?'NOT_DESIGNATED':'UNKNOWN';
    if(p.hazards[k]!==wanted||(p.kind==='SHELTER'&&wanted!=='UNKNOWN')
      ||(state==='EXPLICIT_ONE'&&(p.source_format==='CSV'?typeof raw!=='string'||raw.trim()!=='1':raw!==1))
      ||(state==='EXPLICIT_BLANK'&&(p.source_format!=='CSV'||typeof raw!=='string'||raw.trim()!==''))
      ||(state==='SCHEMA_ABSENT_NOT_DESIGNATED'&&(p.source_format!=='GeoJSON'||raw!==null)))ctx.addIssue({code:'custom',message:'Invalid hazard/source state'});
  }
});
export type DesignatedPlace=z.infer<typeof place>;
const source=z.object({id:z.string().min(1).max(100),url:z.url(),raw_sha256:sha,bytes:z.number().int().positive().max(4_000_000),
  retrieved_at:instant,http_status:z.union([z.literal(200),z.literal(404)]),published_at:z.null(),updated_at:z.null(),
  scope:z.enum(['MUNICIPAL_CSV','TILE_10_914_393','PUBLIC_DATABASE_METADATA'])});
const asset=z.object({kind:z.enum(['catalog','geo-tsunami','geo-shelter']),path:z.string().regex(/^\/hazards\/gsi-ishinomaki-places-v1\/(catalog|geo-tsunami|geo-shelter)-[a-f0-9]{16}\.json$/),
  sha256:sha,bytes:z.number().int().positive().max(4_000_000),record_count:z.number().int().min(0).max(5000)});
const manifestSchema=z.object({schema_version:z.literal(1),dataset_id:z.literal('gsi-ishinomaki-places-v1'),area_id:z.literal('JP-MUNI-04202'),municipality_code:z.literal('04202'),
  reviewed_at:instant,review_due_at:instant,coverage:z.literal('PARTIAL'),catalog_published_on:z.iso.date(),database_updated_on:z.iso.date(),designation_date:z.null(),
  geojson_schema:z.literal('GSI_SPARSE_DISASTER_FLAGS_V1'),identity_crosswalk:z.literal('UNAVAILABLE'),
  geojson_availability:z.object({tsunami:z.literal('AVAILABLE'),shelter:z.literal('AVAILABLE'),earthquake:z.literal('UNAVAILABLE_404')}),
  catalog_count:z.number().int().min(0).max(5000),sources:z.array(source).length(6),assets:z.array(asset).length(3),opening_feed:z.literal('UNCONFIGURED'),
  previous_catalog_sha256:sha.nullable(),catalog_delta:z.object({authority:z.literal('CATALOG_SNAPSHOT_DIFF_ONLY'),
    absent_in_new_snapshot:z.array(z.string()).max(5000),added:z.array(z.string()).max(5000),changed:z.array(z.string()).max(5000)}),
  safe_location_verified:z.literal(false),route_authorized:z.literal(false),attribution:z.string().min(1),license_url:z.url(),schema_url:z.url(),sparse_schema_url:z.url(),
  limitations:z.array(z.string().min(1).max(500)).max(16),
}).refine(m=>Date.parse(m.review_due_at)>Date.parse(m.reviewed_at)&&m.sources.every(s=>Date.parse(s.retrieved_at)<=Date.parse(m.reviewed_at))
  &&new Set(m.sources.map(s=>s.id)).size===6&&new Set(m.assets.map(a=>a.kind)).size===3&&new Set(m.assets.map(a=>a.path)).size===3
  &&m.assets.reduce((n,a)=>n+a.bytes,0)<=4_000_000);
export type DesignationPack={manifest:z.infer<typeof manifestSchema>;catalog:DesignatedPlace[];geoTsunami:DesignatedPlace[];geoShelter:DesignatedPlace[]};
export async function loadDesignatedPlaces(signal?:AbortSignal):Promise<DesignationPack>{
  const m=manifestSchema.parse((await checkedMapAsset(pin.path,pin.sha256,128_000,signal)).data);
  const loaded=await Promise.all(m.assets.map(async a=>{
    const raw=await checkedMapAsset(a.path,a.sha256,a.bytes,signal);
    if(raw.bytes!==a.bytes)throw Error('Designation length mismatch');
    const rows=z.array(place).max(5000).parse(raw.data);
    const sourceKeys=a.kind==='catalog'?['csv-emergency','csv-shelter']:[a.kind];
    if(rows.length!==a.record_count||new Set(rows.map(p=>p.id)).size!==rows.length||rows.some(p=>!sourceKeys.includes(p.source_id)
      ||p.source_format!==(a.kind==='catalog'?'CSV':'GeoJSON')||(a.kind==='geo-tsunami'&&p.hazards.tsunami!=='DESIGNATED')))
      throw Error('Designation source/identity mismatch');
    return {kind:a.kind,rows};
  }));
  const rows=(kind:string)=>loaded.find(a=>a.kind===kind)!.rows;
  if(rows('catalog').length!==m.catalog_count)throw Error('Catalog count mismatch');
  return {manifest:m,catalog:rows('catalog'),geoTsunami:rows('geo-tsunami'),geoShelter:rows('geo-shelter')};
}
export type DesignationHazard='ALL'|typeof hazardKeys[number];
export function selectDesignationPlaces(pack:DesignationPack,format:'CSV'|'GeoJSON',hazard:DesignationHazard){
  if(format==='GeoJSON'&&hazard!=='ALL'&&hazard!=='tsunami')return {places:[] as DesignatedPlace[],reason:hazard==='earthquake'?'UNAVAILABLE_404':'HAZARD_TILE_NOT_LOADED'};
  const rows=format==='CSV'?pack.catalog:hazard==='ALL'?[...pack.geoTsunami,...pack.geoShelter]:pack.geoTsunami;
  return {places:rows.filter(p=>hazard==='ALL'||(p.kind==='EMERGENCY_SITE'&&p.hazards[hazard]==='DESIGNATED')),reason:format==='GeoJSON'?'PARTIAL_TILE_REFERENCE':'MUNICIPAL_PUBLIC_CATALOG'};
}
const openingRecord=z.object({destination_id:z.string().min(1).max(96),status:z.enum(['OPEN','CLOSED','UNKNOWN']),
  reason:z.enum(['VERIFIED','STALE','CONFLICT','AUTHORITY_REVIEW_EXPIRED','SOURCE_UNKNOWN']),source_key:z.string().min(1).max(96),source_url:z.url(),
  published_at:instant,received_at:instant,expires_at:instant,evidence_ids:z.array(z.string().min(1).max(96)).max(64),restrictions:z.array(z.string().min(1).max(500)).max(16),
  safe_location_verified:z.literal(false),route_authorized:z.literal(false)}).refine(r=>Date.parse(r.received_at)>=Date.parse(r.published_at)
    &&Date.parse(r.expires_at)>Date.parse(r.published_at)&&(r.reason!=='VERIFIED'||(r.status!=='UNKNOWN'&&r.evidence_ids.length>0)));
export const openingSchema=z.object({mode:z.literal('LIVE_REFERENCE'),area_id:z.string().regex(/^JP-MUNI-\d{5}$/),generated_at:instant,fetched_at:instant.nullable(),
  source_status:z.enum(['AVAILABLE','UNCONFIGURED','FAILED']),records:z.array(openingRecord).max(512),authority:z.literal('REFERENCE_ONLY'),
  safe_location_verified:z.literal(false),route_authorized:z.literal(false)}).refine(x=>new Set(x.records.map(r=>r.destination_id)).size===x.records.length
    &&(x.source_status==='AVAILABLE'?(x.fetched_at!==null):x.records.length===0));
export type OpeningResponse=z.infer<typeof openingSchema>;
export function placeOpening(p:Pick<DesignatedPlace,'id'|'identity_kind'|'municipality_code'>,data:OpeningResponse|null,connected:boolean,now:number,resumeAt=0){
  const unknown=(reason:string,record:z.infer<typeof openingRecord>|null=null)=>({status:'UNKNOWN' as const,reason,record});
  if(p.identity_kind!=='OFFICIAL_COMMON_ID_PER_ROLE')return unknown('NO_IDENTITY_CROSSWALK');
  if(!data||data.source_status!=='AVAILABLE')return unknown(data?.source_status??'UNAVAILABLE');
  if(data.area_id!==`JP-MUNI-${p.municipality_code}`||Date.parse(data.generated_at)>now+5000)return unknown('UNVERIFIED_SCOPE_OR_RECONNECT');
  const r=data.records.find(r=>r.destination_id===p.id);
  if(!r)return unknown('NO_OPENING_REPORT');
  if(!connected)return unknown('OFFLINE',r);
  if(!data.fetched_at||Date.parse(data.fetched_at)<resumeAt||Date.parse(data.fetched_at)>now+5000)return unknown('UNVERIFIED_SCOPE_OR_RECONNECT',r);
  if(r.reason!=='VERIFIED'||now<Date.parse(r.published_at)||now<Date.parse(r.received_at)||now>=Math.min(Date.parse(r.expires_at),Date.parse(r.published_at)+300_000))return unknown(r.reason==='VERIFIED'?'STALE':r.reason,r);
  return {status:r.status,reason:r.reason,record:r};
}
