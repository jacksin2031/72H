import { z } from 'zod';
import { liveSourceSchema, officialReportSchema, tsunamiReferenceSchema } from './contracts';
import pin from './jma-forecast-lines-pin.json';

const instant=z.iso.datetime({offset:true}),sha=z.string().regex(/^[a-f0-9]{64}$/);
const observation=z.object({
  granularity:z.enum(['PREFECTURE','REGION','CITY','STATION']),measurement:z.enum(['MAXIMUM','MEASURED']),
  code:z.string().min(1).max(16).nullable(),name:z.string().min(1).max(160),intensity:z.enum(['0','1','2','3','4','5-','5+','6-','6+','7','不明']).nullable(),
  prefecture_code:z.string().regex(/^\d{2}$/).nullable(),
}).refine(x=>(x.granularity==='STATION')===(x.measurement==='MEASURED'));
const report=z.object({bulletin:officialReportSchema,observations:z.array(observation).max(6000),
  forecast_areas:tsunamiReferenceSchema.shape.forecast_areas,
}).refine(x=>x.bulletin.is_head&&(x.bulletin.product==='VXSE53'?x.forecast_areas.length===0:x.observations.length===0)
  &&new Set(x.forecast_areas.map(a=>a.area_code)).size===x.forecast_areas.length);
export const disasterMapSchema=z.object({
  mode:z.literal('LIVE_REFERENCE'),generated_at:instant,sources:z.array(liveSourceSchema).length(2),reports:z.array(report).max(128),
  observation_mapping_version:z.literal('jma-xml-observation-v1'),tsunami_code_table_version:z.literal('20261007'),
  earthquake_code_table_version:z.enum(['20261007','UNKNOWN']).default('UNKNOWN'),
  coverage:z.literal('PARTIAL'),capacity_exceeded:z.boolean(),authority:z.literal('REFERENCE_ONLY'),
  safe_location_verified:z.literal(false),route_authorized:z.literal(false),
}).refine(x=>x.reports.reduce((n,r)=>n+r.observations.length,0)<=12000&&(!x.capacity_exceeded||!x.reports.length)
  &&new Set(x.reports.map(r=>r.bulletin.report_id)).size===x.reports.length
  &&new Set(x.sources.map(s=>s.source_key)).size===2
  &&x.sources.some(s=>s.source_key==='jma-live-eqvol')&&x.sources.some(s=>s.source_key==='jma-live-tsunami'));
export type DisasterMapReference=z.infer<typeof disasterMapSchema>;
export type MapReport=DisasterMapReference['reports'][number];
const point=z.tuple([z.number().finite().min(-180).max(180),z.number().finite().min(-90).max(90)]);
const line=z.array(point).min(2).max(100000);
const feature=z.object({type:z.literal('Feature'),properties:z.object({code:z.string().regex(/^\d{3}$/),name:z.string().min(1).max(160)}),
  geometry:z.object({type:z.literal('MultiLineString'),coordinates:z.array(line).min(1).max(10000)})});
const collection=z.object({type:z.literal('FeatureCollection'),features:z.array(feature).length(66)});
const manifestSchema=z.object({schema_version:z.literal(1),geometry_version:z.literal('20240520'),code_table_version:z.literal('20261007'),
  reviewed_at:instant,review_due_at:instant,source_crs:z.literal('EPSG:6668'),output_crs:z.literal('EPSG:4326'),geometry_type:z.literal('MultiLineString'),
  geometry:z.object({path:z.string().regex(/^\/hazards\/jma-forecast-lines-v1\/coastal-lines\.geojson$/),bytes:z.number().int().positive().max(16000000),sha256:sha}),
  codes:z.record(z.string().regex(/^\d{3}$/),z.object({name:z.string().min(1).max(160),members:z.array(z.string().regex(/^\d{3}$/)).min(1).max(32),note:z.string().max(500)})),
  sources:z.array(z.object({url:z.url(),sha256:sha,version:z.string(),published_at:z.string(),retrieved_at:instant})).length(2),
  effective_intervals:z.literal('UNKNOWN'),station_coordinate_mapping:z.literal('UNAVAILABLE'),coverage:z.literal('PARTIAL_REFERENCE_LINES'),
  processing:z.object({method:z.string(),original_points:z.number().int(),output_points:z.number().int(),positional_accuracy:z.literal('UNKNOWN')}),
  attribution:z.string(),license_url:z.url(),
}).refine(x=>Date.parse(x.review_due_at)>Date.parse(x.reviewed_at)&&Object.keys(x.codes).length===98);
export type ForecastLinePack={manifest:z.infer<typeof manifestSchema>;geometry:z.infer<typeof collection>};

