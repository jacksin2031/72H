'use client';
import {useEffect,useState} from 'react';
import type {Language} from '@/lib/contracts';
import type {OfficialPlace} from '@/lib/official-hazards';
import {hazardKeys} from '@/lib/official-hazards';
import {placeOpening,type DesignationHazard} from '@/lib/designated-places';
import type {DesignatedPlacesState} from '@/lib/use-designated-places';
import {hazardText} from './official-hazard-panel';

const text={
  'zh-TW':{format:'場所資料格式',hazard:'災害類別',all:'所有角色及分類',csv:'石卷指定目錄（CSV）',geo:'附近 GeoJSON 圖層',
    noId:'GeoJSON 沒有共通 ID；只供圖層參考，不能連接開放證據。',tile:'只載入此地圖分片的海嘯場所及一般避難所；不是完整市級或全國目錄。',
    unavailable:'地震 GeoJSON 分片回應 404；不能推論沒有場所。',notLoaded:'未載入此類 GeoJSON 分片；資料未判定。',
    dates:'石卷 CSV 目錄首次公開／資料庫更新',dateUnknown:'各場所指定日期及更新時間：未提供',
    openingSource:'尚未接入可核實場所身份的自治體開放來源；目前開放保持未核實。',
    openingUnavailable:'目前開放資料未能取得或尚未重新核實。',
    same:'官方註記：與另一角色的場所地址相同；身份及用途仍分開。',accept:'受入對象／限制',
    unknownId:'共通 ID：未提供',ref:'來源快照',closed:'目前開放：已關閉（官方來源）',open:'目前開放：官方資料顯示開放；仍非安全或移動授權',
  }, 'zh-CN': {format:'场所数据格式',hazard:'灾害类别',all:'所有角色及分类',csv:'石卷指定目录（CSV）',geo:'附近 GeoJSON 图层',
    noId:'GeoJSON 没有共通 ID；只供图层参考，不能连接开放证据。',tile:'只加载此地图分片的海啸场所及一般避难所；不是完整市级或全国目录。',
    unavailable:'地震 GeoJSON 分片回应 404；不能推论没有场所。',notLoaded:'未加载此类 GeoJSON 分片；数据未判定。',
    dates:'石卷 CSV 目录首次公开／数据库更新',dateUnknown:'各场所指定日期及更新时间：未提供',
    openingSource:'尚未接入可核实场所身份的自治体开放来源；目前开放保持未核实。',
    openingUnavailable:'目前开放数据未能取得或尚未重新核实。',
    same:'官方注记：与另一角色的场所地址相同；身份及用途仍分开。',accept:'受入对象／限制',
    unknownId:'共通 ID：未提供',ref:'来源快照',closed:'目前开放：已关闭（官方来源）',open:'目前开放：官方数据显示开放；仍非安全或移动授权',
  },
  ja:{format:'場所データ形式',hazard:'災害種別',all:'全用途・種別',csv:'石巻の指定目録（CSV）',geo:'周辺 GeoJSON レイヤー',
    noId:'GeoJSON に共通IDはありません。参考表示のみで開設情報と結び付けません。',tile:'このタイルの津波対応場所・一般避難所のみ。市全体・全国の完全な目録ではありません。',
    unavailable:'地震 GeoJSON タイルは404。場所が存在しないとは判断できません。',notLoaded:'この災害種別のGeoJSONタイルは未取得。判定不可。',
    dates:'石巻 CSV 目録公開日／DB更新日',dateUnknown:'各場所の指定日・更新日時：情報なし',openingSource:'場所IDを検証できる自治体の開設情報源は未接続。開設は未確認。',
    openingUnavailable:'現在の開設情報が取得できない、または再確認されていません。',
    same:'公式注記：別用途の場所と住所が同一。ID・用途は別々です。',accept:'受入対象・条件',unknownId:'共通ID：情報なし',ref:'出典スナップショット',
    closed:'現在の開設：閉鎖（公式情報）',open:'公式情報では開設。安全確認・移動許可ではありません',
  },
  en:{format:'Place data format',hazard:'Hazard category',all:'All roles and categories',csv:'Ishinomaki designation catalog (CSV)',geo:'Nearby GeoJSON layers',
    noId:'GeoJSON has no common ID. Reference only; cannot attach opening evidence.',tile:'Only tsunami sites and ordinary shelters in this tile. Not a complete municipal or national catalog.',
    unavailable:'Earthquake GeoJSON tile returned 404. This cannot establish that no places exist.',notLoaded:'This hazard tile is not loaded. Undetermined.',
    dates:'Ishinomaki CSV catalog first published / DB updated',dateUnknown:'Per-place designation and update dates: not supplied',openingSource:'No municipal opening source with a verified place identity link is connected. Opening remains unverified.',
    openingUnavailable:'Current opening data is unavailable or has not been reverified.',
    same:'Official note: same address as a place with another role. Identity and purpose remain separate.',accept:'Acceptance / restrictions',unknownId:'Common ID: not supplied',ref:'Source snapshot',
    closed:'Current opening: closed (official source)',open:'Official report says open; this is not safety verification or movement authorization',
  },
};

