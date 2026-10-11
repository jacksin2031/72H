'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { UiIcon } from './ui-icon';
import type { Language } from '@/lib/contracts';
import type { Epicenter, LocationFix } from '@/lib/geospatial-exposure';
import { validPoint } from '@/lib/geospatial-exposure';
import { seismicWavefronts, WAVE_SPEED_SOURCE } from '@/lib/seismic-wavefront';
import {REFERENCE_VECTOR_SOURCE,REFERENCE_VECTOR_LAYERS,REFERENCE_GLYPHS,REFERENCE_REGIONS,REFERENCE_REGION_LAYER} from '@/lib/reference-map-style';
import type { HazardPack, OfficialPlace } from '@/lib/official-hazards';
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
    caution:'海岸線は地理的な境界です。津波の浸水範囲・避難先・安全経路を示しません。P/S波面は発震時刻・深さと一定速度による概算です。実測波形・震度分布ではありません。',
    waves:'P/S波面の概算',waveSource:'気象庁：地震波の速度',
    loading:'日本全国の海岸線地図を検証しています',
    unavailable:'日本全国の基礎地図が検証できません。誤った地図を表示しません。',
    ready:'拡大して地名・道路・鉄道・駅を表示。参考道路は通行可能・安全を意味しません。',tilesUnavailable:'一部の詳細を取得できません · 海陸の輪郭は表示できます',
    roads:'参考道路',rail:'鉄道',
    zoomIn:'拡大',zoomOut:'縮小',overview:'日本全国を表示',focusEpicenter:'震央へ',focusGPS:'取得した GPS へ',
    shortCaution:'海岸線 ≠ 津波浸水範囲 · 避難経路に使用不可',details:'地図の注意事項',
    land:'陸地',sea:'海',gps:'● GPS · 演習',epicenter:'✕ 気象庁 過去の震央',
    gpsOut:'GPS は表示範囲外',epicenterOut:'震央は表示範囲外',noAccess:'経路案内・安全判断には使えません',
  },
  en:{
    title:'All Japan reference map',note:'GSI official tiles · NOT a tsunami risk map',
    caution:'Coastlines show geography, not inundation, verified shelters or safe evacuation routes. P/S fronts use origin time, depth and constant speeds. They are estimates, not measured waveforms or shaking intensity.',
    waves:'Estimated P/S wavefronts',waveSource:'JMA: seismic wave speeds',
    loading:'Verifying offline coastline reference',
    unavailable:'The Japan coastline reference could not be verified. No untrusted map substituted.',
    ready:'Zoom in for places, roads, railways and stations. Reference roads do not mean open or safe routes.',
    roads:'Reference roads',rail:'Rail',
    tilesUnavailable:'Some map detail unavailable · sea/land outlines remain available',
    zoomIn:'Zoom in',zoomOut:'Zoom out',overview:'View all Japan',focusEpicenter:'Go to historical epicenter',focusGPS:'Go to permitted GPS',
    shortCaution:'Coastline ≠ tsunami zone · no safe routes',details:'Map details & limits',
    land:'Land',sea:'Sea',gps:'● GPS · exercise',epicenter:'✕ Archived JMA epicenter',
    gpsOut:'GPS outside map coverage',epicenterOut:'Epicenter outside coverage',noAccess:'Not a safe-route or clearance map',
  },
  'zh-TW':{
    title:'全日本參考地圖',note:'國土地理院地圖 · 並非海嘯風險圖',
    caution:'海岸線只代表海陸邊界，並非浸水範圍、安全避難所或安全路線。P／S 波前按發震時間、深度及固定波速估算，不代表實測波形、震度或震動影響範圍。',
    waves:'P／S 波前估算',waveSource:'氣象廳：地震波速度',
    loading:'正在驗證日本全國離線海岸線',
    unavailable:'無法驗證日本全國海岸圖，不會顯示未經核實的地圖。',
    ready:'放大查看地名、道路、鐵路及車站。參考道路不代表可通行或安全路線。',
    roads:'參考道路',rail:'鐵路',
    tilesUnavailable:'部分地圖詳情未能載入 · 海陸輪廓仍可查看',
    zoomIn:'放大',zoomOut:'縮小',overview:'顯示全日本',focusEpicenter:'前往歷史震央',focusGPS:'前往已授權定位',
    shortCaution:'海岸線 ≠ 海嘯浸水區 · 不可作避難導航',details:'地圖限制與資料',
    land:'陸地',sea:'海洋',gps:'● GPS · 模擬',epicenter:'✕ 氣象廳歷史震央',
    gpsOut:'GPS 超出地圖範圍',epicenterOut:'震央超出地圖範圍',noAccess:'不可用作安全導航或避難授權',
  },
} as const;

