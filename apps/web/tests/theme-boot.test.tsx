// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {THEME_BOOT_SCRIPT} from '../lib/theme-boot';
import {useTheme} from '../lib/use-theme';
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const boot=()=>new Function(THEME_BOOT_SCRIPT)();
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();document.documentElement.dataset.theme='dark';});

describe('pre-hydration theme (no dark flash for a saved contrast / system theme)',()=>{
  it('applies a saved contrast or system theme before React runs',()=>{
    localStorage.setItem('72h-theme','contrast');boot();
    expect(document.documentElement.dataset.theme).toBe('contrast');
    localStorage.setItem('72h-theme','system');boot();
    expect(document.documentElement.dataset.theme).toBe('system');
  });
  it('ignores unknown values and keeps the dark default',()=>{
    localStorage.setItem('72h-theme','<img>');boot();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('still renders (dark) when storage throws',()=>{
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('blocked');});
    expect(()=>boot()).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('useTheme never writes the dark default over the boot theme before reading the saved value',async()=>{
    localStorage.setItem('72h-theme','contrast');boot();
    // oldValue of every record + the final value = every value the attribute held.
    const old:(string|null)[]=[];
    const observer=new MutationObserver(records=>old.push(...records.map(r=>r.oldValue)));
    observer.observe(document.documentElement,{attributes:true,attributeOldValue:true,attributeFilter:['data-theme']});
    function Probe(){useTheme();return null;}
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    await act(async()=>root.render(<Probe/>));
    await act(async()=>{await Promise.resolve();});
    const held=[...old,...observer.takeRecords().map(r=>r.oldValue),document.documentElement.dataset.theme];
    observer.disconnect();
    expect(held).not.toContain('dark');
    expect(document.documentElement.dataset.theme).toBe('contrast');
    await act(async()=>root.unmount());host.remove();
  });
});
