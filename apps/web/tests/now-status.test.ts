import { describe, expect, it } from 'vitest';
import type { DistressStatus } from '../lib/contracts';
import { noActiveAlertsAllowed, nowHeroText, officialAlert, statusBandSpec } from '../lib/now-status';

const NOW = Date.parse('2026-10-14T14:50:00+09:00');
const NONE: DistressStatus = { level: 'NONE', reports: [], trigger_evidence_ids: [], deadline_at: null, ai_escalated: false, synthetic: false,
  warning_class: null, last_official_at: null, trigger_expires_at: null, stale_reason: null };
const tsunami = (warning_class: DistressStatus['warning_class'], extra: Partial<DistressStatus> = {}): DistressStatus => ({
  ...NONE, level: 'OFFICIAL_TSUNAMI', warning_class, trigger_evidence_ids: ['ev-tsunami'], last_official_at: '2026-10-14T05:49:55Z',
  deadline_at: '2026-10-14T06:20:00Z', trigger_expires_at: '2026-10-14T07:00:00Z', ...extra,
});

describe('officialAlert', () => {
  it('names the official tsunami level in force, with the real arrival deadline', () => {
    expect(officialAlert(tsunami('MAJOR_WARNING'), NOW, 'zh-TW')).toEqual({ name: '大津波警報', deadlineAt: Date.parse('2026-10-14T06:20:00Z') });
    expect(officialAlert(tsunami('WARNING'), NOW, 'ja')?.name).toBe('津波警報');
    expect(officialAlert(tsunami('ADVISORY'), NOW, 'en')?.name).toBe('Tsunami Advisory');
  });
  it('has no countdown without a real future deadline', () => {
    expect(officialAlert(tsunami('WARNING', { deadline_at: null }), NOW, 'ja')?.deadlineAt).toBeNull();
    expect(officialAlert(tsunami('WARNING', { deadline_at: '2026-10-14T05:00:00Z' }), NOW, 'ja')?.deadlineAt).toBeNull();
  });
  it('is null without a server-set official level, and once the official evidence has expired (stale is never current)', () => {
    expect(officialAlert(NONE, NOW, 'ja')).toBeNull();
    expect(officialAlert({ ...NONE, level: 'USER_REPORTED' }, NOW, 'ja')).toBeNull();
    expect(officialAlert({ ...tsunami('WARNING'), level: 'OFFICIAL_STALE' }, NOW, 'ja')).toBeNull();
    expect(officialAlert(tsunami('WARNING'), Date.parse('2026-10-14T07:00:00Z'), 'ja')).toBeNull();
  });
});

describe('nowHeroText (one rule for Live and the replay)', () => {
  const messages = { emergency: 'Protect yourself first', noActiveAlerts: 'No active alerts', pending: 'Waiting for verified information.' };
  it('prefers the verified plan action, then the official alert instruction, then the fallbacks', () => {
    const alert = officialAlert(tsunami('WARNING'), NOW, 'en');
    expect(nowHeroText({ actionText: 'Go up now', alert, language: 'en', critical: false, noAlerts: false, messages })).toBe('Go up now');
    const official = nowHeroText({ actionText: null, alert, language: 'en', critical: true, noAlerts: false, messages });
    expect(official).toBe('Move up / to high ground now, away from water.');
    expect(official).not.toBe(messages.pending);
    expect(nowHeroText({ actionText: null, alert: null, language: 'en', critical: true, noAlerts: false, messages })).toBe(messages.emergency);
    expect(nowHeroText({ actionText: null, alert: null, language: 'en', critical: false, noAlerts: true, messages })).toBe(messages.noActiveAlerts);
    expect(nowHeroText({ actionText: null, alert: null, language: 'en', critical: false, noAlerts: false, messages })).toBe(messages.pending);
  });
});

describe('noActiveAlertsAllowed', () => {
  const base = { hasPlan: false, activeEventCount: 0, distressLevel: 'NONE' as const, connection: 'online' as const,
    networkState: 'ONLINE_VERIFIED', primarySourceCurrent: true };
  it('needs a current primary source, a verified online connection and no plan, event or distress level', () => {
    expect(noActiveAlertsAllowed(base)).toBe(true);
    expect(noActiveAlertsAllowed({ ...base, primarySourceCurrent: false })).toBe(false);
    expect(noActiveAlertsAllowed({ ...base, connection: 'offline' })).toBe(false);
    expect(noActiveAlertsAllowed({ ...base, networkState: 'RECONNECTING' })).toBe(false);
    expect(noActiveAlertsAllowed({ ...base, hasPlan: true })).toBe(false);
    expect(noActiveAlertsAllowed({ ...base, activeEventCount: 1 })).toBe(false);
    expect(noActiveAlertsAllowed({ ...base, distressLevel: 'USER_REPORTED' })).toBe(false);
  });
});

describe('statusBandSpec', () => {
  const labels = { offline: 'Offline · last verified 14:49', stale: 'Data out of date', officialAlert: 'Official alert' };
  it('danger for an official alert (name + real deadline only), never the hero text', () => {
    expect(statusBandSpec({ alert: { name: 'Tsunami Warning', deadlineAt: 5 }, criticalEventName: null, critical: false, offline: true, stale: true, labels }))
      .toEqual({ tone: 'danger', label: 'Tsunami Warning', deadlineAt: 5 });
    expect(statusBandSpec({ alert: null, criticalEventName: 'Earthquake', critical: true, offline: false, stale: false, labels }))
      .toEqual({ tone: 'danger', label: 'Earthquake', deadlineAt: null });
    expect(statusBandSpec({ alert: null, criticalEventName: null, critical: true, offline: false, stale: false, labels }))
      .toEqual({ tone: 'danger', label: 'Official alert', deadlineAt: null });
  });
  it('warn for offline, then stale; nothing in the normal state', () => {
    expect(statusBandSpec({ alert: null, criticalEventName: null, critical: false, offline: true, stale: true, labels }))
      .toEqual({ tone: 'warn', label: labels.offline, deadlineAt: null });
    expect(statusBandSpec({ alert: null, criticalEventName: null, critical: false, offline: false, stale: true, labels }))
      .toEqual({ tone: 'warn', label: labels.stale, deadlineAt: null });
    expect(statusBandSpec({ alert: null, criticalEventName: null, critical: false, offline: false, stale: false, labels })).toBeNull();
  });
});
