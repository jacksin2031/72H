import { z } from 'zod';
import pin from './official-hazard-pin.json';

// Official reference data is not movement authority. GPS queries stay on device.
const instant=z.iso.datetime({offset:true});
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const point=z.tuple([z.number().finite().min(-180).max(180),z.number().finite().min(-90).max(90)]);
const ring=z.array(point).min(4).max(200000).refine(x=>x[0][0]===x.at(-1)![0]&&x[0][1]===x.at(-1)![1],'Unclosed polygon');
const polygon=z.array(ring).min(1).max(2000);
const geometry=z.discriminatedUnion('type',[
  z.object({type:z.literal('Polygon'),coordinates:polygon}),
  z.object({type:z.literal('MultiPolygon'),coordinates:z.array(polygon).min(1).max(2000)}),
]);
const feature=z.object({type:z.literal('Feature'),geometry,properties:z.object({
  id:z.string().min(1).max(160),depth_label:z.string().min(1).max(100),source_id:z.string().min(1).max(100),
})});
const collection=z.object({type:z.literal('FeatureCollection'),features:z.array(feature).max(50000)});
const coverageCollection=z.object({type:z.literal('FeatureCollection'),features:z.array(z.object({type:z.literal('Feature'),geometry})).max(1000)});
export const hazardKeys=['flood','landslide','storm_surge','earthquake','tsunami','large_fire','inland_flood','volcano'] as const;
const classification=z.enum(['DESIGNATED','NOT_DESIGNATED','UNKNOWN']);
export const officialPlaceSchema=z.object({
  id:z.string().min(1).max(160),common_id:z.string().min(1).max(160).optional(),name:z.string().min(1).max(240),address:z.string().max(1000).nullable(),
  lat:z.number().finite().min(-90).max(90),lng:z.number().finite().min(-180).max(180),
  kind:z.enum(['EMERGENCY_SITE','SHELTER']),hazards:z.object(Object.fromEntries(hazardKeys.map(key=>[key,classification])) as Record<typeof hazardKeys[number],typeof classification>),
  notes:z.string().max(4000),source_id:z.string().min(1).max(100),open_status:z.literal('UNKNOWN'),
});
const sourceSchema=z.object({id:z.string(),title:z.string(),url:z.url(),basis_date:z.string().nullable(),
  published_at:z.string().nullable(),retrieved_at:instant,raw_sha256:sha,license_url:z.url(),notes:z.string()});
const assetSchema=z.object({path:z.string().regex(/^\/hazards\/[a-z0-9/_-]+\.(json|geojson)$/),sha256:sha,
  bytes:z.number().int().positive().max(16000000),kind:z.enum(['inundation','places','coverage'])});
export const hazardManifestSchema=z.object({schema_version:z.literal(1),dataset_id:z.string(),region_name:z.string(),area_id:z.string(),
  reviewed_at:instant,review_due_at:instant,coverage_status:z.enum(['PARTIAL','VERIFIED']),
  bbox:z.tuple([z.number(),z.number(),z.number(),z.number()]).optional(),
  positional_accuracy_m:z.number().finite().min(0).max(1000),
  positional_accuracy_kind:z.enum(['MAX_BOUND','STANDARD_DEVIATION','UNKNOWN']),
  scenario:z.object({source_id:z.string().min(1),announced_on:z.iso.date(),source_crs:z.string().min(1),output_crs:z.literal('EPSG:4326'),
    terrain_basis:z.string().min(1).max(100),conditions:z.array(z.enum(['MAXIMUM_CLASS_ADVERSE','LARGER_OR_OUTSIDE_POSSIBLE','LATER_WAVE_MAXIMUM','RIVER_LAKE_CHANGES_NOT_SHOWN'])).min(1).max(4),
  }).optional(),
  sources:z.array(sourceSchema).min(1).max(10),assets:z.array(assetSchema).min(2).max(20),
}).superRefine((value,ctx)=>{
  if(Date.parse(value.review_due_at)<=Date.parse(value.reviewed_at))ctx.addIssue({code:'custom',message:'Invalid review period'});
  if(new Set(value.sources.map(x=>x.id)).size!==value.sources.length||new Set(value.assets.map(x=>x.path)).size!==value.assets.length)
    ctx.addIssue({code:'custom',message:'Duplicate pack identity'});
  if(value.scenario&&!value.sources.some(s=>s.id===value.scenario!.source_id))ctx.addIssue({code:'custom',message:'Unknown scenario source'});
});
export type OfficialPlace=z.infer<typeof officialPlaceSchema>;
export type HazardFeature=z.infer<typeof feature>;
export type HazardManifest=z.infer<typeof hazardManifestSchema>;
export type HazardPack={manifest:HazardManifest;inundation:z.infer<typeof collection>;places:OfficialPlace[];coverage:z.infer<typeof coverageCollection>|null};
export type HazardLocation={lat:number;lng:number;accuracy_m:number;captured_at:number;source:'GPS'|'MAP_POINT'};
export type HazardAssessment={status:'INSIDE_KNOWN'|'OUTSIDE_KNOWN'|'BOUNDARY_UNCERTAIN'|'UNKNOWN';reason:string;
  depth_labels:string[];safe_location_verified:false;route_authorized:false};