/** All-Japan reference map; no inferred inundation, shelter or routes. */
export function SimulationReferenceMap({
  language,compact=false,epicenter=null,userLocation=null,referencePoint=null,officialPack=null,showInundation=false,showPlaces=false,focusPoint=null,onReferencePoint,onPlace,protectDeviceLocation=true,seismicOrigins=[],seismicTime=null,
}:{
  language:Language; compact?:boolean;epicenter?:Epicenter|null;userLocation?:LocationFix|null;
  referencePoint?:{lat:number;lng:number}|null;
  officialPack?:HazardPack|null;showInundation?:boolean;showPlaces?:boolean;focusPoint?:{lat:number;lng:number;zoom?:number}|null;
  onReferencePoint?:(point:{lat:number;lng:number})=>void;onPlace?:(place:OfficialPlace)=>void;
  protectDeviceLocation?:boolean;
  seismicOrigins?:readonly Epicenter[];seismicTime?:number|null;
}){
  const host=useRef<HTMLDivElement>(null);
  const mapRef=useRef<import('maplibre-gl').Map|null>(null);
  const pins=useRef<import('maplibre-gl').Marker[]>([]);
  const fitCountry=useRef<()=>void>(()=>{});
  const detailSuppressed=useRef(false);
  const [status,setStatus]=useState<'loading'|'ready'|'unavailable'>('loading');
  const [tileIssues,setTileIssues]=useState(false);
  const waveData=useMemo(()=>seismicWavefronts(seismicOrigins,seismicTime??NaN),[seismicOrigins,seismicTime]);
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
          renderWorldCopies:false,fadeDuration:0,localIdeographFontFamily:'sans-serif',
          // Camera padding lets a portrait viewport fit the entire country.
          // Exact tile/data coverage remains JAPAN_VIEW_BOUNDS.
          maxBounds:[[80,-50],[180,80]],
          style:{
            version:8,
            glyphs:REFERENCE_GLYPHS,
            sources:{
              'natural-earth-land':{type:'geojson',data:land},
              'reference-regions':REFERENCE_REGIONS,
              'gsi-reference':REFERENCE_VECTOR_SOURCE,
            },
            layers:[
              {id:'sea',type:'background',paint:{'background-color':'#0c2535'}},
              {id:'land-fill',type:'fill',source:'natural-earth-land',
                paint:{'fill-color':'#35574e','fill-opacity':1}},

              {id:'coastline-halo',type:'line',source:'natural-earth-land',maxzoom:9,
                paint:{'line-color':'#0c2535','line-width':4}},
              {id:'coastline',type:'line',source:'natural-earth-land',maxzoom:9,
                paint:{'line-color':'#aad2c5','line-width':1.5,'line-opacity':1}},
              ...REFERENCE_VECTOR_LAYERS,
              REFERENCE_REGION_LAYER,
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
          if(/tile|glyph|reference-vectors|reference-glyphs|source/i.test(message))setTileIssues(true);
        });
        map.on('movestart',()=>{if(!cancelled)setTileIssues(false);});
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
      detailSuppressed.current=false;
      fitCountry.current=()=>{};
    };
  },[compact]);

  // Remove tile requests before centering on GPS: z/x/y can reveal location
  // even without sending literal latitude/longitude. Local vectors remain.
  useEffect(()=>{
    const map=mapRef.current;if(status!=='ready'||!map||!protectDeviceLocation)return;
    if(userLocation){
      for(const layer of REFERENCE_VECTOR_LAYERS)if(map.getLayer(layer.id))map.removeLayer(layer.id);
      if(map.getSource('gsi-reference'))map.removeSource('gsi-reference');
      detailSuppressed.current=true;
    }else if(detailSuppressed.current){
      fitCountry.current();
      map.addSource('gsi-reference',REFERENCE_VECTOR_SOURCE);
      for(const layer of REFERENCE_VECTOR_LAYERS)map.addLayer(layer,'reference-region-labels');
      detailSuppressed.current=false;
    }
  },[status,protectDeviceLocation,!!userLocation]);

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
        const symbol=document.createElement('span');symbol.className='sim-marker-symbol';symbol.textContent=kind==='epicenter'?'✕':'●';element.append(symbol);
        element.setAttribute('role','img');element.setAttribute('aria-label',label);
        element.title=label;
        pins.current.push(new Marker({element}).setLngLat([point.lng,point.lat]).addTo(map));
      };
      if(userLocation?.source==='BROWSER_GEOLOCATION'&&userLocation.accuracy_m<=1000&&inCoverage(userLocation)){
        attach(userLocation,officialPack?'GPS':t.gps,'gps');
        map.easeTo({center:[userLocation.lng,userLocation.lat],zoom:Math.max(map.getZoom(),9),duration:0});
      }
      if(epicenter)attach(epicenter,t.epicenter,'epicenter');
      if(referencePoint)attach(referencePoint,language==='ja'?'地図選択点':language==='en'?'Selected reference point':'地圖選點','reference');
      settleMarkers();
    });
    return()=>{cancelled=true;map.off('moveend',settleMarkers);map.off('resize',settleMarkers);pins.current.forEach(marker=>marker.remove());pins.current=[];};
  },[status,epicenter?.lat,epicenter?.lng,userLocation?.lat,userLocation?.lng,userLocation?.accuracy_m,userLocation?.source,referencePoint,language,officialPack]);

  // One map source, updated from the shared simulation clock. No CSS loop,
  // independent animation clock, or restart on tab switch / map remount.
  useEffect(()=>{
    const map=mapRef.current;
    if(status!=='ready'||!map)return;
    const data=waveData;
    const source=map.getSource('seismic-wavefronts') as import('maplibre-gl').GeoJSONSource|undefined;
    if(source){source.setData(data);return;}
    if(!seismicOrigins.length||seismicTime===null)return;
    map.addSource('seismic-wavefronts',{type:'geojson',data});
    map.addLayer({id:'seismic-wavefront-lines',type:'line',source:'seismic-wavefronts',
      paint:{'line-color':['match',['get','phase'],'P','#b6dae8','#f3bb85'],'line-width':2,'line-opacity':0.9}});
  },[status,seismicTime,seismicOrigins,waveData]);

  useEffect(()=>{
    const map=mapRef.current;if(status!=='ready'||!map||!officialPack)return;
    if(showInundation){
      map.addSource('official-inundation',{type:'geojson',data:officialPack.inundation});
      map.addLayer({id:'official-inundation-fill',type:'fill',source:'official-inundation',paint:{'fill-color':'#e9ac66','fill-opacity':0.38}});
      map.addLayer({id:'official-inundation-edge',type:'line',source:'official-inundation',paint:{'line-color':'#ffd19a','line-width':1}});
    }
    if(showPlaces){
      map.addSource('official-places',{type:'geojson',data:{type:'FeatureCollection',features:officialPack.places.map(p=>({
        type:'Feature',geometry:{type:'Point',coordinates:[p.lng,p.lat]},properties:{id:p.id,kind:p.kind},
      }))}});
      map.addLayer({id:'official-places-points',type:'circle',source:'official-places',paint:{'circle-radius':5,
        'circle-color':['match',['get','kind'],'EMERGENCY_SITE','#afcbed','#aeb4bd'],'circle-stroke-color':'#122230','circle-stroke-width':1.5}});
    }
    const choose=(event:import('maplibre-gl').MapMouseEvent)=>{
      const hit=showPlaces?map.queryRenderedFeatures(event.point,{layers:['official-places-points']})[0]:null;
      const place=hit?officialPack.places.find(p=>p.id===hit.properties.id):null;
      if(place)onPlace?.(place);else onReferencePoint?.({lat:event.lngLat.lat,lng:event.lngLat.lng});
    };
    map.on('click',choose);
    return()=>{
      map.off('click',choose);
      for(const id of ['official-places-points','official-inundation-edge','official-inundation-fill'])if(map.getLayer(id))map.removeLayer(id);
      for(const id of ['official-places','official-inundation'])if(map.getSource(id))map.removeSource(id);
    };
  },[status,officialPack,showInundation,showPlaces,onReferencePoint,onPlace]);

  useEffect(()=>{
    if(status==='ready'&&focusPoint&&validPoint(focusPoint))mapRef.current?.easeTo({center:[focusPoint.lng,focusPoint.lat],zoom:focusPoint.zoom??13,duration:0});
  },[status,focusPoint]);

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
        <option value="139.7,35.7,11">東京 / Tokyo</option><option value="137,36.5,6">中部</option>
        <option value="135.5,34.7,7">近畿</option><option value="133,34.2,7">中國・四國</option>
        <option value="131,32.5,6">九州</option><option value="127.7,26.2,8">沖繩 / 沖縄</option>
        <option value="124.2,24.4,8">八重山</option><option value="142.2,27.1,8">小笠原</option>
        <option value="153.98,24.28,10">南鳥島</option>
      </select>
    </label>}
    <div className="sim-map-information">
      <div className="sim-map-maplabel"><strong>{t.title}</strong><small>{officialPack?(language==='ja'?'公式想定データ · 安全性未判定':language==='en'?'Official scenario data · safety undetermined':'官方想定資料 · 安全性未判定'):t.note}</small></div>
      <div className="sim-map-landsea-legend" data-testid="japan-land-sea-legend">
        <span><i className="sim-map-land-color"/>{t.land}</span>
        <span><i className="sim-map-sea-color"/>{t.sea}</span>
        <span><i className="sim-map-road-color"/>{t.roads}</span>
        <span><i className="sim-map-rail-color"/>{t.rail}</span>
        {officialPack&&showInundation&&<span><i style={{background:'#e9ac66'}}/>{language==='ja'?'浸水想定':language==='en'?'Inundation scenario':'浸水想定'}</span>}
      </div>
      <p className="sim-map-quick-caution">{t.shortCaution}</p>
      {seismicOrigins.length>0&&seismicTime!==null&&<p className="sim-map-wave-legend" data-testid="seismic-wave-legend"
        data-wave-time={seismicTime} data-wave-count={waveData.features.length}
        data-p-radius-km={waveData.features.filter(f=>f.properties.phase==='P').at(-1)?.properties.radius_km.toFixed(3)}
        data-s-radius-km={waveData.features.filter(f=>f.properties.phase==='S').at(-1)?.properties.radius_km.toFixed(3)}>
        <span>{t.waves} · {new Date(seismicTime+9*60*60*1000).toISOString().slice(11,19)} JST</span>
        <span className="sim-wave-p">P ≈ 7 km/s</span><span className="sim-wave-s">S ≈ 4 km/s</span>
      </p>}
      {(status!=='ready'||tileIssues)&&<p className="sim-map-status" role="status">
        {status==='loading'?t.loading:status==='unavailable'?t.unavailable:t.tilesUnavailable}
      </p>}
      {protectDeviceLocation&&userLocation&&<p className="sim-map-status">{language==='ja'?'GPS使用中は位置を守るため端末内の輪郭・想定データのみ表示':language==='en'?'GPS view uses device-local outlines and scenario data to protect location':'GPS 查詢只顯示裝置內輪廓及想定資料，避免詳細圖磚洩漏位置'}</p>}
      <details className="sim-map-details" data-testid="japan-map-details">
        <summary>{t.details}</summary>
        <p className="sim-map-caution">{t.caution}</p>
        <p className="sim-map-detail-ready">{t.ready}</p>
        {seismicOrigins.length>0&&<a href={WAVE_SPEED_SOURCE} target="_blank" rel="noopener noreferrer">{t.waveSource} ↗</a>}
      </details>
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
        onClick={()=>{
          const map=mapRef.current,rect=host.current?.getBoundingClientRect();
          const info=host.current?.parentElement?.querySelector('.sim-map-information')?.getBoundingClientRect();
          if(!map||!rect)return;
          map.easeTo({center:[epicenter!.lng,epicenter!.lat],zoom:Math.max(map.getZoom(),6),duration:250,
            padding:{top:130,bottom:Math.min(rect.height*.6,Math.max(160,info?rect.bottom-info.top+24:0)),left:25,right:70}});
        }}>
        <UiIcon name="close" />
      </button>}
      {displayedGps&&<button type="button" aria-label={t.focusGPS}
        onClick={()=>mapRef.current?.easeTo({center:[userLocation!.lng,userLocation!.lat],zoom:11,duration:250})}><UiIcon name="location" /></button>}
    </div>}
    {status==='ready'&&(userLocation||epicenter)&&<div className="sim-map-geo-note" data-testid="simulation-geo-markers">
      {displayedGps?(officialPack?'GPS':t.gps):userLocation?t.gpsOut:''}
      {displayedEpicenter?' '+t.epicenter:epicenter?' '+t.epicenterOut:''}
    </div>}
  </section>;
}
