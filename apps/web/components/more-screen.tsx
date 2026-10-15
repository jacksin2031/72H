import type {ReactNode} from 'react';
import type {Language} from '@/lib/contracts';
import {Button,ListRow} from './ui';

export type MoreRowKey='language'|'appearance'|'power'|'contacts'|'privacy'|'notifications'|'sources'|'exercise'|'about';
/** The nine settings rows, in display order. */
export const MORE_ROW_LABELS:Record<MoreRowKey,Record<Language,string>>={
  language:{'zh-TW':'語言', 'zh-CN': '语言',ja:'言語',en:'Language'},
  appearance:{'zh-TW':'外觀', 'zh-CN': '外观',ja:'表示',en:'Appearance'},
  power:{'zh-TW':'電量模式', 'zh-CN': '电量模式',ja:'省電力モード',en:'Power mode'},
  contacts:{'zh-TW':'緊急聯絡人', 'zh-CN': '紧急联系人',ja:'緊急連絡先',en:'Emergency contacts'},
  privacy:{'zh-TW':'位置與隱私', 'zh-CN': '位置与隐私',ja:'位置情報とプライバシー',en:'Location & privacy'},
  notifications:{'zh-TW':'通知', 'zh-CN': '通知',ja:'通知',en:'Notifications'},
  sources:{'zh-TW':'資訊來源', 'zh-CN': '信息来源',ja:'情報源',en:'Sources'},
  exercise:{'zh-TW':'演練與示範', 'zh-CN': '演练与示范',ja:'演習とデモ',en:'Exercises & demo'},
  about:{'zh-TW':'關於', 'zh-CN': '关于',ja:'このアプリについて',en:'About'},
};
export const MORE_ROW_ORDER:MoreRowKey[]=['language','appearance','power','contacts','privacy','notifications','sources','exercise','about'];

export function MoreScreen({language,rows,subpage,onBack}:{language:Language;rows:{key:string;label:string;value?:string;href?:string;onClick?:()=>void}[];subpage:ReactNode|null;onBack?:()=>void}){
  if(subpage)return <div className="more-sub"><Button variant="secondary" onClick={onBack}>{language==='ja'?'‹ 戻る':language==='en'?'‹ Back':'‹ 返回'}</Button>{subpage}</div>;
  return <div className="more"><h1 className="more-title">{language==='ja'?'その他':language==='en'?'More':'更多'}</h1>
    {rows.map(r=><ListRow key={r.key} label={r.label} value={r.value} href={r.href} onClick={r.onClick}/>)}</div>;
}
