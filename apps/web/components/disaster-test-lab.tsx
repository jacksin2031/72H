'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Language } from '@/lib/contracts';
import {
  defaultDisasterTest, disasterPresets, projectDisasterTest,
  type DisasterKind, type DisasterTestInput, type TestEvidence, type TestMobility,
  type TestNetwork, type TestSeverity,
} from '@/lib/disaster-test';
import { AgentDrillPanel } from './agent-drill-panel';
import './disaster-test.css';

const copy = {
  ja: {
    title: '災害シミュレーション', test: 'テストモード — 実際の警報ではありません',
    explanation: 'ここで条件を設定し、開始すると独立した72H模擬ホームへ移動します。実際の電池・通信・GPS・緊急通報・公式Live状態は変更しません。',
    back: '設定に戻る', presets: 'すぐに試す', routine: '平常時', moderate: '中程度', critical: '重大・オフライン', survival: '残量3%',
    settings: 'シナリオ条件', disaster: '災害の種類', severity: '模擬レベル（公式の震度等とは異なります）',
    battery: '模擬バッテリー残量', batteryUnknown: '残量不明を再現', network: '模擬通信', evidence: '模擬情報の状態', mobility: '本人の状態',
    preview: '模擬画面', now: 'NOW · 模擬表示', next: 'NEXT · 模擬表示', avoid: 'AVOID · 模擬表示',
    level: 'レベル', normal: '通常', conserve: '省電力', emergencyPower: '緊急省電力', survivalPower: '最低限の表示',
    networkOnline: 'オンライン', networkOffline: 'オフライン', networkReconnect: '再接続中',
    evidenceFresh: '最新（模擬）', evidenceStale: '期限切れ', evidenceUnknown: '未確認', able: '移動可能', cannotMove: '移動できない',
    earthquake: '地震', tsunami: '津波', typhoon: '台風', flood: '洪水', landslide: '土砂災害', fire: '火災',
    none: '平常の準備状況を表示', monitor: '警戒情報を確認', emergency: '緊急保護状態を確認', check: '安否確認状態を表示',
    lowPower: '最小限のテキスト表示を優先', unverified: '公式情報の確認が必要', simulatedFresh: '模擬情報は最新ですが、正式な安全認証には使用できません',
    nextAction: '安全な場所で公式情報を再確認', avoidAction: '未確認の移動経路や避難先を安全と見なさない',
    checkTitle: '安否確認の模擬操作', safe: '安全', needHelp: '支援が必要', stuck: '動けない', checkResult: '模擬回答',
    noCheck: '重大レベルで安否確認のテストが表示されます', mapBlocked: '避難地図・移動許可は常に無効（模擬データ）',
    powerMode: '模擬省電力モード', map: '模擬地図', disabled: '無効', notify: '警報送信', no: 'なし', reset: 'すべて初期化',
    noRealEmergency: '119 / 110 は参考表示のみ。ここから電話をかけることはできません。',
    threshold: '模擬残量が 30% 以下で省電力、15% 以下で緊急省電力、5% 以下で最低限の表示になります。',
  },
  en: {
    title: 'Disaster test lab', test: 'TEST MODE — Not a real emergency alert',
    explanation: 'Configure the drill here. Start to enter the isolated 72H simulation home, with timed events and actual Mock Live / AI decisions. No real GPS, battery, alerts or calls change.',
    back: 'Back to settings', presets: 'Quick scenarios', routine: 'Routine', moderate: 'Moderate', critical: 'Critical / offline', survival: '3% battery',
    settings: 'Scenario settings', disaster: 'Hazard type', severity: 'Simulated level (not an official hazard scale)',
    battery: 'Simulated battery', batteryUnknown: 'Simulate unknown level', network: 'Simulated network', evidence: 'Simulated source status', mobility: 'Mobility',
    preview: 'Simulated view', now: 'NOW · Simulation', next: 'NEXT · Simulation', avoid: 'AVOID · Simulation',
    level: 'Level', normal: 'Normal', conserve: 'Conserve', emergencyPower: 'Emergency power', survivalPower: 'Minimal display',
    networkOnline: 'Online', networkOffline: 'Offline', networkReconnect: 'Reconnecting',
    evidenceFresh: 'Recent (simulated)', evidenceStale: 'Stale', evidenceUnknown: 'Unverified', able: 'Able to move', cannotMove: 'Unable to move',
    earthquake: 'Earthquake', tsunami: 'Tsunami', typhoon: 'Typhoon', flood: 'Flood', landslide: 'Landslide', fire: 'Fire',
    none: 'Review preparedness status', monitor: 'Review warning status', emergency: 'Review emergency protection state', check: 'Simulated safety check',
    lowPower: 'Prioritize minimal text-only information', unverified: 'Official information needs verification', simulatedFresh: 'Simulated fresh input is never official authorization',
    nextAction: 'Recheck official guidance from a safe location', avoidAction: 'Do not treat unverified routes or shelters as safe',
    checkTitle: 'Safety Check simulation', safe: 'Safe', needHelp: 'Need help', stuck: 'Cannot move', checkResult: 'Simulated response',
    noCheck: 'Safety Check controls appear from severe level upward', mapBlocked: 'Movement and safe-route maps always blocked for synthetic input',
    powerMode: 'Simulated power mode', map: 'Simulated map', disabled: 'Disabled', notify: 'Alerts sent', no: 'None', reset: 'Reset',
    noRealEmergency: '119 / 110 are reference numbers only; this page does not dial.',
    threshold: 'At 30% battery: conserve; at 15%: emergency power; at 5%: minimal display.',
  },
  'zh-TW': {
    title: '災難測試', test: '測試模式 — 並非真實災難警報',
    explanation: '在這裏設定情境，開始後會進入獨立 72H 模擬主畫面，按倒數時間執行事件及 AI 判斷。不會更改真實 GPS、電量、網絡或發出緊急通知。',
    back: '返回設定', presets: '快速情境', routine: '日常', moderate: '中等災難', critical: '重大／離線', survival: '電量 3%',
    settings: '情境設定', disaster: '災難類型', severity: '模擬程度（不是官方震度或警報等級）',
    battery: '模擬手機電量', batteryUnknown: '模擬無法讀取電量', network: '模擬網絡', evidence: '模擬資訊狀態', mobility: '行動能力',
    preview: '模擬畫面', now: 'NOW · 模擬', next: 'NEXT · 模擬', avoid: 'AVOID · 模擬',
    level: '程度', normal: '一般', conserve: '省電', emergencyPower: '緊急省電', survivalPower: '極簡顯示',
    networkOnline: '有網絡', networkOffline: '離線', networkReconnect: '重新連線中',
    evidenceFresh: '最新（模擬）', evidenceStale: '已過期', evidenceUnknown: '未核實', able: '可以移動', cannotMove: '無法移動',
    earthquake: '地震', tsunami: '海嘯', typhoon: '颱風', flood: '水浸', landslide: '山泥傾瀉', fire: '火災',
    none: '顯示一般準備狀態', monitor: '留意災難消息', emergency: '顯示緊急保護狀態', check: '進行模擬安全確認',
    lowPower: '優先顯示最基本文字資訊', unverified: '需要重新核實官方資訊', simulatedFresh: '即使模擬資訊為最新，亦不代表已獲正式安全授權',
    nextAction: '先確保自身安全，再核實官方指引', avoidAction: '不要視未核實路線及避難場所為安全',
    checkTitle: '模擬 Safety Check', safe: '安全', needHelp: '需要協助', stuck: '無法移動', checkResult: '模擬回答',
    noCheck: '程度達嚴重以上才顯示安全確認操作', mapBlocked: '使用模擬資料時，安全路線及移動授權一律停用',
    powerMode: '模擬省電模式', map: '模擬地圖', disabled: '已停用', notify: '已發送警報', no: '沒有', reset: '重設',
    noRealEmergency: '119／110 只供參考，測試介面不設撥號功能。',
    threshold: '模擬電量 ≤30% 省電、≤15% 緊急省電、≤5% 極簡顯示。',
  },
} as const;

