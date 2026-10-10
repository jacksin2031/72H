'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Language } from '@/lib/contracts';
import { SimulationReferenceMap } from '@/components/simulation-reference-map';
import { UiIcon } from '@/components/ui-icon';
import { documentedEpicenters } from '@/lib/geospatial-exposure';
import '@/components/simulation-flat-ui.css';
import '@/components/simulation-geo.css';
import '@/components/simulation-map-ui.css';

/** Public nationwide geography; no session, device location or movement authorization. */
export default function JapanMapPage() {
  const [language,setLanguage]=useState<Language>('zh-TW');
  const [historicCase,setHistoricCase]=useState('');
  useEffect(()=>{
    if(process.env.NODE_ENV==='production'&&'serviceWorker' in navigator){
      void navigator.serviceWorker.register('/sw.js').catch(()=>{});
    }
  },[]);
  return <main className="japan-reference-page">
    <header><Link href="/more" aria-label={language==='ja'?'戻る':language==='en'?'Back':'返回'}><UiIcon name="arrow" /></Link>
      <strong>{language==='ja'?'日本全国の参考地図':language==='en'?'All Japan reference map':'全日本參考地圖'}</strong>
      <select aria-label="Language" value={language} onChange={event=>setLanguage(event.target.value as Language)}>
        <option value="zh-TW">繁體中文</option><option value="ja">日本語</option><option value="en">English</option>
      </select>
    </header>
    <div className="japan-reference-viewport">
      <SimulationReferenceMap language={language} epicenter={documentedEpicenters[historicCase]??null}/>
      <label className="japan-history-picker"><select aria-label={language==='ja'?'過去の地震':language==='en'?'Historical earthquake':'歷史地震'} value={historicCase} onChange={event=>setHistoricCase(event.target.value)}>
        <option value="">{language==='ja'?'過去の震央を表示':language==='en'?'Show historical epicenter':'顯示歷史震央'}</option>
        <option value="tohoku-2011">2011 · 東日本</option><option value="kobe-1995">1995 · 神戶 / 神戸</option>
        <option value="kumamoto-2016">2016 · 熊本</option><option value="iburi-2018">2018 · 北海道</option><option value="noto-2024">2024 · 能登</option>
      </select></label>
    </div>
  </main>;
}
