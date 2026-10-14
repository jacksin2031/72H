'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { tsunamiReferenceSchema, type Language, type TsunamiReferenceResponse } from '@/lib/contracts';
import { assessOfficialHazards, hazardKeys, isTsunamiDesignated, type HazardPack, type HazardLocation, type OfficialPlace, type HazardManifest } from '@/lib/official-hazards';

export const hazardText={
  'zh-TW':{title:'官方海嘯及避難場所資料',scope:'石卷試點 · 其他地區未完成資料驗收',caution:'安全性：無法判定 · 場所開放及路線未核實',
    loading:'正在核對官方資料包',error:'資料包無法驗證，查詢不可用',retry:'重新載入',inundation:'浸水想定圖層',places:'指定場所圖層',
    gps:'使用目前 GPS 查詢',privacy:'定位只留在此裝置；亦可點選地圖或場所查詢，不會上傳精確座標。',clear:'清除查詢',focus:'查看石卷試點',
    choose:'點選地圖或指定場所，查看該點資料。',point:'地圖選點／場所座標（並非目前 GPS）',gpsPoint:'目前 GPS',
    statuses:{INSIDE_KNOWN:'位於已知浸水想定範圍',OUTSIDE_KNOWN:'未與已核查想定範圍相交',BOUNDARY_UNCERTAIN:'邊界或定位精度不確定',UNKNOWN:'無法判定浸水情況'},
    reasons:{SOURCE_ACCURACY_NOT_BOUND:'原典位置精度為標準差或未知，沒有最大誤差保證；此點浸水情況仍不確定',NO_LOCATION:'尚未選擇位置',INVALID_OR_EXPIRED_LOCATION:'定位已過期或精度不足',DATA_REVIEW_EXPIRED:'資料包已超過本地覆核期限',ACCURACY_OR_DATA_BOUNDARY:'定位或資料誤差範圍跨越分級邊界',SCENARIO_INUNDATION:'官方想定情境中的浸水範圍，並非本次事件預測',NO_SCENARIO_INTERSECTION:'只代表與此資料情境未相交，不代表安全',NO_VERIFIED_SURVEY_COVERAGE:'沒有足夠調查覆蓋證據，不能判定範圍之外的地點'},
    depth:'原典浸水深度分級',partial:'覆蓋未完整核實：範圍外不代表零浸水。',review:'資料包覆核期限',basis:'資料基準',retrieved:'取得時間',
    source:'資料來源與版本',list:'官方指定場所',filter:'只顯示海嘯指定緊急避難場所',search:'搜尋場所',more:'顯示更多場所',emergency:'指定緊急避難場所',shelter:'指定避難所',
    designated:'有該類指定',notDesignated:'沒有該類指定',unknown:'資料未提供',open:'目前開放：未核實',route:'路線：未核實',
    hazardNames:['洪水','山泥傾瀉','風暴潮','地震','海嘯','大規模火災','內水氾濫','火山'],live:'JMA 即時海嘯資訊（獨立於歷史演練）',
    unavailable:'未取得有效且新鮮的官方海嘯資訊',current:'已取得近期官方電文；不等於此點安全',expired:'官方電文已過期／有衝突，只作舊資料參考',
    published:'電文發布時間',cancelled:'電文包含解除資訊；不代表本地已核實安全',fetching:'正在查詢官方電文',summary:'此圖層為想定情境；實際海嘯可能超出範圍。最近場所並非安全排名。',
  },
  ja:{title:'公式の津波・避難場所データ',scope:'石巻の試行 · 他地域は未検証',caution:'安全性：判定不可 · 開設・経路は未確認',loading:'公式データを検証中',error:'データ検証に失敗。照会できません',retry:'再読込',inundation:'津波浸水想定',places:'指定場所',gps:'現在の GPS で照会',privacy:'位置は端末内のみ。地図や場所を選んでも照会できます。座標は送信しません。',clear:'選択を消去',focus:'石巻の試行範囲へ',choose:'地図または指定場所を選択してください。',point:'地図・施設の位置（現在の GPS ではありません）',gpsPoint:'現在の GPS',statuses:{INSIDE_KNOWN:'既知の浸水想定範囲内',OUTSIDE_KNOWN:'検証済み想定範囲と交差なし',BOUNDARY_UNCERTAIN:'境界・位置精度が不確実',UNKNOWN:'浸水の判定不可'},reasons:{SOURCE_ACCURACY_NOT_BOUND:'原典の位置精度は標準偏差または不明。最大誤差の保証がなく、地点の浸水は不確実です',NO_LOCATION:'位置未選択',INVALID_OR_EXPIRED_LOCATION:'位置が古い・精度不足',DATA_REVIEW_EXPIRED:'データの再確認期限切れ',ACCURACY_OR_DATA_BOUNDARY:'精度範囲が境界を横断',SCENARIO_INUNDATION:'想定条件の範囲。今回の予測ではありません',NO_SCENARIO_INTERSECTION:'安全を意味しません',NO_VERIFIED_SURVEY_COVERAGE:'調査範囲の証拠不足。範囲外は判定不可'},depth:'原典の浸水深区分',partial:'調査範囲は未完全検証。範囲外もゼロ浸水とは限りません。',review:'再確認期限',basis:'データ基準',retrieved:'取得日時',source:'出典・版',list:'公式指定場所',filter:'津波指定の緊急避難場所のみ',search:'場所を検索',more:'さらに表示',emergency:'指定緊急避難場所',shelter:'指定避難所',designated:'指定あり',notDesignated:'指定なし',unknown:'情報なし',open:'現在の開設：未確認',route:'経路：未確認',hazardNames:['洪水','土砂災害','高潮','地震','津波','大規模火事','内水氾濫','火山'],live:'JMA 津波情報（過去の演習とは別）',unavailable:'有効・新しい津波情報を取得できません',current:'最近の公式電文。個別地点の安全確認ではありません',expired:'古い情報・競合。参考のみ',published:'電文発表日時',cancelled:'解除情報を含む電文。地点の安全確認ではありません',fetching:'公式電文を取得中',summary:'想定データです。実際の津波が上回る場合があります。近い場所が安全とは限りません。'},
  en:{title:'Official tsunami & evacuation-place data',scope:'Ishinomaki pilot · other regions unvalidated',caution:'Safety undetermined · opening & routes unverified',loading:'Verifying official data pack',error:'Pack could not be verified. Query unavailable',retry:'Reload',inundation:'Inundation scenario',places:'Designated places',gps:'Query current GPS',privacy:'Coordinates stay on this device. Select a map point or place instead if preferred.',clear:'Clear query',focus:'View Ishinomaki pilot',choose:'Select a map point or designated place to inspect its data.',point:'Map / facility point (not current GPS)',gpsPoint:'Current GPS',statuses:{INSIDE_KNOWN:'Inside a known inundation scenario',OUTSIDE_KNOWN:'No intersection with reviewed scenario',BOUNDARY_UNCERTAIN:'Boundary / accuracy uncertainty',UNKNOWN:'Inundation undetermined'},reasons:{SOURCE_ACCURACY_NOT_BOUND:'Source accuracy is a standard deviation or unknown, not a maximum error bound. Point inundation remains uncertain',NO_LOCATION:'No location selected',INVALID_OR_EXPIRED_LOCATION:'Location expired or imprecise',DATA_REVIEW_EXPIRED:'Pack review deadline passed',ACCURACY_OR_DATA_BOUNDARY:'Accuracy overlaps a classification boundary',SCENARIO_INUNDATION:'Scenario inundation, not a forecast for this event',NO_SCENARIO_INTERSECTION:'No intersection does not establish safety',NO_VERIFIED_SURVEY_COVERAGE:'Survey coverage not established. Outside polygons remains unknown'},depth:'Source depth classification',partial:'Survey coverage incomplete. Outside is not zero inundation.',review:'Pack review deadline',basis:'Data basis',retrieved:'Retrieved',source:'Sources & versions',list:'Official designated places',filter:'Tsunami-designated emergency sites only',search:'Search places',more:'Show more',emergency:'Emergency evacuation site',shelter:'Designated shelter',designated:'Designated',notDesignated:'Not designated',unknown:'Not supplied',open:'Current opening: unverified',route:'Route: unverified',hazardNames:['Flood','Landslide','Storm surge','Earthquake','Tsunami','Large fire','Inland flood','Volcano'],live:'JMA live tsunami information (separate from historical exercises)',unavailable:'No valid, recent official tsunami information available',current:'Recent official bulletin; not point safety verification',expired:'Stale or conflicting bulletin; reference only',published:'Bulletin published',cancelled:'Cancellation bulletin; not local safety clearance',fetching:'Fetching official bulletin',summary:'Scenario data. Actual tsunami may exceed it. Nearby places are not ranked by safety.'},
} as const;

