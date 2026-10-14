// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it} from 'vitest';
import {HelpOverlay} from '../components/help-overlay';

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
function Report({disable}:{disable:boolean}){
  const [sent,setSent]=useState(false);
  return sent&&!disable?<p>Report received</p>:<button disabled={sent} onClick={()=>setSent(true)}>Send report</button>;
}
function Harness({disable=false}:{disable?:boolean}){
  const [open,setOpen]=useState(false);
  return <><button onClick={()=>setOpen(true)}>Open help</button>{open&&<HelpOverlay language="en" onClose={()=>setOpen(false)}><Report disable={disable}/></HelpOverlay>}</>;
}
async function open(disable=false){
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<Harness disable={disable}/>));
  const trigger=host.querySelector<HTMLButtonElement>('button')!;
  await act(async()=>{trigger.focus();trigger.click();});
  return trigger;
}
it('keeps keyboard focus inside help when submitting removes the focused report control, so Escape still closes it',async()=>{
  const trigger=await open();
  const send=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Send report')!;
  await act(async()=>{send.focus();send.click();});
  expect(send.isConnected).toBe(false);
  expect(host.querySelector('[role=dialog]')?.contains(document.activeElement)).toBe(true);
  await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it('moves focus off a report control disabled after submit, and preserves Escape and return focus',async()=>{
  const trigger=await open(true);
  const send=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Send report')!;
  await act(async()=>{send.focus();send.click();});
  expect(send.disabled).toBe(true);
  expect(document.activeElement).not.toBe(send);
  expect(host.querySelector('[role=dialog]')?.contains(document.activeElement)).toBe(true);
  await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
