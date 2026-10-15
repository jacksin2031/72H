'use client';

import { AppShell, Button, Disclosure, Section, StatusBand } from './ui';
import { MapScreen } from './map-screen';
import { SimulationReferenceMap } from './simulation-reference-map';
import { noActiveAlertsAllowed, nowHeroText, officialAlert } from '@/lib/now-status';
import { formatCountdown } from '@/lib/distress-guidance';
import { HelpOverlay } from './help-overlay';
import { AdaptiveHome } from './adaptive-home';
import { DeviceLocationControls } from './device-location';
import type { AppTab } from '@/lib/app-tabs';
import { NowScreen } from './now-screen';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { snapshotSchema, type Language, type Snapshot } from '@/lib/contracts';
import { messages } from '@/lib/i18n';
import { liveMessages } from '@/lib/live-i18n';
import { canReconcile, loadSnapshot, nextSafetyDeadline, projectContinuity, replayClock, saveSnapshot, type CacheEnvelope } from '@/lib/continuity';
import { derivePresentation } from '@/lib/adaptive-ui';
import { emergencyPack } from '@/lib/emergency-pack';
import { usePower } from '@/lib/use-power';
import { vnextMessages } from '@/lib/vnext-i18n';
import { initialSafetyCheck, type SafetyCheckState } from '@/lib/vnext';
import { distressText, sosText } from '@/lib/distress';
import { ReplaySafetyCheck, VNextExperience } from './vnext-experience';
import { useDeviceLocation } from '@/lib/use-device-location';
import { ScenarioPicker } from './scenario-picker';
import { PlanExplanationPanel } from './plan-explanation-panel';
import { DistressEntry } from './distress-entry';
import { fixFromDevicePosition } from '@/lib/distress-guidance';
import { RoadReferenceNotice, RoadReferenceSection, roadLayerLabel, roadPeekText, roadReferenceRoutes, useRoadReference } from './road-reference-section';
import { DrillLocationPicker } from './drill-location-picker';
import type { DrillPoint } from '@/lib/drill-location';
import type { RoadHazard } from '@/lib/road-destinations';