export function DesignatedPlacesPanel({language,state,onPlace}:{language:Language;state:DesignatedPlacesState;onPlace:(p:OfficialPlace)=>void}){
  const t=hazardText[language],d=text[language],{pack,places,format,hazard,now}=state;const [limit,setLimit]=useState(12);
  useEffect(()=>setLimit(12),[format,hazard,state.search]);
  return <div className="designated-places-panel" data-testid="designated-places"><h3>{t.list} · {places.length}</h3>
    <p className="hazard-muted">{t.scope}</p><p>{d.dateUnknown}</p>
    {state.loading&&<p role="status">{t.loading}</p>}{state.error&&<p role="alert">{t.error}</p>}
    {(!pack||state.error)&&<button onClick={state.retry} disabled={state.loading}>{t.retry}</button>}
    {pack&&<>
      <p>{d.dates}: {pack.manifest.catalog_published_on} / {pack.manifest.database_updated_on}<br/>{t.review}: {pack.manifest.review_due_at.slice(0,10)}</p>
      {(now<Date.parse(pack.manifest.reviewed_at)||now>=Date.parse(pack.manifest.review_due_at))&&<p className="hazard-safety" role="alert">{t.reasons.DATA_REVIEW_EXPIRED}</p>}
      <div className="hazard-place-selects"><label>{d.format}<select aria-label={d.format} value={format} onChange={e=>state.setFormat(e.target.value as 'CSV'|'GeoJSON')}>
        <option value="CSV">{d.csv}</option><option value="GeoJSON">{d.geo}</option></select></label>
      <label>{d.hazard}<select aria-label={d.hazard} value={hazard} onChange={e=>state.setHazard(e.target.value as DesignationHazard)}>
        <option value="ALL">{d.all}</option>{hazardKeys.map((key,i)=><option key={key} value={key}>{t.hazardNames[i]}</option>)}</select></label></div>
      {format==='GeoJSON'&&<p className="hazard-muted">{d.noId} {d.tile}</p>}
      {state.reason==='UNAVAILABLE_404'&&<p role="status">{d.unavailable}</p>}{state.reason==='HAZARD_TILE_NOT_LOADED'&&<p role="status">{d.notLoaded}</p>}
      {(state.opening?.source_status!=='AVAILABLE'||!state.connected)&&<p className="hazard-safety">{state.opening?.source_status==='UNCONFIGURED'?d.openingSource:d.openingUnavailable}</p>}
      <input className="hazard-search" type="search" aria-label={t.search} placeholder={t.search} value={state.search} maxLength={80} onChange={e=>state.setSearch(e.target.value)}/>
      <ul className="hazard-place-list">{places.slice(0,limit).map(p=>{
        const opening=placeOpening(p,state.opening,state.connected,now,state.resumeAt),source=pack.manifest.sources.find(s=>s.id===p.source_id);
        return <li key={p.id}><button onClick={()=>onPlace(p)}>{p.name}</button><p>{p.kind==='EMERGENCY_SITE'?t.emergency:t.shelter} · {p.address}</p>
          <p>{opening.status==='OPEN'?d.open:opening.status==='CLOSED'?d.closed:t.open} · {t.route}</p>
          <details><summary>{t.source}</summary><p>{p.common_id?`ID: ${p.common_id}`:d.unknownId} · {p.source_format}</p>
            {p.other_role_same_address&&<p>{d.same}</p>}
            <dl>{hazardKeys.map((key,i)=><div key={key}><dt>{t.hazardNames[i]}</dt><dd>{p.hazards[key]==='DESIGNATED'?t.designated:p.hazards[key]==='NOT_DESIGNATED'?t.notDesignated:t.unknown}</dd></div>)}</dl>
            {(p.acceptance||p.necessary_matters)&&<p>{d.accept}: {p.acceptance} {p.necessary_matters}</p>}<p>{p.notes}</p>
            <p>{t.retrieved}: {source?.retrieved_at??'—'}</p><p>{d.ref}: {source?.raw_sha256.slice(0,16)}</p>
            {source&&<a href={source.url} target="_blank" rel="noopener noreferrer">国土地理院 · {p.source_format}</a>}
            {opening.record&&<><p>{language==='ja'?'開設情報の検証状態':language==='en'?'Opening verification status':'開放資料核對狀態'}: {openingReason(language,opening.reason)}</p>
              <p>{t.published}: {opening.record.published_at} · {opening.record.expires_at}</p>
              <p>{opening.record.restrictions.join(' / ')}</p><a href={opening.record.source_url} target="_blank" rel="noopener noreferrer">{opening.record.source_key}</a></>}
          </details></li>;
      })}</ul>{places.length>limit&&<button onClick={()=>setLimit(x=>x+12)}>{t.more}</button>}
      <details><summary>{t.source}</summary><p>{pack.manifest.attribution}</p><p>{d.tile} {d.noId}</p>
        <a href={pack.manifest.schema_url} target="_blank" rel="noopener noreferrer">GSI GeoJSON</a> · <a href={pack.manifest.license_url} target="_blank" rel="noopener noreferrer">国土地理院</a>
      </details>
    </>}
  </div>;
}

