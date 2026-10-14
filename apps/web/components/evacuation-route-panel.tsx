'use client';
import {useEffect,useMemo,useState} from 'react';
import type {Language} from '@/lib/contracts';
import {hazardKeys,type HazardLocation} from '@/lib/official-hazards';
import type {DesignationHazard} from '@/lib/designated-places';
import type {DesignatedPlacesState} from '@/lib/use-designated-places';
import {selectEvacuationDestinations,assessEvacuationRouteReadiness,usableEvacuationOrigin,type EvacuationCheckId} from '@/lib/evacuation-route-assessment';
import {loadEvacuationRoadGraph,findEvacuationRoadCandidates,type RoadGraphPack,type RoadCandidate} from '@/lib/evacuation-road-graph';
import {hazardText} from './official-hazard-panel';
import './evacuation-route.css';

const text={
 'zh-TW':{title:'避難路線評估',undetermined:'最安全路線：未判定',scope:'石卷道路候選試點 · 非避難導航',hazard:'避難路線災害類別',chooseHazard:'請選擇災害',
 destination:'該災害指定緊急避難場所',choosePlace:'請選擇目的地',origin:'起點',none:'請在地圖點選起點或按上方 GPS 查詢。',gps:'裝置 GPS（只留本機）',manual:'地圖選點（並非目前 GPS）',
 trial:'使用試點示例起點（非 GPS）',generate:'計算本機道路候選',loading:'正在核對道路資料',error:'道路資料未配置或未能驗證',
 noRoute:'未能產生道路候選：覆蓋、接駁或連通資料不足。',candidate:'道路候選',distance:'道路距離',gap:'起點／場所至道路缺口',
 gapWarning:'路線只包括圖內道路；起點及場所的最後接駁未核實。',show:'查看此道路候選',clear:'移除路線',
 disclaimer:'距離不代表安全排名。尚欠即時災害覆蓋、沿路通行、場所開放及移動授權；不能核實最安全路線。',
 ref:'參考資料已核對',blocked:'不可使用',unknown:'未核實',source:'道路來源與範圍',
 checks:{ORIGIN:'起點時效及精度',DESIGNATION:'災害分類及場所用途',OPENING:'目前開放',ROAD_GEOMETRY:'圖內道路連通',ROAD_CONDITIONS:'災後道路通行',HAZARD_COVERAGE:'沿途災害覆蓋及風險',MOVEMENT_AUTHORITY:'目的地及移動授權'}},
 ja:{title:'避難経路の検討',undetermined:'最も安全な経路：判定不可',scope:'石巻の道路候補試行 · 避難ナビではありません',hazard:'経路の災害種別',chooseHazard:'災害を選択',destination:'災害に対応する指定緊急避難場所',choosePlace:'目的地を選択',origin:'出発点',none:'地図で出発点を選ぶか、上のGPS照会を利用してください。',gps:'端末のGPS（端末内のみ）',manual:'地図選択点（現在のGPSではありません）',trial:'試行の例示出発点（GPSではありません）',generate:'端末内で道路候補を計算',loading:'道路データを検証中',error:'道路データ未設定・検証不可',noRoute:'道路候補なし。範囲・接続・連通情報が不足しています。',candidate:'道路候補',distance:'道路距離',gap:'出発点／施設と道路の間隔',gapWarning:'図内道路だけを表示。出発点・施設までの最後の接続は未確認です。',show:'この道路候補を表示',clear:'経路を消去',disclaimer:'距離は安全順位ではありません。現在の災害範囲、通行状況、開設と移動許可が未確認で、最も安全な経路は判定できません。',ref:'参考資料検証済み',blocked:'使用不可',unknown:'未確認',source:'道路の出典・範囲',checks:{ORIGIN:'出発点の時刻・精度',DESIGNATION:'災害指定・施設用途',OPENING:'現在の開設',ROAD_GEOMETRY:'図内道路の接続',ROAD_CONDITIONS:'災害後の通行',HAZARD_COVERAGE:'経路上の災害範囲・危険',MOVEMENT_AUTHORITY:'目的地と移動許可'}},
 en:{title:'Evacuation route review',undetermined:'Safest route: undetermined',scope:'Ishinomaki road-candidate pilot · not evacuation navigation',hazard:'Route hazard category',chooseHazard:'Select hazard',destination:'Emergency site designated for this hazard',choosePlace:'Select destination',origin:'Origin',none:'Select an origin on the map or use the GPS query above.',gps:'Device GPS (local only)',manual:'Map point (not current GPS)',trial:'Use pilot example origin (not GPS)',generate:'Calculate local road candidates',loading:'Verifying road data',error:'Road data unconfigured or unverified',noRoute:'No road candidate. Coverage, connections or graph continuity are insufficient.',candidate:'Road candidate',distance:'Road distance',gap:'Origin / site gap to road',gapWarning:'Only graph roads are included. Last connections from origin and to the site are unverified.',show:'View this road candidate',clear:'Remove route',disclaimer:'Distance is not a safety ranking. Current hazards, road conditions, opening and movement authorization are missing; a safest route cannot be verified.',ref:'Reference checked',blocked:'Blocked',unknown:'Unverified',source:'Road sources and scope',checks:{ORIGIN:'Origin age and accuracy',DESIGNATION:'Hazard designation and site role',OPENING:'Current opening',ROAD_GEOMETRY:'Graph road continuity',ROAD_CONDITIONS:'Post-disaster passability',HAZARD_COVERAGE:'Route hazard coverage and risk',MOVEMENT_AUTHORITY:'Destination and movement authorization'}},
} as const;

