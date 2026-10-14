export function StatusBand({tone,label,countdown=null}:{tone:'danger'|'warn'|'exercise';label:string;countdown?:string|null}){
  return <div className={`ui-band ui-band-${tone}`} role="status"><strong>{label}</strong>{countdown&&<span role="timer" aria-live="off">{countdown}</span>}</div>;
}
