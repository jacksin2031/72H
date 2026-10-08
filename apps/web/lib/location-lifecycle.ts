import { CONSERVE_LOCATION_REFRESH_MS, LOCATION_FIX_TIMEOUT_MS } from './location-freshness';

export type LocationPowerMode = 'NORMAL' | 'CONSERVE' | 'EMERGENCY_POWER' | 'SURVIVAL';
export type LocationTrackingMode = 'NONE' | 'WATCH' | 'THROTTLED_ONE_SHOT';
export type LocationTrackingConfig = {
  routeActive: boolean;
  visible: boolean;
  permissionGranted: boolean;
  powerMode: LocationPowerMode;
};

export function locationTrackingMode(config: LocationTrackingConfig): LocationTrackingMode {
  if (!config.routeActive || !config.visible || !config.permissionGranted) return 'NONE';
  if (config.powerMode === 'NORMAL') return 'WATCH';
  if (config.powerMode === 'CONSERVE') return 'THROTTLED_ONE_SHOT';
  return 'NONE';
}

export function shouldRefreshAfterForeground(config: LocationTrackingConfig & {
  freshness: 'CURRENT' | 'AGING' | 'STALE' | 'LAST_KNOWN' | 'UNAVAILABLE';
  permissionDenied: boolean;
}): boolean {
  return config.visible && !config.routeActive && config.permissionGranted && !config.permissionDenied
    && config.powerMode === 'NORMAL' && config.freshness !== 'CURRENT';
}

export function isNewForegroundRevision(revision: number, lastHandled: number): boolean {
  return Number.isInteger(revision) && revision > lastHandled;
}

export type GeolocationPort = Pick<Geolocation, 'getCurrentPosition' | 'watchPosition' | 'clearWatch'>;
export type PermissionStatusPort = Pick<PermissionStatus, 'state' | 'addEventListener' | 'removeEventListener'>;
export type PermissionsPort = Pick<Permissions, 'query'>;
export type TimerPort = Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>;

/** Runs a single explicit browser location request and ignores callbacks after settlement or cleanup. */
export function requestLocationOnce(input: {
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | null | undefined;
  onPosition: PositionCallback;
  onError: PositionErrorCallback;
  onException: (error: unknown) => void;
  onUnsupported: () => void;
}): () => void {
  let active = true;
  const stop = () => { active = false; };
  if (!input.geolocation) {
    active = false;
    input.onUnsupported();
    return stop;
  }
  const options: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: LOCATION_FIX_TIMEOUT_MS };
  try {
    input.geolocation.getCurrentPosition(
      position => { if (active) { active = false; input.onPosition(position); } },
      error => { if (active) { active = false; input.onError(error); } },
      options,
    );
  } catch (error) {
    if (active) { active = false; input.onException(error); }
  }
  return stop;
}

/** Observes an already-granted permission; query is read-only and never prompts the user. */
export function subscribeToGeolocationPermission(permissions: PermissionsPort | null | undefined, onDenied: () => void): () => void {
  if (!permissions) return () => {};
  let closed = false;
  let status: PermissionStatusPort | null = null;
  const onChange = () => { if (!closed && status?.state === 'denied') onDenied(); };
  void permissions.query({ name: 'geolocation' }).then(result => {
    if (closed) return;
    status = result;
    status.addEventListener('change', onChange);
    onChange();
  }).catch(() => { /* Older browsers may expose an incomplete Permissions API. */ });
  return () => {
    closed = true;
    status?.removeEventListener('change', onChange);
    status = null;
  };
}

/** Starts route-scene location work and returns the cleanup that stops every active request. */
export function startLocationTracking(input: {
  mode: LocationTrackingMode;
  geolocation: GeolocationPort;
  onPosition: PositionCallback;
  onError: (error: GeolocationPositionError) => void;
  timers?: TimerPort;
}): () => void {
  const timers = input.timers ?? globalThis;
  if (input.mode === 'NONE') return () => {};

  let stopped = false;
  let watchId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (watchId !== null) input.geolocation.clearWatch(watchId);
    if (timer !== null) timers.clearTimeout(timer);
    watchId = null; timer = null;
  };
  const options: PositionOptions = { enableHighAccuracy: input.mode === 'WATCH', maximumAge: 0, timeout: LOCATION_FIX_TIMEOUT_MS };
  const onError: PositionErrorCallback = error => {
    if (stopped) return;
    input.onError(error);
    // Permission denial is terminal until another explicit user action requests a fix.
    if (error.code === 1) stop();
  };

  if (input.mode === 'WATCH') {
    try {
      const startedWatchId = input.geolocation.watchPosition(position => { if (!stopped) input.onPosition(position); }, onError, options);
      // A test port or browser shim can synchronously report denial before returning the ID.
      if (stopped) input.geolocation.clearWatch(startedWatchId);
      else watchId = startedWatchId;
    } catch (error) {
      stop();
      input.onError(error as GeolocationPositionError);
    }
    return stop;
  }

  const poll = () => {
    if (stopped) return;
    try {
      input.geolocation.getCurrentPosition(position => {
        if (stopped) return;
        input.onPosition(position);
        timer = timers.setTimeout(poll, CONSERVE_LOCATION_REFRESH_MS);
      }, error => {
        if (stopped) return;
        onError(error);
        // Do not create an error retry loop. A deliberate location request or scene re-entry can retry.
        stop();
      }, options);
    } catch (error) {
      onError(error as GeolocationPositionError);
      stop();
    }
  };
  poll();
  return stop;
}
