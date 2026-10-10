'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocationFix } from '@/lib/geospatial-exposure';
import { screenGeoExposure } from '@/lib/geospatial-exposure';

/**
 * One-shot, opt-in, in-memory GPS. Unlike production Live location tracking it
 * does not save into localStorage, cookies, service workers or send coordinates
 * to the server / AI; it clears on leaving the exercise or expiry.
 */
export function useSimulationGeo() {
  const [location,setLocation] = useState<LocationFix|null>(null);
  const [state,setState] = useState<'idle'|'requesting'|'ready'|'error'>('idle');
  const [error,setError] = useState('');
  const requestId=useRef(0);
  const [now,setNow] = useState(()=>Date.now());

  useEffect(()=>{
    const interval=setInterval(()=>setNow(Date.now()),15000);
    return ()=>{ clearInterval(interval); requestId.current++; };
  },[]);
  useEffect(()=>{
    if(location?.source==='BROWSER_GEOLOCATION'&&now-location.captured_at>120000){
      setLocation(null); setState('idle'); setError('');
    }
  },[location,now]);
  const clear=useCallback(()=>{
    requestId.current++; setLocation(null);setState('idle');setError('');
  },[]);
  const request=useCallback(()=>{
    const request=++requestId.current;
    if(typeof navigator==='undefined'||!navigator.geolocation) {
      setState('error');setError('GEOLOCATION_UNAVAILABLE');return;
    }
    setState('requesting');setError('');
    navigator.geolocation.getCurrentPosition(
      pos=>{
        if(request!==requestId.current)return;
        const value:LocationFix={
          lat:pos.coords.latitude,lng:pos.coords.longitude,
          accuracy_m:pos.coords.accuracy,captured_at:pos.timestamp||Date.now(),
          source:'BROWSER_GEOLOCATION',
        };
        const checked=screenGeoExposure({location:value,epicenter:null,tsunamiWarningActive:false,now:Date.now()});
        if(!checked.user_location){setLocation(null);setState('error');setError('UNUSABLE_GPS');return;}
        setLocation(value);setNow(Date.now());setState('ready');
      },
      ()=>{if(request!==requestId.current)return;setLocation(null);setState('error');setError('GEOLOCATION_DENIED_OR_TIMEOUT');},
      {enableHighAccuracy:true,timeout:12000,maximumAge:0},
    );
  },[]);
  return {location,state,error,request,clear};
}
