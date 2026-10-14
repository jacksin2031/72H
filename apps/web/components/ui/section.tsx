import type {ReactNode} from 'react';
export function Section({title,children,id}:{title?:string;children:ReactNode;id?:string}){
  return <section className="ui-section" id={id}>{title&&<h2 className="ui-section-title">{title}</h2>}{children}</section>;
}
