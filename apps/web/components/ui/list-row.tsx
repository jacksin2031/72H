import Link from 'next/link';
import type {ReactNode} from 'react';
import {UiIcon} from '../ui-icon';
/** selected marks the chosen row of a single-choice list (language, appearance): aria-current="true" plus the caller's check mark. */
export function ListRow({label,value,href,onClick,trailing='chevron',selected=false}:{label:ReactNode;value?:ReactNode;href?:string;onClick?:()=>void;trailing?:'chevron'|'none'|ReactNode;selected?:boolean}){
  const tail=trailing==='chevron'?<UiIcon name="arrow"/>:trailing==='none'?null:trailing;
  const current=selected?'true' as const:undefined;
  const body=<><span className="ui-row-label">{label}</span>{value!==undefined&&<span className="ui-row-value">{value}</span>}{tail&&<span className="ui-row-tail" aria-hidden={trailing==='chevron'||selected||undefined}>{tail}</span>}</>;
  if(href)return <Link className="ui-row" href={href} aria-current={current}>{body}</Link>;
  if(onClick)return <button type="button" className="ui-row" onClick={onClick} aria-current={current}>{body}</button>;
  return <div className="ui-row" aria-current={current}>{body}</div>;
}