const exerciseLabel: Record<Language, string> = { 'zh-TW': '演練', 'zh-CN': '演练', ja: '演習', en: 'Exercise' };
/** Exercise-only wording; technical terms (Agent log, Judge) appear only in the last basis section. */
const exerciseCopy: Record<Language, { details: string; setup: string; planning: string }> = {
  'zh-TW': { details: '演練詳細（Agent 紀錄 · Judge）', setup: '演練設定', planning: '計畫產生方式' }, 'zh-CN': { details: '演练详细（Agent 纪录 · Judge）', setup: '演练设置', planning: '计划产生方式' },
  ja: { details: '演習の詳細（エージェント記録 · Judge）', setup: '演習の設定', planning: '計画の作成方法' },
  en: { details: 'Exercise details (agent log · Judge)', setup: 'Exercise setup', planning: 'Planning mode' },
};
const CRITICAL_MODES = ['SAFETY_CHECK', 'EMERGENCY_PROTECT'];
function time(value: string | null, language: Language) {
  return value ? new Date(value).toLocaleTimeString(language, { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) : '—';
}

/** /demo and /trace: the deterministic replay drives the same Now screen as Live; only the 演練 band, tag and controls differ. */
export function Dashboard({ view }: { view: string }) {
  const [language, setLanguage] = useState<Language>('ja');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<'online' | 'offline' | 'reconnecting'>('online');
  const [wallNow, setWallNow] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const [sessionMissing, setSessionMissing] = useState(false);
  const [distressOpen, setDistressOpen] = useState(false);
  const demoRoadHazard:RoadHazard=snapshot?.distress.level==='OFFICIAL_TSUNAMI'?'tsunami':'earthquake';
  // /demo's exercise reference point is chosen on this page only: volatile component state, never persisted and never written to the
  // replay profile or the SOS / distress location. The replay area and device GPS are never substituted for it.
  const [demoPoint, setDemoPoint] = useState<{ point: DrillPoint; prefecture: string | null } | null>(null);
  const [demoRoadLayerOn, setDemoRoadLayerOn] = useState(false);
  const [demoSheetOpen, setDemoSheetOpen] = useState(false);
  const demoRoadReference=useRoadReference(demoPoint?{lat:demoPoint.point.lat,lng:demoPoint.point.lng}:null,demoRoadHazard,demoPoint?.prefecture??null);
  const demoReferenceRoutes=useMemo(()=>roadReferenceRoutes(demoRoadReference,demoRoadLayerOn),[demoRoadLayerOn,demoRoadReference.state,demoRoadReference.result]);
  const demoRoadNoticeInChrome=demoRoadLayerOn&&demoPoint!==null;
  // Owned here so the hero and the Now-screen safety check use the same state (VNextExperience restores, persists and advances it).
  const [check, setCheck] = useState<SafetyCheckState>(initialSafetyCheck);
  const [tab, setTab] = useState<AppTab>('now');
  const requestPending = useRef(false);
  const envelope = useRef<CacheEnvelope | null>(null);
  const offlineBase = useRef<Snapshot | null>(null);
  const verificationAnchor = useRef<Snapshot | null>(null);
  const connectionRef = useRef<'online' | 'offline' | 'reconnecting'>('online');
  const t = messages[language];
  const lm = liveMessages[language];
  const vt = vnextMessages[language];
  const xc = exerciseCopy[language];
  const battery = usePower();
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
      try { localStorage.setItem('72h-session', state.replay.id); } catch { setStorageError(true); }
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
    let savedSession: string | null = null;
    try {
      const savedLanguage = localStorage.getItem('72h-language');
      if (savedLanguage && ['ja', 'en', 'zh-TW', 'zh-CN'].includes(savedLanguage)) setLanguage(savedLanguage as Language);
      savedSession = localStorage.getItem('72h-session');
    } catch { setStorageError(true); }
    let cancelled = false;
    void (async () => {
      const saved = await loadSnapshot().catch(() => null);
      if (cancelled) return;
      if (saved) {
        envelope.current = saved; setSnapshot(saved.snapshot);
        if (saved.connection !== 'online' || !navigator.onLine) { offlineBase.current = saved.snapshot; verificationAnchor.current = saved.snapshot; network('reconnecting'); }
      }
      if (!navigator.onLine) { network('offline'); return; }
      const session = saved?.snapshot.replay.id || savedSession;
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
  useEffect(() => {
    if (!snapshot || (connection === 'online' && !snapshot.situation.network_state.startsWith('OFFLINE'))) return;
    const deadline = nextSafetyDeadline(snapshot, continuityTime);
    if (!deadline) return;
    const timer = setTimeout(() => setWallNow(Date.now()), Math.max(1, deadline - continuityTime));
    return () => clearTimeout(timer);
  }, [snapshot, connection, continuityTime]);

  // Band: purple 演練 always; red with the official level when the replayed state carries an official tsunami warning.
  const alert = snapshot ? officialAlert(snapshot.distress, continuityTime, language) : null;
  const warningName = alert?.name;
  const replayOffline = !!snapshot && (connection !== 'online' || projection?.networkState.startsWith('OFFLINE') || projection?.networkState === 'RECONNECTING');
  const band = replayOffline
    ? <StatusBand tone="warn" label={`${exerciseLabel[language]} · ${lm.nowOfflineVerified} ${time(snapshot!.situation.latest_evidence_at,language)}`} />
    : alert
    ? <StatusBand tone="danger" label={`${exerciseLabel[language]} · ${alert.name}`} countdown={alert.deadlineAt ? formatCountdown(alert.deadlineAt-continuityTime) : null} />
    : <StatusBand tone="exercise" label={exerciseLabel[language]} />;
  const controlsEnabled = !!snapshot && !busy && battery.power.allowNonCriticalNetwork;
  const exerciseControls = view === 'demo' && snapshot && battery.power.mode !== 'SURVIVAL' ? <>
    <Button variant="secondary" disabled={!controlsEnabled || !['RUNNING', 'PAUSED'].includes(snapshot.replay.status)} onClick={() => void update(`${snapshot.replay.id}/next`)}>{t.next} →</Button>
    <Button variant="secondary" disabled={!controlsEnabled || snapshot.replay.status === 'COMPLETED'} onClick={() => void update(`${snapshot.replay.id}/${snapshot.replay.status === 'RUNNING' ? 'pause' : 'resume'}`)}>{snapshot.replay.status === 'RUNNING' ? t.pause : t.resume}</Button>
    <Button variant="secondary" disabled={!controlsEnabled} onClick={() => void update(`${snapshot.replay.id}/reset`)}>{t.reset}</Button>
    <select aria-label="Replay speed" value={snapshot.replay.speed} disabled={!controlsEnabled || snapshot.replay.status === 'COMPLETED'} onChange={e => void update(`${snapshot.replay.id}/speed`, { speed: Number(e.target.value) })}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>
    <span className="ui-exercise-meta">{snapshot.replay.current_event_index} / {snapshot.scenario_events.length}</span>
  </> : undefined;

  const offline = !!snapshot && (connection !== 'online' || snapshot.situation.network_state.startsWith('OFFLINE') || snapshot.situation.network_state === 'RECONNECTING');
  const status = <>
    {error && <p className="error" role="alert">{error}</p>}
    {storageError && <p className="error" role="alert">{t.storageError}</p>}
    {sessionMissing && <p className="now-meta" role="status">{t.sessionMissing} <Button variant="secondary" disabled={busy || !battery.power.allowNonCriticalNetwork} onClick={() => void update('start', { language })}>{t.newDemo}</Button></p>}
    {snapshot && offline && <div role="status"><p className="now-meta now-meta-warn">{projection?.networkState === 'RECONNECTING' ? t.reconnecting : t.offline} · {t.offlineDetail}</p>
      <p className="now-meta">{t.lastVerified}: {time(snapshot.situation.latest_evidence_at, language)} · {t.actualNetwork}: {connection === 'online' ? t.online : connection}</p>
      {connection !== 'online' && <Button variant="secondary" disabled={busy} onClick={() => { network('reconnecting'); void update(snapshot.replay.id, undefined, 'GET'); }}>{t.retry}</Button>}</div>}
  </>;

  if (!snapshot || !projection) return <AppShell tab="now" language={language} band={band}>
    {status}
    {view === 'demo' ? <Section title={exerciseLabel[language]}><h1 className="now-hero">{vt.demoMode}</h1><p>{t.introDetail}</p>
      <ScenarioPicker language={language} enabled={battery.power.allowNonCriticalNetwork && connection !== 'offline'} busy={busy} button={t.start} start={key => void update('start', { language, scenario_key: key })} />
    </Section> : <p className="now-meta">{t.empty}</p>}
  </AppShell>;

  // Same field mapping as Live's Now screen (hero / basis / next / avoid / updated), fed by the replayed snapshot.
  const presentation = derivePresentation(snapshot, continuityTime, connection, battery.power, check);
  const current = projection.plan;
  const usable = snapshot.plan_actions.filter(a => a.plan_id === current?.id && a.status === 'ACTIVE' && !projection.invalidActionIds.includes(a.id));
  const texts = (category: 'NEXT' | 'AVOID') => usable.filter(a => a.category === category).map(a => a.text);
  const critical = CRITICAL_MODES.includes(presentation.mode);
  const unverified = projection.networkState !== 'ONLINE_VERIFIED' || projection.evidence.some(e => e.freshness_status !== 'CURRENT');
  const primarySourceCurrent = projection.evidence.some(e => e.trust_status === 'VERIFIED_OFFICIAL' && e.freshness_status === 'CURRENT' && !e.conflict && e.affected_area_ids.some(id => snapshot.profile.current_location.area_ids.includes(id)));
  const noAlerts = noActiveAlertsAllowed({hasPlan:!!current, activeEventCount:snapshot.situation.active_event_ids.length, distressLevel:snapshot.distress.level, connection, networkState:projection.networkState, primarySourceCurrent});
  const hero = nowHeroText({actionText:presentation.primaryAction?.text, alert, language, critical, noAlerts, messages:lm as {emergency:string;noActiveAlerts:string;pending:string}});
  const heroTone = critical || warningName ? 'danger' : connection !== 'online' || unverified ? 'warn' : 'normal';
  const activeEvent = snapshot.events.findLast(event => snapshot.situation.active_event_ids.includes(event.id));
  const basisEvidence = projection.evidence.filter(e => e.trust_status === 'VERIFIED_OFFICIAL').at(-1) ?? null;
  const basis = alert && snapshot.distress.last_official_at ? distressText[language].basis.replace('{warning}',alert.name).replace('{time}',time(snapshot.distress.last_official_at,language)) : basisEvidence ? lm.basisPublished.replace('{source}', [basisEvidence.source_name, activeEvent ? lm[`event${activeEvent.event_type}`] : ''].filter(Boolean).join(' '))
    .replace('{time}', time(basisEvidence.published_at, language)) : null;
  const updatedPrefix = connection === 'offline' ? lm.nowOfflineVerified : unverified ? lm.nowLastVerified : lm.nowUpdated;
  const updatedLabel = `${updatedPrefix} ${time(snapshot.situation.latest_evidence_at, language)}`;
  const survival = battery.power.mode === 'SURVIVAL';
  const statusLabel = (status: string) => status === 'ACTIVE' ? t.active : status === 'EXPIRED' ? t.stale : ['INVALIDATED', 'PARTIALLY_INVALID', 'SUPERSEDED'].includes(status) ? t.invalid : t.unknown;
  const categoryLabel = (category: string) => category === 'NOW' ? t.now : category === 'NEXT' ? t.nextActions : t.avoid;

  const basisDetails = <>
    <p className="now-meta">{t.demoDetail}</p>
    {!survival && <>
      <Section title={t.plan}><div className="plan-history">{snapshot.plans.map(p => {
        const pe = snapshot.plan_evaluations.findLast(e => e.plan_id === p.id);
        const historical = projectContinuity({ ...snapshot, situation: { ...snapshot.situation, current_plan_id: p.id } }, continuityTime, connection);
        return <article key={p.id}><div className="section-head"><h3>Plan v{p.version}</h3><span className="badge">{statusLabel(historical.planStatus)}</span></div>
          <small>{time(p.created_at, language)} → {t.expires}: {time(p.expires_at, language)}</small>{pe?.reason && <p>{pe.reason}</p>}
          {snapshot.plan_actions.filter(a => a.plan_id === p.id).map(a => <p key={a.id} className={historical.invalidActionIds.includes(a.id) ? 'invalid' : ''}><b>{categoryLabel(a.category)}</b> · {a.text}{historical.invalidActionIds.includes(a.id) && ` · ${t.invalid}`}</p>)}</article>;
      })}{!snapshot.plans.length && <p className="now-meta">{t.empty}</p>}</div></Section>
      <Section title={t.sources}><div className="record-list">{projection.evidence.map(e => <article key={e.id}>
        <div className="section-head"><h3>{e.source_name}</h3><span className={`badge ${e.conflict || e.trust_status === 'CONFLICTING' || e.trust_status === 'UNVERIFIED' || e.freshness_status !== 'CURRENT' ? 'warn' : ''}`}>{e.conflict || e.trust_status === 'CONFLICTING' ? t.unknown : e.freshness_status !== 'CURRENT' ? t.stale : e.trust_status === 'UNVERIFIED' ? t.unknown : t.active}</span></div>
        <p>{e.summary}</p><p className="muted">{time(e.published_at, language)} · {t.expires}: {time(e.expires_at, language)} · {t.sourceAge}: {Math.max(0, Math.floor((continuityTime - Date.parse(e.published_at)) / 60_000))} min</p>
        <p className="muted">{e.conflict || e.trust_status === 'CONFLICTING' ? t.conflicting : e.trust_status === 'UNVERIFIED' ? t.unverified : t.verified}</p></article>)}
        {!snapshot.evidence.length && <p className="now-meta">{t.empty}</p>}</div></Section>
      <Section title={t.progress}><ol className="ui-exercise-list">{snapshot.scenario_events.map((e, i) => <li key={e.id} data-event-state={i < snapshot.replay.current_event_index ? 'processed' : 'pending'}>
        {i < snapshot.replay.current_event_index ? '✓ ' : ''}{e.label}<small>+{e.offset_seconds}s</small></li>)}</ol></Section>
      <PlanExplanationPanel snapshot={snapshot} language={language} scope="replay" enabled={connection === 'online' && battery.power.allowNonCriticalNetwork} />
      {view === 'demo' && <Section title={xc.setup}>
        <p className="now-meta">{t.location}: {snapshot.profile.current_location.label} · {t.destination}: {snapshot.profile.accommodation_location.label} · {t.simulatedTime}: {time(snapshot.replay.current_time, language)} JST</p>
        <ScenarioPicker language={language} currentKey={snapshot.replay.scenario_key} primary={false} enabled={battery.power.allowNonCriticalNetwork && connection !== 'offline'} busy={busy} button={t.newDemo} start={key => void update('start', { language, scenario_key: key })} />
      </Section>}
    </>}
    <Section title={emergencyPack[language].title}><p className="now-meta">{emergencyPack[language].label} · v{emergencyPack.version} · {emergencyPack.reviewed_at}</p>
      <p>{emergencyPack[language].shaking}</p><p>{emergencyPack[language].phone}</p><p>{emergencyPack[language].phrase}</p>
      {emergencyPack.sources.map(s => <p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.name} ↗</a></p>)}</Section>
    <Disclosure summary={xc.details} defaultOpen={view === 'trace'} id="exercise-details">
      <p className="now-meta">{xc.planning}: {snapshot.replay.planning_mode === 'GEMINI_ADK' ? t.ai : snapshot.replay.planning_mode === 'GEMINI_ADK_FALLBACK' ? t.modelFallback : t.fallback} · {projection.planStatus} · {projection.networkState}</p>
      <VNextExperience snapshot={snapshot} language={language} now={continuityTime} connection={connection} verificationAnchor={verificationAnchor.current} power={battery.power} level={battery.level} override={battery.override} choose={battery.choose} view="demo" showLocalTrace={view === 'trace'} deviceLocation={deviceLocation} check={check} setCheck={setCheck} />
      <Section title={t.trace}><div className="record-list">{[...snapshot.trace].reverse().map(e => <article key={e.id}><div className="section-head"><h3>{e.event_type}</h3><small>{time(e.timestamp, language)}</small></div>
        <p>{e.public_summary}</p><p className="muted">{e.agent} · {e.status} · {e.input_refs.join(', ')} → {e.output_refs.join(', ')}</p></article>)}
        {!snapshot.trace.length && <p className="now-meta">{t.empty}</p>}</div></Section>
    </Disclosure>
  </>;
  const help = <>
    <Button variant="danger" className="distress-entry-button" aria-expanded={distressOpen} onClick={() => setDistressOpen(open => !open)}>{sosText[language].title}</Button>

  </>;
  // Same position as Live: the safety check sits right under the Now screen (AdaptiveHome embedded); consent stays reachable
  // here because the exercise has no More settings of its own.
  const safetyCheck = <ReplaySafetyCheck check={check} setCheck={setCheck} language={language} visible={presentation.showSafetyCheck} hideTitle />;
  const demoPicker = <DrillLocationPicker language={language} caseId={null} value={demoPoint?.point ?? null}
    onChange={(point, location) => {
      setDemoPoint(point ? { point, prefecture: location?.area_ids.find(id => /^JP-\d{2}$/.test(id))?.slice(3) ?? null } : null);
      setDemoRoadLayerOn(Boolean(point));
    }} />;
  const exerciseMap = <MapScreen language={language} sheetOpen={demoSheetOpen} onSheetOpenChange={setDemoSheetOpen}
    // Without a chosen point the chip opens the sheet at the point picker; with one it toggles the reference lines.
    layers={[{key:'road-reference',label:roadLayerLabel(language),on:demoRoadLayerOn&&demoPoint!==null,
      toggle:()=>{if(demoPoint)setDemoRoadLayerOn(on=>!on);else setDemoSheetOpen(true);}}]}
    legend={null} region={null} routeSection={null} notice={demoRoadNoticeInChrome?<RoadReferenceNotice language={language}/>:null}
    map={<SimulationReferenceMap language={language} showInformation={false} legend="none" regionPicker={false}
      focusPoint={demoPoint?{lat:demoPoint.point.lat,lng:demoPoint.point.lng,zoom:14}:null} referenceRoutes={demoReferenceRoutes} userLocation={deviceLocation.position ? {lat:deviceLocation.position.latitude,lng:deviceLocation.position.longitude,accuracy_m:deviceLocation.position.accuracy_m,captured_at:deviceLocation.position.captured_at,source:'BROWSER_GEOLOCATION'} : null} />}
    peek={roadPeekText(language,demoRoadHazard,demoRoadReference)}
    sections={[
      {title:roadLayerLabel(language),content:<RoadReferenceSection language={language} exercise hazard={demoRoadHazard} reference={demoRoadReference}
        suppressNotice={demoRoadNoticeInChrome} pointControl={demoPicker}/>},
      { title: t.location, content: <DeviceLocationControls location={deviceLocation} language={language} /> },
    ]} />;
  return <AppShell tab={tab} language={language} band={band} exerciseControls={exerciseControls} fullBleed={tab === 'map'}
    onTab={setTab} localTabs={['now', 'map']}>
    {status}
    <button type="button" hidden={tab !== 'map' || distressOpen} className="ui-help-pin" aria-label={sosText[language].title} onClick={()=>setDistressOpen(true)}>{sosText[language].title}</button>
    {distressOpen && <HelpOverlay language={language} onClose={()=>setDistressOpen(false)}><DistressEntry snapshot={snapshot} language={language} scope="replay" fix={fixFromDevicePosition(deviceLocation.position)} now={continuityTime} onSnapshot={adoptDistress} refreshLocation={deviceLocation.permissionGranted ? () => void deviceLocation.locate() : undefined}/></HelpOverlay>}
    {tab === 'map' && <div data-testid="exercise-map">{battery.power.allowMap ? exerciseMap : <p className="now-meta">{vnextMessages[language].mapUnavailable}</p>}</div>}
    {/* The Now screen stays mounted (hidden) on the Map tab, so safety-check timers and an open help panel keep their state. */}
    <div hidden={tab === 'map'}>
      <NowScreen language={language} hero={hero} heroTone={heroTone} basis={basis} next={texts('NEXT')} avoid={texts('AVOID')}
        updatedLabel={updatedLabel} note={lm.notSafetyVerdict} exercise openBasis={view === 'trace'} basisDetails={basisDetails} help={help} />
      <AdaptiveHome embedded presentation={presentation} snapshot={snapshot} language={language} networkState={projection.networkState}
        planStatus={projection.planStatus} notifications={0} actions={usable} checkControls={safetyCheck} powerMode={battery.power.mode}
        location={deviceLocation} mapClosed={false} now={continuityTime} />
      {!presentation.showSafetyCheck && safetyCheck}
    </div>
  </AppShell>;
}
