'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { derivePower } from './vnext';

const overrideSchema = z.enum(['AUTO', 'CONSERVE', 'EMERGENCY_POWER', 'SURVIVAL']);
type Battery = EventTarget & { level: number; charging: boolean };
export function usePower() {
  const [level, setLevel] = useState<number | null>(null);
  const [charging, setCharging] = useState(false);
  const [override, setOverride] = useState<z.infer<typeof overrideSchema>>('AUTO');
  useEffect(() => {
    try { const saved = overrideSchema.safeParse(localStorage.getItem('72h-power')); if (saved.success) setOverride(saved.data); } catch { /* Manual mode remains available in memory. */ }
    let cancelled = false;
    let battery: Battery | undefined;
    const update = () => { if (!cancelled && battery) { setLevel(battery.level * 100); setCharging(battery.charging); } };
    const navigatorWithBattery = navigator as Navigator & { getBattery?: () => Promise<Battery> };
    if (navigatorWithBattery.getBattery) void navigatorWithBattery.getBattery().then(value => {
      if (cancelled) return;
      battery = value; update(); battery.addEventListener('levelchange', update); battery.addEventListener('chargingchange', update);
    }).catch(() => { if (!cancelled) setLevel(null); });
    return () => { cancelled = true; battery?.removeEventListener('levelchange', update); battery?.removeEventListener('chargingchange', update); };
  }, []);
  const choose = (value: string) => {
    const parsed = overrideSchema.safeParse(value); if (!parsed.success) return;
    setOverride(parsed.data); try { localStorage.setItem('72h-power', parsed.data); } catch { /* In-memory fallback. */ }
  };
  return { power: derivePower(level, charging, override), level, charging, override, choose };
}
