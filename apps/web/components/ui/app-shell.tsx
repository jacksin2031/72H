'use client';
import Link from 'next/link';
import type {ReactNode} from 'react';
import type {Language} from '@/lib/contracts';
import {APP_TABS,type AppTab} from '@/lib/app-tabs';
import {useTheme} from '@/lib/use-theme';
import {UiIcon} from '../ui-icon';
export function AppShell({tab,language,band,exerciseControls,fullBleed,children}:{tab:AppTab;language:Language;band?:ReactNode;exerciseControls?:ReactNode;fullBleed?:boolean;children:ReactNode}){
  useTheme(); // applies the saved theme on every page wrapped by the shell
  return <div className={`ui-app${band?' ui-app-has-band':''}${exerciseControls?' ui-app-has-controls':''}`}>
    {band}
    <main className={fullBleed?'ui-main ui-main-full':'ui-main'}>{children}</main>
    {exerciseControls&&<div className="ui-exercise-controls">{exerciseControls}</div>}
    <nav className="ui-tabs" aria-label={language==='ja'?'メイン':language==='en'?'Main':'主選單'}>
      {APP_TABS.map(t=><Link key={t.key} href={t.href} aria-current={t.key===tab?'page':undefined}><UiIcon name={t.icon}/><span>{t.label[language]}</span></Link>)}
    </nav>
  </div>;
}
