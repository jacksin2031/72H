// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {SosPanel} from '../components/sos-panel';
import {sosText} from '../lib/distress';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const mounted:{root:ReturnType<typeof createRoot>;host:HTMLDivElement}[]=[];
const t=sosText['zh-TW'];
const contacts=[{name:'媽媽',phone:'090-1234-5678'}];
afterEach(async()=>{for(const m of mounted.splice(0)){await act(async()=>m.root.unmount());m.host.remove();}vi.unstubAllGlobals();vi.useRealTimers();});
async function mount(profile={contacts,needsAssistance:false,mobilityLimited:false}){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push({root,host});
 await act(async()=>root.render(<SosPanel language="zh-TW" profile={profile} tags={['TRAPPED']} location={{lat:35.1,lng:139.2,accuracy_m:10}} pinned/>));return host;
}
const button=(host:HTMLElement,text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!;
const nav=(extra:Record<string,unknown>)=>{const o=Object.create(navigator);for(const [k,v] of Object.entries({onLine:true,...extra}))Object.defineProperty(o,k,{value:v,configurable:true});vi.stubGlobal('navigator',o);};
function stubAudio(){
 const osc={type:'',frequency:{value:0},connect:vi.fn((n:unknown)=>n),start:vi.fn(),stop:vi.fn()};
 const gain={gain:{value:0},connect:vi.fn((n:unknown)=>n)};
 const ctx={createOscillator:vi.fn(()=>osc),createGain:vi.fn(()=>gain),destination:{},close:vi.fn(async()=>{})};
 vi.stubGlobal('AudioContext',vi.fn(function(){return ctx;}));return {osc,ctx,gain};
}
it('sends nothing automatically on render',async()=>{
 const fetchMock=vi.fn(),open=vi.fn();vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('open',open);
 await mount();expect(fetchMock).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
});
it('renders tel links for 119 and 110',async()=>{
 const host=await mount();
 expect(host.querySelector('a[href="tel:119"]')).not.toBeNull();expect(host.querySelector('a[href="tel:110"]')).not.toBeNull();
});
it('uses an sms link with contacts, otherwise navigator.share',async()=>{
 let host=await mount();
 expect(host.querySelector<HTMLAnchorElement>('a[href^="sms:"]')?.getAttribute('href')).toContain('090-1234-5678');
 const share=vi.fn(async()=>{});nav({share});
 host=await mount({contacts:[],needsAssistance:false,mobilityLimited:false});
 expect(host.querySelector('a[href^="sms:"]')).toBeNull();
 await act(async()=>button(host,t.share).click());
 expect(share).toHaveBeenCalledTimes(1);
});
it('alarm starts an oscillator, stop closes it, and unmount stops it too',async()=>{
 const {osc,ctx}=stubAudio();nav({mediaDevices:{getUserMedia:vi.fn(async()=>{throw new Error('no');})}});
 const host=await mount();
 await act(async()=>button(host,t.alarm).click());
 expect(osc.start).toHaveBeenCalled();expect(osc.type).toBe('square');
 await act(async()=>button(host,t.stop).click());
 expect(osc.stop).toHaveBeenCalled();expect(ctx.close).toHaveBeenCalled();
 await act(async()=>button(host,t.alarm).click());
 const before=ctx.close.mock.calls.length;
 const m=mounted.pop()!;await act(async()=>m.root.unmount());m.host.remove();
 expect(ctx.close.mock.calls.length).toBeGreaterThan(before);
});
it('falls back to a full-screen flash when the torch is unavailable',async()=>{
 stubAudio();nav({mediaDevices:{getUserMedia:vi.fn(async()=>{throw new Error('denied');})}});
 const host=await mount();
 await act(async()=>button(host,t.alarm).click());
 expect(host.querySelector('[data-testid=sos-flash]')).not.toBeNull();
 await act(async()=>button(host,t.stop).click());
 expect(host.querySelector('[data-testid=sos-flash]')).toBeNull();
});
it('uses the torch track when available and stops it',async()=>{
 stubAudio();const track={applyConstraints:vi.fn(async()=>{}),stop:vi.fn()};
 nav({mediaDevices:{getUserMedia:vi.fn(async()=>({getVideoTracks:()=>[track],getTracks:()=>[track]}))}});
 const host=await mount();
 await act(async()=>button(host,t.alarm).click());
 expect(track.applyConstraints).toHaveBeenCalled();expect(host.querySelector('[data-testid=sos-flash]')).toBeNull();
 await act(async()=>button(host,t.stop).click());expect(track.stop).toHaveBeenCalled();
});
it('offline: dial and alarm stay available, Net119 says it needs a network',async()=>{
 stubAudio();nav({onLine:false});
 const host=await mount();
 expect(host.querySelector('a[href="tel:119"]')).not.toBeNull();expect(button(host,t.alarm).disabled).toBe(false);
 expect(host.textContent).toContain(t.needsNetwork);
});
