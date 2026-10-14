import Link from 'next/link';
import type {ReactNode} from 'react';
import {UiIcon} from '../ui-icon';
export function ListRow({label,value,href,onClick,trailing='chevron'}:{label:ReactNode;value?:ReactNode;href?:string;onClick?:()=>void;trailing?:'chevron'|'none'|ReactNode}){
  const tail=trailing==='chevron'?<UiIcon name="arrow"/>:trailing==='none'?null:trailing;
  const body=<><span className="ui-row-label">{label}</span>{value!==undefined&&<span className="ui-row-value">{value}</span>}{tail&&<span className="ui-row-tail" aria-hidden={trailing==='chevron'}>{tail}</span>}</>;
  if(href)return <Link className="ui-row" href={href}>{body}</Link>;
  if(onClick)return <button type="button" className="ui-row" onClick={onClick}>{body}</button>;
  return <div className="ui-row">{body}</div>;
}
