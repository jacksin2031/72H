'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Language } from '@/lib/contracts';
import { SimulationReferenceMap } from '@/components/simulation-reference-map';
import { UiIcon } from '@/components/ui-icon';
import { documentedEpicenters } from '@/lib/geospatial-exposure';
import { loadOfficialHazardPack, officialPlaceLocation, type HazardPack, type HazardLocation, type OfficialPlace } from '@/lib/official-hazards';
import { OfficialHazardPanel } from '@/components/official-hazard-panel';
import { useSimulationGeo } from '@/lib/use-simulation-geo';
import { useDisasterMap } from '@/lib/use-disaster-map';
import { DisasterMapPanel } from '@/components/disaster-map-panel';
import { useDesignatedPlaces } from '@/lib/use-designated-places';
import { DesignatedPlacesPanel } from '@/components/designated-places-panel';
import '@/components/simulation-flat-ui.css';
import '@/components/simulation-geo.css';
import '@/components/simulation-map-ui.css';
import '@/components/official-hazard.css';

/** Public geography and reviewed official reference data. GPS is opt-in and device-local; no movement authority. */
export default function JapanMapPage() {
  const [language,setLanguage]=useState<Language>('zh-TW');
  const [historicCase,setHistoricCase]=useState('');
  const [pack,setPack]=useState<HazardPack|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
  const [showInundation,setShowInundation]=useState(true),[showPlaces,setShowPlaces]=useState(true);
  const [manualPoint,setManualPoint]=useState<HazardLocation|null>(null),[focus,setFocus]=useState<{lat:number;lng:number;zoom?:number}|null>(null);
  const geo=useSimulationGeo();
  const [showIntensityRegions,setShowIntensityRegions]=useState(false);
  const official=useDisasterMap(showIntensityRegions);
  const [showForecastLines,setShowForecastLines]=useState(true);
  const designations=useDesignatedPlaces();
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
  useEffect(()=>{
    if(process.env.NODE_ENV==='production'&&'serviceWorker' in navigator){
      void navigator.serviceWorker.register('/sw.js').catch(()=>{});
    }
  },[]);
  return <main className="japan-reference-page japan-official-page">
    <header><Link href="/more" aria-label={language==='ja'?'戻る':language==='en'?'Back':'返回'}><UiIcon name="arrow" /></Link>
      <strong>{language==='ja'?'日本全国の参考地図':language==='en'?'All Japan reference map':'全日本參考地圖'}</strong>
      <select aria-label="Language" value={language} onChange={event=>setLanguage(event.target.value as Language)}>
        <option value="zh-TW">繁體中文</option><option value="ja">日本語</option><option value="en">English</option>
      </select>
    </header>
    <div className="official-hazard-layout"><div className="japan-reference-viewport">
      <SimulationReferenceMap language={language} protectDeviceLocation epicenter={documentedEpicenters[historicCase]??null}
        userLocation={geo.location} referencePoint={manualPoint} officialPack={pack} showInundation={showInundation} showPlaces={showPlaces}
        disasterReference={official.data} forecastLinePack={official.pack} referenceConnected={official.connected} referenceNow={official.now} showForecastLines={showForecastLines}
        intensityRegionPack={official.regions} showIntensityRegions={showIntensityRegions}
        referencePlaces={designations.places}
        focusPoint={focus} onReferencePoint={choosePoint} onPlace={choosePlace}/>
      <label className="japan-history-picker"><select aria-label={language==='ja'?'過去の地震':language==='en'?'Historical earthquake':'歷史地震'} value={historicCase} onChange={event=>setHistoricCase(event.target.value)}>
        <option value="">{language==='ja'?'過去の震央を表示':language==='en'?'Show historical epicenter':'顯示歷史震央'}</option>
        <option value="tohoku-2011">2011 · 東日本</option><option value="kobe-1995">1995 · 神戶 / 神戸</option>
        <option value="kumamoto-2016">2016 · 熊本</option><option value="iburi-2018">2018 · 北海道</option><option value="noto-2024">2024 · 能登</option>
      </select></label>
    </div><OfficialHazardPanel language={language} pack={pack} loading={loading} error={error} point={point}
      liveReference={<DisasterMapPanel language={language} {...official} showLines={showForecastLines} onLines={setShowForecastLines}
        showRegions={showIntensityRegions} onRegions={setShowIntensityRegions}/>}
      placesReference={<DesignatedPlacesPanel language={language} state={designations} onPlace={choosePlace}/>}
      showInundation={showInundation} showPlaces={showPlaces} onInundation={setShowInundation} onPlaces={setShowPlaces}
      onRetry={()=>setAttempt(x=>x+1)} onGPS={()=>{setManualPoint(null);geo.request();}} gpsState={geo.state}
      onClear={()=>{geo.clear();setManualPoint(null);}} onFocus={()=>{
        if(pack?.manifest.bbox){const [w,s,e,n]=pack.manifest.bbox;setFocus({lng:(w+e)/2,lat:(s+n)/2,zoom:10});}
        else if(pack?.places[0])setFocus({lat:pack.places[0].lat,lng:pack.places[0].lng});
      }} onPlace={choosePlace}/></div>
  </main>;
}
