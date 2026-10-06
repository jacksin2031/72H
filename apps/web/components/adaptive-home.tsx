'use client';
import Link from 'next/link';
import React, { type ReactNode } from 'react';
import type { Action, Language, Snapshot } from '../lib/contracts';
import type { PresentationProjection } from '../lib/adaptive-ui';
import type { DeviceLocation } from '../lib/use-device-location';
import { adaptiveMessages } from '../lib/adaptive-i18n';
import { vnextMessages } from '../lib/vnext-i18n';

export function AdaptiveHome({ presentation, snapshot, language, networkState, planStatus, notifications,
  actions, mapSurface, checkControls, powerMode, location, openMap, mapClosed }: {
  presentation: PresentationProjection; snapshot: Snapshot; language: Language; networkState: string;
  planStatus: string; notifications: number; actions: Action[]; mapSurface?: ReactNode; checkControls?: ReactNode;
  powerMode: string; location: DeviceLocation; openMap: () => void; mapClosed: boolean;
}) {
  const t = adaptiveMessages[language];
  const vt = vnextMessages[language];
  const offline = networkState !== 'ONLINE_VERIFIED';
  const stale = networkState === 'OFFLINE_STALE' || planStatus === 'EXPIRED' || presentation.reasonCodes.includes('NOW_EVIDENCE_NOT_CURRENT');
  const stamp = snapshot.situation.latest_evidence_at;
  const verifiedTime = stamp ? new Date(stamp).toLocaleString(language, { timeZone: 'Asia/Tokyo' }) : '—';
  const mode = presentation.mode;
  const survival = mode === 'SURVIVAL';
  const restricted = survival || powerMode === 'EMERGENCY_POWER';
  const action = presentation.primaryAction;
  const evidenceLinks = (ids: string[]) => ids.map(id => {
    const e = snapshot.evidence.find(item => item.id === id);
    return <Link key={id} href="/sources">{e?.source_name ?? vt.unknown}</Link>;
  });
  return <section className={`adaptive-home presentation-${mode.toLowerCase()}`} data-presentation-mode={mode}>
    <header className="situation-header">
      <div><h1>{mode === 'EMERGENCY_PROTECT' ? t.protect : mode === 'SAFETY_CHECK' ? vt.check : survival ? t.survival : mode === 'MAP_ASSISTED' ? t.movement : mode === 'TEXT_WITH_DETAILS' ? t.prepare : t.monitoring}</h1>
        <p>{networkState === 'RECONNECTING' ? t.reconnecting : stale ? t.stale : offline ? t.cached : mode === 'MAP_ASSISTED' ? t.movementDetail : t.summary}</p></div>
      {!survival && <Link className="notification-badge" href="/notifications" aria-label={`${t.notifications} · ${notifications}`}>🔔 {presentation.showNotificationsBadge && <span>{notifications}</span>}</Link>}
    </header>
    {(offline || stale) && <p className="freshness-warning" role="status">{t.lastVerified}: {verifiedTime} · {stale ? t.stale : t.cached}</p>}
    <section className="now-card" aria-labelledby="primary-now"><small id="primary-now">NOW</small><h2>{action?.text || t.pending}</h2></section>
    {presentation.showEvidenceInline && action && <p className="inline-evidence">{evidenceLinks(action.evidence_ids)}</p>}
    {presentation.showSafetyCheck && checkControls}
    {presentation.showPowerWarning && <p className="power-warning" role="status">⚠ {powerMode === 'SURVIVAL' ? t.survival : powerMode === 'EMERGENCY_POWER' ? t.emergencyPower : t.conserve} · <Link href="/more">{t.power}</Link></p>}
    {presentation.showMap && <>
      {presentation.showDestination && <p>{t.destination}: {snapshot.profile.current_destination?.label ?? vt.unknown}</p>}
      {presentation.showRoute && <p className="route-state" role="status">{presentation.routeText === 'BLOCKED' ? t.routeBlocked : presentation.routeText === 'UNKNOWN' ? t.routeUnknown : presentation.routeText === 'VERIFIED_USABLE_CANDIDATE' ? t.routeUsable : t.routeCandidate}</p>}
      {mapSurface}
    </>}
    {mapClosed && !presentation.showMap && <p role="status" className="muted">{t.mapEnded}</p>}
    {survival && <><p>{t.lastVerified}: {verifiedTime}</p><p>{t.position}: {location.position ? `${location.position.latitude.toFixed(4)}, ${location.position.longitude.toFixed(4)} · ±${Math.round(location.position.accuracy_m)} m · ${new Date(location.position.captured_at).toLocaleString(language, { timeZone: 'Asia/Tokyo' })} · ${vt.locationStates.last}` : t.noPosition}</p></>}
    {(survival || mode === 'SAFETY_CHECK') && <section className="emergency-contact"><h2>{t.emergency}</h2><p>{t.emergencyDetail}</p><a href="tel:119">119</a> · <a href="tel:110">110</a></section>}
    {!restricted && <details className="plan-sheet"><summary>{t.details}</summary>
      {action && <><p>{action.reason}</p>{evidenceLinks(action.evidence_ids)}</>}
      {(['NEXT', 'AVOID'] as const).map(category => <section key={category}><h2>{category}</h2>{actions.filter(item => item.category === category).map(item => <article key={item.id}><h3>{item.text}</h3><p>{item.reason}</p>{evidenceLinks(item.evidence_ids)}</article>)}</section>)}
      <p>{t.lastVerified}: {verifiedTime}</p>
      <Link href="/plan">{vt.savedPlan}</Link>
      <button type="button" onClick={openMap}>{t.map}</button>
    </details>}
    {restricted && <Link className="essential-settings" href="/more">{t.settings}</Link>}
  </section>;
}
