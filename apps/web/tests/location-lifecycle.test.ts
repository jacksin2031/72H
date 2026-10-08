import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSERVE_LOCATION_REFRESH_MS, LOCATION_FIX_TIMEOUT_MS } from '../lib/location-freshness';
import { isNewForegroundRevision, locationTrackingMode, requestLocationOnce, shouldRefreshAfterForeground, startLocationTracking, subscribeToGeolocationPermission, type GeolocationPort, type PermissionsPort } from '../lib/location-lifecycle';

const position = { timestamp: 1_800_000_000_000, coords: { latitude: 35.68, longitude: 139.76, accuracy: 20 } } as GeolocationPosition;
const error = (code: number) => ({ code, message: 'location unavailable', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) as GeolocationPositionError;

afterEach(() => vi.useRealTimers());

describe('location tracking lifecycle', () => {
  it('uses no tracker outside an active permitted route map and follows power mode', () => {
    expect(locationTrackingMode({ routeActive: false, visible: true, permissionGranted: true, powerMode: 'NORMAL' })).toBe('NONE');
    expect(locationTrackingMode({ routeActive: true, visible: false, permissionGranted: true, powerMode: 'NORMAL' })).toBe('NONE');
    expect(locationTrackingMode({ routeActive: true, visible: true, permissionGranted: false, powerMode: 'NORMAL' })).toBe('NONE');
    expect(locationTrackingMode({ routeActive: true, visible: true, permissionGranted: true, powerMode: 'NORMAL' })).toBe('WATCH');
    expect(locationTrackingMode({ routeActive: true, visible: true, permissionGranted: true, powerMode: 'CONSERVE' })).toBe('THROTTLED_ONE_SHOT');
    expect(locationTrackingMode({ routeActive: true, visible: true, permissionGranted: true, powerMode: 'EMERGENCY_POWER' })).toBe('NONE');
    expect(locationTrackingMode({ routeActive: true, visible: true, permissionGranted: true, powerMode: 'SURVIVAL' })).toBe('NONE');
  });

  it('allows one aging foreground refresh only after permission, in normal power and outside a route map', () => {
    const base = { routeActive: false, visible: true, permissionGranted: true, permissionDenied: false, powerMode: 'NORMAL' as const };
    expect(shouldRefreshAfterForeground({ ...base, freshness: 'AGING' })).toBe(true);
    expect(shouldRefreshAfterForeground({ ...base, freshness: 'STALE' })).toBe(true);
    expect(shouldRefreshAfterForeground({ ...base, freshness: 'UNAVAILABLE' })).toBe(true);
    expect(shouldRefreshAfterForeground({ ...base, freshness: 'CURRENT' })).toBe(false);
    expect(shouldRefreshAfterForeground({ ...base, permissionGranted: false, freshness: 'STALE' })).toBe(false);
    expect(shouldRefreshAfterForeground({ ...base, permissionDenied: true, freshness: 'STALE' })).toBe(false);
    expect(shouldRefreshAfterForeground({ ...base, routeActive: true, freshness: 'STALE' })).toBe(false);
    expect(shouldRefreshAfterForeground({ ...base, visible: false, freshness: 'STALE' })).toBe(false);
    expect(shouldRefreshAfterForeground({ ...base, powerMode: 'CONSERVE', freshness: 'STALE' })).toBe(false);
    expect(shouldRefreshAfterForeground({ ...base, powerMode: 'EMERGENCY_POWER', freshness: 'STALE' })).toBe(false);
    expect(shouldRefreshAfterForeground({ ...base, powerMode: 'SURVIVAL', freshness: 'STALE' })).toBe(false);
  });

  it('creates a refresh opportunity only for a new foreground revision', () => {
    expect(isNewForegroundRevision(1, 0)).toBe(true);
    expect(isNewForegroundRevision(1, 1)).toBe(false);
    expect(isNewForegroundRevision(2, 1)).toBe(true);
    expect(isNewForegroundRevision(0, 0)).toBe(false);
  });

  it('handles successful, denied, unavailable and timed-out one-shot results exactly once', () => {
    for (const code of [1, 2, 3]) {
      let failure: PositionErrorCallback | undefined;
      const onPosition = vi.fn(); const onError = vi.fn(); const onException = vi.fn();
      const geolocation = { getCurrentPosition: (_success: PositionCallback, fail: PositionErrorCallback, options: PositionOptions) => {
        failure = fail; expect(options).toMatchObject({ enableHighAccuracy: true, maximumAge: 0, timeout: LOCATION_FIX_TIMEOUT_MS });
      } };
      requestLocationOnce({ geolocation, onPosition, onError, onException, onUnsupported: () => {} });
      failure?.(error(code)); failure?.(error(code));
      expect(onError).toHaveBeenCalledOnce();
      expect(onPosition).not.toHaveBeenCalled();
      expect(onException).not.toHaveBeenCalled();
    }

    let success: PositionCallback | undefined;
    const onPosition = vi.fn();
    requestLocationOnce({ geolocation: { getCurrentPosition: callback => { success = callback; } }, onPosition,
      onError: () => {}, onException: () => {}, onUnsupported: () => {} });
    success?.(position); success?.(position);
    expect(onPosition).toHaveBeenCalledOnce();
  });

  it('reports unsupported geolocation and ignores callbacks after request cleanup', () => {
    const unsupported = vi.fn();
    requestLocationOnce({ geolocation: undefined, onPosition: () => {}, onError: () => {}, onException: () => {}, onUnsupported: unsupported });
    expect(unsupported).toHaveBeenCalledOnce();

    let success: PositionCallback | undefined;
    const onPosition = vi.fn(); const onError = vi.fn();
    const stop = requestLocationOnce({ geolocation: { getCurrentPosition: callback => { success = callback; } }, onPosition,
      onError, onException: () => {}, onUnsupported: () => {} });
    stop(); success?.(position);
    expect(onPosition).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('stops observing when browser permission changes to denied', async () => {
    let listener: EventListener | undefined;
    let state: PermissionState = 'granted';
    const remove = vi.fn();
    const permissionStatus = {
      get state() { return state; },
      addEventListener: (_type: string, callback: EventListener) => { listener = callback; },
      removeEventListener: remove,
    } as unknown as PermissionStatus;
    const permissions = { query: vi.fn().mockResolvedValue(permissionStatus) } as unknown as PermissionsPort;
    const onDenied = vi.fn();
    const stop = subscribeToGeolocationPermission(permissions, onDenied);
    await Promise.resolve(); await Promise.resolve();
    state = 'denied'; listener?.(new Event('change'));
    expect(onDenied).toHaveBeenCalledOnce();
    stop(); listener?.(new Event('change'));
    expect(remove).toHaveBeenCalledOnce();
    expect(onDenied).toHaveBeenCalledOnce();
  });

  it('throttles successful conserve fixes to at most one every 30 seconds and stops on cleanup', () => {
    vi.useFakeTimers();
    let requests = 0; let cleared: number | null = null; const fixes: GeolocationPosition[] = [];
    const geolocation = {
      getCurrentPosition: (success: PositionCallback, _failure: PositionErrorCallback, options: PositionOptions) => {
        requests++; expect(options.timeout).toBe(LOCATION_FIX_TIMEOUT_MS); success(position);
      },
      watchPosition: () => 1,
      clearWatch: (id: number) => { cleared = id; },
    } as unknown as GeolocationPort;
    const stop = startLocationTracking({ mode: 'THROTTLED_ONE_SHOT', geolocation, onPosition: fix => fixes.push(fix), onError: () => {} });
    expect(requests).toBe(1);
    expect(fixes).toHaveLength(1);
    vi.advanceTimersByTime(CONSERVE_LOCATION_REFRESH_MS - 1);
    expect(requests).toBe(1);
    vi.advanceTimersByTime(1);
    expect(requests).toBe(2);
    stop(); vi.advanceTimersByTime(CONSERVE_LOCATION_REFRESH_MS * 2);
    expect(requests).toBe(2);
    expect(cleared).toBeNull();
  });

  it('stops conserve refresh after an error instead of retrying in a loop', () => {
    vi.useFakeTimers();
    let requests = 0; const errors: GeolocationPositionError[] = [];
    const geolocation = {
      getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) => { requests++; failure(error(2)); },
      watchPosition: () => 1,
      clearWatch: () => {},
    } as unknown as GeolocationPort;
    startLocationTracking({ mode: 'THROTTLED_ONE_SHOT', geolocation, onPosition: () => {}, onError: value => errors.push(value) });
    vi.advanceTimersByTime(CONSERVE_LOCATION_REFRESH_MS * 3);
    expect(requests).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('clears watch IDs on cleanup and handles synchronous permission denial before ID return', () => {
    const cleared: number[] = [];
    const geolocation = {
      getCurrentPosition: () => {},
      watchPosition: (_success: PositionCallback, failure: PositionErrorCallback) => { failure(error(1)); return 9; },
      clearWatch: (id: number) => cleared.push(id),
    } as unknown as GeolocationPort;
    startLocationTracking({ mode: 'WATCH', geolocation, onPosition: () => {}, onError: () => {} });
    expect(cleared).toEqual([9]);

    const laterCleared: number[] = [];
    let latePosition: PositionCallback | undefined;
    const onPosition = vi.fn();
    const active = { ...geolocation, watchPosition: (success: PositionCallback) => { latePosition = success; return 17; }, clearWatch: (id: number) => laterCleared.push(id) } as unknown as GeolocationPort;
    const stop = startLocationTracking({ mode: 'WATCH', geolocation: active, onPosition, onError: () => {} });
    stop(); latePosition?.(position);
    expect(laterCleared).toEqual([17]);
    expect(onPosition).not.toHaveBeenCalled();
  });
});