function LiveTsunamiReference({language}:{language:Language}){
  const t=hazardText[language];
  const [data,setData]=useState<TsunamiReferenceResponse|null>(null),[loading,setLoading]=useState(true),[now,setNow]=useState(()=>Date.now());
  useEffect(()=>{
    const abort=new AbortController();let generation=0;
    const refresh=async()=>{
      const call=++generation;setNow(Date.now());
      try{
        const response=await fetch('/api/reference/tsunami',{cache:'no-store',signal:abort.signal});
        if(!response.ok)throw Error('Unavailable');
        const text=await response.text();if(text.length>250000)throw Error('Oversized bulletin');
        const value=tsunamiReferenceSchema.parse(JSON.parse(text));
        if(!abort.signal.aborted&&call===generation)setData(value);
      }catch{if(!abort.signal.aborted&&call===generation)setData(null);}
      finally{if(!abort.signal.aborted)setLoading(false);}
    };
    const offline=()=>{generation++;setData(null);setLoading(false);};
    void refresh();const timer=setInterval(()=>{setNow(Date.now());void refresh();},60000);
    window.addEventListener('online',refresh);window.addEventListener('offline',offline);
    return()=>{abort.abort();clearInterval(timer);window.removeEventListener('online',refresh);window.removeEventListener('offline',offline);};
  },[]);
  const published=data?.source.published_at;
  const current=data?.source_status==='CURRENT'&&(data.status==='ACTIVE'||data.status==='CANCELLED')&&published&&now>=Date.parse(published)&&now-Date.parse(published)<15*60000;
  const warningNames=language==='zh-TW'?{MAJOR_WARNING:'大海嘯警報',WARNING:'海嘯警報',ADVISORY:'海嘯注意報',FORECAST:'海嘯預報',NONE:'解除／沒有指定警報',UNKNOWN:'未知'}:
    language==='ja'?{MAJOR_WARNING:'大津波警報',WARNING:'津波警報',ADVISORY:'津波注意報',FORECAST:'津波予報',NONE:'解除／指定警報なし',UNKNOWN:'不明'}:
      {MAJOR_WARNING:'Major tsunami warning',WARNING:'Tsunami warning',ADVISORY:'Tsunami advisory',FORECAST:'Tsunami forecast',NONE:'Cancelled / no specified warning',UNKNOWN:'Unknown'};
  const notice=loading?t.fetching:!data||data.source_status==='UNKNOWN'||data.status==='UNKNOWN'?t.unavailable:current?(data.status==='CANCELLED'?t.cancelled:t.current):t.expired;
  return <section className="hazard-live"><h2>{t.live}</h2>
    <p role={current&&data?.status==='ACTIVE'?'alert':'status'}>{current&&data?.status==='ACTIVE'?`${data.forecast_areas.filter(a=>a.status==='ACTIVE').map(a=>`${a.area_name} · ${warningNames[a.warning_class]}`).join(' / ')} · `:''}{notice}</p>
    {data&&<details><summary>{t.source}</summary><p>{t.published}: {published??'—'} · {data.source.operation}</p>
      <ul>{data.forecast_areas.map(area=><li key={area.area_code}>{area.area_name} · {warningNames[area.warning_class]} · {area.max_height.value_m!==null?`${area.max_height.value_m} m`:area.max_height.description??'—'}{area.arrival_at?` · ${area.arrival_at}`:''}</li>)}</ul>
      <a href={data.source.url} target="_blank" rel="noopener noreferrer">気象庁</a></details>}
  </section>;
}

