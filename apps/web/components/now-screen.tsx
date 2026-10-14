// apps/web/components/now-screen.tsx — presentation only: every value comes from the caller.
import type {ReactNode} from 'react';
import type {Language} from '@/lib/contracts';
import {Disclosure,Section,Tag} from './ui';

const T={'zh-TW':{basis:'依據',next:'接下來',avoid:'避免',exercise:'演練'},ja:{basis:'根拠',next:'次に',avoid:'避ける',exercise:'演習'},en:{basis:'Basis',next:'Next',avoid:'Avoid',exercise:'Exercise'}} as const;

export function NowScreen({language,hero,heroTone,basis,next,avoid,updatedLabel,exercise,openBasis,basisDetails,help}:{
  language:Language;hero:string;heroTone:'normal'|'danger'|'warn';basis:string|null;next:string[];avoid:string[];
  updatedLabel:string;exercise:boolean;openBasis:boolean;basisDetails:ReactNode;help:ReactNode}){
  const t=T[language];
  return <div className="now">
    <h1 className={`now-hero now-hero-${heroTone}`} data-now="hero">{hero}</h1>
    <div className="now-basis" data-now="basis">
      {basis&&<p className="now-meta">{basis}</p>}{exercise&&<Tag tone="exercise">{t.exercise}</Tag>}
      <Disclosure summary={t.basis} defaultOpen={openBasis} id="basis">{basisDetails}</Disclosure>
    </div>
    <div className="now-help" data-now="help">{help}</div>
    {next.length>0&&<div data-now="next"><Section title={t.next}><ul className="now-list">{next.map((x,i)=><li key={i}>{x}</li>)}</ul></Section></div>}
    {avoid.length>0&&<div data-now="avoid"><Section title={t.avoid}><ul className="now-list">{avoid.map((x,i)=><li key={i}>{x}</li>)}</ul></Section></div>}
    <p className="now-meta" data-now="updated">{updatedLabel}</p>
  </div>;
}
