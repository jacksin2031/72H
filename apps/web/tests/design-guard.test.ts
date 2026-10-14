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
  it('never loads a web font (offline-safe)',()=>{
    expect(css).not.toMatch(/@import|@font-face|fonts\.googleapis/);
  });
});

function cssFiles(dir:string):string[]{
  return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(e.name==='node_modules'||e.name==='.next'?[]:cssFiles(resolve(dir,e.name))):e.name.endsWith('.css')?[resolve(dir,e.name)]:[]);
}
/** Files not yet migrated. Shrinks every phase; must end as ['components/simulation-map-ui.css']. */
export const LEGACY_CSS_ALLOWLIST=['app/globals.css','components/simulation-map-ui.css','components/simulation-flat-ui.css','components/simulation-dashboard.css','components/disaster-test.css','components/official-hazard.css','components/simulation-geo.css','components/simulation-advice.css','components/distress.css','components/evacuation-route.css','components/plan-explanation.css'];
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
});
