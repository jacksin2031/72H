'use client';
import {useEffect,useState} from 'react';
import {boundedText,disasterMapSchema,loadForecastLinePack,type DisasterMapReference,type ForecastLinePack} from './disaster-map';
import {loadIntensityRegionPack,type ReviewedIntensityRegionPack} from './intensity-regions';

const CACHE='72h-public-disaster-map-v1',MAX_BYTES=4000000;
const onlineNow=()=>navigator.onLine!==false;
export function useDisasterMap(intensityEnabled=false){
  const [data,setData]=useState<DisasterMapReference|null>(null),[pack,setPack]=useState<ForecastLinePack|null>(null);
  const [connected,setConnected]=useState(false),[loading,setLoading]=useState(true),[geometryError,setGeometryError]=useState(false),[now,setNow]=useState(0);
  const [geometryAttempt,setGeometryAttempt]=useState(0);
  const [regions,setRegions]=useState<ReviewedIntensityRegionPack|null>(null),[regionError,setRegionError]=useState(false),[regionLoading,setRegionLoading]=useState(false),[regionAttempt,setRegionAttempt]=useState(0);
  useEffect(()=>{
    if(!intensityEnabled||regions)return;
    const controller=new AbortController();setRegionError(false);setRegionLoading(true);
    void loadIntensityRegionPack(controller.signal).then(pack=>{if(!controller.signal.aborted)setRegions(pack);})
      .catch(()=>{if(!controller.signal.aborted)setRegionError(true);})
      .finally(()=>{if(!controller.signal.aborted)setRegionLoading(false);});
    return()=>controller.abort();
  },[intensityEnabled,regions,regionAttempt]);
  useEffect(()=>{
    const controller=new AbortController();let disposed=false,request:AbortController|null=null,lastLive:DisasterMapReference|null=null;
    let recoveryRequiredSince:number|null=null;
    setNow(Date.now());
    // Public reference cache is separate from LIVE / REPLAY Safety Core stores.
    // Restored bytes are never treated as current before a successful refresh.
    try{const raw=localStorage.getItem(CACHE);if(raw&&new TextEncoder().encode(raw).length<=MAX_BYTES){
      const cached=disasterMapSchema.parse(JSON.parse(raw));
      if(Date.parse(cached.generated_at)<=Date.now()+5000)setData(cached);
    }}catch{/* Invalid / unavailable local cache carries no map authority. */}
    const poll=async()=>{
      if(disposed||request||!onlineNow())return;
      const active=new AbortController();request=active;
      const timeout=setTimeout(()=>active.abort(),35000);
      try{
        const response=await fetch('/api/reference/disaster-map',{cache:'no-store',signal:active.signal});
        const parsed=disasterMapSchema.parse(JSON.parse((await boundedText(response,MAX_BYTES)).text));
        if(disposed||active.signal.aborted||!onlineNow())return;
        if(Date.parse(parsed.generated_at)>Date.now()+5000)throw Error('Future map reference rejected');
        if(lastLive&&Date.parse(parsed.generated_at)<Date.parse(lastLive.generated_at))throw Error('Late map reference rejected');
        const recovered=recoveryRequiredSince===null||parsed.sources.every(source=>{
          const fetched=source.recovery?.last_successful_fetch_at;
          return fetched!==null&&fetched!==undefined&&Date.parse(fetched)>=recoveryRequiredSince!&&Date.parse(fetched)<=Date.now()+5000;
        });
        lastLive=parsed;setData(parsed);setConnected(recovered);if(recovered)recoveryRequiredSince=null;
        try{localStorage.setItem(CACHE,JSON.stringify(parsed));}catch{/* Quota / storage unavailable: retain in-memory reference only. */}
      }catch{if(!disposed&&request===active){setConnected(false);recoveryRequiredSince??=Date.now();}}
      finally{clearTimeout(timeout);if(request===active)request=null;if(!disposed){setLoading(false);setNow(Date.now());}}
    };
    const offline=()=>{request?.abort();request=null;setConnected(false);setLoading(false);setNow(Date.now());};
    const online=()=>{recoveryRequiredSince=Date.now();setConnected(false);setLoading(true);void poll();};
    window.addEventListener('offline',offline);window.addEventListener('online',online);
    void poll();if(navigator.onLine===false)setLoading(false);
    const refresh=setInterval(()=>void poll(),60000),clock=setInterval(()=>setNow(Date.now()),1000);
    return()=>{disposed=true;controller.abort();request?.abort();clearInterval(refresh);clearInterval(clock);window.removeEventListener('offline',offline);window.removeEventListener('online',online);};
  },[]);
  useEffect(()=>{
    const controller=new AbortController();setGeometryError(false);
    void loadForecastLinePack(controller.signal).then(value=>{if(!controller.signal.aborted)setPack(value);})
      .catch(()=>{if(!controller.signal.aborted)setGeometryError(true);});
    return()=>controller.abort();
  },[geometryAttempt]);
  return {data,pack,connected,loading,geometryError,now,regions,regionError,regionLoading,retryRegions:()=>setRegionAttempt(n=>n+1),retryGeometry:()=>setGeometryAttempt(n=>n+1)};
}
