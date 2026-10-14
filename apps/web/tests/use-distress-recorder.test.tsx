// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {useDistressRecorder} from '../lib/use-distress-recorder';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
type Api=ReturnType<typeof useDistressRecorder>;
function Harness({onAudio,api}:{onAudio:(b:Blob)=>void;api:{current:Api|null}}){api.current=useDistressRecorder(onAudio);return null;}
async function setup(){
 const host=document.createElement('div'),root=createRoot(host),api={current:null as Api|null},onAudio=vi.fn();
 await act(async()=>root.render(<Harness onAudio={onAudio} api={api}/>));
 return {api,onAudio,unmount:()=>act(async()=>root.unmount())};
}
function stubMedia({fireOnStop=true}={}){
 const streams:{tracks:{stop:ReturnType<typeof vi.fn>}[]}[]=[],resolvers:((s:unknown)=>void)[]=[];
 const getUserMedia=vi.fn(()=>new Promise(resolve=>{const tracks=[{stop:vi.fn()}];const s={tracks,getTracks:()=>tracks};streams.push(s);resolvers.push(()=>resolve(s));}));
 const o=Object.create(navigator);Object.defineProperty(o,'mediaDevices',{value:{getUserMedia},configurable:true});vi.stubGlobal('navigator',o);
 const recorders:Rec[]=[];
 class Rec{static isTypeSupported=()=>true;state='inactive';mimeType='audio/webm';ondataavailable:((e:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;
  constructor(){recorders.push(this);}start(){this.state='recording';}
  stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array([1])])});if(fireOnStop)this.onstop?.();}}
 vi.stubGlobal('MediaRecorder',Rec);
 return {getUserMedia,streams,resolvers,recorders};
}

it('ignores a double tap while permission is pending: one stream, released at the limit',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 const m=stubMedia(),{api,onAudio}=await setup();
 let first!:Promise<void>,second!:Promise<void>;
 await act(async()=>{first=api.current!.start();second=api.current!.start();});
 expect(m.getUserMedia).toHaveBeenCalledTimes(1);
 expect(api.current!.starting).toBe(true);
 await act(async()=>{m.resolvers.forEach(r=>r(null));await first;await second;});
 expect(m.recorders).toHaveLength(1);expect(api.current!.recording).toBe(true);
 await act(async()=>{vi.advanceTimersByTime(30_000);});
 expect(m.streams[0].tracks[0].stop).toHaveBeenCalled();expect(api.current!.recording).toBe(false);
 expect(onAudio).toHaveBeenCalledTimes(1);
});

it('unmounting while the permission prompt is open never records or uploads, and releases the stream',async()=>{
 const m=stubMedia(),{api,onAudio,unmount}=await setup();
 let started!:Promise<void>;
 await act(async()=>{started=api.current!.start();});
 await unmount();
 m.resolvers.forEach(r=>r(null));await started;
 expect(m.recorders).toHaveLength(0);
 expect(m.streams[0].tracks[0].stop).toHaveBeenCalled();
 expect(onAudio).not.toHaveBeenCalled();
});

it('resets recording and releases the mic even if onstop never fires',async()=>{
 const m=stubMedia({fireOnStop:false}),{api}=await setup();
 await act(async()=>{const p=api.current!.start();m.resolvers.forEach(r=>r(null));await p;});
 expect(api.current!.recording).toBe(true);
 await act(async()=>api.current!.stop());
 expect(api.current!.recording).toBe(false);expect(m.streams[0].tracks[0].stop).toHaveBeenCalled();
 // A new recording can start afterwards.
 await act(async()=>{const p=api.current!.start();m.resolvers.forEach(r=>r(null));await p;});
 expect(m.recorders).toHaveLength(2);expect(api.current!.recording).toBe(true);
});

it('reports failure when permission is denied',async()=>{
 const o=Object.create(navigator);Object.defineProperty(o,'mediaDevices',{value:{getUserMedia:vi.fn(async()=>{throw new DOMException('no','NotAllowedError');})},configurable:true});
 vi.stubGlobal('navigator',o);vi.stubGlobal('MediaRecorder',class{});
 const {api}=await setup();
 await act(async()=>{await api.current!.start();});
 expect(api.current!.failed).toBe(true);expect(api.current!.recording).toBe(false);expect(api.current!.starting).toBe(false);
});
