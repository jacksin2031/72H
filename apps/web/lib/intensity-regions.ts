import {z} from 'zod';
import {checkedMapAsset,isMapReportCurrent,type DisasterMapReference} from './disaster-map';
import pin from './jma-intensity-regions-pin.json';

const coordinate=z.tuple([z.number().finite().min(-180).max(180),z.number().finite().min(-90).max(90)]);
const ring=z.array(coordinate).min(4).max(100000).refine(r=>r[0][0]===r.at(-1)![0]&&r[0][1]===r.at(-1)![1]);
const polygon=z.array(ring).min(1).max(2000);
const geometry=z.discriminatedUnion('type',[
 z.object({type:z.literal('Polygon'),coordinates:polygon}),
 z.object({type:z.literal('MultiPolygon'),coordinates:z.array(polygon).min(1).max(20000)}),
]);
const feature=z.object({type:z.literal('Feature'),properties:z.object({code:z.string().regex(/^\d{3}$/),name:z.string().min(1).max(160),anchor:coordinate}),geometry});
const collection=z.object({type:z.literal('FeatureCollection'),features:z.array(feature).min(1).max(188)});
const instant=z.iso.datetime({offset:true}),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const intensityRegionManifestSchema=z.object({schema_version:z.literal(1),geometry_version:z.literal('20240520'),code_table_version:z.literal('20261007'),
 reviewed_at:instant,review_due_at:instant,source_crs:z.literal('EPSG:6668'),output_crs:z.literal('EPSG:4326'),
 codes:z.record(z.string().regex(/^\d{3}$/),z.string().min(1).max(160)),
 assets:z.array(z.object({path:z.string().regex(/^\/hazards\/jma-intensity-regions-v1\/regions-[0-3]\.geojson$/),bytes:z.number().int().positive().max(16000000),sha256:sha})).min(1).max(4),
 excluded_geometry:z.array(z.object({code:z.string().regex(/^\d{3}$/).nullable(),name:z.string(),reason:z.enum(['UNASSIGNED_OFFICIAL_GEOMETRY','INVALID_OFFICIAL_TOPOLOGY','DISPLAY_PROCESSING_INVALID'])})).max(194),
 included_count:z.number().int().min(1).max(188),source_count:z.literal(194),effective_intervals:z.literal('UNKNOWN'),positional_accuracy:z.literal('UNKNOWN'),coverage:z.literal('PARTIAL_REFERENCE_REGIONS'),
 sources:z.array(z.object({url:z.url(),sha256:sha,version:z.string(),published_at:z.string(),retrieved_at:instant})).length(2),
 processing:z.string(),attribution:z.string(),license_url:z.url(),
}).refine(m=>Object.keys(m.codes).length===188&&Date.parse(m.review_due_at)>Date.parse(m.reviewed_at)
 &&m.assets.reduce((n,a)=>n+a.bytes,0)<=32000000&&new Set(m.assets.map(a=>a.path)).size===m.assets.length);

export type RegionGeometry={type:'Polygon';coordinates:number[][][]}|{type:'MultiPolygon';coordinates:number[][][][]};
export type IntensityRegionPack={manifest:{geometry_version:string;code_table_version:string;reviewed_at:string;review_due_at:string;codes:Record<string,string>};
 features:Array<{type:'Feature';properties:{code:string;name:string;anchor:[number,number]};geometry:RegionGeometry}>};
export type ReviewedIntensityRegionPack=IntensityRegionPack&{manifest:z.infer<typeof intensityRegionManifestSchema>};

export async function loadIntensityRegionPack(signal?:AbortSignal):Promise<ReviewedIntensityRegionPack>{
 const manifest=intensityRegionManifestSchema.parse((await checkedMapAsset(pin.path,pin.sha256,64000,signal)).data);
 const parts=await Promise.all(manifest.assets.map(async asset=>{
  const result=await checkedMapAsset(asset.path,asset.sha256,asset.bytes,signal);
  if(result.bytes!==asset.bytes)throw Error('Regional pack length mismatch');return collection.parse(result.data).features;
 }));
 const features=parts.flat(),seen=new Set(features.map(f=>f.properties.code));
 if(features.length!==manifest.included_count||seen.size!==features.length||features.some(f=>manifest.codes[f.properties.code]!==f.properties.name)
  ||manifest.excluded_geometry.filter(x=>x.code!==null).some(x=>seen.has(x.code!)))throw Error('Regional pack identity mismatch');
 if(Object.keys(manifest.codes).some(code=>!seen.has(code)&&!manifest.excluded_geometry.some(x=>x.code===code)))throw Error('Regional missing geometry was not disclosed');
 return {manifest,features};
}
export type RegionalMaximum={code:string;name:string;intensity:string|null;state:'RECENT_REFERENCE'|'ARCHIVED_REFERENCE'|'UNKNOWN';
 report_ids:string[];issued_at:string[];scope:'REGION_MAXIMUM_NOT_POINT_MEASUREMENT'};

export function regionalMaxima(pack:IntensityRegionPack|null,data:DisasterMapReference|null,connected:boolean,now:number):RegionalMaximum[]{
 if(!pack||!data||data.earthquake_code_table_version!==pack.manifest.code_table_version
  ||now<Date.parse(pack.manifest.reviewed_at)||now>=Date.parse(pack.manifest.review_due_at))return [];
 const geometries=new Map(pack.features.map(f=>[f.properties.code,f.properties.name]));
 const groups=new Map<string,Array<{intensity:string|null;current:boolean;conflict:boolean;report_id:string;issued_at:string}>>();
 for(const report of data.reports){
  if(report.bulletin.product!=='VXSE53'||report.bulletin.operation!=='ISSUE'||Date.parse(report.bulletin.issued_at)<Date.parse('2026-10-07T00:00:00Z'))continue;
  const current=isMapReportCurrent(data,report,connected,now);
  for(const o of report.observations){
   if(o.granularity!=='REGION'||o.measurement!=='MAXIMUM'||!o.code||geometries.get(o.code)!==o.name||pack.manifest.codes[o.code]!==o.name)continue;
   const values=groups.get(o.code)??[];
   values.push({intensity:o.intensity,current,conflict:report.bulletin.lifecycle==='CONFLICT',report_id:report.bulletin.report_id,issued_at:report.bulletin.issued_at});groups.set(o.code,values);
  }
 }
 const rank:Record<string,number>={'0':0,'1':1,'2':2,'3':3,'4':4,'5-':5,'5+':6,'6-':7,'6+':8,'7':9};
 return [...groups].map(([code,all])=>{
  // Never blend old observations into a recent-reference maximum. These are
  // maxima among the listed bulletins, not shaking at every point or now.
  const recent=all.filter(x=>x.current),values=recent.length?recent:all;
  const unknown=all.some(x=>x.conflict)||values.some(x=>x.intensity===null||!(x.intensity in rank));
  const strongest=unknown?null:values.reduce((max,x)=>rank[x.intensity!]>rank[max.intensity!]?x:max).intensity;
  return {code,name:pack.manifest.codes[code],intensity:strongest,state:unknown?'UNKNOWN' as const:recent.length?'RECENT_REFERENCE' as const:'ARCHIVED_REFERENCE' as const,
   report_ids:values.map(x=>x.report_id),issued_at:values.map(x=>x.issued_at),scope:'REGION_MAXIMUM_NOT_POINT_MEASUREMENT' as const};
 });
}
