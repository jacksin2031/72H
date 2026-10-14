import {z} from 'zod';
import pin from './japan-shelter-pin.json';
import {checkedJson,hazardKeys,officialPlaceSchema,type OfficialPlace} from './official-hazards';

const code=z.string().regex(/^(0[1-9]|[1-3][0-9]|4[0-7])$/);
const cityCode=z.string().regex(/^\d{5}$/);
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const date=z.iso.date().nullable();
const municipality=z.object({code:cityCode,name:z.string().min(1).max(100),updated_at:date,
  count:z.number().int().nonnegative(),publication_status:z.enum(['PUBLISHED','NOT_PUBLISHED'])});
const prefecture=z.object({code,name:z.string().min(1).max(40),
  path:z.string().regex(/^\/shelters\/japan-v1\/\d{2}-[a-f0-9]{64}\.json$/),sha256:sha,
  bytes:z.number().int().positive().max(8000000),count:z.number().int().positive().max(30000),
  bbox:z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90),z.number().min(-180).max(180),z.number().min(-90).max(90)]),
  municipalities:z.array(municipality).min(1).max(250),
}).superRefine((value,ctx)=>{
  if(value.path!==`/shelters/japan-v1/${value.code}-${value.sha256}.json`
    ||value.municipalities.some(c=>!c.code.startsWith(value.code))
    ||new Set(value.municipalities.map(c=>c.code)).size!==value.municipalities.length
    ||value.municipalities.reduce((sum,c)=>sum+c.count,0)!==value.count
    ||value.bbox[0]>value.bbox[2]||value.bbox[1]>value.bbox[3])ctx.addIssue({code:'custom',message:'Inconsistent prefecture metadata'});
});
const source=z.object({id:z.enum(['shelters','emergency','municipalities','prefectures']),
  url:z.url().refine(value=>new URL(value).origin==='https://hinanmap.gsi.go.jp'),
  raw_sha256:sha,bytes:z.number().int().positive().max(50000000),retrieved_at:z.iso.datetime({offset:true}),count:z.number().int().nonnegative().nullable()});
export const japanShelterCatalogSchema=z.object({schema_version:z.literal(1),dataset_id:z.literal('gsi-japan-designated-places-v1'),
  coverage:z.literal('PUBLISHED_RECORDS_ONLY'),source_page:z.url(),license_url:z.url(),notice_url:z.url(),
  open_status:z.literal('UNKNOWN'),route_authorized:z.literal(false),safe_location_verified:z.literal(false),
  total_count:z.number().int().positive().max(500000),shelter_count:z.number().int().positive(),emergency_count:z.number().int().positive(),
  sources:z.array(source).length(4),prefectures:z.array(prefecture).length(47),
}).superRefine((value,ctx)=>{
  if(new Set(value.prefectures.map(p=>p.code)).size!==47||new Set(value.sources.map(s=>s.id)).size!==4
    ||value.total_count!==value.shelter_count+value.emergency_count
    ||value.total_count!==value.prefectures.reduce((sum,p)=>sum+p.count,0))ctx.addIssue({code:'custom',message:'Inconsistent national count'});
});
const compactPlace=z.tuple([
  z.string().regex(/^E\d{5}[A-Z0-9]{8}$/),z.string().min(1).max(240),z.string().max(1000).nullable(),
  z.number().finite().min(-90).max(90),z.number().finite().min(-180).max(180),
  z.enum(['EMERGENCY_SITE','SHELTER']),z.string().regex(/^[DNU]{8}$/),z.string().max(4000),cityCode,
]);
export type JapanShelterCatalog=z.infer<typeof japanShelterCatalogSchema>;
export type JapanShelterPlace=OfficialPlace&{municipality_id:string;municipality_name:string;designation_updated_at:string|null};
export type JapanShelterFilters={municipality:string;kind:'ALL'|'EMERGENCY_SITE'|'SHELTER';hazard:typeof hazardKeys[number]|'';search:string};

export async function loadJapanShelterCatalog(signal?:AbortSignal):Promise<JapanShelterCatalog>{
  const raw=await checkedJson(pin.path,pin.sha256,512000,signal);
  return japanShelterCatalogSchema.parse(raw.data);
}
export async function loadJapanShelterPrefecture(catalog:JapanShelterCatalog,prefectureCode:string,signal?:AbortSignal):Promise<JapanShelterPlace[]>{
  const descriptor=catalog.prefectures.find(p=>p.code===prefectureCode);
  if(!descriptor)throw Error('Unknown prefecture');
  const raw=await checkedJson(descriptor.path,descriptor.sha256,descriptor.bytes,signal);
  if(raw.bytes!==descriptor.bytes)throw Error('Shelter pack length mismatch');
  const rows=z.array(compactPlace).length(descriptor.count).parse(raw.data);
  const cities=new Map(descriptor.municipalities.map(city=>[city.code,city]));
  const seen=new Set<string>();
  const counts=new Map<string,number>();
  const places=rows.map(([id,name,address,lat,lng,kind,mask,notes,municipalityId])=>{
    const city=cities.get(municipalityId);
    const typedId=`${kind.toLowerCase()}:${id}`;
    if(!city||id.slice(1,6)!==municipalityId||seen.has(typedId)||kind==='SHELTER'&&mask!=='UUUUUUUU')throw Error('Invalid designation identity or hazard applicability');
    seen.add(typedId);counts.set(municipalityId,(counts.get(municipalityId)??0)+1);
    const hazards=Object.fromEntries(hazardKeys.map((key,index)=>[key,mask[index]==='D'?'DESIGNATED':mask[index]==='N'?'NOT_DESIGNATED':'UNKNOWN']));
    return {...officialPlaceSchema.parse({id:typedId,common_id:id,name,address,lat,lng,kind,hazards,notes,
      source_id:kind==='SHELTER'?'shelters':'emergency',open_status:'UNKNOWN'}),
      municipality_id:municipalityId,municipality_name:city.name,designation_updated_at:city.updated_at};
  });
  if(descriptor.municipalities.some(city=>(counts.get(city.code)??0)!==city.count))throw Error('Municipality count mismatch');
  return places;
}
export function filterJapanShelters(places:JapanShelterPlace[],filters:JapanShelterFilters):JapanShelterPlace[]{
  const search=filters.search.trim().toLocaleLowerCase();
  return places.filter(place=>(!filters.municipality||place.municipality_id===filters.municipality)
    &&(filters.kind==='ALL'||place.kind===filters.kind)
    &&(!filters.hazard||place.kind==='EMERGENCY_SITE'&&place.hazards[filters.hazard]==='DESIGNATED')
    &&(!search||`${place.name} ${place.address??''}`.toLocaleLowerCase().includes(search)));
}
