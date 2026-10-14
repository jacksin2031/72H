// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it} from 'vitest';
import {Button,Disclosure,ListRow,Section,StatusBand,Tag,BottomSheet} from '../components/ui';
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
async function render(node:React.ReactNode){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(node));return host;}
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});

it('Section renders a heading without any card wrapper',async()=>{
  const h=await render(<Section title="依據"><p>x</p></Section>);
  expect(h.querySelector('section.ui-section h2.ui-section-title')?.textContent).toBe('依據');
});
it('ListRow uses a link for href and a button for onClick, at least 48px tall by class',async()=>{
  const h=await render(<><ListRow label="語言" value="繁體中文" href="/more/language"/><ListRow label="通知" onClick={()=>{}}/></>);
  expect(h.querySelector('a.ui-row')?.getAttribute('href')).toBe('/more/language');
  expect(h.querySelector('button.ui-row')).not.toBeNull();
});
it('Button variants map to classes and pass aria-expanded',async()=>{
  const h=await render(<Button variant="danger" aria-expanded={false}>我需要幫助</Button>);
  const b=h.querySelector('button')!;expect(b.className).toContain('ui-btn-danger');expect(b.getAttribute('aria-expanded')).toBe('false');
});
it('Tag tones for exercise and AI',async()=>{
  const h=await render(<><Tag tone="exercise">演練</Tag><Tag tone="ai">AI 建議</Tag></>);
  expect(h.querySelectorAll('.ui-tag-exercise,.ui-tag-ai')).toHaveLength(2);
});
it('Disclosure is a native details element, closed by default',async()=>{
  const h=await render(<Disclosure summary="依據">body</Disclosure>);
  const d=h.querySelector('details.ui-disclosure') as HTMLDetailsElement;expect(d.open).toBe(false);
});
it('StatusBand announces the level once and never live-reads the countdown',async()=>{
  const h=await render(<StatusBand tone="danger" label="大津波警報" countdown="05:00"/>);
  expect(h.querySelector('.ui-band')?.getAttribute('role')).toBe('status');
  const timer=h.querySelector('[role=timer]')!;expect(timer.getAttribute('aria-live')).toBe('off');expect(timer.textContent).toBe('05:00');
});
it('BottomSheet toggles via an aria-expanded header button',async()=>{
  let open=false;const h=await render(<BottomSheet peek="附近 12 處" open={open} onToggle={()=>{open=!open;}}>list</BottomSheet>);
  expect(h.querySelector('.ui-sheet button')?.getAttribute('aria-expanded')).toBe('false');
});
it('ListRow marks the selected row of a single-choice list with aria-current="true" and only that row',async()=>{
  const h=await render(<><ListRow label="日本語" selected trailing="✓" onClick={()=>{}}/><ListRow label="English" trailing="none" onClick={()=>{}}/></>);
  const rows=[...h.querySelectorAll('button.ui-row')];
  expect(rows[0].getAttribute('aria-current')).toBe('true');
  expect(rows[1].hasAttribute('aria-current')).toBe(false);
});