function openingReason(language:Language,reason:string){
  const labels={
    'zh-TW':{VERIFIED:'已核對來源（非安全授權）',STALE:'已過期',CONFLICT:'資料衝突',OFFLINE:'離線，只作舊資料參考',AUTHORITY_REVIEW_EXPIRED:'來源覆核期限已過',SOURCE_UNKNOWN:'來源狀態未知',UNVERIFIED_SCOPE_OR_RECONNECT:'重連尚未重新核實'}, 'zh-CN': {VERIFIED:'已核对来源（非安全授权）',STALE:'已过期',CONFLICT:'数据冲突',OFFLINE:'离线，只作旧数据参考',AUTHORITY_REVIEW_EXPIRED:'来源覆核期限已过',SOURCE_UNKNOWN:'来源状态未知',UNVERIFIED_SCOPE_OR_RECONNECT:'重连尚未重新核实'},
    ja:{VERIFIED:'出典確認済（安全の許可ではない）',STALE:'期限切れ',CONFLICT:'情報の競合',OFFLINE:'オフライン・過去の参考情報',AUTHORITY_REVIEW_EXPIRED:'出典再確認期限切れ',SOURCE_UNKNOWN:'出典状態不明',UNVERIFIED_SCOPE_OR_RECONNECT:'再接続後未確認'},
    en:{VERIFIED:'Source checked; not safety authorization',STALE:'Expired',CONFLICT:'Conflicting reports',OFFLINE:'Offline; archived reference only',AUTHORITY_REVIEW_EXPIRED:'Authority review expired',SOURCE_UNKNOWN:'Unknown source state',UNVERIFIED_SCOPE_OR_RECONNECT:'Reconnect not reverified'},
  };
  return labels[language][reason as keyof typeof labels['en']]??reason;
}
