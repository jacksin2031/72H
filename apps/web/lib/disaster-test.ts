import { derivePower, type PowerProjection } from './vnext';

export type DisasterKind = 'EARTHQUAKE' | 'TSUNAMI' | 'TYPHOON' | 'FLOOD' | 'LANDSLIDE' | 'FIRE';
export type TestSeverity = 0 | 1 | 2 | 3 | 4;
export type TestNetwork = 'ONLINE' | 'OFFLINE' | 'RECONNECTING';
export type TestEvidence = 'FRESH' | 'STALE' | 'UNKNOWN';
export type TestMobility = 'ABLE' | 'CANNOT_MOVE';
export type DisasterTestInput = {
  kind: DisasterKind;
  severity: TestSeverity;
  battery: number | null;
  network: TestNetwork;
  evidence: TestEvidence;
  mobility: TestMobility;
};

export const defaultDisasterTest: DisasterTestInput = {
  kind: 'EARTHQUAKE', severity: 2, battery: 60,
  network: 'ONLINE', evidence: 'UNKNOWN', mobility: 'ABLE',
};

export const disasterPresets: { key: string; input: DisasterTestInput }[] = [
  { key: 'routine', input: { ...defaultDisasterTest, severity: 0, battery: 85 } },
  { key: 'moderate', input: { ...defaultDisasterTest, severity: 2, battery: 25, evidence: 'STALE' } },
  { key: 'critical', input: { ...defaultDisasterTest, severity: 4, battery: 10, network: 'OFFLINE', evidence: 'STALE', mobility: 'CANNOT_MOVE' } },
  { key: 'survival', input: { ...defaultDisasterTest, kind: 'TSUNAMI', severity: 4, battery: 3, network: 'RECONNECTING', evidence: 'UNKNOWN' } },
];

export type DisasterTestProjection = {
  presentationMode: 'MONITOR' | 'SAFETY_CHECK' | 'EMERGENCY_PROTECT' | 'SURVIVAL';
  power: PowerProjection;
  critical: boolean;
  requiresSafetyCheck: boolean;
  informationUnverified: boolean;
  networkUsable: boolean;
  mapEnabled: false;
  movementAuthorized: false;
  notificationsSent: false;
  liveSessionModified: false;
};

export function projectDisasterTest(input: DisasterTestInput): DisasterTestProjection {
  const power = derivePower(input.battery, false, 'AUTO');
  const critical = input.severity >= 4;
  const requiresSafetyCheck = input.severity >= 3;
  const networkUsable = input.network === 'ONLINE' && power.allowNonCriticalNetwork;
  // Deliberately fail closed: synthetic inputs are never official safety evidence.
  // FRESH is a simulated label, not authorization to move or to draw a safe route.
  return {
    presentationMode: power.mode === 'SURVIVAL' ? 'SURVIVAL'
      : critical ? 'EMERGENCY_PROTECT'
        : requiresSafetyCheck ? 'SAFETY_CHECK' : 'MONITOR',
    power, critical, requiresSafetyCheck,
    informationUnverified: input.evidence !== 'FRESH' || input.network !== 'ONLINE',
    networkUsable,
    mapEnabled: false, movementAuthorized: false, notificationsSent: false, liveSessionModified: false,
  };
}
