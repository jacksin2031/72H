import {readFileSync,readdirSync} from 'node:fs';
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
  it('declares a focus colour with at least 3:1 against the background in both themes',()=>{
    for(const theme of ['dark','contrast'] as const){
      const t=TOKENS[theme];
      expect(t.focus,`${theme} focus`).toBeTruthy();
      expect(contrastRatio(t.focus,t.bg),`${theme} focus`).toBeGreaterThanOrEqual(3);
    }
  });
  it('never loads a web font (offline-safe)',()=>{
    expect(css).not.toMatch(/@import|@font-face|fonts\.googleapis/);
  });
});

function cssFiles(dir:string):string[]{
  return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(e.name==='node_modules'||e.name==='.next'?[]:cssFiles(resolve(dir,e.name))):e.name.endsWith('.css')?[resolve(dir,e.name)]:[]);
}
/** Files not yet migrated. Shrinks every phase; must end as ['components/simulation-map-ui.css']. */
export const LEGACY_CSS_ALLOWLIST=['components/simulation-map-ui.css'];
const ALLOWED_RADIUS=new Set(['components/ui/ui.css','app/tokens.css','components/simulation-map-ui.css']);
const WEB=resolve(__dirname,'..');
describe('cardless guard',()=>{
  const files=cssFiles(resolve(WEB,'app')).concat(cssFiles(resolve(WEB,'components')))
    .map(f=>f.slice(WEB.length+1).replace(/\\/g,'/'));
  const source=(f:string)=>readFileSync(resolve(WEB,f),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  it('no box-shadow or drop-shadow anywhere outside legacy files',()=>{
    for(const f of files.filter(f=>!LEGACY_CSS_ALLOWLIST.includes(f)))
      expect(source(f),f).not.toMatch(/box-shadow\s*:|drop-shadow\s*\(/);
  });
  it('border-radius (shorthand and corner longhands) only in the shared ui stylesheet, tokens and map styles',()=>{
    for(const f of files.filter(f=>!LEGACY_CSS_ALLOWLIST.includes(f)&&!ALLOWED_RADIUS.has(f)))
      expect(source(f),f).not.toMatch(/border(?:-[a-z]+)*-radius\s*:/);
  });
  it('the legacy allowlist only shrinks (every listed file still exists)',()=>{
    for(const f of LEGACY_CSS_ALLOWLIST)expect(files,f).toContain(f);
  });
  it('has a global :focus-visible outline that uses the --focus token',()=>{
    const all=files.map(source).join(String.fromCharCode(10));
    expect(all).toMatch(/(^|[},\s]):focus-visible\s*\{[^}]*outline:[^};]*var\(--focus\)/);
  });
  it('no unscoped button:hover background that could override pressed chips or filled buttons',()=>{
    for(const f of files.filter(f=>!LEGACY_CSS_ALLOWLIST.includes(f)))
      expect(source(f),f).not.toMatch(/(^|[},\s])button:hover[^{]*\{[^}]*background/);
  });
  it('the globals reset has zero specificity, so the ui.css base button rule (info colour, weight) applies to unclassed buttons',()=>{
    const globals=source('app/globals.css');
    expect(globals).toMatch(/:where\(button,input,select,textarea\)\{font:inherit;color:inherit\}/);
    expect(globals,'element-specificity control rule').not.toMatch(/(^|\})\s*(button|input|select|textarea)\b[^{]*\{[^}]*(color|font)/);
    expect(source('components/ui/ui.css')).toMatch(/:where\(\.ui-app\) :where\(button[^{]*\{[^}]*color:var\(--info\)[^}]*font-weight:600/);
  });
  it('tokens win: no stylesheet resets body font-family, font-size or line-height outside tokens.css',()=>{
    for(const f of files.filter(f=>f!=='app/tokens.css'))
      expect(source(f),f).not.toMatch(/(^|[},\s])body\s*\{[^}]*(font-family|font-size|line-height)/);
  });
});

describe('exercise screens share the Live components (U2)',()=>{
  it('exercise screens reuse the same Now/Map components as Live',()=>{
    for(const f of ['components/dashboard.tsx','components/simulation-screens.tsx','components/disaster-test-lab.tsx']){
      const src=readFileSync(resolve(WEB,f),'utf8');
      expect(src,f).toMatch(/AppShell/);
      expect(src,f).toMatch(/NowScreen|MapScreen/);
    }
  });
});
