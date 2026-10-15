import {resolveDeviceArea} from './area-resolution';
import type {AreaFix,AreaResolution} from './area-geometry';
import type {SimulationLocation} from './simulation-advice';

export type HistoricalId='tohoku-2011'|'kobe-1995'|'kumamoto-2016'|'iburi-2018'|'noto-2024';
export type DrillPointSource='PRESET'|'MAP_PICK'|'DEVICE_ONCE';
type Label={ja:string;'zh-TW':string;en:string};
export type DrillPreset={id:string;lat:number;lng:number;label:Label};
export type DrillPoint={lat:number;lng:number;source:DrillPointSource;label:Label;preset_id:string|null;
  /** Real device accuracy for DEVICE_ONCE points; presets and map picks have none. */accuracy_m?:number};

/** Exercise-only representative points (approximate centres). Never a statement about real conditions. */
export const DRILL_PRESETS:Record<HistoricalId,readonly DrillPreset[]>={
  'tohoku-2011':[
    {id:'tohoku-ishinomaki-kadonowaki',lat:38.4196,lng:141.2946,label:{ja:'石巻・門脇','zh-TW':'石巻・門脇',en:'Ishinomaki Kadonowaki'}},
    {id:'tohoku-minamisanriku-shizugawa',lat:38.6766,lng:141.4469,label:{ja:'南三陸・志津川','zh-TW':'南三陸・志津川',en:'Minamisanriku Shizugawa'}},
    {id:'tohoku-sendai-arahama',lat:38.2213,lng:140.9800,label:{ja:'仙台・荒浜','zh-TW':'仙台・荒浜',en:'Sendai Arahama'}},
  ],
  'kobe-1995':[
    {id:'kobe-nagata',lat:34.6573,lng:135.1460,label:{ja:'神戸・長田','zh-TW':'神戶・長田',en:'Kobe Nagata'}},
    {id:'kobe-higashinada',lat:34.7200,lng:135.2650,label:{ja:'神戸・東灘','zh-TW':'神戶・東灘',en:'Kobe Higashinada'}},
  ],
  'kumamoto-2016':[
    {id:'kumamoto-mashiki',lat:32.7917,lng:130.8160,label:{ja:'益城町','zh-TW':'益城町',en:'Mashiki'}},
    {id:'kumamoto-chuo',lat:32.8031,lng:130.7079,label:{ja:'熊本市中央区','zh-TW':'熊本市中央區',en:'Kumamoto Chuo'}},
  ],
  'iburi-2018':[
    {id:'iburi-atsuma',lat:42.7240,lng:141.8780,label:{ja:'厚真町','zh-TW':'厚真町',en:'Atsuma'}},
    {id:'iburi-sapporo-kiyota',lat:42.9990,lng:141.4430,label:{ja:'札幌・清田','zh-TW':'札幌・清田',en:'Sapporo Kiyota'}},
  ],
  'noto-2024':[
    {id:'noto-wajima',lat:37.3906,lng:136.8992,label:{ja:'輪島市','zh-TW':'輪島市',en:'Wajima'}},
    {id:'noto-suzu',lat:37.4369,lng:137.2606,label:{ja:'珠洲市','zh-TW':'珠洲市',en:'Suzu'}},
  ],
};

export async function drillPointToLocation(point:DrillPoint,resolve:(fix:AreaFix)=>Promise<AreaResolution>=resolveDeviceArea,now=new Date())
  :Promise<{ok:true;location:SimulationLocation;areaLabel:string}|{ok:false;reason:'OUTSIDE'|'UNAVAILABLE'|'AMBIGUOUS'}>{
  const result=await resolve({latitude:point.lat,longitude:point.lng,accuracy_m:point.source==='DEVICE_ONCE'?(point.accuracy_m??0):0});
  if(result.status!=='RESOLVED'||result.area_ids.length<2)return {ok:false,reason:result.status==='RESOLVED'?'UNAVAILABLE':result.status};
  return {ok:true,areaLabel:result.label,location:{area_ids:[...result.area_ids],source:'USER_SELECTED',observed_at:now.toISOString()}};
}
