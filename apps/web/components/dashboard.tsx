'use client';

import Link from 'next/link';
import { UiIcon } from './ui-icon';
import { AppShell, StatusBand } from './ui';
import { tabForView } from '@/lib/app-tabs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { snapshotSchema, type Language, type Snapshot } from '@/lib/contracts';
import { messages } from '@/lib/i18n';
import { canReconcile, loadSnapshot, nextSafetyDeadline, projectContinuity, replayClock, saveSnapshot, type CacheEnvelope } from '@/lib/continuity';
import { emergencyPack } from '@/lib/emergency-pack';
import { usePower } from '@/lib/use-power';
import { vnextMessages } from '@/lib/vnext-i18n';
import { sourceAuthority } from '@/lib/vnext';
import { VNextExperience } from './vnext-experience';
import { EmergencyMap } from './emergency-map';
import { PowerControls } from './power-controls';
import { useDeviceLocation } from '@/lib/use-device-location';
import { DeviceLocationControls } from './device-location';
import { ScenarioPicker } from './scenario-picker';
import {PlanExplanationPanel} from './plan-explanation-panel';
import { DistressEntry } from './distress-entry';
import { fixFromDevicePosition } from '@/lib/distress-guidance';
import { useTheme } from '@/lib/use-theme';
import { adaptiveMessages } from '@/lib/adaptive-i18n';

