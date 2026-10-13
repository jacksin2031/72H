// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {EmergencyContactsSetup} from '../components/emergency-contacts-setup';
import {SOS_ONBOARDED_KEY,setSosStorage} from '../lib/emergency-contacts';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const mounted:{root:ReturnType<typeof createRoot>;host:HTMLDivElement}[]=[];
beforeEach(()=>{localStorage.clear();let value:unknown;setSosStorage({get:async()=>value,put:async(v)=>{value=v;}});});
afterEach(async()=>{for(const m of mounted.splice(0)){await act(async()=>m.root.unmount());m.host.remove();}vi.unstubAllGlobals();vi.useRealTimers();});
async function mount(onDone=vi.fn()){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push({root,host});
 await act(async()=>root.render(<EmergencyContactsSetup language="zh-TW" onDone={onDone}/>));return {host,onDone};
}
const button=(host:HTMLElement,text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!;
function typeInto(input:HTMLInputElement,value:string){
 const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));
}

it('skip marks onboarding done and calls onDone',async()=>{
 const {host,onDone}=await mount();
 await act(async()=>button(host,'略過').click());
 expect(onDone).toHaveBeenCalledTimes(1);expect(localStorage.getItem(SOS_ONBOARDED_KEY)).toBe('1');
});
it('disables save while a phone number is invalid',async()=>{
 const {host}=await mount();const inputs=host.querySelectorAll<HTMLInputElement>('input:not([type=checkbox])');
 await act(async()=>{typeInto(inputs[0],'媽媽');typeInto(inputs[1],'javascript:1');});
 expect(button(host,'儲存').disabled).toBe(true);
 await act(async()=>typeInto(inputs[1],'090-1234-5678'));
 expect(button(host,'儲存').disabled).toBe(false);
});
it('test alarm uses AudioContext and stops after about one second',async()=>{
 vi.useFakeTimers();
 const osc={frequency:{value:0},connect:vi.fn(),start:vi.fn(),stop:vi.fn()};
 const ctx={createOscillator:vi.fn(()=>osc),destination:{},close:vi.fn(async()=>{})};
 vi.stubGlobal('AudioContext',vi.fn(function(){return ctx;}));
 const {host}=await mount();
 await act(async()=>button(host,'試播警報聲').click());
 expect(osc.start).toHaveBeenCalled();expect(osc.stop).not.toHaveBeenCalled();
 await act(async()=>{vi.advanceTimersByTime(1100);});
 expect(osc.stop).toHaveBeenCalledTimes(1);expect(ctx.close).toHaveBeenCalledTimes(1);
});
it('closes the audio context when unmounted mid-alarm and when start throws',async()=>{
 vi.useFakeTimers();
 const osc={frequency:{value:0},connect:vi.fn(),start:vi.fn(),stop:vi.fn()};
 const ctx={createOscillator:vi.fn(()=>osc),destination:{},close:vi.fn(async()=>{})};
 vi.stubGlobal('AudioContext',vi.fn(function(){return ctx;}));
 const {host}=await mount();await act(async()=>button(host,'試播警報聲').click());
 const m=mounted.pop()!;await act(async()=>m.root.unmount());m.host.remove();
 expect(osc.stop).toHaveBeenCalledTimes(1);expect(ctx.close).toHaveBeenCalledTimes(1);
 osc.start.mockImplementation(()=>{throw new Error('x');});ctx.close.mockClear();
 const again=await mount();await act(async()=>button(again.host,'試播警報聲').click());
 expect(ctx.close).toHaveBeenCalled();
});
