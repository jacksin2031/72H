'use client';
import {useEffect,useMemo,useState} from 'react';
import {boundedText} from './disaster-map';
import {loadDesignatedPlaces,openingSchema,selectDesignationPlaces,type DesignationPack,type DesignationHazard,type OpeningResponse} from './designated-places';

export function useDesignatedPlaces(){
  const [pack,setPack]=useState<DesignationPack|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
  const [format,setFormat]=useState<'CSV'|'GeoJSON'>('CSV'),[hazard,setHazard]=useState<DesignationHazard>('ALL'),[search,setSearch]=useState('');
  const [opening,setOpening]=useState<OpeningResponse|null>(null),[connected,setConnected]=useState(false),[resumeAt,setResumeAt]=useState(0),[now,setNow]=useState(()=>Date.now());
  useEffect(()=>{
    const abort=new AbortController();setLoading(true);setError(false);setPack(null);
    void loadDesignatedPlaces(abort.signal).then(value=>{if(!abort.signal.aborted)setPack(value);})
      .catch(()=>{if(!abort.signal.aborted)setError(true);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[attempt]);
  useEffect(()=>{
    let generation=0,controller:AbortController|null=null,disposed=false,barrier=Date.now(),lastGenerated=0;
    setResumeAt(barrier);setOpening(null);setConnected(false);
    const refresh=async()=>{
      const call=++generation;controller?.abort();controller=new AbortController();
      if(!navigator.onLine){setConnected(false);return;}
      try{
        const response=await fetch('/api/reference/place-opening/04202',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])});
        const data=openingSchema.parse(JSON.parse((await boundedText(response,512_000)).text)),clock=Date.now();
        const generated=Date.parse(data.generated_at);
        if(data.area_id!=='JP-MUNI-04202'||generated>clock+5000||generated<barrier||generated<lastGenerated)throw Error('Opening response timing/scope invalid');
        if(!disposed&&call===generation&&navigator.onLine){lastGenerated=generated;setOpening(data);setConnected(true);}
      }catch{if(!disposed&&call===generation){barrier=Date.now();setResumeAt(barrier);setOpening(null);setConnected(false);}}
    };
    const offline=()=>{generation++;controller?.abort();barrier=Date.now();setResumeAt(barrier);setConnected(false);};
    const online=()=>{barrier=Date.now();setResumeAt(barrier);setOpening(null);setConnected(false);void refresh();};
    void refresh();const timer=setInterval(()=>{setNow(Date.now());},1000),poll=setInterval(()=>void refresh(),60000);
    window.addEventListener('offline',offline);window.addEventListener('online',online);
    return()=>{disposed=true;generation++;controller?.abort();clearInterval(timer);clearInterval(poll);window.removeEventListener('offline',offline);window.removeEventListener('online',online);};
  },[]);
  const selected=useMemo(()=>pack?selectDesignationPlaces(pack,format,hazard):{places:[],reason:'UNAVAILABLE'},[pack,format,hazard]);
  const places=useMemo(()=>selected.places.filter(p=>`${p.name} ${p.address??''}`.toLowerCase().includes(search.trim().toLowerCase())),[selected.places,search]);
  return {pack,loading,error,retry:()=>setAttempt(x=>x+1),format,setFormat,hazard,setHazard,search,setSearch,places,reason:selected.reason,opening,connected,resumeAt,now};
}
export type DesignatedPlacesState=ReturnType<typeof useDesignatedPlaces>;
