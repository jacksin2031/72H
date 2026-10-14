import type {ReactNode} from 'react';
/** keepMounted: closed content stays mounted (hidden) so panel state such as a chosen prefecture or road candidate survives closing the sheet. */
export function BottomSheet({peek,children,open,onToggle,keepMounted=false}:{peek:ReactNode;children:ReactNode;open:boolean;onToggle:()=>void;keepMounted?:boolean}){
  return <section className="ui-sheet" data-open={open||undefined}>
    <button type="button" className="ui-sheet-head" aria-expanded={open} onClick={onToggle}><span className="ui-sheet-grip" aria-hidden="true"/>{peek}</button>
    {open?<div className="ui-sheet-body">{children}</div>:keepMounted?<div className="ui-sheet-held" hidden>{children}</div>:null}
  </section>;
}
