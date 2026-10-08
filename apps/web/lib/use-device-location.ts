'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deviceLocationState, readLastLocation, validDevicePosition, writeLastLocation, type DevicePosition } from './last-known-location';
import { approveCurrentDevicePosition, locationFreshness, nextLocationFreshnessDeadline, type LocationFreshness } from './location-freshness';
import { isNewForegroundRevision, locationTrackingMode, requestLocationOnce, shouldRefreshAfterForeground, startLocationTracking, subscribeToGeolocationPermission, type LocationPowerMode } from './location-lifecycle';

export type DeviceLocationOptions = { powerMode?: LocationPowerMode; routeActive?: boolean };

export function useDeviceLocation(online: boolean, options: DeviceLocationOptions = {}) {
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [consent, setConsent] = useState(false);
  const [restored, setRestored] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [visible, setVisible] = useState(false);
  const [foregroundRevision, setForegroundRevision] = useState(0);
  const [now, setNow] = useState(0);
  const sequence = useRef(0);
  const pendingLocate = useRef<{ request: number; resolve: (position: DevicePosition | null) => void; cancel?: () => void } | null>(null);
  const stopTracking = useRef<(() => void) | null>(null);
  const lastForegroundRefresh = useRef(0);
  const positionRef = useRef(position);
  positionRef.current = position;

  const revokePermission = useCallback(() => {
    sequence.current++;
    const pending = pendingLocate.current;
    pendingLocate.current = null;
    pending?.cancel?.();
    pending?.resolve(null);
    stopTracking.current?.();
    stopTracking.current = null;
    setBusy(false); setFailed(true); setPermissionGranted(false); setPermissionDenied(true);
  }, []);

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
    let wasVisible = false;
    const updateVisibility = () => {
      const next = document.visibilityState !== 'hidden';
      if (next && !wasVisible) setForegroundRevision(value => value + 1);
      if (!next && wasVisible) {
        sequence.current++;
        const pending = pendingLocate.current;
        pendingLocate.current = null;
        pending?.cancel?.();
        pending?.resolve(null);
        stopTracking.current?.();
        stopTracking.current = null;
        setBusy(false);
      }
      wasVisible = next;
      setVisible(next);
      setNow(Date.now());
    };
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      sequence.current++;
      const pending = pendingLocate.current;
      pendingLocate.current = null;
      pending?.cancel?.();
      pending?.resolve(null);
      stopTracking.current?.();
      stopTracking.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { writeLastLocation(localStorage, consent, position, Date.now()); }
    catch { setStorageUnavailable(true); }
  }, [ready, consent, position]);

  useEffect(() => {
    if (!position) return;
    const at = now || Date.now();
    const deadline = nextLocationFreshnessDeadline(position, restored, at);
    if (!deadline) return;
    const timer = setTimeout(() => {
      const capturedNow = Date.now(); setNow(capturedNow);
      if (!validDevicePosition(position, capturedNow)) { positionRef.current = null; setPosition(null); setRestored(true); }
    }, Math.max(1, deadline - at));
    return () => clearTimeout(timer);
  }, [position, restored, now]);

  const recordFix = useCallback((fix: GeolocationPosition): DevicePosition | null => {
    const at = Date.now();
    const input = { latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracy_m: fix.coords.accuracy,
      captured_at: fix.timestamp, source: 'BROWSER_GEOLOCATION' as const };
    const approved = approveCurrentDevicePosition(input, positionRef.current, at);
    setNow(at); setBusy(false); setPermissionGranted(true);
    if (!approved) { setFailed(true); return null; }
    positionRef.current = approved;
    setPosition(approved); setRestored(false); setFailed(false); setPermissionDenied(false);
    return approved;
  }, []);

  const failFix = useCallback((error: GeolocationPositionError) => {
    setBusy(false); setFailed(true); setNow(Date.now());
    if (error.code === 1) revokePermission();
  }, [revokePermission]);

  useEffect(() => {
    if (!permissionGranted || !navigator.permissions?.query) return;
    return subscribeToGeolocationPermission(navigator.permissions, revokePermission);
  }, [permissionGranted, revokePermission]);

  const retain = useCallback((enabled: boolean) => {
    // Forget synchronously so immediate navigation cannot leave a saved point.
    try { writeLastLocation(localStorage, enabled, enabled ? positionRef.current : null, Date.now()); }
    catch { setStorageUnavailable(true); }
    setConsent(enabled);
    if (!enabled) {
      sequence.current++;
      const pending = pendingLocate.current; pendingLocate.current = null; pending?.cancel?.(); pending?.resolve(null);
      stopTracking.current?.(); stopTracking.current = null;
      positionRef.current = null; setBusy(false); setPosition(null); setRestored(true); setFailed(false); setPermissionGranted(false);
    }
  }, []);

  const locate = useCallback((): Promise<DevicePosition | null> => {
    if (!ready) { setFailed(true); return Promise.resolve(null); }
    setBusy(true); setFailed(false); setPermissionDenied(false);
    const request = ++sequence.current;
    return new Promise(resolve => {
      const previous = pendingLocate.current; pendingLocate.current = null; previous?.cancel?.(); previous?.resolve(null);
      pendingLocate.current = { request, resolve };
      const settle = (value: DevicePosition | null) => {
        if (pendingLocate.current?.request === request) pendingLocate.current = null;
        resolve(value);
      };
      const finish = (fix: GeolocationPosition) => {
        if (request !== sequence.current) { settle(null); return; }
        settle(recordFix(fix));
      };
      const fail = (error: GeolocationPositionError) => {
        if (request !== sequence.current) { settle(null); return; }
        failFix(error); settle(null);
      };
      const cancel = requestLocationOnce({ geolocation: navigator.geolocation, onPosition: finish, onError: fail,
        onUnsupported: () => { if (request === sequence.current) { setBusy(false); setFailed(true); settle(null); } },
        onException: error => {
          if (request !== sequence.current) { settle(null); return; }
          setBusy(false); setFailed(true); settle(null);
          if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) revokePermission();
        },
      });
      if (pendingLocate.current?.request === request) pendingLocate.current.cancel = cancel;
    });
  }, [ready, recordFix, failFix, revokePermission]);

  const powerMode = options.powerMode ?? 'NORMAL';
  const routeActive = options.routeActive ?? false;
  const trackingMode = locationTrackingMode({ routeActive, visible,
    permissionGranted, powerMode });
  useEffect(() => {
    if (!ready || permissionDenied || trackingMode === 'NONE') return;
    const geolocation = navigator.geolocation;
    if (!geolocation) { setFailed(true); return; }
    const trackingRequest = ++sequence.current;
    const stop = startLocationTracking({ mode: trackingMode, geolocation,
      onPosition: fix => { if (trackingRequest === sequence.current) recordFix(fix); },
      onError: error => { if (trackingRequest === sequence.current) failFix(error); } });
    stopTracking.current = stop;
    return () => { sequence.current++; stop(); if (stopTracking.current === stop) stopTracking.current = null; };
  }, [ready, permissionDenied, trackingMode, recordFix, failFix]);

  useEffect(() => {
    if (!isNewForegroundRevision(foregroundRevision, lastForegroundRefresh.current)) return;
    lastForegroundRefresh.current = foregroundRevision;
    if (!ready || !shouldRefreshAfterForeground({ routeActive, visible, permissionGranted, powerMode,
      freshness: locationFreshness(positionRef.current, restored, Date.now()), permissionDenied })) return;
    void locate();
  }, [foregroundRevision, ready, visible, routeActive, permissionGranted, permissionDenied, powerMode, position, restored, locate]);

  const at = now || Date.now();
  const state = deviceLocationState(position, restored, online, at);
  const freshness: LocationFreshness = locationFreshness(position, restored, at);
  return { position, consent, ready, busy, failed, permissionDenied, permissionGranted, storageUnavailable,
    state, freshness, now: at, retain, locate };
}

export type DeviceLocation = ReturnType<typeof useDeviceLocation>;
