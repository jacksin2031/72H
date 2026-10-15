'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { UiIcon } from './ui-icon';
import type { Language } from '@/lib/contracts';
import type { RoadCandidate } from '@/lib/evacuation-road-graph';
import type { Epicenter, LocationFix } from '@/lib/geospatial-exposure';
import { validPoint } from '@/lib/geospatial-exposure';
import { seismicWavefronts, WAVE_SPEED_SOURCE } from '@/lib/seismic-wavefront';
import {REFERENCE_VECTOR_SOURCE,REFERENCE_VECTOR_LAYERS,REFERENCE_GLYPHS,REFERENCE_REGIONS,REFERENCE_REGION_LAYER} from '@/lib/reference-map-style';
import type { HazardPack, OfficialPlace } from '@/lib/official-hazards';
import {forecastLines,type DisasterMapReference,type ForecastLinePack} from '@/lib/disaster-map';
import {regionalMaxima,type IntensityRegionPack} from '@/lib/intensity-regions';
import {MAP_REGIONS,mapRegionLabel} from '@/lib/map-regions';
import {
  GSI_ATTRIBUTION_URL, JAPAN_DEFAULT_CENTER, JAPAN_VIEW_BOUNDS,
  NATURAL_EARTH_LICENSE_URL,
} from '@/lib/japan-reference-map';
import './simulation-map-ui.css';

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
  language,compact=false,showInformation=true,epicenter=null,userLocation=null,referencePoint=null,officialPack=null,showInundation=false,showPlaces=false,focusPoint=null,onReferencePoint,onPlace,protectDeviceLocation=true,seismicOrigins=[],seismicTime=null,
  disasterReference=null,forecastLinePack=null,referenceConnected=false,referenceNow=0,showForecastLines=false,
  intensityRegionPack=null,showIntensityRegions=false,referencePlaces,viewBounds=null,referenceRoute=null,referenceRoutes,
  legend='card',regionPicker=!compact,regionRequest=null,
}:{
  language:Language; compact?:boolean;showInformation?:boolean;epicenter?:Epicenter|null;userLocation?:LocationFix|null;
  referencePoint?:{lat:number;lng:number}|null;
  officialPack?:HazardPack|null;showInundation?:boolean;showPlaces?:boolean;focusPoint?:{lat:number;lng:number;zoom?:number}|null;
  referencePlaces?:OfficialPlace[];viewBounds?:[number,number,number,number]|null;
  onReferencePoint?:(point:{lat:number;lng:number})=>void;onPlace?:(place:OfficialPlace)=>void;
  protectDeviceLocation?:boolean;
  seismicOrigins?:readonly Epicenter[];seismicTime?:number|null;
  disasterReference?:DisasterMapReference|null;forecastLinePack?:ForecastLinePack|null;
  referenceConnected?:boolean;referenceNow?:number;showForecastLines?:boolean;
  intensityRegionPack?:IntensityRegionPack|null;showIntensityRegions?:boolean;
  referenceRoute?:RoadCandidate|null;referenceRoutes?:readonly RoadCandidate[];
  /** 'none': the host screen renders its own one-line legend and the single navigation/safety note. */
  legend?:'card'|'none';regionPicker?:boolean;regionRequest?:{value:string}|null;
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
  const forecast=forecastLines(forecastLinePack,disasterReference,referenceConnected,referenceNow);
  // Geometry is immutable per verified pack. Only state / class changes need
  // to replace MapLibre data; the age clock must not serialize coastlines.
  const forecastStates=JSON.stringify(forecast.features.map(f=>f.properties));
  const forecastGeometry=forecastLinePack?.geometry;
  const forecastData=useMemo(()=>{
    const states=JSON.parse(forecastStates) as Array<{code:string;name:string;state:string;warning_class:string}>;
    return {type:'FeatureCollection' as const,features:(forecastGeometry?.features??[]).flatMap(f=>{
      const state=states.find(p=>p.code===f.properties.code);return state?[{...f,properties:state}]:[];
    })};
  },[forecastGeometry,forecastStates]);
  const maxima=regionalMaxima(intensityRegionPack,disasterReference,referenceConnected,referenceNow);
  const regionalStates=JSON.stringify(maxima),regionGeometry=intensityRegionPack&&referenceNow>=Date.parse(intensityRegionPack.manifest.reviewed_at)
    &&referenceNow<Date.parse(intensityRegionPack.manifest.review_due_at)?intensityRegionPack.features:undefined;
  const regionalData=useMemo(()=>{
    const values=JSON.parse(regionalStates) as typeof maxima;
    const valueFor=(f:NonNullable<typeof regionGeometry>[number])=>values.find(v=>v.code===f.properties.code)??{
      code:f.properties.code,name:f.properties.name,intensity:null,state:'NO_OBSERVATION',report_ids:[],issued_at:[],scope:'REGION_UNDETERMINED_NOT_POINT_MEASUREMENT',
    };
    const polygons=(regionGeometry??[]).map(f=>({...f,properties:valueFor(f)}));
    const label=language==='ja'?'地域最大':language==='en'?'Region maximum':'地域最大';
    const past=language==='ja'?'過去':language==='en'?'Archived':'過去';
    const unknown=language==='ja'?'未判定':language==='en'?'Undetermined':'未判定';
    return {polygons:{type:'FeatureCollection' as const,features:polygons},labels:{type:'FeatureCollection' as const,features:(regionGeometry??[]).flatMap(f=>{
      const value=valueFor(f);return [{type:'Feature' as const,geometry:{type:'Point' as const,coordinates:f.properties.anchor},properties:{...value,
        label:`${value.state==='RECENT_REFERENCE'?'':(value.state==='UNKNOWN'||value.state==='NO_OBSERVATION'?unknown:past)+' · '}${value.name} · ${label} ${value.intensity??'UNKNOWN'}`}}];
    })}};
  },[regionGeometry,regionalStates,language]);

  useEffect(()=>{
    const map=mapRef.current;if(status!=='ready'||!map||!showIntensityRegions)return;
    map.addSource('official-intensity-regions',{type:'geojson',data:regionalData.polygons});
    map.addSource('official-intensity-scope-labels',{type:'geojson',data:regionalData.labels});
    map.addLayer({id:'official-intensity-boundaries',type:'line',source:'official-intensity-regions',paint:{'line-color':'#a9bac8','line-width':1.5,'line-dasharray':[3,2]}});
    map.addLayer({id:'official-intensity-labels',type:'symbol',source:'official-intensity-scope-labels',layout:{'text-field':['get','label'],'text-font':['NotoSansCJKjp-Regular'],'text-size':12,'text-max-width':14,
      'symbol-sort-key':['match',['get','state'],'RECENT_REFERENCE',0,'ARCHIVED_REFERENCE',1,2]},
      paint:{'text-color':['case',['==',['get','state'],'RECENT_REFERENCE'],'#d3e7fa','#a6adb5'],'text-halo-color':'#07121d','text-halo-width':2}});
    return()=>{
      for(const id of ['official-intensity-labels','official-intensity-boundaries'])if(map.getLayer(id))map.removeLayer(id);
      for(const id of ['official-intensity-scope-labels','official-intensity-regions'])if(map.getSource(id))map.removeSource(id);
    };
  },[status,showIntensityRegions,regionalData]);

  useEffect(()=>{
    const map=mapRef.current;if(status!=='ready'||!map||!showForecastLines)return;
    map.addSource('official-forecast-lines',{type:'geojson',data:forecastData});
    map.addLayer({id:'official-forecast-halo',type:'line',source:'official-forecast-lines',paint:{'line-color':'#07121d','line-width':7}});
    map.addLayer({id:'official-forecast-current',type:'line',source:'official-forecast-lines',filter:['==',['get','state'],'ACTIVE'],paint:{
      'line-width':4,'line-color':['match',['get','warning_class'],'MAJOR_WARNING','#ef8cb5','WARNING','#ed9b7d','ADVISORY','#efc979','#adcadd'],
    }});
    map.addLayer({id:'official-forecast-old',type:'line',source:'official-forecast-lines',filter:['!=',['get','state'],'ACTIVE'],paint:{'line-color':'#a6adb5','line-width':3,'line-dasharray':[2,2]}});
    return()=>{
      for(const id of ['official-forecast-old','official-forecast-current','official-forecast-halo'])if(map.getLayer(id))map.removeLayer(id);
      if(map.getSource('official-forecast-lines'))map.removeSource('official-forecast-lines');
    };
  },[status,showForecastLines,forecastData]);

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
        map.scrollZoom.enable();map.boxZoom.disable();map.dragRotate.disable();
        map.dragPan.enable();map.touchZoomRotate.enable();map.touchZoomRotate.disableRotation();
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
    // The reference-point tap works with no pack or places (R24): only the place layers depend on them.
    const hasPlaces=Boolean(officialPack)||referencePlaces!==undefined;
    const map=mapRef.current;if(status!=='ready'||!map||(!hasPlaces&&!onReferencePoint))return;
    const places=referencePlaces??officialPack?.places??[];
    const byId=new Map(places.map(p=>[p.id,p]));
    const placeLayers=['official-places-points','official-places-clusters'];
    if(showInundation&&officialPack){
      map.addSource('official-inundation',{type:'geojson',data:officialPack.inundation});
      map.addLayer({id:'official-inundation-fill',type:'fill',source:'official-inundation',paint:{'fill-color':'#e9ac66','fill-opacity':0.38}});
      map.addLayer({id:'official-inundation-edge',type:'line',source:'official-inundation',paint:{'line-color':'#ffd19a','line-width':1}});
    }
    if(showPlaces&&hasPlaces){
      map.addSource('official-places',{type:'geojson',cluster:true,clusterRadius:40,clusterMaxZoom:12,data:{type:'FeatureCollection',features:places.map(p=>({
        type:'Feature',geometry:{type:'Point',coordinates:[p.lng,p.lat]},properties:{id:p.id,kind:p.kind},
      }))}});
      map.addLayer({id:'official-places-clusters',type:'circle',source:'official-places',filter:['has','point_count'],paint:{'circle-radius':['step',['get','point_count'],10,100,16,1000,22],'circle-color':'#80b9a2','circle-opacity':0.8,'circle-stroke-color':'#122230','circle-stroke-width':2}});
      map.addLayer({id:'official-places-points',type:'circle',source:'official-places',filter:['!', ['has','point_count']],paint:{'circle-radius':5,
        'circle-color':['match',['get','kind'],'EMERGENCY_SITE','#afcbed','#aeb4bd'],'circle-stroke-color':'#122230','circle-stroke-width':1.5}});
    }
    const choose=(event:import('maplibre-gl').MapMouseEvent)=>{
      const hit=showPlaces&&places.length&&placeLayers.every(id=>map.getLayer(id))?map.queryRenderedFeatures(event.point,{layers:placeLayers})[0]:null;
      if(hit?.properties?.point_count){
        const point=hit.geometry as {type:'Point';coordinates:[number,number]};
        map.easeTo({center:point.coordinates,zoom:Math.min(17,map.getZoom()+2),duration:0});return;
      }
      const place=hit?byId.get(hit.properties.id):null;
      if(place)onPlace?.(place);else onReferencePoint?.({lat:event.lngLat.lat,lng:event.lngLat.lng});
    };
    map.on('click',choose);
    return()=>{
      map.off('click',choose);
      for(const id of ['official-places-points','official-places-clusters','official-inundation-edge','official-inundation-fill'])if(map.getLayer(id))map.removeLayer(id);
      for(const id of ['official-places','official-inundation'])if(map.getSource(id))map.removeSource(id);
    };
  },[status,officialPack,referencePlaces,showInundation,showPlaces,onReferencePoint,onPlace]);

  useEffect(()=>{
    if(status==='ready'&&viewBounds)mapRef.current?.fitBounds([[viewBounds[0],viewBounds[1]],[viewBounds[2],viewBounds[3]]],{padding:{top:130,bottom:180,left:30,right:70},maxZoom:12,duration:0});
  },[status,viewBounds]);

  useEffect(()=>{
    const map=mapRef.current;
    if(status!=='ready'||!map)return;
    if(referenceRoutes!==undefined){
      const routes=referenceRoutes.slice(0,3).filter(route=>{
        const envelope=route as RoadCandidate&{role?:unknown;movement_authorized?:unknown};
        return envelope.role==='ROAD_REFERENCE_ONLY'&&envelope.movement_authorized===false
          &&route.coordinates.length>=2&&route.coordinates.length<=2048
          &&route.coordinates.every(p=>p.length===2&&validPoint({lng:p[0],lat:p[1]}));
      });
      if(routes.length===0)return;
      const sourceId='road-reference-only-routes';const layerId='road-reference-only-route-lines';
      map.addSource(sourceId,{type:'geojson',data:{type:'FeatureCollection',features:routes.map((route,index)=>({
        type:'Feature' as const,properties:{authority:'ROAD_REFERENCE_ONLY',movement_authorized:false,route_index:index},
        geometry:{type:'LineString' as const,coordinates:route.coordinates.map(([lng,lat])=>[lng,lat])},
      }))}});
      map.addLayer({id:layerId,type:'line',source:sourceId,paint:{'line-color':'#afcbed','line-width':4,'line-dasharray':[2,2]}});
      return()=>{if(map.getLayer(layerId))map.removeLayer(layerId);if(map.getSource(sourceId))map.removeSource(sourceId);};
    }
    if(!referenceRoute||referenceRoute.coordinates.length<2||referenceRoute.coordinates.length>2048
      ||referenceRoute.coordinates.some(p=>p.length!==2||!validPoint({lng:p[0],lat:p[1]})))return;
    map.addSource('evacuation-reference-route',{type:'geojson',data:{type:'Feature',properties:{authority:'ROAD_REFERENCE_ONLY',movement_authorized:false},
      geometry:{type:'LineString',coordinates:referenceRoute.coordinates.map(p=>[p[0],p[1]])}}});
    map.addLayer({id:'evacuation-reference-route-line',type:'line',source:'evacuation-reference-route',
      paint:{'line-color':'#afcbed','line-width':4,'line-dasharray':[2,2]}});
    return()=>{if(map.getLayer('evacuation-reference-route-line'))map.removeLayer('evacuation-reference-route-line');
      if(map.getSource('evacuation-reference-route'))map.removeSource('evacuation-reference-route');};
  },[status,referenceRoute,referenceRoutes]);

  useEffect(()=>{
    if(status==='ready'&&focusPoint&&validPoint(focusPoint))mapRef.current?.easeTo({center:[focusPoint.lng,focusPoint.lat],zoom:focusPoint.zoom??13,duration:0});
  },[status,focusPoint]);

  const displayedEpicenter=!!epicenter&&inCoverage(epicenter);
  const displayedGps=!!userLocation&&userLocation.source==='BROWSER_GEOLOCATION'&&userLocation.accuracy_m<=1000&&inCoverage(userLocation);
  const nationwide=()=>{
    fitCountry.current();
  };
  const goRegion=(region:string)=>{
    if(!region){nationwide();return;}
    const [lng,lat,zoom]=region.split(',').map(Number);
    mapRef.current?.easeTo({center:[lng,lat],zoom,duration:0});
  };
  useEffect(()=>{if(status==='ready'&&regionRequest)goRegion(regionRequest.value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[status,regionRequest]);
  const card=showInformation&&legend==='card';
  return <section className={compact?'sim-map-reference sim-map-compact':'sim-map-reference sim-map-full'}
    aria-label={t.title} data-testid="simulation-reference-map">
    <div ref={host} className="sim-map-canvas" aria-hidden="true"/>
    {regionPicker&&<label className="japan-region-picker"><span>{language==='ja'?'地域':language==='en'?'Region':'地區'}</span>
      <select aria-label={mapRegionLabel(language)} defaultValue=""
        disabled={status!=='ready'} onChange={event=>goRegion(event.target.value)}>
        <option value="">{t.overview}</option>
        {MAP_REGIONS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
    </label>}
    <div className={card?'sim-map-information':'sim-map-footnote'}>
      {card&&<>
      <div className="sim-map-maplabel"><strong>{t.title}</strong><small>{officialPack?(language==='ja'?'公式想定データ · 安全性未判定':language==='en'?'Official scenario data · safety undetermined':'官方想定資料 · 安全性未判定'):t.note}</small></div>
      <div className="sim-map-landsea-legend" data-testid="japan-land-sea-legend">
        <span><i className="sim-map-land-color"/>{t.land}</span>
        <span><i className="sim-map-sea-color"/>{t.sea}</span>
        <span><i className="sim-map-road-color"/>{t.roads}</span>
        <span><i className="sim-map-rail-color"/>{t.rail}</span>
        {officialPack&&showInundation&&<span><i style={{background:'#e9ac66'}}/>{language==='ja'?'浸水想定':language==='en'?'Inundation scenario':'浸水想定'}</span>}
        {showIntensityRegions&&<span><i style={{background:'none',width:16,height:0,borderBottom:'1px dashed #a9bac8'}}/>{language==='ja'?'地域最大観測 · 各地点の実測ではない':language==='en'?'Region maximum · not point measurements':'地域最大觀測 · 非逐點實測'}</span>}
        {disasterReference&&showForecastLines&&<><span><i style={{background:'none',width:16,height:0,borderBottom:'3px solid #ed9b7d'}}/>{language==='ja'?'津波電文 · 予報区海岸線':language==='en'?'Tsunami bulletin · coastal line':'海嘯電文 · 預報區海岸線'}</span>
          <span><i style={{background:'none',width:16,height:0,borderBottom:'3px dashed #a6adb5'}}/>{language==='ja'?'過去／未確認／取消':language==='en'?'Old / unverified / cancelled':'舊資料／未核實／取消'}</span></>}
      </div>
      </>}
      {legend==='card'&&<p className="sim-map-quick-caution">{t.shortCaution}</p>}
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
      {card&&<details className="sim-map-details" data-testid="japan-map-details">
        <summary>{t.details}</summary>
        <p className="sim-map-caution">{t.caution}</p>
        <p className="sim-map-detail-ready">{t.ready}</p>
        {seismicOrigins.length>0&&<a href={WAVE_SPEED_SOURCE} target="_blank" rel="noopener noreferrer">{t.waveSource} ↗</a>}
      </details>}
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
