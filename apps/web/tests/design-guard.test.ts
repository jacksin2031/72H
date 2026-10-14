import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
import {TOKENS,contrastRatio} from '../lib/design-tokens';

const css=readFileSync(resolve(__dirname,'../app/tokens.css'),'utf8');

describe('design tokens',()=>{
  it('declares every token for dark and contrast themes with the spec values',()=>{
    for(const [name,value] of Object.entries(TOKENS.dark))expect(css).toContain(`--${name}:${value}`);
    for(const [name,value] of Object.entries(TOKENS.contrast))expect(css).toContain(`--${name}:${value}`);
  });
  it('keeps every text/state colour at WCAG AA (4.5:1) on its background in both themes',()=>{
    for(const theme of ['dark','contrast'] as const){
      const t=TOKENS[theme];
      for(const fg of ['text','text-2','danger','warn','ok','info','exercise'])
        expect(contrastRatio(t[fg],t.bg),`${theme} ${fg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('keeps text on filled buttons, bands and tags at 4.5:1 (text colour is --bg on a filled state colour)',()=>{
    for(const theme of ['dark','contrast'] as const){
      const t=TOKENS[theme];
      for(const fill of ['text','danger','warn','exercise'])
        expect(contrastRatio(t.bg,t[fill]),`${theme} bg-on-${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('never loads a web font (offline-safe)',()=>{
    expect(css).not.toMatch(/@import|@font-face|fonts\.googleapis/);
  });
});