export function OfficialHazardPanel({language,pack,loading,error,point,showInundation,showPlaces,onInundation,onPlaces,onRetry,onGPS,onClear,onFocus,onPlace,gpsState,liveReference,placesReference,includePlaceList=true}:{
  language:Language;pack:HazardPack|null;loading:boolean;error:boolean;point:HazardLocation|null;
  showInundation:boolean;showPlaces:boolean;onInundation:(v:boolean)=>void;onPlaces:(v:boolean)=>void;
  onRetry:()=>void;onGPS:()=>void;onClear:()=>void;onFocus:()=>void;onPlace:(p:OfficialPlace)=>void;gpsState:string;
  liveReference?:ReactNode;
  placesReference?:ReactNode;
  includePlaceList?:boolean;
}){
  const t=hazardText[language];const [filter,setFilter]=useState(false),[search,setSearch]=useState(''),[limit,setLimit]=useState(12),[now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[]);
  const assessment=useMemo(()=>pack?assessOfficialHazards(pack,point,Date.now()):null,[pack,point,now]);
  const places=pack?.places.filter(p=>(!filter||isTsunamiDesignated(p))&&`${p.name} ${p.address??''}`.includes(search.trim()))??[];
  return <aside className="official-hazard-panel" aria-label={t.title}>
    {includePlaceList?<h1>{t.title}</h1>:<h2>{language==='ja'?'石巻の津波浸水想定':language==='en'?'Ishinomaki inundation scenario':'石卷海嘯浸水想定'}</h2>}<p>{t.scope}</p><p className="hazard-safety">{t.caution}</p>
    {liveReference??<LiveTsunamiReference language={language}/>}
    {loading&&<p role="status">{t.loading}</p>}{error&&<p role="alert">{t.error}</p>}
    {!pack&&<button onClick={onRetry} disabled={loading}>{t.retry}</button>}
    {pack&&<>
      <p className="hazard-muted">{t.inundation} · {t.basis}: {pack.manifest.sources.find(s=>s.id===pack.inundation.features[0]?.properties.source_id)?.basis_date??'—'}<br/>{t.retrieved}: {[...new Set(pack.manifest.sources.map(s=>s.retrieved_at.slice(0,10)))].join(' / ')} · {t.review}: {pack.manifest.review_due_at.slice(0,10)}</p>
      {(now<Date.parse(pack.manifest.reviewed_at)||now>=Date.parse(pack.manifest.review_due_at))&&<p role="alert" className="hazard-safety">{t.reasons.DATA_REVIEW_EXPIRED}</p>}
      <div className="hazard-tools"><label><input type="checkbox" checked={showInundation} onChange={e=>onInundation(e.target.checked)}/>{t.inundation}</label>
        <label><input type="checkbox" checked={showPlaces} onChange={e=>onPlaces(e.target.checked)}/>{t.places}</label></div>
      <div className="hazard-actions"><button onClick={onFocus}>{t.focus}</button><button onClick={onGPS} disabled={gpsState==='requesting'}>{t.gps}</button>{point&&<button onClick={onClear}>{t.clear}</button>}</div>
      <p className="hazard-muted">{t.privacy}</p>{gpsState==='error'&&<p role="alert">{t.reasons.INVALID_OR_EXPIRED_LOCATION}</p>}
      <section className="hazard-query" aria-live="polite" data-testid="official-hazard-assessment">
        <h2>{assessment?t.statuses[assessment.status]:t.statuses.UNKNOWN}</h2>
        <p>{point?point.source==='GPS'?t.gpsPoint:t.point:t.choose}</p>
        {point&&<p>{point.lat.toFixed(5)}, {point.lng.toFixed(5)}{point.source==='GPS'?` · ±${Math.round(point.accuracy_m!)} m`:
          point.source==='OFFICIAL_PLACE'?` · ${language==='ja'?'施設位置精度：不明':language==='en'?'Facility position accuracy: unknown':'場所座標精度：未提供'}`:''}</p>}
        {point?.source==='GPS'&&Number.isFinite(new Date(point.captured_at).getTime())&&<p>{t.retrieved}: {new Date(point.captured_at).toISOString()}</p>}
        <p>{assessment?.reason==='SOURCE_LOCATION_ACCURACY_UNKNOWN'?(language==='ja'?'施設座標の精度が不明で、地点の浸水を判定できません。':language==='en'?'Facility coordinate accuracy is unknown; point inundation cannot be determined.':'場所座標精度未提供，不能判定此點的浸水情況。'):assessment?t.reasons[assessment.reason as keyof typeof t.reasons]:t.choose}</p>
        {!!assessment?.depth_labels.length&&<p>{t.depth}: {assessment.depth_labels.join(' / ')}</p>}
      </section>
      <p className="hazard-muted">{t.summary}</p>{pack.manifest.coverage_status==='PARTIAL'&&<p>{t.partial}</p>}
      <details><summary>{t.source}</summary><p>{pack.manifest.dataset_id} · {t.review}: {pack.manifest.review_due_at.slice(0,10)}</p>
        {pack.manifest.scenario&&<ScenarioDetails language={language} manifest={pack.manifest}/>}
        {pack.manifest.sources.map(source=><div key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><p>{t.basis}: {source.basis_date??'—'} · {t.retrieved}: {source.retrieved_at}</p><p>{source.notes}</p></div>)}
      </details>
      {includePlaceList&&!placesReference&&<section><h2>{t.list} · {places.length}</h2><label className="hazard-filter"><input type="checkbox" checked={filter} onChange={e=>{setFilter(e.target.checked);setLimit(12);}}/>{t.filter}</label>
        <input className="hazard-search" type="search" aria-label={t.search} placeholder={t.search} value={search} maxLength={80} onChange={e=>{setSearch(e.target.value);setLimit(12);}}/>
        <ul className="hazard-place-list">{places.slice(0,limit).map(place=><li key={place.id}>
          <button onClick={()=>onPlace(place)}>{place.name}</button><p>{place.kind==='EMERGENCY_SITE'?t.emergency:t.shelter} · {place.address}</p>
          <p>{t.hazardNames[4]}: {place.hazards.tsunami==='DESIGNATED'?t.designated:place.hazards.tsunami==='NOT_DESIGNATED'?t.notDesignated:t.unknown}</p>
          <p>{t.open} · {t.route}</p><details><summary>{t.source}</summary>
            <dl>{hazardKeys.map((key,index)=><div key={key}><dt>{t.hazardNames[index]}</dt><dd>{place.hazards[key]==='DESIGNATED'?t.designated:place.hazards[key]==='NOT_DESIGNATED'?t.notDesignated:t.unknown}</dd></div>)}</dl>
            <p>{place.notes}</p><p>ID: {place.common_id??place.id}</p><a href={pack.manifest.sources.find(s=>s.id===place.source_id)?.url}>{pack.manifest.sources.find(s=>s.id===place.source_id)?.title}</a>
          </details>
        </li>)}</ul>{places.length>limit&&<button onClick={()=>setLimit(x=>x+12)}>{t.more}</button>}
      </section>}
    </>}
    {placesReference}
  </aside>;
}

