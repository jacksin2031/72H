// Presentation rules shared by Live and the exercise replay for the Now screen's hero and status band.
// Every input is already-derived state (server distress level, projections); nothing here decides safety.
import type { DistressStatus, Language } from './contracts';
import { distressText } from './distress';
import { degradeExpiredOfficial } from './distress-guidance';

const ALERT_NAMES: Record<Language, Record<'MAJOR_WARNING' | 'WARNING' | 'ADVISORY' | 'GENERIC', string>> = {
  'zh-TW': { MAJOR_WARNING: '大津波警報', WARNING: '津波警報', ADVISORY: '津波注意報', GENERIC: '海嘯' },
  ja: { MAJOR_WARNING: '大津波警報', WARNING: '津波警報', ADVISORY: '津波注意報', GENERIC: '津波' },
  en: { MAJOR_WARNING: 'Major Tsunami Warning', WARNING: 'Tsunami Warning', ADVISORY: 'Tsunami Advisory', GENERIC: 'Tsunami' },
};

export type OfficialAlert = { name: string; deadlineAt: number | null };

/** The official tsunami level in force (server-set OFFICIAL_TSUNAMI from verified evidence, not past its expiry).
 *  deadlineAt is the real estimated arrival, only while it is still ahead. */
export function officialAlert(distress: DistressStatus, now: number, language: Language): OfficialAlert | null {
  const current = degradeExpiredOfficial(distress, now);
  if (current.level !== 'OFFICIAL_TSUNAMI') return null;
  const names = ALERT_NAMES[language];
  const cls = current.warning_class;
  const name = cls === 'MAJOR_WARNING' || cls === 'WARNING' || cls === 'ADVISORY' ? names[cls] : names.GENERIC;
  const deadline = current.deadline_at ? Date.parse(current.deadline_at) : NaN;
  return { name, deadlineAt: Number.isFinite(deadline) && deadline > now ? deadline : null };
}

/** "No active alerts" is a claim about the world: only with a current primary source, a live verified connection,
 *  no plan, no active event and no distress level. */
export function noActiveAlertsAllowed(i: { hasPlan: boolean; activeEventCount: number; distressLevel: DistressStatus['level'];
  connection: 'online' | 'offline' | 'reconnecting'; networkState: string; primarySourceCurrent: boolean }) {
  return !i.hasPlan && i.activeEventCount === 0 && i.distressLevel === 'NONE' && i.connection === 'online'
    && i.networkState === 'ONLINE_VERIFIED' && i.primarySourceCurrent;
}

/** The hero: the verified plan action; otherwise the built-in protective instruction for an official alert
 *  (never a destination); otherwise protect / no alerts / waiting. */
export function nowHeroText({ actionText, alert, language, critical, noAlerts, messages }: {
  actionText: string | null | undefined; alert: OfficialAlert | null; language: Language; critical: boolean; noAlerts: boolean;
  messages: { emergency: string; noActiveAlerts: string; pending: string };
}) {
  if (actionText) return actionText;
  if (alert) return distressText[language].vertical;
  return critical ? messages.emergency : noAlerts ? messages.noActiveAlerts : messages.pending;
}

export type BandSpec = { tone: 'danger' | 'warn'; label: string; deadlineAt: number | null } | null;

/** The Now band: danger for an official alert (its name, a countdown only with a real deadline), warn for offline or stale data.
 *  The label is never the hero text. */
export function statusBandSpec({ alert, criticalEventName, critical, offline, stale, labels }: {
  alert: OfficialAlert | null; criticalEventName: string | null; critical: boolean; offline: boolean; stale: boolean;
  labels: { offline: string; stale: string; officialAlert: string };
}): BandSpec {
  if (alert) return { tone: 'danger', label: alert.name, deadlineAt: alert.deadlineAt };
  if (critical) return { tone: 'danger', label: criticalEventName ?? labels.officialAlert, deadlineAt: null };
  if (offline) return { tone: 'warn', label: labels.offline, deadlineAt: null };
  if (stale) return { tone: 'warn', label: labels.stale, deadlineAt: null };
  return null;
}
