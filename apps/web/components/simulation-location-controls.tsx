'use client';
import { useEffect,useState } from 'react';
import type { Language } from '@/lib/contracts';
import { AreaFallbackPicker } from './location-onboarding';
import { resolveDeviceArea } from '@/lib/area-resolution';
import { useSimulationGeo } from '@/lib/use-simulation-geo';
import { simulationAdviceText, simulationConditionsSchema, type SimulationLocation, type SimulationConditions } from '@/lib/simulation-advice';

export const simulationConditionText={
  'zh-TW':{gps:'使用目前 GPS 地區',clear:'清除位置',resolving:'正在裝置內解析地區…',failed:'無法確認 GPS 地區，請手動選擇。',choose:'選擇目前所在地區',pref:'都道府縣',pick:'選擇都道府縣',city:'市區町村',broad:'只選都道府縣',confirm:'確認所在地區',conditions:'所在地的演練條件',
    site:'環境',shaking:'搖晃階段',building:'建物狀態',shelter:'避難所開放',high_ground:'高處條件',route:'移動路線',
    UNKNOWN:'未知',INDOOR:'室內',INLAND:'內陸',COASTAL_LOWLAND:'沿岸低地',HIGH_GROUND:'高處',DURING:'搖晃期間',AFTER:'搖晃結束後',INTACT_IN_SCENARIO:'假設建物完整',DAMAGED_IN_SCENARIO:'假設建物損毀',OPEN_IN_SCENARIO:'假設已確認開放',CLOSED_IN_SCENARIO:'假設關閉',VERIFIED_IN_SCENARIO:'假設已核實可用高處',BLOCKED_IN_SCENARIO:'假設不可用',PASSABLE_IN_SCENARIO:'假設已核實可通行'},
  ja:{gps:'現在の GPS 地域を使用',clear:'位置を削除',resolving:'端末内で地域を解析中…',failed:'GPS 地域を確認できません。手動で選択してください。',choose:'現在の地域を選択',pref:'都道府県',pick:'都道府県を選択',city:'市区町村',broad:'都道府県のみ',confirm:'所在地を確認',conditions:'所在地の演習条件',
    site:'環境',shaking:'揺れの段階',building:'建物状態',shelter:'避難所開設',high_ground:'高所条件',route:'経路',
    UNKNOWN:'不明',INDOOR:'屋内',INLAND:'内陸',COASTAL_LOWLAND:'沿岸低地',HIGH_GROUND:'高所',DURING:'揺れている間',AFTER:'揺れが収まった後',INTACT_IN_SCENARIO:'建物が無損傷という仮定',DAMAGED_IN_SCENARIO:'建物損傷の仮定',OPEN_IN_SCENARIO:'開設確認済みの仮定',CLOSED_IN_SCENARIO:'閉鎖の仮定',VERIFIED_IN_SCENARIO:'高所の利用確認済みの仮定',BLOCKED_IN_SCENARIO:'利用不可の仮定',PASSABLE_IN_SCENARIO:'通行確認済みの仮定'},
  en:{gps:'Use current GPS area',clear:'Clear location',resolving:'Resolving area on device…',failed:'GPS area unavailable. Select an area manually.',choose:'Select current area',pref:'Prefecture',pick:'Choose prefecture',city:'Municipality',broad:'Prefecture only',confirm:'Confirm current area',conditions:'Location drill conditions',
    site:'Setting',shaking:'Shaking phase',building:'Building state',shelter:'Shelter opening',high_ground:'Higher ground',route:'Route',
    UNKNOWN:'Unknown',INDOOR:'Indoors',INLAND:'Inland',COASTAL_LOWLAND:'Coastal lowland',HIGH_GROUND:'Higher ground',DURING:'During shaking',AFTER:'After shaking',INTACT_IN_SCENARIO:'Assume intact building',DAMAGED_IN_SCENARIO:'Assume damaged building',OPEN_IN_SCENARIO:'Assume verified open',CLOSED_IN_SCENARIO:'Assume closed',VERIFIED_IN_SCENARIO:'Assume verified usable higher ground',BLOCKED_IN_SCENARIO:'Assume unavailable',PASSABLE_IN_SCENARIO:'Assume verified passable'},
} as const;

export function SimulationLocationControls({language,location,conditions,onLocation,onConditions}:{language:Language;location:SimulationLocation|null;conditions:SimulationConditions;
  onLocation:(v:SimulationLocation|null)=>void;onConditions:(v:SimulationConditions)=>void}){
  const geo=useSimulationGeo();const t=simulationConditionText[language],a=simulationAdviceText[language];
  const [label,setLabel]=useState('');const [status,setStatus]=useState('');
  useEffect(()=>{
    if(!geo.location){if(location?.source==='GPS'){onLocation(null);setLabel('');}return;}
    let cancelled=false;const fix=geo.location;
    setStatus(t.resolving);
    void resolveDeviceArea({latitude:fix.lat,longitude:fix.lng,accuracy_m:fix.accuracy_m}).then(result=>{
      if(cancelled)return;
      if(result.status==='RESOLVED'&&result.area_ids.length>=2&&Date.now()-fix.captured_at<120000){
        onLocation({area_ids:result.area_ids,source:'GPS',observed_at:new Date(fix.captured_at).toISOString()});setLabel(result.label);setStatus('');
      }else{onLocation(null);setLabel('');setStatus(t.failed);}
    }).catch(()=>{if(!cancelled){onLocation(null);setLabel('');setStatus(t.failed);}});
    return()=>{cancelled=true;};
  // React setters are stable. Location changes from this resolver must not rerun it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[geo.location,t]);
  const fields=['site','shaking','building','shelter','high_ground','route'] as const;
  return <section className="sim-location-controls" data-testid="simulation-location-controls">
    <h4>{a.area}</h4><p>{label||a.unknownArea}{location?' · '+(location.source==='GPS'?a.gps:a.manual):''}</p>
    <button type="button" disabled={geo.state==='requesting'} onClick={()=>{onLocation(null);setLabel('');geo.request();}}>{t.gps}</button>
    <AreaFallbackPicker messages={{locationResolving:t.resolving,locationChooseArea:t.choose,areaCatalogUnavailable:t.failed,locationPrefecture:t.pref,
      locationChoosePrefecture:t.pick,locationMunicipality:t.city,locationPrefectureOnly:t.broad,locationConfirmArea:t.confirm}}
      disabled={geo.state==='requesting'} onConfirm={value=>{geo.clear();onLocation({area_ids:value.area_ids,source:'USER_SELECTED',observed_at:value.observed_at});setLabel(value.label);setStatus('');}}/>
    {location&&<button type="button" onClick={()=>{geo.clear();onLocation(null);setLabel('');}}>{t.clear}</button>}
    {(status||geo.error)&&<p role="status">{status||t.failed}</p>}
    <details><summary>{t.conditions}</summary><p>{a.assumptions}</p>
      <div className="sim-condition-fields">{fields.map(field=><label key={field}>{t[field]}
        <select data-testid={'simulation-condition-'+field} value={conditions[field]}
          onChange={e=>onConditions(simulationConditionsSchema.parse({...conditions,[field]:e.target.value}))}>
          {simulationConditionsSchema.shape[field].removeDefault().options.map(option=><option key={option} value={option}>{t[option]}</option>)}
        </select></label>)}</div>
    </details><p className="lab-muted">{a.limits}</p>
  </section>;
}
