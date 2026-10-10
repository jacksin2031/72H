'use client';

import { useEffect, useRef, useState } from 'react';
import { UiIcon } from './ui-icon';
import type { Language } from '@/lib/contracts';
import type { Epicenter, LocationFix } from '@/lib/geospatial-exposure';
import { validPoint } from '@/lib/geospatial-exposure';
import {
  GSI_ATTRIBUTION_URL, JAPAN_DEFAULT_CENTER, JAPAN_VIEW_BOUNDS,
  NATURAL_EARTH_LICENSE_URL,
} from '@/lib/japan-reference-map';

const LAND_ASSET='/maps/japan-land-50m.geojson';
const LAND_BYTES=284073;
const LAND_SHA256='32a1f99f53084df8d5aaae431d5edfbb41925248954a3836b071ec0861b29b42';
const inCoverage=(point:{lng:number;lat:number}):boolean=>validPoint(point)
  &&point.lng>=JAPAN_VIEW_BOUNDS[0][0]&&point.lng<=JAPAN_VIEW_BOUNDS[1][0]
  &&point.lat>=JAPAN_VIEW_BOUNDS[0][1]&&point.lat<=JAPAN_VIEW_BOUNDS[1][1];

const mapText={
  ja:{
    title:'日本全国の参考地図',note:'地理院タイル · 津波ハザードマップではありません',
    caution:'海岸線は地理的な境界です。津波の浸水範囲・避難先・安全経路を示しません。震央の拡散は図解であり、揺れの範囲ではありません。',
    loading:'日本全国の海岸線地図を検証しています',
    unavailable:'日本全国の基礎地図が検証できません。誤った地図を表示しません。',
    ready:'全国の海陸輪郭 · 拡大して地理院の詳細地図を表示',tilesUnavailable:'詳細地図はネット接続が必要 · 海陸の輪郭のみ表示中',
    zoomIn:'拡大',zoomOut:'縮小',overview:'日本全国を表示',focusEpicenter:'震央へ',focusGPS:'取得した GPS へ',
    land:'陸地',sea:'海',gps:'● GPS · 演習',epicenter:'✕ 気象庁 過去の震央',
    gpsOut:'GPS は表示範囲外',epicenterOut:'震央は表示範囲外',noAccess:'経路案内・安全判断には使えません',
  },
  en:{
    title:'All Japan reference map',note:'GSI official tiles · NOT a tsunami risk map',
    caution:'Coastlines show geography, not inundation, verified shelters or safe evacuation routes. Epicenter rings illustrate the event, not shaking extent.',
    loading:'Verifying offline coastline reference',
    unavailable:'The Japan coastline reference could not be verified. No untrusted map substituted.',
    ready:'Verified Japan outlines · zoom in for GSI detail',
    tilesUnavailable:'Detail tiles need internet · offline sea/land outlines only',
    zoomIn:'Zoom in',zoomOut:'Zoom out',overview:'View all Japan',focusEpicenter:'Go to historical epicenter',focusGPS:'Go to permitted GPS',
    land:'Land',sea:'Sea',gps:'● GPS · exercise',epicenter:'✕ Archived JMA epicenter',
    gpsOut:'GPS outside map coverage',epicenterOut:'Epicenter outside coverage',noAccess:'Not a safe-route or clearance map',
  },
  'zh-TW':{
    title:'全日本參考地圖',note:'國土地理院地圖 · 並非海嘯風險圖',
    caution:'海岸線只代表海陸邊界，並非浸水範圍、安全避難所或安全路線。震央擴散只作事件示意，不代表震動影響範圍。',
    loading:'正在驗證日本全國離線海岸線',
    unavailable:'無法驗證日本全國海岸圖，不會顯示未經核實的地圖。',
    ready:'已驗證全日本海陸輪廓 · 放大查看國土地理院詳細地圖',
    tilesUnavailable:'詳細地圖需要網絡 · 現只顯示離線海陸輪廓',
    zoomIn:'放大',zoomOut:'縮小',overview:'顯示全日本',focusEpicenter:'前往歷史震央',focusGPS:'前往已授權定位',
    land:'陸地',sea:'海洋',gps:'● GPS · 模擬',epicenter:'✕ 氣象廳歷史震央',
    gpsOut:'GPS 超出地圖範圍',epicenterOut:'震央超出地圖範圍',noAccess:'不可用作安全導航或避難授權',
  },
} as const;

