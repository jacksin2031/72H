// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('next/link',()=>({default:({children,...p}:React.ComponentProps<'a'>)=><a {...p}>{children}</a>}));
import {MoreScreen,MORE_ROW_LABELS,MORE_ROW_ORDER} from '../components/more-screen';
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('lists the nine settings rows in order as plain rows',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  const labels=['語言','外觀','電量模式','緊急聯絡人','位置與隱私','通知','資訊來源','演練與示範','關於'];
  expect(MORE_ROW_ORDER.map(k=>MORE_ROW_LABELS[k]['zh-TW'])).toEqual(labels);
  await act(async()=>root.render(<MoreScreen language="zh-TW" subpage={null} rows={labels.map((label,i)=>({key:String(i),label,onClick:()=>{}}))}/>));
  expect([...host.querySelectorAll('.ui-row .ui-row-label')].map(e=>e.textContent)).toEqual(labels);
});
it('shows only the subpage and a back button when a subpage is open',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);const back=vi.fn();
  await act(async()=>root.render(<MoreScreen language="zh-TW" rows={[{key:'a',label:'語言'}]} subpage={<p>sub</p>} onBack={back}/>));
  expect(host.querySelector('.ui-row')).toBeNull();expect(host.textContent).toContain('sub');
  await act(async()=>(host.querySelector('.ui-btn-secondary') as HTMLButtonElement).click());expect(back).toHaveBeenCalled();
});
