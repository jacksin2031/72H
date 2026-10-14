'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Language } from '@/lib/contracts';
import { SimulationReferenceMap } from '@/components/simulation-reference-map';
import { AppShell } from '@/components/ui';
import { readSavedLanguage } from '@/lib/saved-language';
import { documentedEpicenters } from '@/lib/geospatial-exposure';
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
  const [referencePlaces,setReferencePlaces]=useState<OfficialPlace[]>([]),[viewBounds,setViewBounds]=useState<[number,number,number,number]|null>(null);
  const [referenceRoute,setReferenceRoute]=useState<RoadCandidate|null>(null);
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
  useEffect(()=>{setLanguage(readSavedLanguage('zh-TW'));},[]);
  useEffect(()=>{
    if(process.env.NODE_ENV==='production'&&'serviceWorker' in navigator){
      void navigator.serviceWorker.register('/sw.js').catch(()=>{});
    }
  },[]);
  return <AppShell tab="map" language={language} fullBleed><div className="japan-reference-page japan-official-page">
    <div className="official-hazard-layout"><div className="japan-reference-viewport">
      <SimulationReferenceMap language={language} protectDeviceLocation epicenter={documentedEpicenters[historicCase]??null}
        userLocation={geo.location} referencePoint={manualPoint} officialPack={pack} showInundation={showInundation} showPlaces={showPlaces}
        disasterReference={official.data} forecastLinePack={official.pack} referenceConnected={official.connected} referenceNow={official.now} showForecastLines={showForecastLines}
        intensityRegionPack={official.regions} showIntensityRegions={showIntensityRegions}
        referencePlaces={mapPlaces} viewBounds={viewBounds} referenceRoute={referenceRoute}
        focusPoint={focus} onReferencePoint={choosePoint} onPlace={choosePlace}/>
      <label className="japan-history-picker"><select aria-label={language==='ja'?'過去の地震':language==='en'?'Historical earthquake':'歷史地震'} value={historicCase} onChange={event=>setHistoricCase(event.target.value)}>
        <option value="">{language==='ja'?'過去の震央を表示':language==='en'?'Show historical epicenter':'顯示歷史震央'}</option>
        <option value="tohoku-2011">2011 · 東日本</option><option value="kobe-1995">1995 · 神戶 / 神戸</option>
        <option value="kumamoto-2016">2016 · 熊本</option><option value="iburi-2018">2018 · 北海道</option><option value="noto-2024">2024 · 能登</option>
      </select></label>
    </div><div className="japan-official-sidebar">
      <JapanShelterPanel language={language} onPlaces={setReferencePlaces} onPlace={choosePlace} onRegion={setViewBounds}/>
      <OfficialHazardPanel language={language} pack={pack} loading={loading} error={error} point={point} includePlaceList={false}
      liveReference={<DisasterMapPanel language={language} {...official} showLines={showForecastLines} onLines={setShowForecastLines}
        showRegions={showIntensityRegions} onRegions={setShowIntensityRegions}/>}
      placesReference={<><EvacuationRoutePanel language={language} state={designations} origin={point} onOrigin={choosePoint} onFocus={setFocus} onRoute={setReferenceRoute}/>
        <DesignatedPlacesPanel language={language} state={designations} onPlace={choosePlace}/></>}
      showInundation={showInundation} showPlaces={showPlaces} onInundation={setShowInundation} onPlaces={setShowPlaces}
      onRetry={()=>setAttempt(x=>x+1)} onGPS={()=>{setManualPoint(null);geo.request();}} gpsState={geo.state}
      onClear={()=>{geo.clear();setManualPoint(null);}} onFocus={()=>{
        if(pack?.manifest.bbox){const [w,s,e,n]=pack.manifest.bbox;setFocus({lng:(w+e)/2,lat:(s+n)/2,zoom:10});}
        else if(pack?.places[0])setFocus({lat:pack.places[0].lat,lng:pack.places[0].lng});
      }} onPlace={choosePlace}/></div></div>
  </div></AppShell>;
}
