// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('next/link',()=>({default:({children,...p}:React.ComponentProps<'a'>)=><a {...p}>{children}</a>}));
import {AppShell,StatusBand} from '../components/ui';
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('renders band, content, exercise controls and three tabs with aria-current',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<AppShell tab="map" language="zh-TW" band={<StatusBand tone="exercise" label="演練"/>} exerciseControls={<button>下一則更新</button>}><p>content</p></AppShell>));
  const tabs=[...host.querySelectorAll('nav.ui-tabs a')];
  expect(tabs.map(a=>a.textContent)).toEqual(['現在','地圖','更多']);
  expect(tabs[1].getAttribute('aria-current')).toBe('page');
  expect(host.querySelector('.ui-band-exercise')).not.toBeNull();
  expect(host.querySelector('.ui-exercise-controls')?.textContent).toContain('下一則更新');
  expect(host.firstElementChild?.firstElementChild?.className).toContain('ui-band');
});
