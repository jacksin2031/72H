'use client';

import {useCallback,useEffect,useMemo,useState,type ReactNode} from 'react';
import type {Language} from '@/lib/contracts';
import {loadJapanShelterCatalog,loadJapanShelterPrefecture,type JapanShelterCatalog,type JapanShelterPlace} from '@/lib/japan-shelters';
import {loadRoadTilesAround,type RoadTileState} from '@/lib/road-tiles';
import {roadDestinations,type RoadDestination,type RoadHazard} from '@/lib/road-destinations';
import type {RoadCandidate} from '@/lib/evacuation-road-graph';
import {Button,Tag} from './ui';

type RoadResult={destinations:RoadDestination[];none:boolean};
type RoadReferenceValue={state:'IDLE'|'LOADING'|'READY'|'ERROR';tiles:RoadTileState|null;result:RoadResult|null};
export type RoadReference=RoadReferenceValue&{retry:()=>void};

const idle:RoadReferenceValue={state:'IDLE',tiles:null,result:null};
const loading:RoadReferenceValue={state:'LOADING',tiles:null,result:null};
const failed:RoadReferenceValue={state:'ERROR',tiles:null,result:null};
const ROAD_REFERENCE_DEBOUNCE_MS=250;

type Loaded<T>={key:string;status:'LOADING'|'READY'|'ERROR';value:T|null};

/** Loads the selected point's bounded road tiles and the prefecture's designated places.
 *  Tiles are keyed by the point only (R21): a hazard or prefecture change re-derives destinations
 *  from the already-loaded tiles and never starts, aborts or repeats a tile download. */
