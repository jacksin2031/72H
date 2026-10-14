import type {ReactNode} from 'react';
export function Tag({tone,children}:{tone:'exercise'|'ai'|'warn'|'danger';children:ReactNode}){
  return <span className={`ui-tag ui-tag-${tone}`}>{children}</span>;
}
