'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Language } from '@/lib/contracts';
import { SimulationReferenceMap } from '@/components/simulation-reference-map';
import { MAP_REGIONS, mapRegionLabel, mapOverviewLabel } from '@/lib/map-regions';
import { AppShell } from '@/components/ui';
import { MapScreen } from '@/components/map-screen';
import { readSavedLanguage } from '@/lib/saved-language';
import { loadOfficialHazardPack, officialPlaceLocation, type HazardPack, type HazardLocation, type OfficialPlace } from '@/lib/official-hazards';
import { OfficialHazardPanel } from '@/components/official-hazard-panel';
import { JapanShelterPanel } from '@/components/japan-shelter-panel';
import { useSimulationGeo } from '@/lib/use-simulation-geo';
import { useDisasterMap } from '@/lib/use-disaster-map';
import { DisasterMapPanel } from '@/components/disaster-map-panel';
import { useDesignatedPlaces } from '@/lib/use-designated-places';
import { DesignatedPlacesPanel } from '@/components/designated-places-panel';
import {EvacuationRoutePanel} from '@/components/evacuation-route-panel';
import type {RoadCandidate} from '@/lib/evacuation-road-graph';
import { forecastLines } from '@/lib/disaster-map';
import { forecastLegendState, forecastLegendText } from '@/lib/map-legend';
import '@/components/simulation-flat-ui.css';
import '@/components/simulation-map-ui.css';

const screenText={
  'zh-TW':{title:'全日本參考地圖',inundation:'浸水想定',places:'避難場所',lines:'海嘯預報區',regions:'震度地域',
    legendInundation:'浸水想定：官方靜態想定，非即時',legendPlaces:'避難場所：官方指定，開放未核實',legendRegions:'震度地域：地域最大值，非逐點實測',
    note:'僅供參考：不可作避難導航，也不是安全判定',peek:(n:number)=>`附近 ${n} 處指定避難場所`,placesTitle:'避難場所',officialTitle:'官方資料'},
  ja:{title:'日本全国の参考地図',inundation:'浸水想定',places:'避難場所',lines:'津波予報区',regions:'震度地域',
    legendInundation:'浸水想定：公式の静的想定・リアルタイムではない',legendPlaces:'避難場所：公式指定・開設は未確認',legendRegions:'震度地域：地域の最大値・各地点の実測ではない',
    note:'参考情報：避難ナビ・安全判定には使えません',peek:(n:number)=>`付近の指定避難場所 ${n} か所`,placesTitle:'避難場所',officialTitle:'公式情報'},
  en:{title:'All Japan reference map',inundation:'Inundation',places:'Places',lines:'Tsunami areas',regions:'Intensity regions',
    legendInundation:'Inundation: official static scenario, not live',legendPlaces:'Places: official designations, opening unverified',legendRegions:'Intensity regions: regional maxima, not point readings',
    note:'Reference only: not for evacuation navigation or a safety determination',peek:(n:number)=>`${n} designated places nearby`,placesTitle:'Evacuation places',officialTitle:'Official data'},
} as const;

