'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { snapshotSchema, type Language, type Snapshot } from '@/lib/contracts';
import { messages } from '@/lib/i18n';
import { canReconcile, loadSnapshot, projectContinuity, replayClock, saveSnapshot, type CacheEnvelope } from '@/lib/continuity';
import { emergencyPack } from '@/lib/emergency-pack';

const routes = ['dashboard', 'plan', 'sources', 'trace', 'demo'] as const;
function time(value: string | null, language: Language) {
  return value ? new Date(value).toLocaleTimeString(language, { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) : '—';
}

export function Dashboard({ view }: { view: string }) {
  const [language, setLanguage] = useState<Language>('ja');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<'online' | 'offline' | 'reconnecting'>('online');
  const [wallNow, setWallNow] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const [sessionMissing, setSessionMissing] = useState(false);
  const requestPending = useRef(false);
  const envelope = useRef<CacheEnvelope | null>(null);
  const offlineBase = useRef<Snapshot | null>(null);
  const connectionRef = useRef<'online' | 'offline' | 'reconnecting'>('online');
  const t = messages[language];

  const network = useCallback((value: 'online' | 'offline' | 'reconnecting') => {
    connectionRef.current = value;
    setConnection(value);
  }, []);

  const update = useCallback(async (path: string, body?: object, method = 'POST') => {
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
      if (path === 'start' || path.endsWith('/reset')) { network('online'); offlineBase.current = null; }
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
      network('offline');
      if (envelope.current) { envelope.current = { ...envelope.current, connection: 'offline' }; void saveSnapshot(envelope.current).catch(() => setStorageError(true)); }
    }
    finally { requestPending.current = false; setBusy(false); }
  }, [language, network]);

  useEffect(() => {
    const savedLanguage = localStorage.getItem('72h-language');
    if (savedLanguage && ['ja', 'en', 'zh-TW'].includes(savedLanguage)) setLanguage(savedLanguage as Language);
    let cancelled = false;
    void (async () => {
      const saved = await loadSnapshot().catch(() => null);
      if (cancelled) return;
      if (saved) {
        envelope.current = saved; setSnapshot(saved.snapshot);
        if (saved.connection !== 'online' || !navigator.onLine) { offlineBase.current = saved.snapshot; network('reconnecting'); }
      }
      if (!navigator.onLine) { network('offline'); return; }
      const session = saved?.snapshot.replay.id || localStorage.getItem('72h-session');
      if (session && /^[a-zA-Z0-9_-]{1,80}$/.test(session)) void update(session, undefined, 'GET');
    })();
    const onOffline = () => {
      offlineBase.current ||= envelope.current?.snapshot || null; network('offline');
      if (envelope.current) { envelope.current = { ...envelope.current, connection: 'offline' }; void saveSnapshot(envelope.current).catch(() => setStorageError(true)); }
    };
    const onOnline = () => { network('reconnecting'); const session = envelope.current?.snapshot.replay.id; if (session) void update(session, undefined, 'GET'); };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    const clock = setInterval(() => setWallNow(Date.now()), 5000);
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => setStorageError(true));
    // Restore once; subsequent language changes apply to the next new session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { cancelled = true; window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); clearInterval(clock); };
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    if (!snapshot || busy || connection === 'offline' || snapshot.replay.status !== 'RUNNING') return;
    const index = snapshot.replay.current_event_index;
    const next = snapshot.scenario_events[index];
    if (!next) return;
    const previous = index ? snapshot.scenario_events[index - 1].offset_seconds : 0;
    const delay = Math.max(0, next.offset_seconds - previous) * 1000 / snapshot.replay.speed;
    const timer = setTimeout(() => void update(`${snapshot.replay.id}/next`), delay);
    return () => clearTimeout(timer);
  }, [snapshot, busy, connection, update]);

  const continuityTime = snapshot ? ((connection !== 'online' || snapshot.situation.network_state.startsWith('OFFLINE')) && envelope.current ? replayClock(envelope.current, wallNow || Date.now()) : Date.parse(snapshot.replay.current_time)) : 0;
  const projection = snapshot ? projectContinuity(snapshot, continuityTime, connection) : null;
  const current = projection?.plan;
  const displayEvidence = projection?.evidence || [];
  const evaluation = current && snapshot?.plan_evaluations.findLast(e => e.plan_id === current.id);
  const actions = snapshot?.plan_actions.filter(a => a.plan_id === current?.id) || [];
  const navLabels = { dashboard: t.dashboard, plan: t.plan, sources: t.sources, trace: t.trace, demo: t.demo };

  return <div className="shell">
    <aside className="sidebar">
      <Link className="brand" href="/">72<span>H</span><small>{t.tagline}</small></Link>
      <nav aria-label="Main">{routes.map((route, index) => <a key={route} className={view === route ? 'selected' : ''} href={`/${route}`} aria-current={view === route ? 'page' : undefined}><span className="nav-number">0{index + 1}</span>{navLabels[route]}</a>)}</nav>
      <div className="sidebar-foot"><span className="dot" />{t.demoNotice}<p>SHIBUYA → ASAKUSA</p></div>
    </aside>
    <main>
      <header className="topbar"><span className="eyebrow">72H / TOKYO</span><select aria-label="Language" value={language} onChange={event => { const value = event.target.value as Language; setLanguage(value); localStorage.setItem('72h-language', value); }}><option value="ja">日本語</option><option value="en">English</option><option value="zh-TW">繁體中文</option></select></header>
      <div className="simulation"><strong>{t.demoNotice}</strong><span>{t.demoDetail}</span></div>
      {error && <p className="error" role="alert">{error}</p>}
      {sessionMissing && <section className="offline-banner"><p>{t.sessionMissing}</p><button disabled={busy} onClick={() => void update('start', { language })}>{t.newDemo}</button></section>}
      {storageError && <p className="error" role="alert">{t.storageError}</p>}
      {snapshot && (connection !== 'online' || snapshot.situation.network_state.startsWith('OFFLINE') || snapshot.situation.network_state === 'RECONNECTING') && <section className="offline-banner" role="status"><strong>{projection?.networkState === 'RECONNECTING' ? t.reconnecting : t.offline}</strong><p>{t.offlineDetail}</p><small>{t.lastVerified}: {time(snapshot.situation.latest_evidence_at, language)} · {t.actualNetwork}: {connection === 'online' ? t.online : connection}</small>{connection !== 'online' && <div><button disabled={busy} onClick={() => { network('reconnecting'); void update(snapshot.replay.id, undefined, 'GET'); }}>{t.retry}</button></div>}</section>}
      {!snapshot ? <section className="intro"><p className="eyebrow">FROM ALERT TO ACTION</p><h1>{['dashboard', 'demo'].includes(view) ? t.intro : navLabels[view as keyof typeof navLabels]}</h1><p>{['dashboard', 'demo'].includes(view) ? t.introDetail : t.empty}</p><div className="journey"><span>SHIBUYA</span><span>············ →</span><span>ASAKUSA</span></div><button className="primary" disabled={busy} onClick={() => void update('start', { language })}>{busy ? '…' : t.start} <span>→</span></button></section> : <>
        <section className="heading"><div><p className="eyebrow">{snapshot.situation.active_event_ids.length ? 'EARTHQUAKE / REPLAY' : 'READY / REPLAY'}</p><h1>{view === 'dashboard' ? (snapshot.situation.active_event_ids.length ? t.earthquake : t.noEmergency) : navLabels[view as keyof typeof navLabels]}</h1></div><div className="status-pill"><span className="dot" />{projection?.networkState}</div></section>
        <div className="context-grid"><div><small>{t.location}</small><strong>{snapshot.profile.current_location.label}</strong></div><div><small>{t.destination}</small><strong>{snapshot.profile.accommodation_location.label}</strong></div><div><small>{t.simulatedTime} / JST</small><strong>{time(snapshot.replay.current_time, language)}</strong></div><div><small>{t.lastVerified}</small><strong>{time(snapshot.situation.latest_evidence_at, language)}</strong></div></div>
        <div className="controls"><button disabled={busy || snapshot.replay.status === 'COMPLETED'} onClick={() => void update(`${snapshot.replay.id}/${snapshot.replay.status === 'RUNNING' ? 'pause' : 'resume'}`)}>{snapshot.replay.status === 'RUNNING' ? t.pause : t.resume}</button><button disabled={busy || !['RUNNING', 'PAUSED'].includes(snapshot.replay.status)} onClick={() => void update(`${snapshot.replay.id}/next`)}>{t.next} →</button><button disabled={busy} onClick={() => void update(`${snapshot.replay.id}/reset`)}>{t.reset}</button><select aria-label="Replay speed" value={snapshot.replay.speed} disabled={busy || snapshot.replay.status === 'COMPLETED'} onChange={e => void update(`${snapshot.replay.id}/speed`, { speed: Number(e.target.value) })}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select><small>{snapshot.replay.current_event_index} / {snapshot.scenario_events.length}</small></div>
        {['dashboard', 'demo'].includes(view) && <>
          <div className="section-head"><h2>{current ? `${snapshot.situation.current_plan_id !== current.id || connection !== 'online' ? `${t.lastPlan} · ` : ''}Plan v${current.version}` : t.pending}</h2><span>{projection?.planStatus || 'WAITING_FOR_EVIDENCE'}</span></div>
          {current && <p className="muted">{t.lastVerified}: {time(current.created_at, language)} · {t.expires}: {time(current.expires_at, language)}</p>}
          <p className="muted">{snapshot.replay.planning_mode === 'GEMINI_ADK' ? t.ai : snapshot.replay.planning_mode === 'GEMINI_ADK_FALLBACK' ? t.modelFallback : t.fallback} · {t.noMovement}</p>
          <div className="action-grid">{(['NOW', 'NEXT', 'AVOID'] as const).map((category, index) => <section key={category} className={`action-panel panel-${category.toLowerCase()}`}><div className="panel-title"><span>0{index + 1}</span><div><small>{category}</small><h2>{category === 'NOW' ? t.now : category === 'NEXT' ? t.nextActions : t.avoid}</h2></div></div>{actions.filter(a => a.category === category).map(a => {
            const invalid = projection?.invalidActionIds.includes(a.id) || evaluation?.invalid_action_ids.includes(a.id) || a.status !== 'ACTIVE';
            return <article key={a.id} className={invalid ? 'action invalid' : 'action'}><h3>{a.text}</h3><span className="badge">{invalid ? t.invalid : a.risk_level}</span><details><summary>{t.why}</summary><p>{a.reason}</p>{a.evidence_ids.map(id => <Link key={id} href="/sources">{t.evidence}: {id}</Link>)}</details></article>;
          })}{!actions.some(a => a.category === category) && <p className="muted">{t.waitingPlan}</p>}</section>)}</div>
          {view === 'demo' && <section className="record-list"><h2>{t.progress}</h2>{snapshot.scenario_events.map((e, i) => <div className="timeline-item" key={e.id}><span>{i < snapshot.replay.current_event_index ? '✓' : '○'}</span><strong>{e.label}</strong><small>+{e.offset_seconds}s</small></div>)}</section>}
        </>}
        {view === 'plan' && <section className="record-list">{snapshot.plans.map(p => { const pe = snapshot.plan_evaluations.findLast(e => e.plan_id === p.id); const historical = projectContinuity({ ...snapshot, situation: { ...snapshot.situation, current_plan_id: p.id } }, continuityTime, connection); return <article key={p.id}><div className="section-head"><h2>Plan v{p.version}</h2><span className="badge">{historical.planStatus}</span></div><p>{time(p.created_at, language)} → {t.expires}: {time(p.expires_at, language)}</p>{pe?.reason && <p>{pe.reason}</p>}{snapshot.plan_actions.filter(a => a.plan_id === p.id).map(a => <p key={a.id} className={historical.invalidActionIds.includes(a.id) ? 'invalid' : ''}><b>{a.category}</b> · {a.text}{historical.invalidActionIds.includes(a.id) && ` · ${t.invalid}`}</p>)}</article>; })}{!snapshot.plans.length && <p>{t.empty}</p>}</section>}
        {view === 'sources' && <section className="record-list">{displayEvidence.map(e => <article key={e.id}><div className="section-head"><h2>{e.source_name}</h2><span className={`badge ${e.conflict || e.trust_status === 'CONFLICTING' || e.trust_status === 'UNVERIFIED' || e.freshness_status !== 'CURRENT' ? 'warn' : ''}`}>{e.conflict || e.trust_status === 'CONFLICTING' ? 'CONFLICTING' : e.freshness_status === 'CURRENT' ? e.trust_status : e.freshness_status}</span></div><p>{e.summary}</p><p className="muted">{e.freshness_status} · {time(e.published_at, language)} · {t.expires}: {time(e.expires_at, language)} · {t.sourceAge}: {Math.max(0, Math.floor((continuityTime - Date.parse(e.published_at)) / 60_000))} min</p><p>{e.conflict || e.trust_status === 'CONFLICTING' ? t.conflicting : e.trust_status === 'UNVERIFIED' ? t.unverified : t.verified}</p><code>{e.id} · {e.raw_reference}</code></article>)}{!snapshot.evidence.length && <p>{t.empty}</p>}</section>}
        {view === 'trace' && <section className="record-list">{[...snapshot.trace].reverse().map(e => <article key={e.id}><div className="section-head"><h3>{e.event_type}</h3><small>{time(e.timestamp, language)}</small></div><p>{e.public_summary}</p><small>{e.agent} · {e.status}</small><p className="muted">{e.input_refs.join(', ')} → {e.output_refs.join(', ')}</p></article>)}{!snapshot.trace.length && <p>{t.empty}</p>}</section>}
      </>}
      <section className="record-list emergency-pack"><h2>{emergencyPack[language].title}</h2><p className="muted">{emergencyPack[language].label} · v{emergencyPack.version} · {emergencyPack.reviewed_at}</p><p>{emergencyPack[language].shaking}</p><p>{emergencyPack[language].phone}</p><p>{emergencyPack[language].phrase}</p>{emergencyPack.sources.map(s => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.name} ↗ </a>)}</section>
      <footer>72H · From Alert to Action. <span>{t.noMovement}</span></footer>
    </main>
  </div>;
}
