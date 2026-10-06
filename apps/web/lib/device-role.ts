'use client';

import { useEffect, useState } from 'react';

export type DeviceRole = 'unknown' | 'mobile' | 'desktop';

/** Wait for the viewport before mounting a device-specific scene or its map renderer. */
export function useDeviceRole(): DeviceRole {
  const [role, setRole] = useState<DeviceRole>('unknown');
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setRole(media.matches ? 'mobile' : 'desktop');
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return role;
}