/** Public geography and reviewed official reference data. GPS is opt-in and device-local; no movement authority. */
export default function JapanMapPage() {
  const [language,setLanguage]=useState<Language>('zh-TW'),[languageReady,setLanguageReady]=useState(false);
  const [pack,setPack]=useState<HazardPack|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
  const [showInundation,setShowInundation]=useState(true),[showPlaces,setShowPlaces]=useState(true);
  const [manualPoint,setManualPoint]=useState<HazardLocation|null>(null),[focus,setFocus]=useState<{lat:number;lng:number;zoom?:number}|null>(null);
  const [referencePlaces,setReferencePlaces]=useState<OfficialPlace[]>([]),[viewBounds,setViewBounds]=useState<[number,number,number,number]|null>(null);
  const [referenceRoute,setReferenceRoute]=useState<RoadCandidate|null>(null);
  const [regionRequest,setRegionRequest]=useState<{value:string}|null>(null);
  const geo=useSimulationGeo();
  const [showIntensityRegions,setShowIntensityRegions]=useState(false);
  const official=useDisasterMap(showIntensityRegions);
  const [showForecastLines,setShowForecastLines]=useState(true);
  const designations=useDesignatedPlaces();
  // Ishinomaki role-classified designations first; nationwide GSI shelters in view fill the rest (deduplicated by id).
  const mapPlaces=useMemo(()=>{const seen=new Set<string>();return [...designations.places,...referencePlaces].filter(place=>!seen.has(place.id)&&!!seen.add(place.id));},[designations.places,referencePlaces]);
  const point:HazardLocation|null=geo.location?{...geo.location,source:'GPS'}:manualPoint;
  useEffect(()=>{
    const abort=new AbortController();setLoading(true);setError(false);setPack(null);
    void loadOfficialHazardPack(abort.signal).then(value=>{if(!abort.signal.aborted)setPack(value);})
      .catch(()=>{if(!abort.signal.aborted)setError(true);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[attempt]);
  const choosePoint=useCallback((value:{lat:number;lng:number})=>{
    geo.clear();setManualPoint({...value,source:'MAP_POINT',accuracy_m:0,captured_at:Date.now()});
  },[geo.clear]);
  const choosePlace=useCallback((place:OfficialPlace)=>{
    geo.clear();setManualPoint(officialPlaceLocation(place));setFocus({lat:place.lat,lng:place.lng});
  },[geo.clear]);
  useEffect(()=>{setLanguage(readSavedLanguage('zh-TW'));setLanguageReady(true);},[]);
  useEffect(()=>{
    if(process.env.NODE_ENV==='production'&&'serviceWorker' in navigator){
      void navigator.serviceWorker.register('/sw.js').catch(()=>{});
    }
  },[]);
  const t=screenText[language];
  // The forecast-line legend follows the drawn line states, so expired / unverified / cancelled lines are never called current.
  const lineStates=forecastLines(official.pack??null,official.data??null,official.connected??false,official.now??0).features.map(f=>f.properties.state);
  const legendLines=forecastLegendText(language,forecastLegendState(lineStates));
  const layers=[
    {key:'inundation',label:t.inundation,on:showInundation,toggle:()=>setShowInundation(v=>!v),legend:t.legendInundation},
    {key:'places',label:t.places,on:showPlaces,toggle:()=>setShowPlaces(v=>!v),legend:t.legendPlaces},
    {key:'lines',label:t.lines,on:showForecastLines,toggle:()=>setShowForecastLines(v=>!v),legend:legendLines},
    {key:'regions',label:t.regions,on:showIntensityRegions,toggle:()=>setShowIntensityRegions(v=>!v),legend:t.legendRegions},
  ];
  // One legend line: what each visible layer is, then the page's single navigation / safety note (shown even with every layer off).
  const legend=[...layers.filter(l=>l.on&&(l.key!=='inundation'||pack)).map(l=>l.legend),t.note].join(' · ');
  // Road candidates need an origin: the section appears once a point (GPS, map point or place) is chosen, and stays while a candidate is drawn.
  const routeSection=point||referenceRoute?<EvacuationRoutePanel language={language} state={designations} origin={point} onOrigin={choosePoint} onFocus={setFocus} onRoute={setReferenceRoute}/>:null;
  // Render nothing until the saved language is read, so a ja / en user never sees one frame of zh-TW text (a lazy initialiser would mismatch server HTML).
  if(!languageReady)return null;
  return <AppShell tab="map" language={language} fullBleed>
    <h1 className="ui-visually-hidden">{t.title}</h1>
    <MapScreen language={language}
      map={<SimulationReferenceMap language={language} protectDeviceLocation epicenter={null} legend="none" regionPicker={false} regionRequest={regionRequest}
        userLocation={geo.location} referencePoint={manualPoint} officialPack={pack} showInundation={showInundation} showPlaces={showPlaces}
        disasterReference={official.data} forecastLinePack={official.pack} referenceConnected={official.connected} referenceNow={official.now} showForecastLines={showForecastLines}
        intensityRegionPack={official.regions} showIntensityRegions={showIntensityRegions}
        referencePlaces={mapPlaces} viewBounds={viewBounds} referenceRoute={referenceRoute}
        focusPoint={focus} onReferencePoint={choosePoint} onPlace={choosePlace}/>}
      region={<select aria-label={mapRegionLabel(language)} defaultValue="" onChange={event=>setRegionRequest({value:event.target.value})}>
        <option value="">{mapOverviewLabel(language)}</option>
        {MAP_REGIONS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
      </select>}
      layers={layers.map(({key,label,on,toggle})=>({key,label,on,toggle}))}
      legend={legend}
      peek={t.peek(mapPlaces.length)}
      routeSection={routeSection}
      sections={[
        {title:t.placesTitle,content:<>
          <DesignatedPlacesPanel language={language} state={designations} onPlace={choosePlace}/>
          <JapanShelterPanel language={language} onPlaces={setReferencePlaces} onPlace={choosePlace} onRegion={setViewBounds}/>
        </>},
        {title:t.officialTitle,content:<OfficialHazardPanel language={language} pack={pack} loading={loading} error={error} point={point} includePlaceList={false}
          liveReference={<DisasterMapPanel language={language} {...official} showRegions={showIntensityRegions}/>}
          onRetry={()=>setAttempt(x=>x+1)} onGPS={()=>{setManualPoint(null);geo.request();}} gpsState={geo.state}
          onClear={()=>{geo.clear();setManualPoint(null);}} onFocus={()=>{
            if(pack?.manifest.bbox){const [w,s,e,n]=pack.manifest.bbox;setFocus({lng:(w+e)/2,lat:(s+n)/2,zoom:10});}
            else if(pack?.places[0])setFocus({lat:pack.places[0].lat,lng:pack.places[0].lng});
          }} onPlace={choosePlace}/>},
      ]}/>
  </AppShell>;
}
