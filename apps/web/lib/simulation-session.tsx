'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { Language } from './contracts';
import type { DisasterTestInput } from './disaster-test';
import type { Acceleration, TimeMode } from './historical-playback';
import type { SimulationLocation, SimulationConditions } from './simulation-advice';

export type SimulationMilestone = {
  at_jst: string;
  kind: string;
  label: { ja: string; en: string; 'zh-TW': string };
  source_url: string;
  historic_observation: boolean;
  fed_to_safety_core: boolean;
};

export type SimulationLaunch = {
  input: DisasterTestInput;
  language: Language;
  accessKey: string;
  historicalCase: string | null;
  title: string;
  milestones: readonly SimulationMilestone[];
  timeMode: TimeMode;
  acceleratedStart: string;
  acceleration: Acceleration;
  startJst: string;
  endJst: string;
  locationContext?: SimulationLocation | null;
  conditions?: SimulationConditions;
};

type SimulationContext = {
  launch: SimulationLaunch | null;
  startSimulation: (value: SimulationLaunch) => void;
  endSimulation: () => void;
};

const Context = createContext<SimulationContext | null>(null);

/** Volatile only: no URL parameters, cookies, localStorage, IndexedDB or
 * Live persistence. Reloading the page ends the exercise and loses the key. */
export function SimulationProvider({ children }: { children: ReactNode }) {
  const [launch, setLaunch] = useState<SimulationLaunch | null>(null);
  const pathname = usePathname();
  const visitedSimulation = useRef(false);
  useEffect(() => {
    if (pathname === '/simulation') visitedSimulation.current = true;
    else if (visitedSimulation.current) {
      visitedSimulation.current = false;
      setLaunch(null);
    }
  }, [pathname]);
  const startSimulation = useCallback((next: SimulationLaunch) => setLaunch(next), []);
  const endSimulation = useCallback(() => setLaunch(null), []);
  const context = useMemo<SimulationContext>(() => ({
    launch, startSimulation, endSimulation,
  }), [launch, startSimulation, endSimulation]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

export function useSimulationSession(): SimulationContext {
  const value = useContext(Context);
  if (!value) throw new Error('SimulationProvider is required');
  return value;
}
