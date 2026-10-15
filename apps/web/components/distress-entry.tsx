'use client';
import {useEffect,useRef,useState} from 'react';
import type {Language} from '../lib/contracts';
import {loadDesignatedPlaces,selectDesignationPlaces,type DesignatedPlace} from '../lib/designated-places';
import type {DistressScope} from '../lib/distress-api';
import {keepsLocationFresh,usableDistressOrigin} from '../lib/distress-guidance';
import {loadSosProfile,type SosProfile} from '../lib/emergency-contacts';
import {EVACUATION_ROAD_BOUNDS,ishinomakiReferenceGraph,loadEvacuationRoadGraph} from '../lib/evacuation-road-graph';
import {isWithinBounds,type RoadReferenceGraph} from '../lib/road-graph-core';
import {loadRoadTilesAround,tileIdFor} from '../lib/road-tiles';
import {DistressPanel,type DistressSnapshot} from './distress-panel';

export type DistressFix={lat:number;lng:number;accuracy_m:number|null;captured_at:number;manual?:boolean}|null;
/** Below LIVE_LOCATION_MS (2 min) so a fresh fix normally arrives before the current one expires. */
export const LOCATION_REFRESH_MS=90_000;
const EMPTY:SosProfile={contacts:[],needsAssistance:false,mobilityLimited:false};

/** Loads device-local assets once (place pack, SOS profile) and freshness-checks the fix.
 * Uses the place pack directly instead of useDesignatedPlaces() so no opening-status polling runs in emergency power modes.
 * protectDeviceLocation (default true): the fix never leaves the device, so reachability uses no road graph (straight-line estimate).
 * Only an explicitly unprotected fix, during a tsunami level, loads the road tiles around it; the verified Ishinomaki pack replaces
 * them only inside its exact bounds and only when tiles are temporarily / offline unavailable (never TOO_DENSE, INVALID_DATA, NO_ROADS).
 * The fix itself always stays the panel's location; no map point replaces it. */
export function DistressEntry({snapshot,language,scope,accessKey,fix,onSnapshot,now,refreshLocation,protectDeviceLocation=true}:{snapshot:DistressSnapshot;language:Language;
 scope:DistressScope;accessKey?:string;fix:DistressFix;onSnapshot:(raw:unknown)=>void;now?:number;refreshLocation?:()=>void;protectDeviceLocation?:boolean}){
 const [places,setPlaces]=useState<DesignatedPlace[]|null>(null),[road,setRoad]=useState<{graph:RoadReferenceGraph|null}|null>(null);
 const [profile,setProfile]=useState<SosProfile>(EMPTY),[wall,setWall]=useState(()=>Date.now());
 const tsunami=snapshot?.distress.level==='OFFICIAL_TSUNAMI',keepFresh=!!snapshot&&keepsLocationFresh(snapshot.distress.level),asked=useRef(false);
 useEffect(()=>{
  const abort=new AbortController();
  void loadDesignatedPlaces(AbortSignal.any([abort.signal,AbortSignal.timeout(15_000)])).then(pack=>{if(!abort.signal.aborted)setPlaces(selectDesignationPlaces(pack,'CSV','ALL').places);})
   .catch(()=>{if(!abort.signal.aborted)setPlaces([]);});
  void loadSosProfile().then(p=>{if(!abort.signal.aborted)setProfile(p);});
  const tick=setInterval(()=>setWall(Date.now()),10_000);
  return()=>{abort.abort();clearInterval(tick);};
 },[]);
 const location=usableDistressOrigin(fix,wall);
 // Reloaded per centre tile, not per fix, so a 90 s refresh inside the same tile requests nothing.
 const tile=tsunami&&!protectDeviceLocation&&location?tileIdFor(location.lat,location.lng):'';
 const locationRef=useRef(location);locationRef.current=location;
 useEffect(()=>{
  const origin=locationRef.current;
  if(!tile||!origin)return;
  const abort=new AbortController(),signal=AbortSignal.any([abort.signal,AbortSignal.timeout(15_000)]);
  void (async()=>{
   let graph:RoadReferenceGraph|null=null;
   try{
    const tiles=await loadRoadTilesAround({lat:origin.lat,lng:origin.lng},{signal});
    if(tiles.status==='READY')graph=tiles.graph;
    else if((tiles.reason==='TEMPORARILY_UNAVAILABLE'||tiles.reason==='OFFLINE_NO_DATA')&&isWithinBounds(origin,EVACUATION_ROAD_BOUNDS))
     graph=ishinomakiReferenceGraph(await loadEvacuationRoadGraph(signal));
   }catch{graph=null;}
   if(!abort.signal.aborted)setRoad({graph});
  })();
  return()=>abort.abort();
 },[tile]);
 // A previous tile's graph stays usable while the next loads: reachability only routes inside the graph's own bounds.
 const graph=tile?road?road.graph:undefined:null;
 // One fresh fix per opening when permission was already granted; never prompts on its own.
 useEffect(()=>{if(!location&&refreshLocation&&!asked.current){asked.current=true;refreshLocation();}},[location,refreshLocation]);
 // During an official tsunami level (live or stale), keep the origin fresh so "go to X" does not flip to NO_LOCATION
 // mid-walk and the server's area check does not lapse.
 const refreshRef=useRef(refreshLocation);refreshRef.current=refreshLocation;
 useEffect(()=>{
  if(!keepFresh)return;
  const id=setInterval(()=>refreshRef.current?.(),LOCATION_REFRESH_MS);
  return()=>clearInterval(id);
 },[keepFresh]);
 return <DistressPanel snapshot={snapshot} language={language} scope={scope} accessKey={accessKey} location={location}
  places={places} graph={graph} sosProfile={profile} onSnapshot={onSnapshot} now={now}/>;
}
