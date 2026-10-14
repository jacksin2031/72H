'use client';
import {useState} from 'react';
import type {Language} from '@/lib/contracts';
import {documentedEpicenters} from '@/lib/geospatial-exposure';
import {ListRow,Tag} from './ui';
import {SimulationReferenceMap} from './simulation-reference-map';

const text={
  'zh-TW':{exercise:'演練',picker:'歷史地震',none:'顯示歷史震央',mapNote:'歷史震央僅作演練參考，不是目前的災害資訊。',demo:'示範',simulation:'模擬',test:'災害測試'},
  ja:{exercise:'演習',picker:'過去の地震',none:'過去の震央を表示',mapNote:'過去の震央は演習用の参考で、現在の災害情報ではありません。',demo:'デモ',simulation:'シミュレーション',test:'災害テスト'},
  en:{exercise:'Exercise',picker:'Historical earthquake',none:'Show historical epicenter',mapNote:'Historical epicenters are exercise references, not current disaster information.',demo:'Demo',simulation:'Simulation',test:'Disaster test'},
} as const;

/** More → Exercises & demo: links to the exercise tools and the historical epicenter picker (moved from /map). Exercise context only. */
export function ExerciseSubpage({language}:{language:Language}){
  const t=text[language];
  const [historicCase,setHistoricCase]=useState('');
  return <div className="exercise-sub">
    <div><Tag tone="exercise">{t.exercise}</Tag></div>
    <ListRow label={t.demo} href="/demo"/>
    <ListRow label={t.simulation} href="/simulation"/>
    <ListRow label={t.test} href="/disaster-test"/>
    <label className="exercise-history-picker"><select aria-label={t.picker} value={historicCase} onChange={event=>setHistoricCase(event.target.value)}>
      <option value="">{t.none}</option>
      <option value="tohoku-2011">2011 · 東日本</option><option value="kobe-1995">1995 · 神戶 / 神戸</option>
      <option value="kumamoto-2016">2016 · 熊本</option><option value="iburi-2018">2018 · 北海道</option><option value="noto-2024">2024 · 能登</option>
    </select></label>
    <SimulationReferenceMap language={language} protectDeviceLocation compact epicenter={documentedEpicenters[historicCase]??null}/>
    <p className="ui-note">{t.mapNote}</p>
  </div>;
}