/** All-Japan reference map; no inferred inundation, shelter or routes. */
export function SimulationReferenceMap({
  language,compact=false,epicenter=null,userLocation=null,
}:{
  language:Language; compact?:boolean;epicenter?:Epicenter|null;userLocation?:LocationFix|null;
}){
  const host=useRef<HTMLDivElement>(null);
  const mapRef=useRef<import('maplibre-gl').Map|null>(null);
  const pins=useRef<import('maplibre-gl').Marker[]>([]);
  const fitCountry=useRef<()=>void>(()=>{});
  const [status,setStatus]=useState<'loading'|'ready'|'unavailable'>('loading');
  const [tileIssues,setTileIssues]=useState(false);
  const t=mapText[language];

  useEffect(()=>{
    const abort=new AbortController();
    let cancelled=false;
    let observer:ResizeObserver|null=null;
    setStatus('loading');setTileIssues(false);
    void(async()=>{
      try{
        const response=await fetch(LAND_ASSET,{cache:'force-cache',signal:abort.signal});
        if(!response.ok)throw Error('Coastline asset unavailable');
        const bytes=await response.arrayBuffer();
        if(bytes.byteLength!==LAND_BYTES)throw Error('Unexpected coastline byte length');
        const digest=await crypto.subtle.digest('SHA-256',bytes);
        const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
        if(hash!==LAND_SHA256)throw Error('Coastline integrity failure');
        const land=JSON.parse(new TextDecoder().decode(bytes));
        if(land?.type!=='FeatureCollection'||!Array.isArray(land.features)
          ||land.features.length!==71)throw Error('Unexpected coastline data');
        const {Map,setWorkerCount,setWorkerUrl}=await import('maplibre-gl');
        if(cancelled||!host.current)return;
        setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
        setWorkerCount(1);
        const map=new Map({
          container:host.current,
          center:[...JAPAN_DEFAULT_CENTER],zoom:4.15,
          minZoom:2,maxZoom:17,attributionControl:false,
          renderWorldCopies:false,fadeDuration:0,
          // Camera padding lets a portrait viewport fit the entire country.
          // Exact tile/data coverage remains JAPAN_VIEW_BOUNDS.
          maxBounds:[[80,-50],[180,80]],
          style:{
            version:8,
            sources:{
              'natural-earth-land':{type:'geojson',data:land},
              'gsi-standard':{
                type:'raster',tiles:['/api/reference-tiles/{z}/{x}/{y}'],
                tileSize:256,minzoom:3,maxzoom:17,
                bounds:[120,19,156,48],
              },
            },
            layers:[
              {id:'sea',type:'background',paint:{'background-color':'#0b131e'}},
              {id:'land-fill',type:'fill',source:'natural-earth-land',
                paint:{'fill-color':'#29343f','fill-opacity':1}},

              {id:'gsi-topographic',type:'raster',source:'gsi-standard',
                paint:{
                  'raster-opacity':['interpolate',['linear'],['zoom'],6,0,9,0.38,14,0.55],
                  'raster-brightness-min':0.05,
                  'raster-brightness-max':0.35,
                  'raster-saturation':-1,
                  'raster-fade-duration':0,
                }},
              {id:'coastline-halo',type:'line',source:'natural-earth-land',maxzoom:9,
                paint:{'line-color':'#0b131e','line-width':4}},
              {id:'coastline',type:'line',source:'natural-earth-land',maxzoom:9,
                paint:{'line-color':'#a3b6c7','line-width':1.5,'line-opacity':1}},
            ],
          },
        });
        mapRef.current=map;
        fitCountry.current=()=>{
          if(cancelled||!host.current)return;
          const rect=host.current.getBoundingClientRect();
          const info=host.current.parentElement?.querySelector('.sim-map-information')?.getBoundingClientRect();
          // Fit the declared coverage into the unobscured viewport, including
          // remote islands. A z=3 minimum would crop its width on narrow phones.
          const bottom=Math.min(rect.height*.45,Math.max(compact?85:160,info?rect.bottom-info.top+24:0));
          map.fitBounds([[...JAPAN_VIEW_BOUNDS[0]],[...JAPAN_VIEW_BOUNDS[1]]],{
            padding:{top:compact?25:130,bottom,left:25,right:compact?25:70},duration:0,
          });
        };
        if(typeof ResizeObserver!=='undefined'){
          observer=new ResizeObserver(()=>{if(!cancelled)map.resize();});
          observer.observe(host.current);
        }
        map.scrollZoom.disable();map.boxZoom.disable();map.dragRotate.disable();
        if(compact){map.dragPan.disable();map.touchZoomRotate.disable();}
        else{map.dragPan.enable();map.touchZoomRotate.enable();map.touchZoomRotate.disableRotation();}
        map.on('error',event=>{
          if(cancelled)return;
          const message=String(event.error?.message||'');
          if(/tile|raster|reference-tiles|source/i.test(message))setTileIssues(true);
        });
        map.once('load',()=>{
          if(!cancelled){
            map.resize();
            setStatus('ready');
            fitCountry.current();
          }
        });
      }catch{if(!cancelled)setStatus('unavailable');}
    })();
    return()=>{
      cancelled=true;abort.abort();observer?.disconnect();
      pins.current.forEach(marker=>marker.remove());pins.current=[];
      mapRef.current?.remove();mapRef.current=null;
      fitCountry.current=()=>{};
    };
  },[compact]);

  useEffect(()=>{
    let cancelled=false;
    pins.current.forEach(marker=>marker.remove());pins.current=[];
    const map=mapRef.current;
    if(status!=='ready'||!map)return;
    const settleMarkers=()=>{
      const occupied:DOMRect[]=[];
      const overlays=Array.from(host.current?.parentElement?.querySelectorAll<HTMLElement>('.sim-map-controls,.japan-region-picker,.sim-map-information')??[]).map(node=>node.getBoundingClientRect());
      for(const pin of pins.current){
        const element=pin.getElement(),rect=element.getBoundingClientRect();
        const overlaps=[...occupied,...overlays].some(other=>rect.right+6>other.left&&rect.left-6<other.right&&rect.bottom+6>other.top&&rect.top-6<other.bottom);
        element.style.visibility=overlaps?'hidden':'';
        element.setAttribute('aria-hidden',String(overlaps));
        if(!overlaps)occupied.push(rect);
      }
    };
    map.on('moveend',settleMarkers);
    map.on('resize',settleMarkers);
    void import('maplibre-gl').then(({Marker})=>{
      if(cancelled||mapRef.current!==map)return;
      const attach=(point:{lat:number;lng:number},label:string,kind:string)=>{
        if(!inCoverage(point))return;
        const element=document.createElement('div');
        element.className='sim-geo-marker sim-geo-'+kind;
        if(kind==='epicenter'){
          const ripple=document.createElement('span');ripple.className='sim-quake-ripple';ripple.setAttribute('aria-hidden','true');
          for(let i=0;i<3;i++)ripple.append(document.createElement('i'));
          element.append(ripple);
        }
        const symbol=document.createElement('span');symbol.className='sim-marker-symbol';symbol.textContent=kind==='gps'?'●':'✕';element.append(symbol);
        element.setAttribute('role','img');element.setAttribute('aria-label',label);
        element.title=label;
        pins.current.push(new Marker({element}).setLngLat([point.lng,point.lat]).addTo(map));
      };
      if(userLocation?.source==='BROWSER_GEOLOCATION'&&userLocation.accuracy_m<=1000&&inCoverage(userLocation)){
        attach(userLocation,t.gps,'gps');
        map.easeTo({center:[userLocation.lng,userLocation.lat],zoom:Math.max(map.getZoom(),9),duration:0});
      }
      if(epicenter)attach(epicenter,t.epicenter,'epicenter');
      settleMarkers();
    });
    return()=>{cancelled=true;map.off('moveend',settleMarkers);map.off('resize',settleMarkers);pins.current.forEach(marker=>marker.remove());pins.current=[];};
  },[status,epicenter?.lat,epicenter?.lng,userLocation?.lat,userLocation?.lng,userLocation?.accuracy_m,userLocation?.source,language]);

  const displayedEpicenter=!!epicenter&&inCoverage(epicenter);
  const displayedGps=!!userLocation&&userLocation.source==='BROWSER_GEOLOCATION'&&userLocation.accuracy_m<=1000&&inCoverage(userLocation);
  const nationwide=()=>{
    fitCountry.current();
  };
  return <section className={compact?'sim-map-reference sim-map-compact':'sim-map-reference sim-map-full'}
    aria-label={t.title} data-testid="simulation-reference-map">
    <div ref={host} className="sim-map-canvas" aria-hidden="true"/>
    {!compact&&<label className="japan-region-picker"><span>{language==='ja'?'地域':language==='en'?'Region':'地區'}</span>
      <select aria-label={language==='ja'?'地図の地域':language==='en'?'Map region':'地圖地區'} defaultValue=""
        disabled={status!=='ready'} onChange={event=>{
          const region=event.target.value;
          if(!region){nationwide();return;}
          const [lng,lat,zoom]=region.split(',').map(Number);
          mapRef.current?.easeTo({center:[lng,lat],zoom,duration:0});
        }}>
        <option value="">{t.overview}</option>
        <option value="142,43.5,6">北海道</option><option value="140,38.5,6">東北</option>
        <option value="139.7,35.7,9">東京 / Tokyo</option><option value="137,36.5,6">中部</option>
        <option value="135.5,34.7,7">近畿</option><option value="133,34.2,7">中國・四國</option>
        <option value="131,32.5,6">九州</option><option value="127.7,26.2,8">沖繩 / 沖縄</option>
        <option value="124.2,24.4,8">八重山</option><option value="142.2,27.1,8">小笠原</option>
        <option value="153.98,24.28,10">南鳥島</option>
      </select>
    </label>}
    <div className="sim-map-information"><div className="sim-map-maplabel"><strong>{t.title}</strong><small>{t.note}</small></div>
    <div className="sim-map-landsea-legend" data-testid="japan-land-sea-legend">
      <span><i className="sim-map-land-color"/>{t.land}</span>
      <span><i className="sim-map-sea-color"/>{t.sea}</span>
    </div>
    <p className="sim-map-status" role="status">
      {status==='loading'?t.loading:status==='unavailable'?t.unavailable:tileIssues?t.tilesUnavailable:t.ready}
    </p>
    <p className="sim-map-caution">{t.caution}</p>
    <div className="sim-map-attribution">
      <a href={GSI_ATTRIBUTION_URL} target="_blank" rel="noopener noreferrer">© 国土地理院</a>
      <span> · </span>
      <a href={NATURAL_EARTH_LICENSE_URL} target="_blank" rel="noopener noreferrer">Natural Earth</a>
    </div>
    </div>
    {!compact&&<div className="sim-map-controls">
      <button type="button" aria-label={t.zoomIn} onClick={()=>mapRef.current?.zoomIn()} disabled={status!=='ready'}><UiIcon name="plus" /></button>
      <button type="button" aria-label={t.zoomOut} onClick={()=>mapRef.current?.zoomOut()} disabled={status!=='ready'}><UiIcon name="minus" /></button>
      <button type="button" className="sim-map-overview" aria-label={t.overview} data-testid="japan-map-overview"
        onClick={nationwide} disabled={status!=='ready'}><UiIcon name="overview" /></button>
      {displayedEpicenter&&<button type="button" className="sim-map-epicenter-jump"
        aria-label={t.focusEpicenter} data-testid="japan-map-epicenter"
        onClick={()=>mapRef.current?.easeTo({center:[epicenter!.lng,epicenter!.lat],zoom:Math.max(mapRef.current?.getZoom()??6,6),duration:250})}>
        <UiIcon name="close" />
      </button>}
      {displayedGps&&<button type="button" aria-label={t.focusGPS}
        onClick={()=>mapRef.current?.easeTo({center:[userLocation!.lng,userLocation!.lat],zoom:11,duration:250})}><UiIcon name="location" /></button>}
    </div>}
    {status==='ready'&&(userLocation||epicenter)&&<div className="sim-map-geo-note" data-testid="simulation-geo-markers">
      {displayedGps?t.gps:userLocation?t.gpsOut:''}
      {displayedEpicenter?' '+t.epicenter:epicenter?' '+t.epicenterOut:''}
    </div>}
  </section>;
}
