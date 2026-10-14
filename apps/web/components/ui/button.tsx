import type {ButtonHTMLAttributes,ReactNode,Ref} from 'react';
// React 19: `ref` is a plain prop and reaches the <button> through the spread.
export function Button({variant,children,className='',...rest}:{variant:'primary'|'secondary'|'danger';children:ReactNode;ref?:Ref<HTMLButtonElement>}&ButtonHTMLAttributes<HTMLButtonElement>){
  return <button type="button" {...rest} className={`ui-btn ui-btn-${variant} ${className}`.trim()}>{children}</button>;
}
