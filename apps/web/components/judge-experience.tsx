'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Language } from '@/lib/contracts';
import type { MockLiveResponse } from '@/lib/mock-live-envelope';
import { judgeProjection, judgeRequest, judgeText } from '@/lib/judge-experience';
import { useTheme } from '@/lib/use-theme';
import { exerciseHeroText } from '@/lib/now-status';
import { Button, Disclosure, Section, StatusBand } from './ui';
import { NowScreen } from './now-screen';

export function JudgeEntry({ language }: { language: Language }) {
  const t = judgeText[language];
  return <section className="judge-entry" aria-label={t.entry}>
    <h2>{t.lead}</h2><p>{t.purpose}</p>
    <Link className="ui-btn ui-btn-primary" href="/judge">{t.entry}</Link>
  </section>;
}

type StepRecord = { response: MockLiveResponse; previous: MockLiveResponse | null };
function actionSignature(response: MockLiveResponse | null) {
  return response?.snapshot.plan_actions.filter(a => a.plan_id === response.snapshot.situation.current_plan_id)
    .map(a => [a.category, a.intent_id, a.text, a.safety_decision]).sort().map(a => JSON.stringify(a)).join('|');
}

/** A volatile, one-owner walkthrough. Only event input advances; every displayed plan comes from the existing pipeline. */
export function JudgeExperience() {
  useTheme();
  const [language, setLanguage] = useState<Language>('ja');
  const [ready, setReady] = useState(false);
  const [record, setRecord] = useState<StepRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  const [needsRecheck, setNeedsRecheck] = useState(false);
  const lock = useRef(false);
  const task = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const interrupted = useRef(false);
  const t = judgeText[language];

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    setReady(true);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const offline = () => { interrupted.current = true; setNeedsRecheck(true); setOnline(false); };
    const connected = () => setOnline(true);
    setOnline(navigator.onLine);
    window.addEventListener('offline', offline); window.addEventListener('online', connected);
    return () => { task.current?.abort(); clearInterval(timer); window.removeEventListener('offline', offline); window.removeEventListener('online', connected); };
  }, []);
  useEffect(() => { if (record || summary) heading.current?.focus(); }, [record, summary]);

  const response = record?.response;
  const previous = record?.previous;
  const projection = response ? judgeProjection(response, now, online) : null;
  const currentPlan = projection?.plan;
  const usable = !!projection && currentPlan?.status === 'ACTIVE' && !['EXPIRED', 'INVALIDATED'].includes(projection.planStatus)
    && online && !needsRecheck && !busy && !error;
  const actions = usable ? projection.actions : [];
  const currentEvent = response?.historical?.current_milestone;
  const complete = !!response && response.current_step === response.total_steps;
  const aiCounts = { success: 0, fallback: 0, notRun: 0 };
  for (const assessment of response?.movement_assessment_history ?? []) {
    aiCounts[assessment.ai_mode === 'GEMINI_ADK' ? 'success' : assessment.ai_mode === 'GEMINI_ADK_FALLBACK' ? 'fallback' : 'notRun']++;
  }
  const first = !previous?.snapshot.situation.current_plan_id;
  const newPlan = currentPlan?.id !== previous?.snapshot.situation.current_plan_id;
  const sameAction = actionSignature(response ?? null) === actionSignature(previous ?? null);
  const updateLabel = first ? t.first : newPlan ? sameAction ? t.refreshed : t.changed : t.kept;

  const advance = async () => {
    if (lock.current || !online || error || complete) return;
    lock.current = true; setBusy(true); setError('');
    const controller = new AbortController(); task.current = controller;
    interrupted.current = false;
    try {
      const base = response ?? await judgeRequest('start', controller.signal, language);
      if (!response && base.current_step !== 0) throw new Error('Unexpected initial step');
      const result = await judgeRequest(base.snapshot.session_id + '/next', controller.signal);
      if (controller.signal.aborted) return;
      if (result.snapshot.session_id !== base.snapshot.session_id || result.current_step !== base.current_step + 1) {
        throw new Error('Unexpected event transition');
      }
      setRecord({ response: result, previous: response ?? null });
      setNeedsRecheck(interrupted.current); setNow(Date.now());
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error && ['429', '503'].includes(reason.message) ? t.capacity : t.error);
    } finally {
      if (task.current === controller) { lock.current = false; setBusy(false); task.current = null; }
    }
  };
  const restart = () => {
    task.current?.abort(); task.current = null; lock.current = false;
    setRecord(null); setError(''); setSummary(false); setBusy(false); setNeedsRecheck(false);
    heading.current?.focus();
  };
  const aiResult = response?.movement_assessment?.ai_mode;
  const currentAi = aiResult === 'GEMINI_ADK' ? t.success : aiResult === 'GEMINI_ADK_FALLBACK' ? t.fallback : t.notRun;
  const rawNow = response?.snapshot.plan_actions.find(a => a.plan_id === currentPlan?.id && a.category === 'NOW');
  const hero = usable ? exerciseHeroText({ started: true, distress: response?.snapshot.distress, now: projection!.clock, language,
    planNowIntent: rawNow?.intent_id, safetyCoreNowText: actions.find(a => a.category === 'NOW')?.text ?? '', adviceText: null,
    messages: { awaiting: t.empty, waiting: t.empty } }) : busy ? t.processing : t.expired;
  const previousNow = previous?.snapshot.plan_actions.filter(a => a.plan_id === previous.snapshot.situation.current_plan_id
    && a.category === 'NOW' && a.safety_decision === 'ALLOW') ?? [];

  return <div className="ui-app judge-experience" data-testid="judge-experience">
    <StatusBand tone="exercise" label={t.notice} />
    <main className="ui-main">
      <header className="judge-header"><Link href="/">72H</Link>
        <label>{t.language}<select aria-label={t.language} value={language} disabled={busy || !!response} onChange={e => setLanguage(e.target.value as Language)}>
          <option value="ja">日本語</option><option value="en">English</option><option value="zh-TW">繁體中文</option><option value="zh-CN">简体中文</option>
        </select></label>
      </header>
      <p className="judge-scenario">2011.03.11 · {t.title}</p>
      {!response && !summary && <div data-testid="judge-intro">
        <h1 ref={heading} tabIndex={-1} className="now-hero">{t.lead}</h1>
        <p className="judge-purpose">{t.purpose}</p><p>{t.persona}</p>
        <p className="now-meta">{t.assumptions}</p>
        <p className="judge-pace">{t.pace}</p>
        <Button variant="primary" data-testid="judge-start" disabled={!ready || busy || !online || !!error} onClick={() => void advance()}>{t.start}</Button>
        <p className="judge-limits now-meta">{t.limits}</p>
        <Disclosure summary={t.advanced}><Link href="/disaster-test">{t.advanced}</Link></Disclosure>
      </div>}
      {busy && <p className="judge-processing" role="status">{t.processing}</p>}
      {!online && <p className="judge-state" role="status">{t.expired}</p>}
      {error && <p className="judge-state" role="alert">{error}</p>}
      {response && !summary && <>
        <div className="judge-event" data-testid="judge-current-event">
          <span>{t.event} {response.current_step} / {response.total_steps}</span>
          <h2 ref={heading} tabIndex={-1}>{currentEvent?.at_jst.slice(11, 16)} JST · {currentEvent?.label[language]}</h2>
          <p className="now-meta">{t.persona}</p>
        </div>
        <NowScreen language={language} exercise hero={hero}
          heroTone={usable ? 'normal' : 'warn'} basis={currentPlan ? `${t.version} v${currentPlan.version} · ${updateLabel}` : t.empty}
          next={actions.filter(a => a.category === 'NEXT').map(a => a.text)} avoid={actions.filter(a => a.category === 'AVOID').map(a => a.text)}
          updatedLabel={`${t.updated}: ${new Date(response.snapshot.situation.updated_at).toLocaleString(language, { timeZone: 'Asia/Tokyo' })} JST`}
          note={t.limits} openBasis={false} help={null} basisDetails={<>
            {currentEvent && <p><a href={currentEvent.source_url} target="_blank" rel="noopener noreferrer">{t.historical}</a> · {currentEvent.at_jst}</p>}
            <ul className="judge-evidence">{projection?.evidence.filter(e => currentPlan?.based_on_evidence_ids.includes(e.id)).map(e => <li key={e.id}>
              <strong>{e.source_name}</strong><p>{e.summary}</p><small>{e.id} · {e.trust_status} · {e.freshness_status}</small>
            </li>)}</ul>
            <p>{t.ai}: {currentAi}</p>
          </>} />
        <section className="judge-change" data-testid="judge-change" aria-label={t.why}>
          <h2>{t.why}</h2><p>{updateLabel}</p>
          {usable && rawNow ? <p>{rawNow.safety_decision === 'BLOCK' ? t.blockedReason : rawNow.reason}</p> : <p>{busy ? t.processing : t.expired}</p>}
          {previousNow.length > 0 && <Disclosure summary={t.before}><p className="now-meta">{t.archive}</p>{previousNow.map(a => <p key={a.id}>{a.text}</p>)}</Disclosure>}
        </section>
      </>}
      {response && summary && <section data-testid="judge-summary">
        <h1 ref={heading} tabIndex={-1} className="now-hero">{t.finished}</h1><p>{t.takeaway}</p>
        <dl className="judge-results">
          <div><dt>{t.evaluated}</dt><dd>{response.current_step} / {response.total_steps}</dd></div>
          <div><dt>{t.plans}</dt><dd>{response.snapshot.plans.length}</dd></div>
          <div><dt>{t.safety}</dt><dd>{t.no}</dd></div>
        </dl>
        <Section title={t.ai}><ul className="now-list"><li>{t.success}: {aiCounts.success}</li><li>{t.fallback}: {aiCounts.fallback}</li><li>{t.notRun}: {aiCounts.notRun}</li></ul></Section>
        <p className="now-meta">{t.retained}</p>
        <Section title={t.history}><p className="now-meta">{t.archive}</p>
          {response.snapshot.plans.map(plan => <article className="judge-history-plan" key={plan.id}>
            <h3>{t.version} v{plan.version}</h3>
            {response.snapshot.plan_actions.filter(a => a.plan_id === plan.id && a.category === 'NOW').map(a => <p key={a.id}>
              {exerciseHeroText({ started: true, distress: null, now: Date.parse(plan.created_at), language,
                planNowIntent: a.intent_id, safetyCoreNowText: a.safety_decision === 'ALLOW' ? a.text : '', adviceText: null,
                messages: { awaiting: t.empty, waiting: t.empty } })}<br/>
              <small>{a.safety_decision === 'BLOCK' ? t.blockedReason : a.reason}</small>
            </p>)}
            <small>{new Date(plan.created_at).toLocaleString(language, { timeZone: 'Asia/Tokyo' })} JST</small>
          </article>)}
        </Section>
      </section>}
      {response?.historical && <Disclosure summary={t.history} defaultOpen={summary}><ol className="judge-timeline">
        {response.historical.milestones.map((event, i) => <li key={event.at_jst} data-event-state={i < response.current_step ? 'processed' : 'pending'}>
          <span>{event.at_jst.slice(11, 16)} JST</span> {event.label[language]}{i >= response.current_step && <small> · {t.pending}</small>}
          <a href={event.source_url} target="_blank" rel="noopener noreferrer">{t.historical}</a>
        </li>)}
      </ol></Disclosure>}
      {(error || summary) && <Button variant="primary" data-testid="judge-restart" onClick={restart}>{t.restart}</Button>}
      <footer className="judge-footer"><Link href="/">{t.exit}</Link> · <Link href="/disaster-test">{t.advanced}</Link></footer>
    </main>
    {response && !summary && !error && <div className="judge-controls">
      <Button variant="primary" data-testid={complete ? 'judge-review' : 'judge-next'} disabled={busy || (!complete && !online)}
        onClick={() => { if (complete) setSummary(true); else void advance(); }}>{complete ? t.review : t.next}</Button>
    </div>}
  </div>;
}
