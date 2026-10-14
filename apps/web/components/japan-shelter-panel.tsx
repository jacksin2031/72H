'use client';
import {useEffect,useMemo,useState} from 'react';
import type {Language} from '@/lib/contracts';
import {hazardKeys,type OfficialPlace} from '@/lib/official-hazards';
import {filterJapanShelters,loadJapanShelterCatalog,loadJapanShelterPrefecture,
  type JapanShelterCatalog,type JapanShelterPlace,type JapanShelterFilters} from '@/lib/japan-shelters';
import {hazardText} from './official-hazard-panel';

const copy={
  'zh-TW':{title:'全日本官方避難場所',prefecture:'都道府縣',choose:'選擇都道府縣',municipality:'市區町村',allCities:'所有市區町村',
    kind:'場所類型',all:'全部類型',hazard:'災害指定',allHazards:'全部（不代表適用所有災害）',
    loading:'正在驗證避難場所資料',error:'無法驗證避難場所資料；未顯示未經核實的場所。',retry:'重新載入',
    select:'選擇都道府縣以載入地圖及清單。',snapshot:'官方公開資料快照',records:'筆',results:'符合篩選',
    caution:'目前開放及路線：未核實。指定緊急避難場所供災害發生時避難；指定避難所供暫時停留，兩者用途不同。',
    limits:'只收錄官方已公開資料，可能有未收錄或尚未更新的場所。請向所在地市町村核對最新指定及開放狀況。指定不代表此刻安全或可前往。',
    updated:'市町村資料庫更新',unknown:'未提供',noRecords:'此市町村沒有收錄資料；不代表沒有避難場所。',
    empty:'沒有符合篩選的場所。',static:'資料庫更新日期並非場所指定日期，也不是即時開放狀態。',
    more:'顯示更多場所',sources:'資料來源及限制',retrieved:'下載時間',cache:'只在選擇地區後載入資料；離線時只能開啟已下載的地區。'},
  ja:{title:'全国の公式避難場所',prefecture:'都道府県',choose:'都道府県を選択',municipality:'市区町村',allCities:'全市区町村',
    kind:'施設の種類',all:'すべて',hazard:'災害種別の指定',allHazards:'すべて（全災害への適合を意味しません）',
    loading:'避難場所データを検証中',error:'避難場所データを検証できません。未検証の施設は表示しません。',retry:'再読込',
    select:'都道府県を選ぶと地図と一覧を読み込みます。',snapshot:'公式公開データの保存版',records:'件',results:'絞り込み結果',
    caution:'現在の開設・経路：未確認。指定緊急避難場所は災害から命を守る場所、指定避難所は一時的な滞在施設です。',
    limits:'公開済みデータのみ。未掲載・未更新の場合があります。最新の指定・開設状況は市町村へご確認ください。指定は現在の安全性や移動許可を意味しません。',
    updated:'市町村データベース更新',unknown:'情報なし',noRecords:'この市町村の収録データはありません。避難場所がないという意味ではありません。',
    empty:'条件に合う施設はありません。',static:'更新日は指定日でも現在の開設状況でもありません。',
    more:'さらに表示',sources:'出典と利用上の注意',retrieved:'取得日時',cache:'選択した地域のみ読み込みます。オフラインでは取得済みの地域のみ閲覧できます。'},
  en:{title:'Official places across Japan',prefecture:'Prefecture',choose:'Choose a prefecture',municipality:'Municipality',allCities:'All municipalities',
    kind:'Place type',all:'All types',hazard:'Hazard designation',allHazards:'All (not suitable for every hazard)',
    loading:'Verifying designation data',error:'Place data could not be verified. Unverified places are not shown.',retry:'Reload',
    select:'Choose a prefecture to load its map points and list.',snapshot:'Published official data snapshot',records:'records',results:'Matching places',
    caution:'Current opening and routes: unverified. Emergency evacuation sites protect life during a hazard; designated shelters provide temporary accommodation.',
    limits:'Published records only; some places may be missing or outdated. Check current designation and opening with the municipality. Designation is not current safety or permission to travel.',
    updated:'Municipal database updated',unknown:'Not supplied',noRecords:'No records supplied for this municipality; this does not mean no evacuation places exist.',
    empty:'No places match these filters.',static:'Database update dates are not designation dates or real-time opening status.',
    more:'Show more places',sources:'Sources and limits',retrieved:'Downloaded',cache:'Only selected regions are loaded. Offline access requires a previously downloaded region.'},
} as const;