export function DisasterTestLab() {
  const [language, setLanguage] = useState<Language>('ja');
  const [input, setInput] = useState<DisasterTestInput>(defaultDisasterTest);
  const [answer, setAnswer] = useState<string>('');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('72h-language');
      if (saved === 'en' || saved === 'ja' || saved === 'zh-TW') setLanguage(saved);
    } catch { /* Use Japanese without saved preferences. */ }
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const t = copy[language];
  const output = projectDisasterTest(input);
  const set = <K extends keyof DisasterTestInput>(name: K, value: DisasterTestInput[K]) => {
    setInput(current => ({ ...current, [name]: value }));
    setAnswer('');
  };
  const powerName = output.power.mode === 'SURVIVAL' ? t.survivalPower
    : output.power.mode === 'EMERGENCY_POWER' ? t.emergencyPower
      : output.power.mode === 'CONSERVE' ? t.conserve : t.normal;
  const primary = output.presentationMode === 'SURVIVAL' ? t.lowPower
    : output.critical ? t.emergency
      : output.requiresSafetyCheck ? t.check
        : input.severity ? t.monitor : t.none;
  return <main className="disaster-lab" data-testid="disaster-test-lab">
    <header className="lab-header">
      <Link href="/more">← {t.back}</Link>
      <label><span className="sr-only">Language</span><select aria-label="Language" value={language} onChange={event => setLanguage(event.target.value as Language)}>
        <option value="ja">日本語</option><option value="en">English</option><option value="zh-TW">繁體中文</option>
      </select></label>
    </header>
    <div className="lab-test-banner" role="status"><strong>{t.test}</strong><p>{t.explanation}</p></div>
    <h1>{t.title}</h1>
    <div className="lab-sticky-status" role="status">
      <strong>TEST · L{input.severity} · {input.battery === null ? '—' : input.battery + '%'}</strong>
      <span>{primary} · {powerName}</span>
    </div>
    <AgentDrillPanel input={input} language={language} />
    <section className="lab-preview" aria-label={t.preview} data-local-preview="true">
      <div className="lab-preview-top"><strong>{t.preview}</strong><span>TEST / L{input.severity}</span></div>
      <p className="lab-preview-state">{t[input.kind.toLowerCase() as 'earthquake']} · {t.level} L{input.severity} · {input.battery === null ? '—' : input.battery + '%'}</p>
      <p data-testid="power-mode" className="lab-power">{t.powerMode}: <strong>{powerName}</strong></p>
      <section className="lab-now" data-testid="simulation-now"><small>{t.now}</small><h2>{primary}</h2>
        <p>{output.informationUnverified ? t.unverified : t.simulatedFresh}</p>
        {input.mobility === 'CANNOT_MOVE' && <p><strong>{t.cannotMove}</strong></p>}
      </section>
      {output.requiresSafetyCheck ? <section className="lab-safety-check">
        <h3>{t.checkTitle}</h3>
        <div>{([['safe', t.safe], ['help', t.needHelp], ['stuck', t.stuck]] as const).map(([key, label]) =>
          <button type="button" key={key} aria-pressed={answer === key} onClick={() => setAnswer(key)}>{label}</button>)}</div>
        {answer && <p role="status">{t.checkResult}: {answer === 'safe' ? t.safe : answer === 'help' ? t.needHelp : t.stuck}</p>}
      </section> : <p className="lab-muted">{t.noCheck}</p>}
      <details className="lab-secondary"><summary>{t.next} / {t.avoid}</summary>
        <p><strong>{t.next}:</strong> {t.nextAction}</p>
        <p><strong>{t.avoid}:</strong> {t.avoidAction}</p>
      </details>
      <p className="lab-hard-gates" data-testid="safety-gates">{t.mapBlocked} · {t.map}: {t.disabled} · {t.notify}: {t.no}</p>
      <p className="lab-no-dial">{t.noRealEmergency}</p>
    </section>

    <section aria-labelledby="lab-presets-title" className="lab-presets">
      <h2 id="lab-presets-title">{t.presets}</h2>
      <div className="lab-preset-buttons">{disasterPresets.map(preset => <button key={preset.key} type="button" onClick={() => { setInput(preset.input); setAnswer(''); }}>{t[preset.key as keyof typeof t]}</button>)}</div>
    </section>
    <section className="lab-settings" aria-labelledby="lab-settings-title">
      <h2 id="lab-settings-title">{t.settings}</h2>
      <div className="lab-fields">
        <label>{t.disaster}<select data-testid="hazard" value={input.kind} onChange={e => set('kind', e.target.value as DisasterKind)}>
          <option value="EARTHQUAKE">{t.earthquake}</option><option value="TSUNAMI">{t.tsunami}</option>
          <option value="TYPHOON">{t.typhoon}</option><option value="FLOOD">{t.flood}</option>
          <option value="LANDSLIDE">{t.landslide}</option><option value="FIRE">{t.fire}</option>
        </select></label>
        <label>{t.severity}<select data-testid="severity" value={input.severity} onChange={e => set('severity', Number(e.target.value) as TestSeverity)}>
          {[0, 1, 2, 3, 4].map(value => <option value={value} key={value}>L{value}</option>)}
        </select></label>
        <div className="lab-battery">
          <label htmlFor="lab-battery">{t.battery}: {input.battery === null ? '—' : input.battery + '%'}</label>
          <input id="lab-battery" data-testid="battery" type="range" min={0} max={100} step={1} value={input.battery ?? 50}
            disabled={input.battery === null} onChange={e => set('battery', Number(e.target.value))} />
          <label className="lab-check"><input type="checkbox" checked={input.battery === null}
            onChange={e => set('battery', e.target.checked ? null : 50)} />{t.batteryUnknown}</label>
        </div>
        <label>{t.network}<select data-testid="network" value={input.network} onChange={e => set('network', e.target.value as TestNetwork)}>
          <option value="ONLINE">{t.networkOnline}</option><option value="OFFLINE">{t.networkOffline}</option><option value="RECONNECTING">{t.networkReconnect}</option>
        </select></label>
        <label>{t.evidence}<select data-testid="evidence" value={input.evidence} onChange={e => set('evidence', e.target.value as TestEvidence)}>
          <option value="FRESH">{t.evidenceFresh}</option><option value="STALE">{t.evidenceStale}</option><option value="UNKNOWN">{t.evidenceUnknown}</option>
        </select></label>
        <label>{t.mobility}<select data-testid="mobility" value={input.mobility} onChange={e => set('mobility', e.target.value as TestMobility)}>
          <option value="ABLE">{t.able}</option><option value="CANNOT_MOVE">{t.cannotMove}</option>
        </select></label>
      </div>
      <p className="lab-help">{t.threshold}</p>
    </section>
    <button className="lab-reset" type="button" onClick={() => { setInput(defaultDisasterTest); setAnswer(''); }}>{t.reset}</button>
  </main>;
}