async function checkedJson(path:string,expected:string,max:number,signal?:AbortSignal){
  // Revalidate browser HTTP caches after a pack update; offline SW still serves
  // only the public asset snapshot, whose bytes are checked below.
  const response=await fetch(path,{cache:'no-cache',signal});
  if(!response.ok)throw Error('Official pack unavailable');
  const raw=await response.arrayBuffer();
  if(raw.byteLength>max)throw Error('Oversized official pack');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==expected)throw Error('Official pack integrity failure');
  return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),bytes:raw.byteLength};
}
export async function loadOfficialHazardPack(signal?:AbortSignal):Promise<HazardPack>{
  const raw=await checkedJson(pin.path,pin.sha256,64000,signal);
  const manifest=hazardManifestSchema.parse(raw.data);
  const packs=await Promise.all(manifest.assets.map(async asset=>{
    const value=await checkedJson(asset.path,asset.sha256,asset.bytes,signal);
    if(value.bytes!==asset.bytes)throw Error('Pack length mismatch');
    return {kind:asset.kind,data:value.data};
  }));
  if(!packs.some(x=>x.kind==='inundation')||packs.filter(x=>x.kind==='places').length!==1
    ||packs.filter(x=>x.kind==='coverage').length>1)throw Error('Incomplete official pack');
  const inundation={type:'FeatureCollection' as const,features:packs.filter(x=>x.kind==='inundation').flatMap(x=>collection.parse(x.data).features)};
  const places=z.array(officialPlaceSchema).max(5000).parse(packs.find(x=>x.kind==='places')!.data);
  const coverageData=packs.find(x=>x.kind==='coverage');
  const coverage=coverageData?coverageCollection.parse(coverageData.data):null;
  if(manifest.coverage_status==='VERIFIED'&&(!coverage||coverage.features.length===0))throw Error('No verified survey coverage');
  const sources=new Set(manifest.sources.map(x=>x.id));
  if(inundation.features.some(x=>!sources.has(x.properties.source_id))||places.some(x=>!sources.has(x.source_id))
    ||new Set(places.map(x=>x.id)).size!==places.length)throw Error('Unknown or duplicate data identity');
  return {manifest,inundation,places,coverage};
}

type Ring=number[][];
function ringContains(r:Ring,x:number,y:number){
  let inside=false;
  for(let i=0,j=r.length-1;i<r.length;j=i++){
    const a=r[i],b=r[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function contains(rings:Ring[],fix:HazardLocation){return ringContains(rings[0],fix.lng,fix.lat)&&!rings.slice(1).some(r=>ringContains(r,fix.lng,fix.lat));}
function nearBoundary(rings:Ring[],fix:HazardLocation,radius:number){
  // Conservative local tangent distance; data is Japanese regional geography.
  const sx=110000*Math.cos(fix.lat*Math.PI/180),sy=110000;
  for(const r of rings)for(let i=1;i<r.length;i++){
    const ax=(r[i-1][0]-fix.lng)*sx,ay=(r[i-1][1]-fix.lat)*sy;
    const bx=(r[i][0]-fix.lng)*sx,by=(r[i][1]-fix.lat)*sy;
    const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
    if(Math.hypot(ax+t*dx,ay+t*dy)<=radius+1)return true;
  }
  return false;
}
const polygons=(g:z.infer<typeof geometry>)=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
export function assessOfficialHazards(pack:HazardPack,fix:HazardLocation|null,now=Date.now()):HazardAssessment{
  const result=(status:HazardAssessment['status'],reason:string,depth_labels:string[]=[]):HazardAssessment=>({status,reason,depth_labels,safe_location_verified:false,route_authorized:false});
  if(!fix)return result('UNKNOWN','NO_LOCATION');
  if(![fix.lat,fix.lng,fix.accuracy_m,fix.captured_at,now].every(Number.isFinite)||Math.abs(fix.lat)>90||Math.abs(fix.lng)>180
    ||fix.accuracy_m<0||fix.accuracy_m>1000||fix.captured_at>now+5000||(fix.source==='GPS'&&now-fix.captured_at>120000))return result('UNKNOWN','INVALID_OR_EXPIRED_LOCATION');
  if(now<Date.parse(pack.manifest.reviewed_at)||now>=Date.parse(pack.manifest.review_due_at))return result('UNKNOWN','DATA_REVIEW_EXPIRED');
  const radius=fix.accuracy_m+pack.manifest.positional_accuracy_m;
  const hits=pack.inundation.features.map(f=>({f,inside:polygons(f.geometry).some(p=>contains(p,fix)),edge:polygons(f.geometry).some(p=>nearBoundary(p,fix,radius))})).filter(x=>x.inside||x.edge);
  const labels=[...new Set(hits.map(x=>x.f.properties.depth_label))];
  // A reported standard deviation is not a guaranteed position-error bound.
  if(pack.manifest.positional_accuracy_kind!=='MAX_BOUND')
    return result(hits.length?'BOUNDARY_UNCERTAIN':'UNKNOWN',
      !hits.length&&pack.manifest.coverage_status==='PARTIAL'?'NO_VERIFIED_SURVEY_COVERAGE':'SOURCE_ACCURACY_NOT_BOUND',labels);
  if(hits.some(x=>x.edge)||labels.length>1)return result('BOUNDARY_UNCERTAIN','ACCURACY_OR_DATA_BOUNDARY',labels);
  if(hits.some(x=>x.inside))return result('INSIDE_KNOWN','SCENARIO_INUNDATION',labels);
  if(pack.manifest.coverage_status==='VERIFIED'&&pack.coverage?.features.some(f=>polygons(f.geometry).some(p=>contains(p,fix)&&!nearBoundary(p,fix,radius))))
    return result('OUTSIDE_KNOWN','NO_SCENARIO_INTERSECTION');
  return result('UNKNOWN','NO_VERIFIED_SURVEY_COVERAGE');
}

export function isTsunamiDesignated(place:OfficialPlace){return place.kind==='EMERGENCY_SITE'&&place.hazards.tsunami==='DESIGNATED';}
