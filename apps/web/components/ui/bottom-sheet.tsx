import type {ReactNode} from 'react';
export function BottomSheet({peek,children,open,onToggle}:{peek:ReactNode;children:ReactNode;open:boolean;onToggle:()=>void}){
  return <section className="ui-sheet" data-open={open||undefined}>
    <button type="button" className="ui-sheet-head" aria-expanded={open} onClick={onToggle}><span className="ui-sheet-grip" aria-hidden="true"/>{peek}</button>
    {open&&<div className="ui-sheet-body">{children}</div>}
  </section>;
}