const exerciseLabel: Record<Language, string> = { 'zh-TW': '演練', ja: '演習', en: 'Exercise' };
function time(value: string | null, language: Language) {
  return value ? new Date(value).toLocaleTimeString(language, { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) : '—';
}

export function Dashboard({ view: initialView }: { view: string }) {
  const [reviewView, setReviewView] = useState<string | null>(null);
  const view = reviewView ?? initialView;
  const [language, setLanguage] = useState<Language>('ja');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [initialMapOpen, setInitialMapOpen] = useState(false);
  const [previewScene, setPreviewScene] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<'online' | 'offline' | 'reconnecting'>('online');
  const [wallNow, setWallNow] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const [sessionMissing, setSessionMissing] = useState(false);
  const requestPending = useRef(false);
  const envelope = useRef<CacheEnvelope | null>(null);
  const offlineBase = useRef<Snapshot | null>(null);
  const verificationAnchor = useRef<Snapshot | null>(null);
  const connectionRef = useRef<'online' | 'offline' | 'reconnecting'>('online');
  const t = messages[language];
  const vt = vnextMessages[language];
  const battery = usePower();
  const { theme, chooseTheme } = useTheme();
  const at = adaptiveMessages[language];
  const deviceLocation = useDeviceLocation(connection === 'online');
  const powerRef = useRef(battery.power);
  powerRef.current = battery.power;

  const network = useCallback((value: 'online' | 'offline' | 'reconnecting') => {
    connectionRef.current = value;
    setConnection(value);
  }, []);

  const update = useCallback(async (path: string, body?: object, method = 'POST') => {
    if (method === 'POST' && !powerRef.current.allowNonCriticalNetwork) return;
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/replay/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined, cache: 'no-store', signal: AbortSignal.timeout(40000) });
      if (response.status === 404) setSessionMissing(true);
      if (!response.ok) throw new Error('Request failed');
      const state = snapshotSchema.parse(await response.json());
      setSessionMissing(false);
      const previous = envelope.current;
      if (path === 'start' || path.endsWith('/reset')) { network('online'); offlineBase.current = null; verificationAnchor.current = null; }
      if (connectionRef.current !== 'online' && offlineBase.current && canReconcile(offlineBase.current, state, Math.max(Date.parse(state.replay.current_time), previous ? replayClock(previous, Date.now()) : 0))) {
        network('online'); offlineBase.current = null;
      }
      const nextEnvelope: CacheEnvelope = { schema_version: 1, snapshot: state, connection: connectionRef.current, saved_at: previous?.snapshot.replay.id === state.replay.id && previous.snapshot.replay.current_time === state.replay.current_time ? previous.saved_at : Date.now() };
      envelope.current = nextEnvelope;
      setSnapshot(state);
      localStorage.setItem('72h-session', state.replay.id);
      void saveSnapshot(nextEnvelope).then(() => setStorageError(false)).catch(() => setStorageError(true));
    } catch {
      setError(messages[language].error);
      offlineBase.current ||= envelope.current?.snapshot || null;
      verificationAnchor.current = offlineBase.current;
      network('offline');
      if (envelope.current) { envelope.current = { ...envelope.current, connection: 'offline' }; void saveSnapshot(envelope.current).catch(() => setStorageError(true)); }
    }
    finally { requestPending.current = false; setBusy(false); }
  }, [language, network]);

  // Distress reports/advice return a full replay snapshot; adopt it only for the same session and never move backwards.
  const adoptDistress = useCallback((raw: unknown) => {
    const parsed = snapshotSchema.safeParse(raw), previous = envelope.current;
    if (!parsed.success || !previous || parsed.data.replay.id !== previous.snapshot.replay.id
      || parsed.data.replay.current_event_index < previous.snapshot.replay.current_event_index) return;
    const state = parsed.data;
    const nextEnvelope: CacheEnvelope = { ...previous, snapshot: state, saved_at: previous.snapshot.replay.current_time === state.replay.current_time ? previous.saved_at : Date.now() };
    envelope.current = nextEnvelope; setSnapshot(state);
    void saveSnapshot(nextEnvelope).then(() => setStorageError(false)).catch(() => setStorageError(true));
  }, []);

  useEffect(() => {
    const savedLanguage = localStorage.getItem('72h-language');
    if (savedLanguage && ['ja', 'en', 'zh-TW'].includes(savedLanguage)) setLanguage(savedLanguage as Language);
    let cancelled = false;
    void (async () => {
      const saved = await loadSnapshot().catch(() => null);
      if (cancelled) return;
      if (saved) {
        envelope.current = saved; setSnapshot(saved.snapshot);
        if (saved.connection !== 'online' || !navigator.onLine) { offlineBase.current = saved.snapshot; verificationAnchor.current = saved.snapshot; network('reconnecting'); }
      }
      if (!navigator.onLine) { network('offline'); return; }
      const session = saved?.snapshot.replay.id || localStorage.getItem('72h-session');
      if (session && /^[a-zA-Z0-9_-]{1,80}$/.test(session)) void update(session, undefined, 'GET');
    })();
    const onOffline = () => {
      offlineBase.current ||= envelope.current?.snapshot || null; verificationAnchor.current = offlineBase.current; network('offline');
      if (envelope.current) { envelope.current = { ...envelope.current, connection: 'offline' }; void saveSnapshot(envelope.current).catch(() => setStorageError(true)); }
    };
    const onOnline = () => { network('reconnecting'); const session = envelope.current?.snapshot.replay.id; if (session) void update(session, undefined, 'GET'); };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => setStorageError(true));
    // Restore once; subsequent language changes apply to the next new session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { cancelled = true; window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); };
  }, []);
  useEffect(() => { const clock = setInterval(() => setWallNow(Date.now()), battery.power.refreshMs); return () => clearInterval(clock); }, [battery.power.refreshMs]);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    if (!snapshot || busy || connection === 'offline' || !battery.power.allowNonCriticalNetwork || snapshot.replay.status !== 'RUNNING') return;
    const index = snapshot.replay.current_event_index;
    const next = snapshot.scenario_events[index];
    if (!next) return;
    const previous = index ? snapshot.scenario_events[index - 1].offset_seconds : 0;
    const delay = Math.max(0, next.offset_seconds - previous) * 1000 / snapshot.replay.speed;
    const timer = setTimeout(() => void update(`${snapshot.replay.id}/next`), delay);
    return () => clearTimeout(timer);
  }, [snapshot, busy, connection, update, battery.power.allowNonCriticalNetwork]);

  const continuityTime = snapshot ? ((connection !== 'online' || snapshot.situation.network_state.startsWith('OFFLINE')) && envelope.current ? replayClock(envelope.current, wallNow || Date.now()) : Date.parse(snapshot.replay.current_time)) : 0;
  const projection = snapshot ? projectContinuity(snapshot, continuityTime, connection) : null;
  const current = projection?.plan;
  const displayEvidence = projection?.evidence || [];
  const evaluation = current && snapshot?.plan_evaluations.findLast(e => e.plan_id === current.id);
  const actions = snapshot?.plan_actions.filter(a => a.plan_id === current?.id) || [];
  const navLabels = { dashboard: vt.home, plan: t.plan, more: vt.more, notifications: at.notifications, sources: t.sources, trace: t.trace, demo: vt.demoMode };
  useEffect(() => {
    if (!snapshot || (connection === 'online' && !snapshot.situation.network_state.startsWith('OFFLINE'))) return;
    const deadline = nextSafetyDeadline(snapshot, continuityTime);
    if (!deadline) return;
    const timer = setTimeout(() => setWallNow(Date.now()), Math.max(1, deadline - continuityTime));
    return () => clearTimeout(timer);
  }, [snapshot, connection, continuityTime]);

  const exerciseBand = <StatusBand tone="exercise" label={exerciseLabel[language]} />;
  if (view === 'demo' && snapshot && previewScene) return <AppShell tab="now" language={language} band={exerciseBand}><div className={`shell theme-${theme} power-${battery.power.mode.toLowerCase()}`}>
    <main>
      <div className="simulation"><strong>SYNTHETIC_REPLAY · {t.demoNotice}</strong><button type="button" onClick={() => setPreviewScene(false)}>{at.backJudge}</button></div>
      <VNextExperience snapshot={snapshot} language={language} now={continuityTime} connection={connection} verificationAnchor={verificationAnchor.current}
        power={battery.power} level={battery.level} override={battery.override} choose={battery.choose} view="dashboard" deviceLocation={deviceLocation} />
    </main>
  </div></AppShell>;

  const replayControls = view === 'demo' && snapshot && battery.power.mode !== 'SURVIVAL' ? <><button disabled={busy || !battery.power.allowNonCriticalNetwork || snapshot.replay.status === 'COMPLETED'} onClick={() => void update(`${snapshot.replay.id}/${snapshot.replay.status === 'RUNNING' ? 'pause' : 'resume'}`)}>{snapshot.replay.status === 'RUNNING' ? t.pause : t.resume}</button><button disabled={busy || !battery.power.allowNonCriticalNetwork || !['RUNNING', 'PAUSED'].includes(snapshot.replay.status)} onClick={() => void update(`${snapshot.replay.id}/next`)}>{t.next} →</button><button disabled={busy || !battery.power.allowNonCriticalNetwork} onClick={() => void update(`${snapshot.replay.id}/reset`)}>{t.reset}</button><select aria-label="Replay speed" value={snapshot.replay.speed} disabled={busy || !battery.power.allowNonCriticalNetwork || snapshot.replay.status === 'COMPLETED'} onChange={e => void update(`${snapshot.replay.id}/speed`, { speed: Number(e.target.value) })}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select><small>{snapshot.replay.current_event_index} / {snapshot.scenario_events.length}</small></> : undefined;
  return <AppShell tab={tabForView(view)} language={language} band={exerciseBand} exerciseControls={replayControls}><div className={`shell theme-${theme} power-${battery.power.mode.toLowerCase()}`}>
    <main>
      <header className="topbar"><span className="eyebrow">72H{snapshot ? ' / ' + snapshot.profile.current_location.label : ''}</span><select aria-label="Language" value={language} onChange={event => { const value = event.target.value as Language; setLanguage(value); localStorage.setItem('72h-language', value); }}><option value="ja">日本語</option><option value="en">English</option><option value="zh-TW">繁體中文</option></select></header>
      <div className="simulation"><strong>{t.demoNotice}</strong><span>{t.demoDetail}</span></div>
      {initialView === 'demo' && snapshot && <nav className="controls" aria-label={vt.demoMode}>
        {(['demo', 'plan', 'sources', 'trace'] as const).map(item => <button key={item} type="button" aria-current={view === item ? 'page' : undefined} onClick={() => setReviewView(item)}>{navLabels[item]}</button>)}
      </nav>}
      {error && <p className="error" role="alert">{error}</p>}
      {view==='plan'&&snapshot&&<DistressEntry snapshot={snapshot} language={language} scope="replay" fix={fixFromDevicePosition(deviceLocation.position)} now={continuityTime} onSnapshot={adoptDistress} refreshLocation={deviceLocation.permissionGranted ? () => void deviceLocation.locate() : undefined} />}
      {view==='plan'&&snapshot&&battery.power.mode!=='SURVIVAL'&&<PlanExplanationPanel snapshot={snapshot} language={language} scope="replay" enabled={connection==='online'&&battery.power.allowNonCriticalNetwork}/>}
      {sessionMissing && <section className="offline-banner"><p>{t.sessionMissing}</p><button disabled={busy || !battery.power.allowNonCriticalNetwork} onClick={() => void update('start', { language })}>{t.newDemo}</button></section>}
      {storageError && <p className="error" role="alert">{t.storageError}</p>}
      {!snapshot && view === 'more' && <PowerControls language={language} power={battery.power} level={battery.level} override={battery.override} choose={battery.choose} />}
      {snapshot && view !== 'dashboard' && (connection !== 'online' || snapshot.situation.network_state.startsWith('OFFLINE') || snapshot.situation.network_state === 'RECONNECTING') && <section className="offline-banner" role="status"><strong>{projection?.networkState === 'RECONNECTING' ? t.reconnecting : t.offline}</strong><p>{t.offlineDetail}</p><small>{t.lastVerified}: {time(snapshot.situation.latest_evidence_at, language)} · {t.actualNetwork}: {connection === 'online' ? t.online : connection}</small>{connection !== 'online' && <div><button disabled={busy} onClick={() => { network('reconnecting'); void update(snapshot.replay.id, undefined, 'GET'); }}>{t.retry}</button></div>}</section>}
      {view === 'more' && <section className="more-menu"><h1>{vt.more}</h1><Link href="/sources">{t.sources} →</Link><Link href="/notifications">{at.notifications} →</Link><label className="theme-setting">{at.appearance}<select value={theme} onChange={e => chooseTheme(e.target.value)}><option value="dark">{at.dark}</option><option value="system">{at.system}</option><option value="contrast">{at.contrast}</option></select></label><details><summary>{vt.demoMode}</summary><Link href="/demo">{t.demo} →</Link><Link href="/trace">{t.trace} →</Link></details></section>}
      {!snapshot ? <>
        {(view === 'dashboard' || (battery.power.mode === 'SURVIVAL' && view !== 'more')) ? <section className="adaptive-home" data-presentation-mode={battery.power.mode === 'SURVIVAL' ? 'SURVIVAL' : 'TEXT_ONLY'}>
          <header className="situation-header"><div><h1>{battery.power.mode === 'SURVIVAL' ? at.survival : at.monitoring}</h1><p>{connection === 'offline' ? at.cached : at.summary}</p></div>{battery.power.mode !== 'SURVIVAL' && <Link className="notification-badge" href="/notifications" aria-label={at.notifications}><UiIcon name="bell" /></Link>}</header>
          <section className="now-card"><small>NOW</small><h2>{at.pending}</h2></section>
          {['NORMAL', 'CONSERVE'].includes(battery.power.mode) ? <details className="plan-sheet"><summary>{at.details}</summary><p>{t.introDetail}</p><Link href="/more">{at.settings}</Link><Link href="/demo">{vt.demoMode}</Link></details> : <><p className="power-warning"><UiIcon name="warning" />{battery.power.mode === 'SURVIVAL' ? at.survival : at.emergencyPower}</p><Link href="/more">{at.settings}</Link><section className="emergency-contact"><h2>{at.emergency}</h2><p>{at.emergencyDetail}</p><a href="tel:119">119</a> · <a href="tel:110">110</a></section><p>{at.position}: {deviceLocation.position ? `${deviceLocation.position.latitude.toFixed(4)}, ${deviceLocation.position.longitude.toFixed(4)} · ${new Date(deviceLocation.position.captured_at).toLocaleString(language, { timeZone: 'Asia/Tokyo' })}` : at.noPosition}</p></>}

        </section> : view === 'demo' ? <section className="intro"><h1>{vt.demoMode}</h1><p>{t.introDetail}</p><ScenarioPicker language={language} enabled={battery.power.allowNonCriticalNetwork && connection !== 'offline'} busy={busy} button={t.start} start={key => void update('start', { language, scenario_key: key })} /></section> : view === 'more' ? <><DeviceLocationControls location={deviceLocation} language={language} /><button disabled={!battery.power.allowMap} onClick={() => setInitialMapOpen(value => !value)}>{initialMapOpen ? at.closeMap : at.map}</button><Link href="/map">{language === 'ja' ? '日本全国の参考地図' : language === 'en' ? 'All Japan reference map' : '全日本參考地圖'}</Link>{initialMapOpen && battery.power.allowMap && <EmergencyMap language={language} conserve={battery.power.mode !== 'NORMAL'} location={deviceLocation} />}</> : <p>{view === 'notifications' ? vt.emptyNotifications : t.empty}</p>}
      </> : <>
        {view !== 'dashboard' && battery.power.mode !== 'SURVIVAL' && <section className="heading"><div><p className="eyebrow">{snapshot.situation.active_event_ids.length ? 'EARTHQUAKE / REPLAY' : 'READY / REPLAY'}</p><h1>{view === 'dashboard' ? (snapshot.situation.active_event_ids.length ? t.earthquake : t.noEmergency) : navLabels[view as keyof typeof navLabels]}</h1></div><div className="status-pill"><span className="dot" />{projection?.networkState}</div></section>}
        {view === 'demo' && <div className="controls"><button type="button" onClick={() => setPreviewScene(true)}>{at.previewScene}</button><button type="button" disabled={!battery.power.allowMap} onClick={() => setInitialMapOpen(value => !value)}>{initialMapOpen ? at.closeMap : at.map}</button><Link href="/map">{language === 'ja' ? '日本全国の参考地図' : language === 'en' ? 'All Japan reference map' : '全日本參考地圖'}</Link><Link href="/trace">{t.trace} →</Link></div>}
        {view === 'demo' && initialMapOpen && battery.power.allowMap && <EmergencyMap language={language} conserve={battery.power.mode !== 'NORMAL'} profile={snapshot.profile} location={deviceLocation}
          earthquake={(() => { const event = snapshot.events.findLast(item => snapshot.situation.active_event_ids.includes(item.id)); return event ? { id: event.id, occurredAt: event.occurred_at, synthetic: true } : null; })()} />}
        <VNextExperience snapshot={snapshot} language={language} now={continuityTime} connection={connection} verificationAnchor={verificationAnchor.current} power={battery.power} level={battery.level} override={battery.override} choose={battery.choose} view={view} showLocalTrace={view === 'trace'} deviceLocation={deviceLocation} />
        {view === 'demo' && battery.power.mode !== 'SURVIVAL' && <><ScenarioPicker language={language} currentKey={snapshot.replay.scenario_key} enabled={battery.power.allowNonCriticalNetwork && connection !== 'offline'} busy={busy} button={t.newDemo} start={key => void update('start', { language, scenario_key: key })} /><div className="context-grid"><div><small>{t.location}</small><strong>{snapshot.profile.current_location.label}</strong></div><div><small>{t.destination}</small><strong>{snapshot.profile.accommodation_location.label}</strong></div><div><small>{t.simulatedTime} / JST</small><strong>{time(snapshot.replay.current_time, language)}</strong></div><div><small>{t.lastVerified}</small><strong>{time(snapshot.situation.latest_evidence_at, language)}</strong></div></div>
</>}
        {view === 'demo' && battery.power.mode !== 'SURVIVAL' && <>
          <div className="section-head"><h2>{current ? `${snapshot.situation.current_plan_id !== current.id || connection !== 'online' ? `${t.lastPlan} · ` : ''}Plan v${current.version}` : t.pending}</h2><span>{projection?.planStatus || 'WAITING_FOR_EVIDENCE'}</span></div>
          {current && <p className="muted">{t.lastVerified}: {time(current.created_at, language)} · {t.expires}: {time(current.expires_at, language)}</p>}
          <p className="muted">{snapshot.replay.planning_mode === 'GEMINI_ADK' ? t.ai : snapshot.replay.planning_mode === 'GEMINI_ADK_FALLBACK' ? t.modelFallback : t.fallback} · {t.noMovement}</p>
          <div className="action-grid">{(['NOW', 'NEXT', 'AVOID'] as const).map((category, index) => <section key={category} className={`action-panel panel-${category.toLowerCase()}`}><div className="panel-title"><span>0{index + 1}</span><div><small>{category}</small><h2>{category === 'NOW' ? t.now : category === 'NEXT' ? t.nextActions : t.avoid}</h2></div></div>{actions.filter(a => a.category === category).map(a => {
            const invalid = projection?.invalidActionIds.includes(a.id) || evaluation?.invalid_action_ids.includes(a.id) || a.status !== 'ACTIVE';
            return <article key={a.id} className={invalid ? 'action invalid' : 'action'}><h3>{a.text}</h3><span className="badge">{invalid ? t.invalid : a.risk_level}</span><details><summary>{t.why}</summary><p>{a.reason}</p>{a.evidence_ids.map(id => <Link key={id} href="/sources">{t.evidence}: {id}</Link>)}</details></article>;
          })}{!actions.some(a => a.category === category) && <p className="muted">{t.waitingPlan}</p>}</section>)}</div>
          <section className="record-list"><h2>{t.progress}</h2>{snapshot.scenario_events.map((e, i) => <div className="timeline-item" key={e.id}><span>{i < snapshot.replay.current_event_index ? '✓' : '○'}</span><strong>{e.label}</strong><small>+{e.offset_seconds}s</small></div>)}</section>
        </>}
        {view === 'plan' && battery.power.mode !== 'SURVIVAL' && <section className="record-list">{snapshot.plans.map(p => { const pe = snapshot.plan_evaluations.findLast(e => e.plan_id === p.id); const historical = projectContinuity({ ...snapshot, situation: { ...snapshot.situation, current_plan_id: p.id } }, continuityTime, connection); return <article key={p.id}><div className="section-head"><h2>Plan v{p.version}</h2><span className="badge">{historical.planStatus}</span></div><p>{time(p.created_at, language)} → {t.expires}: {time(p.expires_at, language)}</p>{pe?.reason && <p>{pe.reason}</p>}{snapshot.plan_actions.filter(a => a.plan_id === p.id).map(a => <p key={a.id} className={historical.invalidActionIds.includes(a.id) ? 'invalid' : ''}><b>{a.category}</b> · {a.text}{historical.invalidActionIds.includes(a.id) && ` · ${t.invalid}`}</p>)}</article>; })}{!snapshot.plans.length && <p>{t.empty}</p>}</section>}
        {view === 'sources' && battery.power.mode !== 'SURVIVAL' && <section className="record-list">{displayEvidence.map(e => <article key={e.id}><div className="section-head"><h2>{e.source_name}</h2><span className={`badge ${e.conflict || e.trust_status === 'CONFLICTING' || e.trust_status === 'UNVERIFIED' || e.freshness_status !== 'CURRENT' ? 'warn' : ''}`}>{e.conflict || e.trust_status === 'CONFLICTING' ? 'CONFLICTING' : e.freshness_status === 'CURRENT' ? e.trust_status : e.freshness_status}</span></div><p>{e.summary}</p><span className="badge">{sourceAuthority(e)}</span><p className="muted">{e.freshness_status} · {time(e.published_at, language)} · {t.expires}: {time(e.expires_at, language)} · {t.sourceAge}: {Math.max(0, Math.floor((continuityTime - Date.parse(e.published_at)) / 60_000))} min</p><p>{e.conflict || e.trust_status === 'CONFLICTING' ? t.conflicting : e.trust_status === 'UNVERIFIED' ? t.unverified : t.verified}</p><code>{e.id} · {e.raw_reference}</code></article>)}{!snapshot.evidence.length && <p>{t.empty}</p>}</section>}
        {view === 'trace' && battery.power.mode !== 'SURVIVAL' && <section className="record-list">{[...snapshot.trace].reverse().map(e => <article key={e.id}><div className="section-head"><h3>{e.event_type}</h3><small>{time(e.timestamp, language)}</small></div><p>{e.public_summary}</p><small>{e.agent} · {e.status}</small><p className="muted">{e.input_refs.join(', ')} → {e.output_refs.join(', ')}</p></article>)}{!snapshot.trace.length && <p>{t.empty}</p>}</section>}
      </>}
      {view !== 'dashboard' && battery.power.mode !== 'SURVIVAL' && <section className="record-list emergency-pack"><h2>{emergencyPack[language].title}</h2><p className="muted">{emergencyPack[language].label} · v{emergencyPack.version} · {emergencyPack.reviewed_at}</p><p>{emergencyPack[language].shaking}</p><p>{emergencyPack[language].phone}</p><p>{emergencyPack[language].phrase}</p>{emergencyPack.sources.map(s => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.name} ↗ </a>)}</section>}
      {view !== 'dashboard' && <footer>72H · From Alert to Action. <span>{t.noMovement}</span></footer>}
    </main>
  </div></AppShell>;
}
