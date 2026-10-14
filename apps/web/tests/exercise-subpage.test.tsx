// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {documentedEpicenters} from '../lib/geospatial-exposure';
const mapProps:Record<string,unknown>[]=[];
vi.mock('next/link',()=>({default:({children,...p}:React.ComponentProps<'a'>)=><a {...p}>{children}</a>}));
vi.mock('../components/simulation-reference-map',()=>({SimulationReferenceMap:(p:Record<string,unknown>)=>{mapProps.push(p);return <div data-testid="map"/>;}}));
import {ExerciseSubpage} from '../components/exercise-subpage';
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();mapProps.length=0;});
async function render(language:'zh-TW'|'ja'|'en'='zh-TW'){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<ExerciseSubpage language={language}/>));}
it('links the exercise tools and labels the context as an exercise',async()=>{
  await render();
  expect([...host.querySelectorAll('a.ui-row')].map(a=>a.getAttribute('href'))).toEqual(['/demo','/simulation','/disaster-test']);
  expect(host.querySelector('.ui-tag-exercise')?.textContent).toBe('演練');
});
it('lists the five historical cases and passes the chosen epicenter to the reference map',async()=>{
  await render();
  const select=host.querySelector<HTMLSelectElement>('select[aria-label="歷史地震"]')!;
  expect([...select.options].map(o=>o.value)).toEqual(['','tohoku-2011','kobe-1995','kumamoto-2016','iburi-2018','noto-2024']);
  expect(mapProps.at(-1)!.epicenter).toBeNull();
  await act(async()=>{select.value='noto-2024';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(mapProps.at(-1)!.epicenter).toBe(documentedEpicenters['noto-2024']);
  expect(documentedEpicenters['noto-2024']).toBeTruthy();
});
it('localises the picker label',async()=>{
  await render('en');
  expect(host.querySelector('select[aria-label="Historical earthquake"]')).not.toBeNull();
});
it('gives the compact reference map a height-bearing frame (its children are all absolutely positioned)',async()=>{
  await render();
  expect(host.querySelector('.exercise-map [data-testid=map]')).not.toBeNull();
  const {readFileSync}=await import('node:fs');const {resolve}=await import('node:path');
  const css=readFileSync(resolve(__dirname,'../components/ui/ui.css'),'utf8');
  expect(css).toMatch(/\.exercise-map\{[^}]*position:relative[^}]*height:clamp\(/);
});
