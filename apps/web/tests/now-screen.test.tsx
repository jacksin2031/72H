// @vitest-environment jsdom
import React,{act} from 'react';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it} from 'vitest';
import {NowScreen} from '../components/now-screen';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement|null=null;let root:ReturnType<typeof createRoot>|null=null;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();root=null;host=null;});
const base={language:'zh-TW' as const,hero:'立刻往堅固建築物 3 樓以上或高處移動',heroTone:'danger' as const,basis:'氣象廳 大津波警報 · 14:51 發布',
  next:['確認家人位置'],avoid:['不要靠近海邊'],updatedLabel:'更新 14:52',exercise:false,openBasis:false,basisDetails:<p>history</p>,help:<button>我需要幫助</button>};
async function render(p:React.ComponentProps<typeof NowScreen>=base){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<NowScreen {...p}/>));return host;}

it('orders hero, basis, help, next, avoid, updated — hero first',async()=>{
  const h=await render();
  const order=[...h.querySelectorAll('[data-now]')].map(e=>e.getAttribute('data-now'));
  expect(order).toEqual(['hero','basis','help','next','avoid','updated']);
  expect(h.querySelector('[data-now=hero]')?.tagName).toBe('H1');
  expect(h.querySelector('[data-now=hero]')?.textContent).toBe(base.hero);
  expect(h.querySelector('[data-now=basis]')?.textContent).toContain('氣象廳 大津波警報 · 14:51 發布');
  expect(h.querySelector('[data-now=updated]')?.textContent).toBe('更新 14:52');
});
it('has no card wrappers and keeps basis details collapsed unless openBasis',async()=>{
  const h=await render();
  expect(h.querySelector('[class*=card]')).toBeNull();
  expect((h.querySelector('details') as HTMLDetailsElement).open).toBe(false);
  await act(async()=>root!.render(<NowScreen {...base} openBasis/>));
  expect((h.querySelector('details') as HTMLDetailsElement).open).toBe(true);
});
it('shows the exercise tag next to the basis in exercise mode',async()=>{
  const h=await render({...base,exercise:true});
  expect(h.querySelector('[data-now=basis] .ui-tag-exercise')?.textContent).toBe('演練');
});
it('omits the basis line but keeps the details entry when there is no official basis',async()=>{
  const h=await render({...base,basis:null});
  expect(h.querySelector('[data-now=basis] .now-meta')).toBeNull();
  expect(h.querySelector('[data-now=basis] details')).not.toBeNull();
});
it('omits empty next/avoid sections instead of rendering empty headings',async()=>{
  const h=await render({...base,next:[],avoid:[]});
  expect(h.querySelector('[data-now=next]')).toBeNull();expect(h.querySelector('[data-now=avoid]')).toBeNull();
});

// R2: read the real CSS values instead of literals, so a CSS change that breaks the fold fails here.
const css=readFileSync(join(__dirname,'../components/ui/ui.css'),'utf8');
const tokens=readFileSync(join(__dirname,'../app/tokens.css'),'utf8');
const rule=(selector:string)=>{
  const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=css.match(new RegExp(`(?:^|[},\\s])${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`,'m'));
  if(!match)throw new Error(`missing rule ${selector}`);return match[1];
};
const prop=(body:string,name:string)=>{const m=body.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`));if(!m)throw new Error(`missing ${name}`);return m[1].trim();};
const token=(name:string)=>{const m=tokens.match(new RegExp(`${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`));if(!m)throw new Error(`missing token ${name}`);return Number(m[1]);};
const px=(value:string)=>{const v=value.match(/^var\((--[\w-]+)\)$/);if(v)return token(v[1]);const n=value.match(/^(\d+(?:\.\d+)?)(?:px)?$/);if(!n)throw new Error(`not px: ${value}`);return Number(n[1]);};
const margins=(value:string)=>{const parts=value.split(/\s+/).map(px);return {top:parts[0],bottom:parts[2]??parts[0]};};

it('fits band + 3-line hero + basis + help above the fold on a 320x568 phone (values read from CSS)',()=>{
  const band=px(prop(rule('.ui-band'),'min-height'));
  const hero=rule('.now-hero');
  const heroLines=3*token('--fs-hero')*Number(prop(hero,'line-height'));
  const heroMargin=margins(prop(hero,'margin'));
  const basisLine=token('--fs-meta')*1.5;
  const disclosureSummary=px(prop(rule('.ui-disclosure summary'),'min-height'));
  const helpMargin=margins(prop(rule('.now-help'),'margin'));
  const helpButton=Math.max(px(prop(rule('.ui-btn-primary'),'min-height')),px(prop(rule('.ui-btn-danger'),'min-height')));
  const fold=568-64;
  expect([band,heroLines,heroMargin.top,basisLine,disclosureSummary,helpMargin.top,helpButton].every(Number.isFinite)).toBe(true);
  expect(band+heroMargin.top+heroLines+heroMargin.bottom+basisLine+disclosureSummary+helpMargin.top+helpButton).toBeLessThanOrEqual(fold);
});