export function EvacuationRoutePanel({language,state,origin,onOrigin,onFocus,onRoute}:{language:Language;state:DesignatedPlacesState;origin:HazardLocation|null;
 onOrigin:(point:{lat:number;lng:number})=>void;onFocus:(point:{lat:number;lng:number;zoom?:number})=>void;onRoute:(route:RoadCandidate|null)=>void}){
 const t=text[language],hazard=state.hazard;
 const [graph,setGraph]=useState<RoadGraphPack|null>(null),[loadError,setLoadError]=useState(false),[loading,setLoading]=useState(true);
 const [destinationId,setDestinationId]=useState(''),[candidates,setCandidates]=useState<readonly RoadCandidate[]>([]),[attempted,setAttempted]=useState(false);
 const places=useMemo(()=>selectEvacuationDestinations(state.pack?.catalog??[],hazard),[state.pack,hazard]);
 const destination=places.find(p=>p.id===destinationId)??null;
 const originKey=origin?`${origin.source}:${origin.lat}:${origin.lng}:${origin.captured_at}`:'';
 const currentCatalog=!!state.pack&&state.now>=Date.parse(state.pack.manifest.reviewed_at)&&state.now<Date.parse(state.pack.manifest.review_due_at);
 const graphCurrent=!!graph&&state.now>=Date.parse(graph.manifest.reviewed_at)&&state.now<Date.parse(graph.manifest.review_due_at);
 useEffect(()=>{
  const abort=new AbortController();void loadEvacuationRoadGraph(abort.signal).then(pack=>{if(!abort.signal.aborted)setGraph(pack);})
   .catch(()=>{if(!abort.signal.aborted)setLoadError(true);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return()=>abort.abort();
 },[]);
 useEffect(()=>{setCandidates([]);setAttempted(false);onRoute(null);},[originKey,destinationId,hazard,currentCatalog,graphCurrent,onRoute]);
 useEffect(()=>{if(!usableEvacuationOrigin(origin,state.now)){setCandidates([]);onRoute(null);}},[origin,state.now,onRoute]);
 const assessment=assessEvacuationRouteReadiness({place:destination,hazard,origin,catalogCurrent:currentCatalog,opening:state.opening,
  connected:state.connected,now:state.now,resumeAt:state.resumeAt,roadCandidateCount:candidates.length,graphCurrent:graphCurrent&&!loadError});
 const generate=()=>{
  setAttempted(true);onRoute(null);
  if(!graph||!graphCurrent||!origin||!destination||!currentCatalog||!usableEvacuationOrigin(origin,state.now)){setCandidates([]);return;}
  const result=findEvacuationRoadCandidates(graph,origin,destination);setCandidates(result.candidates);
 };
 return <section id="evacuation-routes" className="evacuation-route-panel" data-testid="evacuation-route-panel">
  <h2>{t.title}</h2><p>{t.scope}</p><p className="hazard-safety" role="status">{t.undetermined}</p>
  <label>{t.hazard}<select aria-label={t.hazard} value={hazard} onChange={e=>{state.setHazard(e.target.value as DesignationHazard);setDestinationId('');}}>
   <option value="ALL">{t.chooseHazard}</option>{hazardKeys.map((h,i)=><option key={h} value={h}>{hazardText[language].hazardNames[i]}</option>)}</select></label>
  <label>{t.destination}<select aria-label={t.destination} value={destination?.id??''} onChange={e=>setDestinationId(e.target.value)}>
   <option value="">{t.choosePlace}</option>{places.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  <p>{t.origin}: {origin&&origin.source!=='OFFICIAL_PLACE'?origin.source==='GPS'?t.gps:t.manual:t.none}</p>
  {loading&&<p>{t.loading}</p>}{loadError&&<p role="status">{t.error}</p>}
  <button type="button" disabled={!graphCurrent} onClick={()=>{
   // A fixed, public demo point, never a device-location claim.
   const point=graph!.manifest.pilot_starting_point;onOrigin({lat:point.lat,lng:point.lng});onFocus({lat:point.lat,lng:point.lng,zoom:15});
  }}>{t.trial}</button>
  <button type="button" onClick={generate} disabled={!graphCurrent||!destination||!currentCatalog||!usableEvacuationOrigin(origin,state.now)}>{t.generate}</button>
  <ul className="evacuation-checks">{assessment.checks.map(check=><li key={check.id}><span>{t.checks[check.id as EvacuationCheckId]}</span>
   <strong>{check.status==='REFERENCE_VERIFIED'?t.ref:check.status==='BLOCKED'?t.blocked:t.unknown}</strong></li>)}</ul>
  <p>{t.disclaimer}</p>{attempted&&!candidates.length&&<p role="status">{t.noRoute}</p>}
  {candidates.map((candidate,i)=><article key={candidate.id}>
   <h3>{t.candidate} {i+1}</h3><p>{t.distance}: {Math.round(candidate.distance_m)} m · {t.gap}: {Math.round(candidate.origin_gap_m)} / {Math.round(candidate.destination_gap_m)} m</p>
   {!!candidate.road_names.length&&<p>{candidate.road_names.join(' → ')}</p>}<p>{t.gapWarning}</p>
   <button type="button" onClick={()=>{onRoute(candidate);if(origin)onFocus({...origin,zoom:15});}}>{t.show}</button>
  </article>)}{candidates.length>0&&<button type="button" onClick={()=>onRoute(null)}>{t.clear}</button>}
  <details><summary>{t.source}</summary><p>© OpenStreetMap contributors · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">ODbL</a></p>
   {graph&&<p>{graph.manifest.pack_id} · {graph.manifest.source.osm_base_timestamp}<br/>{graph.manifest.review_due_at}<br/>{graph.manifest.asset_sha256.slice(0,16)}</p>}
   <p>{t.gapWarning} {t.disclaimer}</p></details>
 </section>;
}