export function JapanShelterPanel({language,onPlaces,onPlace,onRegion}:{language:Language;
  onPlaces:(places:OfficialPlace[])=>void;onPlace:(place:OfficialPlace)=>void;onRegion:(bbox:[number,number,number,number])=>void}){
  const t=copy[language],h=hazardText[language];
  const [catalog,setCatalog]=useState<JapanShelterCatalog|null>(null);
  const [prefecture,setPrefecture]=useState('');
  const [places,setPlaces]=useState<JapanShelterPlace[]>([]);
  const [filters,setFilters]=useState<JapanShelterFilters>({municipality:'',kind:'ALL',hazard:'',search:''});
  const [loading,setLoading]=useState(true),[error,setError]=useState(false),[attempt,setAttempt]=useState(0),[limit,setLimit]=useState(12);
  useEffect(()=>{
    const abort=new AbortController();setLoading(true);setError(false);setCatalog(null);setPlaces([]);
    void loadJapanShelterCatalog(abort.signal).then(value=>{if(!abort.signal.aborted)setCatalog(value);})
      .catch(()=>{if(!abort.signal.aborted)setError(true);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[attempt]);
  useEffect(()=>{
    const abort=new AbortController();setPlaces([]);setLimit(12);
    if(!catalog||!prefecture)return()=>abort.abort();
    setLoading(true);setError(false);
    void loadJapanShelterPrefecture(catalog,prefecture,abort.signal).then(value=>{if(!abort.signal.aborted)setPlaces(value);})
      .catch(()=>{if(!abort.signal.aborted)setError(true);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[catalog,prefecture]);
  const results=useMemo(()=>filterJapanShelters(places,filters),[places,filters]);
  useEffect(()=>{onPlaces(results);return()=>onPlaces([]);},[results,onPlaces]);
  const pref=catalog?.prefectures.find(p=>p.code===prefecture);
  const selectedCity=pref?.municipalities.find(c=>c.code===filters.municipality);
  const changeFilters=(patch:Partial<JapanShelterFilters>)=>{setFilters(value=>({...value,...patch}));setLimit(12);};
  return <section className="national-shelter-panel" aria-labelledby="national-shelter-title">
    <h1 id="national-shelter-title">{t.title}</h1>
    <p className="hazard-safety">{t.caution}</p>
    {catalog&&<p>{t.snapshot} · 47 {t.prefecture} · {catalog.total_count.toLocaleString(language)} {t.records}</p>}
    <label className="shelter-select">{t.prefecture}<select data-testid="shelter-prefecture" value={prefecture} disabled={!catalog}
      onChange={event=>{
        const value=event.target.value;onPlaces([]);setPlaces([]);setPrefecture(value);changeFilters({municipality:'',search:''});
        const region=catalog?.prefectures.find(p=>p.code===value);if(region)onRegion(region.bbox);
      }}>
      <option value="">{t.choose}</option>{catalog?.prefectures.map(p=><option key={p.code} value={p.code}>{p.name} ({p.count.toLocaleString(language)})</option>)}
    </select></label>
    {pref&&<div className="national-shelter-filters">
      <label>{t.municipality}<select value={filters.municipality} onChange={e=>changeFilters({municipality:e.target.value})}>
        <option value="">{t.allCities}</option>{pref.municipalities.map(c=><option key={c.code} value={c.code}>{c.name} ({c.count})</option>)}
      </select></label>
      <label>{t.kind}<select data-testid="shelter-kind" value={filters.kind} onChange={e=>changeFilters({kind:e.target.value as JapanShelterFilters['kind']})}>
        <option value="ALL">{t.all}</option><option value="SHELTER">{h.shelter}</option><option value="EMERGENCY_SITE">{h.emergency}</option>
      </select></label>
      <label>{t.hazard}<select value={filters.hazard} onChange={e=>changeFilters({hazard:e.target.value as JapanShelterFilters['hazard']})}>
        <option value="">{t.allHazards}</option>{hazardKeys.map((key,i)=><option key={key} value={key}>{h.hazardNames[i]}</option>)}
      </select></label>
      <label>{h.search}<input type="search" maxLength={100} value={filters.search} onChange={e=>changeFilters({search:e.target.value})}/></label>
    </div>}
    {loading&&<p role="status">{t.loading}</p>}
    {error&&<><p role="alert">{t.error}</p><button type="button" onClick={()=>setAttempt(value=>value+1)}>{t.retry}</button></>}
    {!prefecture&&!loading&&!error&&<p>{t.select}</p>}
    {prefecture&&!loading&&!error&&<>
      <p role="status">{t.results}: {results.length.toLocaleString(language)} {t.records}</p>
      {selectedCity&&<p>{t.updated}: {selectedCity.updated_at??t.unknown} · {t.static}</p>}
      {!results.length&&<p>{selectedCity?.count===0?t.noRecords:t.empty}</p>}
      <ul className="national-shelter-list">{results.slice(0,limit).map(place=><li key={place.id}>
        <button type="button" onClick={()=>onPlace(place)}>{place.name}</button>
        <p>{place.kind==='SHELTER'?h.shelter:h.emergency} · {place.address??place.municipality_name}</p>
        <p className="hazard-muted">{h.open} · {h.route}</p>
        <details><summary>{h.source}</summary>
          <dl>{hazardKeys.map((key,i)=><div key={key}><dt>{h.hazardNames[i]}</dt><dd>{place.hazards[key]==='DESIGNATED'?h.designated:place.hazards[key]==='NOT_DESIGNATED'?h.notDesignated:h.unknown}</dd></div>)}</dl>
          <p>{t.updated}: {place.designation_updated_at??t.unknown}</p><p>{place.notes}</p><p>ID: {place.common_id}</p>
          <a href={catalog!.source_page} rel="noopener noreferrer" target="_blank">国土地理院</a>
        </details>
      </li>)}</ul>
      {results.length>limit&&<button type="button" onClick={()=>setLimit(value=>value+12)}>{t.more}</button>}
    </>}
    <details className="national-shelter-sources"><summary>{t.sources}</summary><p>{t.limits}</p><p>{t.cache}</p>
      {catalog&&<><a href={catalog.source_page} target="_blank" rel="noopener noreferrer">国土地理院</a>
        <p>{t.retrieved}: {new Date(catalog.sources[0].retrieved_at).toLocaleString(language,{timeZone:'Asia/Tokyo'})}</p>
        <a href={catalog.license_url} target="_blank" rel="noopener noreferrer">国土地理院コンテンツ利用規約</a></>}
    </details>
  </section>;
}
