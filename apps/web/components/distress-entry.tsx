'use client';
import {useEffect,useRef,useState} from 'react';
import type {Language} from '../lib/contracts';
import {loadDesignatedPlaces,selectDesignationPlaces,type DesignatedPlace} from '../lib/designated-places';
import type {DistressScope} from '../lib/distress-api';
import {usableDistressOrigin} from '../lib/distress-guidance';
import {loadSosProfile,type SosProfile} from '../lib/emergency-contacts';
import {loadEvacuationRoadGraph,type RoadGraphPack} from '../lib/evacuation-road-graph';
import {DistressPanel,type DistressSnapshot} from './distress-panel';

export type DistressFix={lat:number;lng:number;accuracy_m:number|null;captured_at:number;manual?:boolean}|null;
/** Below LIVE_LOCATION_MS (2 min) so a fresh fix normally arrives before the current one expires. */
export const LOCATION_REFRESH_MS=90_000;
const EMPTY:SosProfile={contacts:[],needsAssistance:false,mobilityLimited:false};

/** Loads device-local assets once (place pack, road graph only for a tsunami level, SOS profile) and freshness-checks the fix.
 * Uses the place pack directly instead of useDesignatedPlaces() so no opening-status polling runs in emergency power modes. */
export function DistressEntry({snapshot,language,scope,accessKey,fix,onSnapshot,now,refreshLocation}:{snapshot:DistressSnapshot;language:Language;
 scope:DistressScope;accessKey?:string;fix:DistressFix;onSnapshot:(raw:unknown)=>void;now?:number;refreshLocation?:()=>void}){
 const [places,setPlaces]=useState<DesignatedPlace[]|null>(null),[graph,setGraph]=useState<RoadGraphPack|null|undefined>(undefined);
 const [profile,setProfile]=useState<SosProfile>(EMPTY),[wall,setWall]=useState(()=>Date.now());
 const tsunami=snapshot?.distress.level==='OFFICIAL_TSUNAMI',asked=useRef(false);
 useEffect(()=>{
  const abort=new AbortController();
  void loadDesignatedPlaces(AbortSignal.any([abort.signal,AbortSignal.timeout(15_000)])).then(pack=>{if(!abort.signal.aborted)setPlaces(selectDesignationPlaces(pack,'CSV','ALL').places);})
   .catch(()=>{if(!abort.signal.aborted)setPlaces([]);});
  void loadSosProfile().then(p=>{if(!abort.signal.aborted)setProfile(p);});
  const tick=setInterval(()=>setWall(Date.now()),10_000);
  return()=>{abort.abort();clearInterval(tick);};
 },[]);
 useEffect(()=>{
  if(!tsunami||graph!==undefined)return;
  const abort=new AbortController();
  void loadEvacuationRoadGraph(AbortSignal.any([abort.signal,AbortSignal.timeout(15_000)])).then(g=>{if(!abort.signal.aborted)setGraph(g);})
   .catch(()=>{if(!abort.signal.aborted)setGraph(null);});
  return()=>abort.abort();
 },[tsunami,graph]);
 const location=usableDistressOrigin(fix,wall);
 // One fresh fix per opening when permission was already granted; never prompts on its own.
 useEffect(()=>{if(!location&&refreshLocation&&!asked.current){asked.current=true;refreshLocation();}},[location,refreshLocation]);
 // During a tsunami level, keep the origin fresh so "go to X" does not flip to NO_LOCATION mid-walk.
 const refreshRef=useRef(refreshLocation);refreshRef.current=refreshLocation;
 useEffect(()=>{
  if(!tsunami)return;
  const id=setInterval(()=>refreshRef.current?.(),LOCATION_REFRESH_MS);
  return()=>clearInterval(id);
 },[tsunami]);
 return <DistressPanel snapshot={snapshot} language={language} scope={scope} accessKey={accessKey} location={location}
  places={places} graph={tsunami?graph:null} sosProfile={profile} onSnapshot={onSnapshot} now={now}/>;
}
