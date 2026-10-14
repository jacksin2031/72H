'use client';
import Link from 'next/link';
import type {ReactNode} from 'react';
import type {Language} from '@/lib/contracts';
import {APP_TABS,type AppTab} from '@/lib/app-tabs';
import {useTheme} from '@/lib/use-theme';
import {UiIcon} from '../ui-icon';
/** onTab: an exercise keeps its own Now / Map / More inside the running session, so the tabs switch in place instead of linking to the live pages.
 *  localTabs limits which tabs switch in place (default: all when onTab is given); the others stay links to the live routes. */
/** language null: the saved language is not read yet; the shell renders without any language-dependent text so the page is never blank. */
export function AppShell({tab,language,band,exerciseControls,fullBleed,onTab,localTabs,children}:{tab:AppTab;language:Language|null;band?:ReactNode;exerciseControls?:ReactNode;fullBleed?:boolean;onTab?:(tab:AppTab)=>void;localTabs?:AppTab[];children:ReactNode}){
  useTheme(); // applies the saved theme on every page wrapped by the shell
  return <div className={`ui-app${band?' ui-app-has-band':''}${exerciseControls?' ui-app-has-controls':''}`}>
    {band}
    <main className={fullBleed?'ui-main ui-main-full':'ui-main'}>{children}</main>
    {exerciseControls&&<div className="ui-exercise-controls">{exerciseControls}</div>}
    <nav className="ui-tabs" inert={language===null||undefined} aria-label={language===null?undefined:language==='ja'?'メイン':language==='en'?'Main':'主選單'}>
      {APP_TABS.map(t=>onTab&&(!localTabs||localTabs.includes(t.key))
        ?<button key={t.key} type="button" aria-current={t.key===tab?'page':undefined} onClick={()=>onTab(t.key)}><UiIcon name={t.icon}/><span>{language&&t.label[language]}</span></button>
        :<Link key={t.key} href={t.href} aria-current={t.key===tab?'page':undefined}><UiIcon name={t.icon}/><span>{language&&t.label[language]}</span></Link>)}
    </nav>
  </div>;
}
