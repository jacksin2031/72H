'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deviceLocationState, LIVE_LOCATION_MS, LOCATION_RETENTION_MS, newerDevicePosition, readLastLocation, validDevicePosition, writeLastLocation, type DevicePosition } from './last-known-location';

export function useDeviceLocation(online: boolean) {
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [consent, setConsent] = useState(false);
  const [restored, setRestored] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [now, setNow] = useState(0);
  const sequence = useRef(0);
  const positionRef = useRef(position);
  positionRef.current = position;
  useEffect(() => {
    const at = Date.now(); setNow(at);
    try {
      const saved = readLastLocation(localStorage, at);
      setConsent(saved.consent); setPosition(saved.position); setStorageUnavailable(saved.storageUnavailable);
    } catch { setStorageUnavailable(true); }
    setReady(true);
    return () => { sequence.current++; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { writeLastLocation(localStorage, consent, position, Date.now()); }
    catch { setStorageUnavailable(true); }
  }, [ready, consent, position]);
  useEffect(() => {
    if (!position) return;
    const refresh = () => { const at = Date.now(); setNow(at); if (!validDevicePosition(position, at)) setPosition(null); };
    const liveTimer = setTimeout(refresh, Math.max(1, position.captured_at + LIVE_LOCATION_MS - Date.now()));
    const expiryTimer = setTimeout(refresh, Math.max(1, position.captured_at + LOCATION_RETENTION_MS + 1 - Date.now()));
    return () => { clearTimeout(liveTimer); clearTimeout(expiryTimer); };
  }, [position]);
  const retain = useCallback((enabled: boolean) => {
    // Forget synchronously so immediate navigation cannot leave a saved point.
    try { writeLastLocation(localStorage, enabled, enabled ? position : null, Date.now()); }
    catch { setStorageUnavailable(true); }
    setConsent(enabled);
    if (!enabled) { sequence.current++; setBusy(false); setPosition(null); setRestored(true); setFailed(false); }
  }, [position]);
  const locate = useCallback(() => {
    if (!ready || !navigator.geolocation) { setFailed(true); return; }
    setBusy(true); setFailed(false);
    const request = ++sequence.current;
    navigator.geolocation.getCurrentPosition(fix => {
      if (request !== sequence.current) return;
      const at = Date.now();
      const approved = newerDevicePosition({ latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracy_m: fix.coords.accuracy, captured_at: fix.timestamp, source: 'BROWSER_GEOLOCATION' }, positionRef.current, at);
      setBusy(false); setNow(at);
      if (!approved) { setFailed(true); setRestored(true); return; }
      positionRef.current = approved;
      setPosition(approved); setRestored(false);
    }, () => { if (request === sequence.current) { setBusy(false); setFailed(true); setRestored(true); setNow(Date.now()); } }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 });
  }, [ready]);
  return { position, consent, ready, busy, failed, storageUnavailable, state: deviceLocationState(position, restored, online, now || Date.now()), retain, locate };
}
export type DeviceLocation = ReturnType<typeof useDeviceLocation>;