export function useRoadReference(point:{lat:number;lng:number}|null,hazard:RoadHazard,prefectureCode:string|null):RoadReference{
  const [retryVersion,setRetryVersion]=useState(0);
  const retry=useCallback(()=>setRetryVersion(value=>value+1),[]);
  const lat=point?.lat,lng=point?.lng;
  const tileKey=point?`${lat}:${lng}:${retryVersion}`:'';
  const placesKey=point&&prefectureCode?`${prefectureCode}:${retryVersion}`:'';
  const [tileEntry,setTileEntry]=useState<Loaded<RoadTileState>>({key:'',status:'LOADING',value:null});
  const [placesEntry,setPlacesEntry]=useState<Loaded<JapanShelterPlace[]>>({key:'',status:'LOADING',value:null});

  // Tiles: point only, debounced, aborted and key-fenced on point change (R16).
  useEffect(()=>{
    if(lat===undefined||lng===undefined)return;
    const controller=new AbortController();
    let active=true;
    const timer=setTimeout(()=>{
      loadRoadTilesAround({lat,lng},{signal:controller.signal}).then(
        tiles=>{if(active&&!controller.signal.aborted)setTileEntry({key:tileKey,status:'READY',value:tiles});},
        ()=>{if(active&&!controller.signal.aborted)setTileEntry({key:tileKey,status:'ERROR',value:null});},
      );
    },ROAD_REFERENCE_DEBOUNCE_MS);
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[tileKey]);

  // Designated places: prefecture only; never touches tiles.
  useEffect(()=>{
    if(!placesKey||!prefectureCode)return;
    const controller=new AbortController();
    let active=true;
    void (async()=>{
      try{
        const catalog:JapanShelterCatalog=await loadJapanShelterCatalog(controller.signal);
        const places=await loadJapanShelterPrefecture(catalog,prefectureCode,controller.signal);
        if(active&&!controller.signal.aborted)setPlacesEntry({key:placesKey,status:'READY',value:places});
      }catch{if(active&&!controller.signal.aborted)setPlacesEntry({key:placesKey,status:'ERROR',value:null});}
    })();
    return()=>{active=false;controller.abort();};
  },[placesKey]);

  const tiles=tileEntry.key===tileKey?tileEntry:null;
  const places=placesEntry.key===placesKey?placesEntry:null;
  const result=useMemo(()=>{
    if(lat===undefined||lng===undefined||tiles?.status!=='READY'||places?.status!=='READY'||!tiles.value||!places.value)return null;
    return roadDestinations(tiles.value.status==='READY'?tiles.value.graph:null,{lat,lng},places.value,hazard);
  },[tiles,places,hazard,lat,lng]);

  let value:RoadReferenceValue;
  if(!point)value=idle;
  else if(!prefectureCode||tiles?.status==='ERROR'||places?.status==='ERROR')value=failed;
  else if(!result||!tiles?.value)value=loading;
  else value={state:'READY',tiles:tiles.value,result};
  return {...value,retry};
}

const copy={
  ja:{
    loading:'道路データを取得中…',noPoint:'地点を選択すると道路参考線を表示します',noPlaces:'近くに条件に合う指定場所がありません',
    failed:'この地域の道路データを取得できません',tooDense:'この地域の道路データが密集しているため参考線を表示できません',noRoads:'この地域には利用できる道路データがありません',offline:'この地域の道路参考データはありません（オフライン）',
    partial:'道路データの一部が未取得です',stale:'データは古くなっています（取得日 {date}）',notPersisted:'オフライン保存できませんでした',
    tsunami:'津波対応指定場所',earthquake:'地震対応指定場所',roadReference:'道路参考',exercise:'演習',retry:'再試行',
    straight:'直線',road:'道路',reference:'参考',dash:'—',disclaimer:'道路参考線は避難経路ではありません。最も安全な経路は未判定です。',
  },
  en:{
    loading:'Loading road data…',noPoint:'Select a point to show road references',noPlaces:'No nearby designated places match this hazard',failed:'Could not load road data for this area',
    tooDense:'Road data is too dense in this area to show reference lines',noRoads:'No road data is available for this area',offline:'No road reference data for this area (offline)',partial:'Some road data tiles are missing',
    stale:'Data is stale (retrieved {date})',notPersisted:'Could not save for offline use',tsunami:'tsunami-designated places',earthquake:'earthquake-designated places',
    roadReference:'road reference',exercise:'Exercise',retry:'Retry',straight:'Straight-line',road:'Road',reference:'reference',dash:'—',
    disclaimer:'Road reference lines are not evacuation routes. The safest route is undetermined.',
  },
  'zh-TW':{
    loading:'正在取得道路資料…',noPoint:'請選擇一個點以顯示道路參考線',noPlaces:'附近沒有符合條件的指定場所',failed:'無法取得此地區道路資料',
    tooDense:'此地區道路資料過於密集，無法顯示參考線',noRoads:'此地區沒有可用的道路資料',offline:'此地區沒有道路參考資料（離線）',partial:'部分道路資料未下載',
    stale:'資料較舊（取得於 {date}）',notPersisted:'無法離線保存',tsunami:'海嘯適用指定場所',earthquake:'地震適用指定場所',
    roadReference:'道路參考',exercise:'演練',retry:'重試',straight:'直線',road:'道路',reference:'參考',dash:'—',
    disclaimer:'道路參考線不是避難路線，最安全路線未判定。',
  },
} as const;

const formatKm=(metres:number,language:Language)=>`${(metres/1000).toLocaleString(language,{minimumFractionDigits:1,maximumFractionDigits:1})} km`;
function messageForTiles(tiles:RoadTileState|null,language:Language):string|null{
  if(!tiles||tiles.status==='READY')return null;
  if(tiles.reason==='TOO_DENSE')return copy[language].tooDense;
  if(tiles.reason==='OFFLINE_NO_DATA')return copy[language].offline;
  if(tiles.reason==='NO_ROADS')return copy[language].noRoads;
  return copy[language].failed;
}

export function roadPeekText(language:Language,hazard:RoadHazard,reference:RoadReference):string{
  const t=copy[language];
  if(reference.state==='IDLE')return t.noPoint;
  if(reference.state==='LOADING')return t.loading;
  if(reference.state==='ERROR')return t.failed;
  const tileMessage=messageForTiles(reference.tiles,language);
  if(tileMessage)return tileMessage;
  if(reference.result?.none)return t.noPlaces;
  const count=reference.result?.destinations.length??0;
  const hazardText=hazard==='tsunami'?t.tsunami:t.earthquake;
  if(language==='zh-TW')return `附近 ${count} 處${hazardText} · 道路參考`;
  if(language==='ja')return `近くの${hazardText} ${count} か所 · 道路参考`;
  return `${count} ${hazardText} nearby · road reference`;
}

export const roadLayerLabel=(language:Language)=>language==='ja'?'道路参考':language==='en'?'Road reference':'道路參考';

/** At most three validated reference-only road lines for the map; nothing while the layer is off or without READY road tiles. */
export function roadReferenceRoutes(reference:RoadReference,layerOn:boolean):RoadCandidate[]{
  if(!layerOn||reference.state!=='READY'||reference.tiles?.status!=='READY')return [];
  return (reference.result?.destinations??[]).flatMap(destination=>destination.road
    &&destination.road.role==='ROAD_REFERENCE_ONLY'&&destination.road.movement_authorized===false?[destination.road]:[]).slice(0,3);
}

const attribution=<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>;

/** The page's single road-reference disclaimer and OSM attribution, for persistent map chrome (visible while the sheet is closed). */
export function RoadReferenceNotice({language}:{language:Language}){
  return <div className="map-road-notice" data-testid="road-reference-notice">
    <p className="road-reference-disclaimer">{copy[language].disclaimer}</p>
    <p className="road-reference-attribution">{attribution}</p>
  </div>;
}

/** suppressNotice: the host renders RoadReferenceNotice in its map chrome, so the section omits its own copy (one per page).
 *  pointControl: a local point chooser shown at the top; while no point is chosen it replaces the no-point hint. */
export function RoadReferenceSection({language,exercise,hazard,reference,suppressNotice=false,pointControl}:{language:Language;exercise:boolean;hazard:RoadHazard;
  reference:RoadReference;suppressNotice?:boolean;pointControl?:ReactNode}){
  const t=copy[language];
  const tileMessage=messageForTiles(reference.tiles,language);
  const retryable=reference.state==='ERROR'||reference.tiles?.status==='UNAVAILABLE'
    &&reference.tiles.reason!=='TOO_DENSE'&&reference.tiles.reason!=='OFFLINE_NO_DATA'&&reference.tiles.reason!=='NO_ROADS';
  const messages:string[]=[];
  if(reference.state==='LOADING')messages.push(t.loading);
  else if(reference.state==='ERROR')messages.push(t.failed);
  if(tileMessage&&!(reference.state==='ERROR'&&tileMessage===t.failed))messages.push(tileMessage);
  if(reference.state==='IDLE'&&!pointControl)messages.push(t.noPoint);
  if(reference.state==='READY'&&reference.result?.none)messages.push(t.noPlaces);
  if(reference.tiles?.status==='READY'){
    if(reference.tiles.stale)messages.push(t.stale.replace('{date}',reference.tiles.oldestRetrievedAt.slice(0,10)));
    if(reference.tiles.missing.length>0)messages.push(t.partial);
    if(!reference.tiles.persisted)messages.push(t.notPersisted);
  }
  const destinations=reference.state==='READY'?reference.result?.destinations??[]:[];
  return <div className="road-reference-section">
    {exercise&&<p><Tag tone="exercise">{t.exercise}</Tag></p>}
    {pointControl}
    {messages.map((message,index)=><p className="road-reference-status" role="status" key={`${index}-${message}`}>{message}</p>)}
    {destinations.length>0&&<ul className="road-reference-list">{destinations.map(destination=>{
      const road=destination.road?.role==='ROAD_REFERENCE_ONLY'&&destination.road.movement_authorized===false?destination.road:null;
      return <li key={destination.place.id}>
        {destination.place.name} · {t.straight} {formatKm(destination.straight_m,language)} · {t.road} {road?formatKm(road.distance_m,language):t.dash}（{t.reference}）
      </li>;
    })}</ul>}
    {retryable&&<Button variant="secondary" onClick={reference.retry}>{t.retry}</Button>}
    {!suppressNotice&&<>
      <p className="road-reference-disclaimer">{t.disclaimer}</p>
      <p className="road-reference-attribution">{attribution}</p>
    </>}
  </div>;
}