/** Bound the decoded bytes before parsing either public cache or API input. */
export async function boundedText(response:Response,max:number){
  if(!response.ok||!response.body)throw Error('Map reference unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>max)throw Error('Map reference capacity exceeded');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
  return {body,text:new TextDecoder('utf-8',{fatal:true}).decode(body)};
}
export async function checkedMapAsset(path:string,hash:string,max:number,signal?:AbortSignal){
  const result=await boundedText(await fetch(path,{cache:'no-cache',signal}),max);
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',result.body.buffer)),x=>x.toString(16).padStart(2,'0')).join('');
  if(actual!==hash)throw Error('Map reference integrity failure');
  return {data:JSON.parse(result.text),bytes:result.body.byteLength};
}
export async function loadForecastLinePack(signal?:AbortSignal):Promise<ForecastLinePack>{
  const manifest=manifestSchema.parse((await checkedMapAsset(pin.path,pin.sha256,64000,signal)).data);
  const raw=await checkedMapAsset(manifest.geometry.path,manifest.geometry.sha256,manifest.geometry.bytes,signal);
  if(raw.bytes!==manifest.geometry.bytes)throw Error('Map line size mismatch');
  const geometry=collection.parse(raw.data),codes=new Set(geometry.features.map(f=>f.properties.code));
  if(codes.size!==66||geometry.features.some(f=>manifest.codes[f.properties.code]?.name!==f.properties.name)
    ||Object.values(manifest.codes).some(c=>c.members.some(m=>!codes.has(m))))throw Error('Map line code mismatch');
  return {manifest,geometry};
}
export function isMapReportCurrent(data:DisasterMapReference,item:MapReport,connected:boolean,now:number){
  const source=data.sources.find(s=>s.source_key===(item.bulletin.product==='VXSE53'?'jma-live-eqvol':'jma-live-tsunami'));
  const b=item.bulletin,issued=Date.parse(b.issued_at);
  return connected&&source?.status==='FRESH'&&source.recovery?.scan_status==='WINDOW_VERIFIED'
    &&b.lifecycle==='CURRENT'&&b.operation==='ISSUE'&&now>=issued&&now<Date.parse(b.evidence_expires_at)
    &&now>=Date.parse(b.received_at)
    &&now<issued+900000&&(!b.official_valid_until||now<Date.parse(b.official_valid_until))
    &&Date.parse(data.generated_at)<=now+5000;
}
type LineState='ACTIVE'|'CANCELLED'|'STALE'|'CONFLICT';
const rank:Record<string,number>={MAJOR_WARNING:5,WARNING:4,ADVISORY:3,FORECAST:2,NONE:1,UNKNOWN:0};
export function forecastLines(pack:ForecastLinePack|null,data:DisasterMapReference|null,connected:boolean,now:number){
  const empty={type:'FeatureCollection' as const,features:[] as Array<z.infer<typeof feature>&{properties:z.infer<typeof feature>['properties']&{state:LineState;warning_class:string}}>};
  if(!pack||(data&&data.tsunami_code_table_version!==pack.manifest.code_table_version)
    ||now<Date.parse(pack.manifest.reviewed_at)||now>=Date.parse(pack.manifest.review_due_at))return {...empty,reason:'GEOMETRY_VERSION_OR_REVIEW_UNKNOWN',unmapped:[] as string[]};
  if(!data)return {...empty,reason:'NO_OFFICIAL_REPORT_REFERENCE',unmapped:[] as string[]};
  const states=new Map<string,{state:LineState;warning_class:string}>(),unmapped=new Set<string>();
  for(const item of data.reports){
    if(item.bulletin.product!=='VTSE41')continue;
    const current=isMapReportCurrent(data,item,connected,now);
    for(const area of item.forecast_areas){
      const mapped=pack.manifest.codes[area.area_code];
      // Latest registry has no historical effective intervals: never reinterpret
      // pre-registry bulletins as verified spatial observations.
      if(!mapped||mapped.name!==area.area_name||Date.parse(item.bulletin.issued_at)<Date.parse('2026-10-07T00:00:00Z')){unmapped.add(area.area_code);continue;}
      const state:LineState=item.bulletin.lifecycle==='CONFLICT'?'CONFLICT':!current?'STALE':area.status==='ACTIVE'?'ACTIVE':area.status==='CANCELLED'?'CANCELLED':'STALE';
      for(const code of mapped.members){
        const previous=states.get(code),candidate={state,warning_class:area.warning_class};
        // A separate cancellation never clears another information unit's
        // active warning. Conflicting / unresolved old units remain visible.
        if(!previous)states.set(code,candidate);
        else if(previous.state==='CONFLICT'||state==='CONFLICT')states.set(code,{state:'CONFLICT',warning_class:'UNKNOWN'});
        else if(previous.state!==state&&(previous.state==='STALE'||state==='STALE'))states.set(code,{state:'CONFLICT',warning_class:'UNKNOWN'});
        else if(state==='ACTIVE'&&(previous.state!=='ACTIVE'||rank[area.warning_class]>rank[previous.warning_class]))states.set(code,candidate);
      }
    }
  }
  for(const f of pack.geometry.features){const value=states.get(f.properties.code);if(value)empty.features.push({...f,properties:{...f.properties,...value}});}
  return {...empty,reason:unmapped.size?'UNMAPPED_CODE_OR_HISTORICAL_VERSION':null,unmapped:[...unmapped]};
}
