'use client';
import type {Language} from '@/lib/contracts';
import {useState} from 'react';
import {forecastLines,isMapReportCurrent,type DisasterMapReference,type ForecastLinePack,type MapReport} from '@/lib/disaster-map';
import {regionalMaxima,type ReviewedIntensityRegionPack} from '@/lib/intensity-regions';

const text={
 'zh-TW':{title:'官方事件圖層 · LIVE 參考',waiting:'正在取得官方電文',unknown:'未取得可核實資料；保持未判定',offline:'離線／未完成更新 · 舊電文只供參考',lines:'海嘯預報區（海岸線）',observations:'震度觀測資料',limits:'實測震度、最新電文參考、靜態浸水想定及 P／S 估算各自獨立。未着色不代表安全；道路不代表暢通。',coordinates:'測站座標對照未核實；逐站震度以文字顯示，不猜測位置。地域／市町村／都道府縣值為各自最大震度。',source:'來源、時間與限制',geometry:'幾何／代碼版本',unmapped:'預報區代碼、名稱或歷史版本無法核對',old:'過時／未核實',current:'期限內電文參考',age:'發表至今',seconds:'秒',station:'測站實測',maximum:'範圍最大值',none:'此電文沒有該類資料；不能推論無風險',depth:'預報高度',cancel:'電文取消不等於警報解除',geometryUnknown:'官方海岸線資料無法驗證／覆核過期；空間圖層未判定',reference:'海岸線經簡化加工，精度及完整調查覆蓋未核實；不能作地點安全查詢。'},
 ja:{title:'公式情報レイヤー · LIVE参考',waiting:'公式電文を取得中',unknown:'検証可能な資料なし · 未判定',offline:'オフライン／更新未確認 · 過去の電文は参考のみ',lines:'津波予報区（海岸線）',observations:'震度観測資料',limits:'実測震度、最新電文、静的浸水想定、P/S概算は別資料です。無着色は安全、道路は通行可能を意味しません。',coordinates:'観測点コードと座標の対応は未検証。実測値は文字表示し、位置は推測しません。地域・市町村・都道府県は各範囲の最大震度です。',source:'出典・時刻・制限',geometry:'GIS／コード版',unmapped:'コード・名称・過去の版を照合できません',old:'期限切れ／未確認',current:'期限内の電文参考',age:'発表後',seconds:'秒',station:'観測点の実測',maximum:'範囲内の最大値',none:'この電文に資料なし · 無リスクとは限りません',depth:'予報高',cancel:'電文取消は警報解除を意味しません',geometryUnknown:'GIS検証失敗／確認期限切れ · 空間レイヤー未判定',reference:'海岸線を簡略化加工。位置精度・調査範囲は未検証。地点の安全判定には使用不可。'},
 en:{title:'Official event layers · LIVE reference',waiting:'Fetching official bulletins',unknown:'No verifiable data · undetermined',offline:'Offline / refresh unverified · archived reference only',lines:'Tsunami forecast coastal lines',observations:'Intensity observations',limits:'Measured intensity, recent bulletins, static inundation scenarios and P/S estimates are separate. Uncoloured does not mean safe; mapped roads do not mean open.',coordinates:'Station coordinates are not verified. Measured values are listed without guessed map positions. Region, city and prefecture observations are scope maxima.',source:'Sources, times & limits',geometry:'Geometry / code version',unmapped:'Code, name or historical version cannot be matched',old:'Expired / unverified',current:'Bulletin within reference TTL',age:'Since publication',seconds:'seconds',station:'Measured station',maximum:'Scope maximum',none:'No data of this type in the bulletin · no risk conclusion',depth:'Forecast height',cancel:'Bulletin withdrawal is not a warning cancellation',geometryUnknown:'GIS integrity / review unavailable · spatial layer undetermined',reference:'Coastal lines simplified for display. Positional accuracy and independent survey coverage unknown. No point safety query.'},
} as const;
/** Sheet content; the forecast-line and intensity-region layer toggles are map chips on the map screen. */
export function DisasterMapPanel({language,data,pack,connected,loading,geometryError,now,
 regions=null,showRegions=false,regionLoading=false,regionError=false,retryRegions=()=>{},retryGeometry=()=>{}}:{
 language:Language;data:DisasterMapReference|null;pack:ForecastLinePack|null;connected:boolean;loading:boolean;geometryError:boolean;now:number;
 regions?:ReviewedIntensityRegionPack|null;showRegions?:boolean;regionLoading?:boolean;regionError?:boolean;retryRegions?:()=>void;
 retryGeometry?:()=>void;
}){
 const t=text[language],lines=forecastLines(pack,data,connected,now),[limit,setLimit]=useState(6);
 const reports=[...(data?.reports??[])].sort((a,b)=>{
  const priority=(r:MapReport)=>(data&&isMapReportCurrent(data,r,connected,now)?100:0)+(r.bulletin.product==='VTSE41'?10:0);
  return priority(b)-priority(a)||Date.parse(b.bulletin.issued_at)-Date.parse(a.bulletin.issued_at);
 });
 const regionText=language==='ja'?'地域最大震度（各地点の実測ではない）':language==='en'?'Regional intensity maxima (not point measurements)':'地域最大震度（非逐點實測）';
 const regionUnknown=language==='ja'?'地域GIS・コード版・確認期限を照合できません · 未判定':language==='en'?'Regional geometry / code version / review unverified · undetermined':'地域幾何、代碼版本或覆核無法確認 · 未判定';
 const regionValues=regionalMaxima(regions,data,connected,now);
 const regionalReady=regions&&data?.earthquake_code_table_version===regions.manifest.code_table_version
  &&now>=Date.parse(regions.manifest.reviewed_at)&&now<Date.parse(regions.manifest.review_due_at);
 const regionMissing=new Set(regions?data?.reports.filter(r=>r.bulletin.product==='VXSE53').flatMap(r=>r.observations.filter(o=>o.granularity==='REGION'&&(!o.code
  ||regions.manifest.codes[o.code]!==o.name||!regions.features.some(f=>f.properties.code===o.code)||Date.parse(r.bulletin.issued_at)<Date.parse('2026-10-07T00:00:00Z'))).map(o=>o.code??'UNKNOWN'))??[]:[]);
 return <section className="hazard-live" data-testid="disaster-map-panel"><h3>{t.title}</h3>
  <p role="status">{loading?t.waiting:!data?t.unknown:!connected?t.offline:data.capacity_exceeded?t.unknown:''}</p>
  <p className="hazard-muted">{t.lines}</p>
  <p className="hazard-warning-key">{(language==='ja'?['大津波警報','津波警報','津波注意報','津波予報']:language==='en'?['Major warning','Warning','Advisory','Forecast']:['大海嘯警報','海嘯警報','海嘯注意報','海嘯預報']).map((label,i)=><span key={label}><i style={{background:['#ef8cb5','#ed9b7d','#efc979','#adcadd'][i]}}/>{label}</span>)}</p>
  {showRegions&&<><p>{regionLoading?t.waiting:regionError||!regionalReady?regionUnknown:`${regionText} · ${regionValues.length}`}</p>
    <p className="hazard-muted">{language==='ja'?'期限内の地域最大値と過去の観測を分けて表示。点線は地域境界の概略で、災害範囲ではありません。':language==='en'?'Recent-reference maxima and archived observations are shown separately. Dashed outlines indicate approximate regional boundaries, not disaster extent.':'近期最大值與過去觀測分開顯示；虛線為概略地域邊界，並非災害範圍。'}</p>
    {!!regionMissing.size&&<p>{t.unmapped}: {[...regionMissing].join(', ')}</p>}
    {regionError&&<button onClick={retryRegions}>{language==='ja'?'再検証':language==='en'?'Retry verification':'重新驗證'}</button>}
    {!!regionValues.length&&<details><summary>{language==='ja'?'地域最大値の出典':language==='en'?'Sources of regional maxima':'地域最大值的來源'}</summary>
      <ul>{regionValues.map(value=><li key={value.code}>{value.name} ({value.code}) · {value.intensity??'UNKNOWN'} · {value.state}
        <ul>{value.report_ids.map((id,i)=><li key={id}>{value.issued_at[i]} · <a href={data?.reports.find(r=>r.bulletin.report_id===id)?.bulletin.reference_url} target="_blank" rel="noopener noreferrer">{id}</a></li>)}</ul>
      </li>)}</ul></details>}
  </>}
  <p>{t.limits}</p><p className="hazard-muted">{t.coordinates}</p>
  <p className="hazard-muted">{language==='ja'?'参照TTLはアプリ方針です。期限切れ・電文取消は災害終了や安全を意味しません。':language==='en'?'Reference TTL is application policy. Expiry or bulletin withdrawal does not mean the hazard ended or a place is safe.':'參考期限屬應用程式政策；資料過時或電文取消，不代表災害結束或地點安全。'}</p>
  {(geometryError||(pack&&lines.reason==='GEOMETRY_VERSION_OR_REVIEW_UNKNOWN'))&&<p>{t.geometryUnknown}</p>}
  {geometryError&&<button onClick={retryGeometry}>{language==='ja'?'GISを再検証':language==='en'?'Retry coastline verification':'重新驗證海岸線'}</button>}
  {!!lines.unmapped.length&&<p>{t.unmapped}: {lines.unmapped.join(', ')}</p>}
  {data?.sources.map(s=><p key={s.source_key}>{s.source_name}: {connected?s.status:'UNKNOWN'} · {connected?s.recovery?.scan_status??'UNKNOWN':'UNKNOWN'}<br/>
    {language==='ja'?'取得':language==='en'?'Retrieved':'取得'}: {s.retrieved_at??'UNKNOWN'} · {language==='ja'?'検証':language==='en'?'Verified':'覆核'}: {s.recovery?.last_verified_at??'UNKNOWN'}</p>)}
  {reports.length>0&&<p>{language==='ja'?'電文':language==='en'?'Bulletins':'電文'}: {reports.length} · {Math.min(limit,reports.length)} / {reports.length}</p>}
  {reports.slice(0,limit).map(r=>{const b=r.bulletin,current=data?isMapReportCurrent(data,r,connected,now):false;return <details key={b.report_id}>
   <summary>{b.title} · {current?t.current:t.old} · {b.lifecycle}</summary>
   <p>{b.issued_at} · {t.age}: {Math.max(0,Math.floor((now-Date.parse(b.issued_at))/1000))} {t.seconds}</p>
   <p>{b.operation==='CANCEL'?t.cancel:b.operation} · {language==='ja'?'アプリ参照期限':language==='en'?'App reference deadline':'本地參考期限'}: {b.evidence_expires_at}</p>
   {b.official_valid_until&&<p>{language==='ja'?'公式予報の期限':language==='en'?'Official forecast validity':'官方預報有效期'}: {b.official_valid_until}</p>}
   <p>ID: {b.report_id}</p>
   <a href={b.reference_url} target="_blank" rel="noopener noreferrer">{b.source_name}</a>
   {b.product==='VXSE53'?<ObservationList language={language} observations={r.observations}/>:<ul>{r.forecast_areas.map(a=><li key={a.area_code}>{a.area_name} ({a.area_code}) · {current?a.status:t.old} · {a.warning_class} · {t.depth}: {a.max_height.value_m!==null?`${a.max_height.value_m} m`:a.max_height.description??a.max_height.expression}{a.arrival_at?` · ${a.arrival_at}`:''}</li>)}</ul>}
  </details>;})}
  {reports.length>limit&&<button onClick={()=>setLimit(n=>n+6)}>{language==='ja'?'電文をさらに表示':language==='en'?'Show more bulletins':'顯示更多電文'}</button>}
  {!data?.reports.length&&<p>{t.unknown}</p>}
  <details><summary>{t.source}</summary>{pack&&<><p>{t.geometry}: {pack.manifest.geometry_version} / {pack.manifest.code_table_version}</p>
   <p>{t.reference}</p>{pack.manifest.sources.map(s=><p key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">気象庁 · {s.version}</a> · {s.published_at} · {s.retrieved_at}</p>)}
   <p>{pack.manifest.processing.method}</p><p>{pack.manifest.attribution}</p><a href={pack.manifest.license_url}>License</a></>}
   {regions&&<><h4>{regionText}</h4><p>{t.geometry}: {regions.manifest.geometry_version} / {regions.manifest.code_table_version} · {regions.manifest.included_count} / 188</p>
    <p>{regions.manifest.source_crs} → {regions.manifest.output_crs} · {regions.manifest.coverage} · {regions.manifest.positional_accuracy}</p>
    <p>{regions.manifest.processing}</p><p>{regions.manifest.attribution}</p>
    {regions.manifest.sources.map(s=><p key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">気象庁 · {s.version}</a> · {s.published_at} · {s.retrieved_at}</p>)}
    <ul>{regions.manifest.excluded_geometry.map((x,i)=><li key={i}>{x.name} ({x.code??'UNKNOWN'}) · {x.reason}</li>)}</ul>
   </>}
  </details>
 </section>;
}

function ObservationList({language,observations}:{language:Language;observations:MapReport['observations']}){
 const t=text[language],[limit,setLimit]=useState(50),[open,setOpen]=useState(false);
 return <><h4>{t.observations} · {observations.length}</h4><details onToggle={e=>setOpen(e.currentTarget.open)}><summary>{t.observations}</summary>
  {open&&<><ul className="hazard-observation-list">{observations.slice(0,limit).map((o,i)=><li key={`${o.granularity}-${o.code}-${i}`}>{o.name} · {o.intensity??'UNKNOWN'} · {o.granularity==='STATION'?t.station:t.maximum} ({o.granularity} / {o.code??'UNKNOWN'})</li>)}</ul>
   {limit<observations.length&&<button onClick={()=>setLimit(n=>n+50)}>{language==='ja'?'続きを表示':language==='en'?'Show more':'顯示更多'} ({Math.min(limit,observations.length)} / {observations.length})</button>}</>}
 </details>{!observations.length&&<p>{t.none}</p>}</>;
}
