// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {MapScreen} from '../components/map-screen';
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('renders a full-bleed map, one chip row, one legend line and a collapsed sheet',async()=>{
  let on=false;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<MapScreen language="zh-TW" map={<div data-testid="map"/>} region={<select aria-label="地區"/>}
    layers={[{key:'inundation',label:'浸水想定',on,toggle:()=>{on=!on;}}]} legend="浸水想定：官方想定，不代表即時" peek="附近 12 處指定避難場所"
    sections={[{title:'避難場所',content:<p>list</p>},{title:'官方資料',content:<p>jma</p>}]} routeSection={null}/>));
  expect(host.querySelectorAll('.ui-chip')).toHaveLength(1);
  expect(host.querySelector('.map-legend')?.textContent).toBe('浸水想定：官方想定，不代表即時');
  expect(host.querySelector('.ui-sheet button')?.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.ui-sheet-body')).toBeNull();
});
it('opens the sheet to show titled sections and hides the route section when null',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<MapScreen language="zh-TW" map={<div/>} region={null} layers={[]} legend={null} peek="附近"
    sections={[{title:'避難場所',content:<p>list</p>}]} routeSection={null}/>));
  await act(async()=>(host.querySelector('.ui-sheet button') as HTMLButtonElement).click());
  expect([...host.querySelectorAll('.ui-section-title')].map(e=>e.textContent)).toEqual(['避難場所']);
});
it('puts the road-candidate section first when present and reflects chip state with aria-pressed',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<MapScreen language="ja" map={<div/>} region={null}
    layers={[{key:'a',label:'A',on:true,toggle:()=>{}},{key:'b',label:'B',on:false,toggle:()=>{}}]} legend="x" peek="p"
    sections={[{title:'避難場所',content:<p>list</p>}]} routeSection={<p>route</p>}/>));
  expect([...host.querySelectorAll('.ui-chip')].map(c=>c.getAttribute('aria-pressed'))).toEqual(['true','false']);
  expect(host.querySelector('.map-chips')?.getAttribute('aria-label')).toBe('レイヤー');
  await act(async()=>(host.querySelector('.ui-sheet button') as HTMLButtonElement).click());
  expect([...host.querySelectorAll('.ui-section-title')].map(e=>e.textContent)).toEqual(['道路候補','避難場所']);
});
it('keeps section state (chosen prefecture, road candidate) when the sheet is closed and reopened',async()=>{
  function Counter(){const [n,setN]=React.useState(0);return <button type="button" data-testid="count" onClick={()=>setN(n+1)}>{n}</button>;}
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<MapScreen language="en" map={<div/>} region={null} layers={[]} legend={null} peek="p"
    sections={[{title:'Places',content:<Counter/>}]} routeSection={null}/>));
  const head=host.querySelector('.ui-sheet-head') as HTMLButtonElement;
  await act(async()=>head.click());
  await act(async()=>(host.querySelector('[data-testid=count]') as HTMLButtonElement).click());
  await act(async()=>head.click());
  expect(host.querySelector('.ui-sheet-body')).toBeNull();
  expect((host.querySelector('.ui-sheet-held') as HTMLElement).hidden).toBe(true);
  await act(async()=>head.click());
  expect(host.querySelector('.ui-sheet-body [data-testid=count]')?.textContent).toBe('1');
});
it('keeps the pinned help control clear of the bottom sheet (above the peek, at the top while open)',()=>{
  const css=readFileSync(resolve(__dirname,'../components/ui/ui.css'),'utf8');
  expect(css).toMatch(/\.ui-app:has\(\.ui-sheet\) \.ui-help-pin\{[^}]*bottom:calc\(64px \+ env\(safe-area-inset-bottom\) \+ 56px \+ var\(--sp-3\)\)/);
  expect(css).toMatch(/\.ui-app:has\(\.ui-sheet\[data-open\]\) \.ui-help-pin\{[^}]*top:/);
});
it('styles the GPS / epicenter markers and keeps the out-of-coverage note positioned above the map canvas',()=>{
  const css=readFileSync(resolve(__dirname,'../components/ui/ui.css'),'utf8');
  expect(css).toMatch(/\.sim-map-geo-note\{[^}]*position:absolute[^}]*z-index:5/);
  expect(css).toMatch(/\.sim-geo-marker\{[^}]*border-radius:50%[^}]*background:var\(--info\)/);
  expect(css).toMatch(/\.sim-geo-epicenter\{[^}]*background:var\(--danger\)/);
});
