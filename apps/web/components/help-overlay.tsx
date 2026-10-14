'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import type {Language} from '@/lib/contracts';
import {sosText} from '@/lib/distress';
import {Button} from './ui';

/** One stable help surface outside the active tab, so a map cannot hide an open report. */
export function HelpOverlay({language,onClose,children}:{language:Language;onClose:()=>void;children:ReactNode}){
  const panel=useRef<HTMLDivElement>(null),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    panel.current?.focus();
    return()=>{if(previous?.isConnected)previous.focus();};
  },[]);
  return <div className="ui-help-overlay" role="dialog" aria-modal="true" aria-label={sosText[language].title} ref={panel} tabIndex={-1}
    onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();close.current();}
      if(e.key!=='Tab')return;
      const nodes=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),summary')].filter(n=>!n.closest('details:not([open])')||n.tagName==='SUMMARY');
      const first=nodes[0],last=nodes.at(-1);
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }}>
    <Button variant="secondary" onClick={onClose}>{language==='ja'?'閉じる':language==='en'?'Close':'關閉'}</Button>
    {children}
  </div>;
}