function ScenarioDetails({language,manifest}:{language:Language;manifest:HazardManifest}){
  const s=manifest.scenario;if(!s)return null;
  const conditions={
    'zh-TW':{MAXIMUM_CLASS_ADVERSE:'最大規模海嘯及不利條件的靜態想定，並非本次事件預測。',LARGER_OR_OUTSIDE_POSSIBLE:'仍可能有更大海嘯、範圍外浸水或更深浸水。',LATER_WAVE_MAXIMUM:'較後波次亦可能才達到最大。',RIVER_LAKE_CHANGES_NOT_SHOWN:'圖中未包括河川及湖泊水位變化。'},
    ja:{MAXIMUM_CLASS_ADVERSE:'最大クラスの津波・悪条件を想定。本件の予測ではありません。',LARGER_OR_OUTSIDE_POSSIBLE:'より大きな津波、範囲外や深い浸水もあり得ます。',LATER_WAVE_MAXIMUM:'第二波以降に最大となる場合もあります。',RIVER_LAKE_CHANGES_NOT_SHOWN:'河川・湖沼の水位変化は図示されていません。'},
    en:{MAXIMUM_CLASS_ADVERSE:'Static maximum-class tsunami scenario under adverse conditions, not a prediction for this incident.',LARGER_OR_OUTSIDE_POSSIBLE:'Larger waves, flooding outside polygons and deeper flooding remain possible.',LATER_WAVE_MAXIMUM:'The maximum may occur in a later wave.',RIVER_LAKE_CHANGES_NOT_SHOWN:'River/lake water-level changes are not shown.'},
  };
  return <><p>{language==='ja'?'静的想定・公表日':language==='en'?'Static scenario announced':'靜態想定公布日期'}: {s.announced_on}</p>
    <ul>{s.conditions.map(c=><li key={c}>{conditions[language][c]}</li>)}</ul>
    <p>CRS: {s.source_crs} → {s.output_crs} · {manifest.positional_accuracy_m} m ({manifest.positional_accuracy_kind})</p>
    <p>{s.terrain_basis} · {manifest.coverage_status}</p></>;
}
