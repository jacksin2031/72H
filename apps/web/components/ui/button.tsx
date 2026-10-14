import type {ButtonHTMLAttributes,ReactNode} from 'react';
export function Button({variant,children,className='',...rest}:{variant:'primary'|'secondary'|'danger';children:ReactNode}&ButtonHTMLAttributes<HTMLButtonElement>){
  return <button type="button" {...rest} className={`ui-btn ui-btn-${variant} ${className}`.trim()}>{children}</button>;
}
