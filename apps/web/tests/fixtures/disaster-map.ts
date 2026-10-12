import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {disasterMapSchema,type ForecastLinePack} from '../../lib/disaster-map';

export const manifest=JSON.parse(readFileSync(resolve(__dirname,'../../public/hazards/jma-forecast-lines-v1/manifest.json'),'utf8'));
export const now=Date.parse(manifest.reviewed_at)+1000;
const stamp=(delta=0)=>new Date(now+delta).toISOString();
export function mapFixture(){
 const source=(source_key:string)=>({source_key,source_name:'JMA fixture',source_url:'https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml',
  status:'FRESH',retrieved_at:stamp(),last_published_at:stamp(),next_retry_at:null,record_count:1,detail:'Synthetic test only',
  recovery:{persistence:'MEMORY',storage_status:'HEALTHY',scan_status:'WINDOW_VERIFIED',last_verified_at:stamp(),
   pending_details:0,archived_reports:1,checkpoint_version:1,last_checked_at:stamp(),last_successful_fetch_at:stamp(),window_start_at:stamp(),coverage_origin_at:stamp(),restored:false,limitations:[]},
 });
 return disasterMapSchema.parse({mode:'LIVE_REFERENCE',generated_at:stamp(),sources:[source('jma-live-eqvol'),source('jma-live-tsunami')],
  reports:[{bulletin:{report_id:`${'a'.repeat(24)}--${'b'.repeat(24)}`,group_id:'a'.repeat(24),raw_sha256:'b'.repeat(64),
   product:'VTSE41',title:'Synthetic test only',source_name:'JMA fixture',reference_url:'https://www.data.jma.go.jp/developer/xml/data/fixture.xml',
   event_ids:['20261012000000'],serial:null,operation:'ISSUE',lifecycle:'CURRENT',issued_at:stamp(),reported_at:stamp(),received_at:stamp(),target_at:null,occurred_at:null,
   official_valid_until:null,evidence_expires_at:stamp(900000),target_codes:['100'],is_head:true,superseded_by:null,
   parser_version:'test',information_version:'1.0_1',code_mapping_version:'test',authority:'REFERENCE_ONLY',eligible_for_action:false},
   observations:[],forecast_areas:[{area_code:'100',area_name:manifest.codes['100'].name,status:'ACTIVE',warning_class:'WARNING',max_height:{value_m:3,expression:'NUMERIC',description:null},arrival_at:null}],
  }],observation_mapping_version:'jma-xml-observation-v1',tsunami_code_table_version:'20261007',earthquake_code_table_version:'20261007',coverage:'PARTIAL',capacity_exceeded:false,
  authority:'REFERENCE_ONLY',safe_location_verified:false,route_authorized:false});
}
export const linePack:ForecastLinePack={manifest,geometry:{type:'FeatureCollection',features:['100','101','102'].map(code=>({
 type:'Feature',properties:{code,name:manifest.codes[code].name},geometry:{type:'MultiLineString',coordinates:[[[143,43],[144,44]]]},
}))}};
