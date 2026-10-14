import type {ReactNode} from 'react';
export function Disclosure({summary,children,defaultOpen=false,id}:{summary:ReactNode;children:ReactNode;defaultOpen?:boolean;id?:string}){
  return <details className="ui-disclosure" open={defaultOpen||undefined} id={id}><summary>{summary}</summary><div className="ui-disclosure-body">{children}</div></details>;
}
