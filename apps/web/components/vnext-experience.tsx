'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Action, Language, Snapshot } from '@/lib/contracts';
import { projectContinuity } from '@/lib/continuity';
import { deriveNotifications, deriveSeverity, initialSafetyCheck, reduceSafetyCheck, safetyCheckSchema, type Notification, type PowerProjection, type SafetyCheckState } from '@/lib/vnext';
import { vnextMessages } from '@/lib/vnext-i18n';
import { aggregateNotifications, notificationLedgerSchema } from '@/lib/notification-inbox';
import { checkTrace, localCheckTraceSchema, type LocalCheckTrace } from '@/lib/local-check-trace';
import { EmergencyMap } from './emergency-map';
import { PowerControls } from './power-controls';
import type { DeviceLocation } from '@/lib/use-device-location';
import { DeviceLocationControls } from './device-location';

export function VNextExperience({ snapshot, language, now, connection, verificationAnchor, power, level, override, choose, deviceLocation, compact = false, showLocalTrace = false }: {
  snapshot: Snapshot; language: Language; now: number; connection: 'online' | 'offline' | 'reconnecting';
  power: PowerProjection; level: number | null; override: string; choose: (value: string) => void;
  compact?: boolean;
  showLocalTrace?: boolean;
  verificationAnchor?: Snapshot | null;
  deviceLocation: DeviceLocation;
}) {
  const t = vnextMessages[language];
  const projection = projectContinuity(snapshot, now, connection);
  const severity = deriveSeverity(snapshot, now);
  const [check, setCheck] = useState(initialSafetyCheck);
  const [localTrace, setLocalTrace] = useState<LocalCheckTrace>([]);
  const previousCheck = useRef<SafetyCheckState | null>(null);
  const [restored, setRestored] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const previous = useRef<Snapshot | null>(null);
  const previousConnection = useRef<'online' | 'offline' | 'reconnecting'>('online');
  const seen = useRef(new Set<string>());
  const session = useRef<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('72h-safety-check');
      if (raw) { const parsed = safetyCheckSchema.safeParse(JSON.parse(raw)); if (parsed.success) setCheck(parsed.data); }
      const trace = localStorage.getItem('72h-local-check-trace');
      if (trace) { const parsed = localCheckTraceSchema.safeParse(JSON.parse(trace)); if (parsed.success) setLocalTrace(parsed.data); }
    } catch { setStorageUnavailable(true); }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    if (previousCheck.current) {
      const event = checkTrace(previousCheck.current, check, Date.now());
      if (event) setLocalTrace(history => [...history, event].slice(-128));
    }
    previousCheck.current = check;
  }, [check, restored]);
  useEffect(() => { if (restored) try { localStorage.setItem('72h-local-check-trace', JSON.stringify(localTrace)); } catch { setStorageUnavailable(true); } }, [localTrace, restored]);
  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem('72h-safety-check', JSON.stringify(check)); } catch { setStorageUnavailable(true); }
  }, [check, restored]);
  useEffect(() => {
    if (!restored) return;
    setCheck(state => reduceSafetyCheck(state, { type: 'CRITICAL', eventKey: `${snapshot.replay.id}:${severity.criticalEventKey || 'none'}`, eligible: !!severity.criticalEventKey && severity.level === 'L4' && connection === 'online' && projection.networkState === 'ONLINE_VERIFIED', now: Date.now() }));
  }, [restored, snapshot.replay.id, severity.criticalEventKey, severity.level, connection, projection.networkState]);
  useEffect(() => {
    if (!restored || check.status !== 'AWAITING_RESPONSE') return;
    const timer = setInterval(() => setCheck(state => reduceSafetyCheck(state, { type: 'TICK', now: Date.now() })), 1000);
    return () => clearInterval(timer);
  }, [restored, check.status]);
  useEffect(() => {
    if (session.current !== snapshot.replay.id || (previous.current && snapshot.replay.current_event_index < previous.current.replay.current_event_index)) {
      previous.current = null; seen.current = new Set(); setNotifications([]); session.current = snapshot.replay.id;
      try {
        const raw = localStorage.getItem('72h-notification-ledger'); const parsed = raw && notificationLedgerSchema.safeParse(JSON.parse(raw));
        if (parsed && parsed.success && parsed.data.session === snapshot.replay.id) { seen.current = new Set(parsed.data.seen); setNotifications(aggregateNotifications([], parsed.data.items as Notification[])); }
      } catch { setStorageUnavailable(true); }
    }
    const events = deriveNotifications(previous.current, snapshot, now, connection, previousConnection.current, verificationAnchor).filter(n => !seen.current.has(n.id));
    previous.current = snapshot;
    previousConnection.current = connection;
    if (!events.length) return;
    for (const event of events) seen.current.add(event.id);
    // Aggregate updates into one bounded inbox; no repeated audio/push interrupt.
    setNotifications(items => aggregateNotifications(items, events));
    const bounded = [...seen.current].slice(-512); seen.current = new Set(bounded);
  }, [snapshot, now, connection, verificationAnchor]);
  useEffect(() => { if (session.current) try { localStorage.setItem('72h-notification-ledger', JSON.stringify({ session: session.current, seen: [...seen.current], items: notifications })); } catch { setStorageUnavailable(true); } }, [notifications]);

  const usable = snapshot.plan_actions.filter(a => a.plan_id === projection.plan?.id && !projection.invalidActionIds.includes(a.id));
  const nowActions = usable.filter(a => a.category === 'NOW');
  const renderAction = (a: Action) => <article className="action" key={a.id}><h3>{a.text}</h3><details><summary>{t.details}</summary><p>{a.reason}</p>{a.evidence_ids.map(id => <Link href="/sources" key={id}>{id}</Link>)}</details></article>;
  const checkControls = <section className={`check-card ${check.status === 'AWAITING_RESPONSE' ? 'check-required' : ''}`}>
    <label><input type="checkbox" checked={check.consent} onChange={e => setCheck(state => reduceSafetyCheck(state, { type: 'CONSENT', enabled: e.target.checked }))} /> {t.consent}</label>
    {check.status !== 'UNKNOWN' && <><h2>{t.check}</h2><p role="status">{check.status === 'UNRESPONSIVE_UNKNOWN' ? t.silence : check.status} · {check.attempts}/3</p>
      <div className="check-buttons">{(['SAFE_CONFIRMED', 'NEEDS_ASSISTANCE', 'CANNOT_MOVE'] as const).map((response, index) => <button key={response} onClick={() => setCheck(state => reduceSafetyCheck(state, { type: 'RESPOND', response, now: Date.now() }))}>{[t.safe, t.help, t.cannotMove][index]}</button>)}</div></>}
    <p className="muted">{t.checkLimit}</p>
  </section>;
  const powerControls = <PowerControls language={language} power={power} level={level} override={override} choose={choose} />;
  const inbox = <section className="notifications"><h2>{t.notifications}</h2><div aria-live="polite">{notifications.length ? notifications.map(n => <article key={n.id}><Link href={n.href}><span className="badge">{n.kind}</span> {t.events[n.event as keyof typeof t.events] || n.event}</Link><button onClick={() => setNotifications(items => items.filter(item => item.id !== n.id))}>{t.dismiss}</button></article>) : <p className="muted">{t.emptyNotifications}</p>}</div></section>;

  if (power.mode === 'SURVIVAL') return <section className="survival-screen"><h1>{t.survival}</h1><strong>NOW</strong>{nowActions.length ? nowActions.slice(0, 1).map(renderAction) : <p>{t.pending}</p>}<p>{projection.planStatus} · {projection.networkState}</p><p>{t.savedPlan}: {projection.plan?.version ?? '—'} · {projection.plan?.created_at ?? '—'}</p><p>{t.profileReference} · {snapshot.profile.current_location.label}</p><DeviceLocationControls location={deviceLocation} language={language} />{checkControls}{powerControls}</section>;
  if (compact) return <>{checkControls}<details><summary>{t.notifications} · {notifications.length}</summary>{inbox}</details>{powerControls}{showLocalTrace && <section className="record-list"><h2>{t.check} · Local trace</h2>{[...localTrace].reverse().map(e => <article key={e.id}><h3>{e.event_type}</h3><p>{e.status} · {e.attempts}/3 · {e.timestamp}</p></article>)}</section>}</>;
  return <>
    <div className="vnext-status"><div><small>{t.severity}</small><strong>{severity.level} · {severity.actionState}</strong><p className="muted">{t.severityDetail}</p>{severity.evidenceIds.map(id => <Link key={id} className="badge" href="/sources">{id}</Link>)}</div><div><small>{t.savedPlan}</small><strong>{projection.plan ? `v${projection.plan.version}` : '—'} · {projection.planStatus}</strong><p className="muted">{projection.plan?.created_at || '—'} · {projection.networkState}</p></div></div>
    <DeviceLocationControls location={deviceLocation} language={language} />
    {power.allowMap ? <EmergencyMap language={language} conserve={power.mode !== 'NORMAL'} profile={snapshot.profile} location={deviceLocation} /> : <section className="offline-banner"><strong>{power.mode}</strong><p>{t.mapFallback}</p></section>}
    <section className="now-card"><small>NOW</small>{nowActions.length ? nowActions.slice(0, 1).map(renderAction) : <p>{t.pending}</p>}</section>
    <details className="plan-sheet"><summary>{t.details}</summary>{nowActions.slice(1).map(renderAction)}{(['NEXT', 'AVOID'] as const).map(category => <section key={category}><h2>{category}</h2>{usable.filter(a => a.category === category).map(renderAction)}</section>)}<p>{projection.plan?.expires_at}</p><Link href="/plan">{t.savedPlan} →</Link></details>
    {checkControls}
    {inbox}
    {powerControls}
    {storageUnavailable && <p className="error" role="status">{t.mapUnavailable} · local storage unavailable</p>}
  </>;
}
