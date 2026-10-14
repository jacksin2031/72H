# 72H 介面重整實作計劃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 72H 的介面改成深色為主、簡單、沒有卡片框的單欄設計，主結構改為「現在／地圖／更多」三分頁；演練畫面和真實畫面使用同一套元件。

**Architecture:** 新增 `app/tokens.css`（設計變數）和 `components/ui/`（8 個共用元件，搭配 `ui.css`）。每個畫面改成由這些元件組成，舊的手機版／桌面版雙版面合併成一個單欄版面。分四個階段，每個階段完成後都能獨立運作，也能用真機驗收。

**Tech Stack:** Next.js 16、React 19、TypeScript、Vitest（jsdom）、純 CSS（不新增任何套件）。

**Spec:** `docs/superpowers/specs/2026-10-14-ui-redesign-design.md`

## Global Constraints

- 顏色（深色／高對比）：`--bg` `#0B0D10`/`#FFFFFF`、`--text` `#F2F4F6`/`#0B0D10`、`--text-2` `#9AA3AD`/`#3D4651`、`--line` `rgba(255,255,255,.08)`/`rgba(0,0,0,.14)`、`--danger` `#FF5A52`/`#C4120A`、`--warn` `#FFB020`/`#8A5A00`、`--ok` `#3DDC97`/`#0B7A4B`、`--info` `#6CB6FF`/`#0A58B0`、`--exercise` `#B49CFF`/`#5B3DC4`。
- 字型：`system-ui, "Hiragino Sans", "Noto Sans JP", "PingFang TC", "Noto Sans TC", sans-serif`，不下載網路字型。
- 字級：`--fs-hero` 28px（寬度 ≥ 600px 時 32px，粗體 700）、`--fs-title` 20px（600）、`--fs-body` 16px（行高 1.5，全站最小字級）、`--fs-meta` 14px。
- 間距：4／8／12／16／24／32／48px；左右邊距 20px；內容最大寬度 640px；區塊間距 24–32px。
- 不使用卡片外框、陰影或背景色塊分區。圓角只用在按鈕（12px）、地圖、底部抽屜上緣、膠囊標籤。
- 主要按鈕填色、全寬、高 52px，一個畫面最多一個；所有可點擊元素至少 48×48px。
- 填色元素（按鈕、色帶、標籤）上的文字一律用 `var(--bg)`，不寫死白色，確保兩種主題都達到 4.5:1。
- 動畫 ≤ 150ms；`prefers-reduced-motion: reduce` 時關閉動畫。
- 對比度：一般文字 ≥ 4.5:1（WCAG AA）。
- 不改安全邏輯、API、資料契約；既有安全相關斷言不可以刪除。必須保留：官方依據與時間、「演練」標籤、「AI 建議」標籤、一次「不代表安全」說明。
- 主要指示永遠在最上方；求救區只在使用者自己回報 TRAPPED／INJURED／MOBILITY_LIMITED 時，才放在主要指示的正下方（修正 D1）。
- 不新增套件、不部署。全域 npm 已損壞：只用 `./node_modules/.bin/vitest`、`./node_modules/.bin/tsc`、`node scripts/build.mjs`。
- 永遠不要 commit `apps/web/next-env.d.ts`。

## Review Focus

1. **320px 寬的手機在官方海嘯警報時**：狀態色帶、主要指示和「我需要幫助」必須在第一個畫面內看到，不需要捲動。（測試放在 Task 5）
2. **高對比模式在陽光下**：所有文字 token 組合都要達到 4.5:1。（測試放在 Task 1）
3. **舊網址仍然可用**：`/plan`、`/sources`、`/notifications`、`/demo`、`/trace` 不能 404，要導到對應的新位置。（測試放在 Task 3）
4. **離線＋SURVIVAL 省電模式**：底部分頁和「我需要幫助」入口仍然可以使用；不依賴任何網路資源（字型）。（測試放在 Task 3、Task 5）
5. **螢幕閱讀器**：分頁有 `aria-current`；狀態色帶的倒數不會每秒被朗讀（`role="timer"` 加上 `aria-live="off"`），只有等級改變時才宣告。（測試放在 Task 2）

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `apps/web/app/tokens.css` | 新增 | 所有設計變數；深色、高對比、跟隨系統三種主題 |
| `apps/web/components/ui/ui.css` | 新增 | 共用元件的樣式（唯一允許使用 border-radius 的地方之一） |
| `apps/web/components/ui/{section,list-row,button,tag,disclosure,status-band,bottom-sheet,app-shell}.tsx` | 新增 | 8 個共用元件 |
| `apps/web/components/ui/index.ts` | 新增 | 統一匯出 |
| `apps/web/lib/app-tabs.ts` | 新增 | 三個分頁的定義、三語文字、舊網址對應 |
| `apps/web/lib/use-theme.ts` | 修改 | 主題改成設定在 `<html data-theme>` |
| `apps/web/app/layout.tsx` | 修改 | 匯入 tokens.css，`themeColor` 改為 `#0B0D10` |
| `apps/web/app/page.tsx`、`app/[view]/page.tsx` | 修改 | 路由對應 |
| `apps/web/components/now-screen.tsx` | 新增 | 「現在」頁 |
| `apps/web/components/more-screen.tsx` | 新增 | 「更多」頁＋子頁 |
| `apps/web/components/map-screen.tsx` | 新增 | 「地圖」頁＋底部抽屜（取代 `app/map/page.tsx` 的版面） |
| `apps/web/components/live-dashboard.tsx` | 修改 | 移除 `MobileScene`／`DesktopPreparedness` 的雙版面，改由 AppShell 加上各畫面元件組成 |
| `apps/web/components/dashboard.tsx`、`simulation-screens.tsx`、`disaster-test-lab.tsx` | 修改 | 演練模式改用相同的元件 |
| `apps/web/components/distress-panel.tsx`、`distress.css` | 修改 | 改用共用元件；修正 D1 |
| `apps/web/tests/design-guard.test.ts` | 新增 | 禁止卡片框、陰影；檢查對比度 |
| `docs/UI_REDESIGN_TEXT_AUDIT.md`、`docs/UI_REDESIGN_VALIDATION.md` | 新增 | 文字盤點清單、驗收紀錄 |

---

# 第 1 階段：設計規則與外殼

### Task 1: 設計變數（tokens）與主題

**Files:**
- Create: `apps/web/app/tokens.css`
- Modify: `apps/web/app/layout.tsx`、`apps/web/lib/use-theme.ts`
- Test: `apps/web/tests/design-guard.test.ts`（新增）

**Interfaces:**
- Produces：CSS 變數 `--bg --text --text-2 --line --danger --warn --ok --info --exercise --fs-hero --fs-title --fs-body --fs-meta --sp-1..--sp-7 --radius --gutter --content-max`；`<html data-theme="dark|contrast|system">`；`export const TOKENS: Record<'dark'|'contrast', Record<string,string>>`（放在 `apps/web/lib/design-tokens.ts`，同時給測試與 tokens.css 的產生檢查使用）。

- [ ] **Step 1: 寫失敗的對比度測試**

```ts
// apps/web/tests/design-guard.test.ts
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
```

- [ ] **Step 2: 執行測試，確認會失敗**

Run（在 `apps/web`）：`./node_modules/.bin/vitest run tests/design-guard.test.ts`
Expected：FAIL（找不到 `../lib/design-tokens`）

- [ ] **Step 3: 實作**

```ts
// apps/web/lib/design-tokens.ts
/** Single source of truth for colours; tokens.css must mirror these exactly (tested). */
export const TOKENS={
  dark:{bg:'#0B0D10',text:'#F2F4F6','text-2':'#9AA3AD',line:'rgba(255,255,255,.08)',danger:'#FF5A52',warn:'#FFB020',ok:'#3DDC97',info:'#6CB6FF',exercise:'#B49CFF'},
  contrast:{bg:'#FFFFFF',text:'#0B0D10','text-2':'#3D4651',line:'rgba(0,0,0,.14)',danger:'#C4120A',warn:'#8A5A00',ok:'#0B7A4B',info:'#0A58B0',exercise:'#5B3DC4'},
} as const satisfies Record<'dark'|'contrast',Record<string,string>>;

function luminance(hex:string){
  const n=hex.replace('#','');const c=[0,2,4].map(i=>parseInt(n.slice(i,i+2),16)/255)
    .map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);
  return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
}
export function contrastRatio(a:string,b:string){
  const [x,y]=[luminance(a),luminance(b)].sort((p,q)=>q-p);
  return (x+0.05)/(y+0.05);
}
```

```css
/* apps/web/app/tokens.css — mirrors lib/design-tokens.ts (tested); no web fonts. */
:root,[data-theme="dark"]{--bg:#0B0D10;--text:#F2F4F6;--text-2:#9AA3AD;--line:rgba(255,255,255,.08);--danger:#FF5A52;--warn:#FFB020;--ok:#3DDC97;--info:#6CB6FF;--exercise:#B49CFF;color-scheme:dark}
[data-theme="contrast"]{--bg:#FFFFFF;--text:#0B0D10;--text-2:#3D4651;--line:rgba(0,0,0,.14);--danger:#C4120A;--warn:#8A5A00;--ok:#0B7A4B;--info:#0A58B0;--exercise:#5B3DC4;color-scheme:light}
@media (prefers-color-scheme: light){[data-theme="system"]{--bg:#FFFFFF;--text:#0B0D10;--text-2:#3D4651;--line:rgba(0,0,0,.14);--danger:#C4120A;--warn:#8A5A00;--ok:#0B7A4B;--info:#0A58B0;--exercise:#5B3DC4;color-scheme:light}}
:root{--font:system-ui,"Hiragino Sans","Noto Sans JP","PingFang TC","Noto Sans TC",sans-serif;
  --fs-hero:28px;--fs-title:20px;--fs-body:16px;--fs-meta:14px;
  --sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:24px;--sp-6:32px;--sp-7:48px;
  --gutter:20px;--content-max:640px;--radius:12px;--motion:150ms}
@media (min-width:600px){:root{--fs-hero:32px}}
@media (prefers-reduced-motion: reduce){:root{--motion:0ms}*{animation:none!important;transition:none!important}}
html{background:var(--bg);color:var(--text);font-family:var(--font);font-size:var(--fs-body);line-height:1.5}
body{margin:0;background:var(--bg);color:var(--text)}
```

測試用 `--${name}:${value}` 的字串比對，所以 CSS 裡**每個宣告的冒號後面不可以有空格**（照上面的寫法）。

`layout.tsx`：在 `import './globals.css';` **之後**加上 `import './tokens.css';`（讓 tokens 覆蓋舊的 body 樣式）；`themeColor` 改成 `'#0B0D10'`；`<html lang="ja" data-theme="dark">`。

`use-theme.ts`：在 `setTheme` 和讀取 localStorage 之後，執行 `document.documentElement.dataset.theme = theme`（用 `useEffect` 監看 `theme`）。既有的 `theme-*` class 先保留，第 4 階段才移除。

- [ ] **Step 4: 執行測試，確認通過**

Run：`./node_modules/.bin/vitest run tests/design-guard.test.ts` 和 `./node_modules/.bin/tsc --noEmit`
Expected：PASS。如果某個顏色的對比度不到 4.5:1，**不可以改測試**；照實回報 NEEDS_CONTEXT，由使用者決定要不要調整色值。

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/tokens.css apps/web/lib/design-tokens.ts apps/web/app/layout.tsx apps/web/lib/use-theme.ts apps/web/tests/design-guard.test.ts
git commit -m "feat(ui): design tokens with dark/contrast/system themes and contrast guard"
```

---

### Task 2: 共用元件（Section、ListRow、Button、Tag、Disclosure、StatusBand、BottomSheet）

**Files:**
- Create: `apps/web/components/ui/{section,list-row,button,tag,disclosure,status-band,bottom-sheet}.tsx`、`apps/web/components/ui/ui.css`、`apps/web/components/ui/index.ts`
- Test: `apps/web/tests/ui-primitives.test.tsx`

**Interfaces:**
- Produces（全部從 `@/components/ui` 匯出）：
  - `Section({title?:string; children; id?:string})` → `<section class="ui-section">` 加上 `<h2 class="ui-section-title">`
  - `ListRow({label:ReactNode; value?:ReactNode; href?:string; onClick?:()=>void; trailing?:'chevron'|'none'|ReactNode})` → 有 href 時用 `<a>`，有 onClick 時用 `<button>`，否則用 `<div>`；類別 `ui-row`
  - `Button({variant:'primary'|'secondary'|'danger'; children; onClick?; type?; disabled?; 'aria-expanded'?})` → `<button class="ui-btn ui-btn-{variant}">`
  - `Tag({tone:'exercise'|'ai'|'warn'|'danger'; children})` → `<span class="ui-tag ui-tag-{tone}">`
  - `Disclosure({summary:ReactNode; children; defaultOpen?:boolean; id?:string})` → 原生 `<details class="ui-disclosure">`
  - `StatusBand({tone:'danger'|'warn'|'exercise'; label:string; countdown?:string|null})` → `<div class="ui-band ui-band-{tone}" role="status">`；倒數放在 `<span role="timer" aria-live="off">`
  - `BottomSheet({peek:ReactNode; children; open:boolean; onToggle:()=>void})` → `<section class="ui-sheet" data-open>`，標題列是 `<button aria-expanded>`

- [ ] **Step 1: 寫失敗的測試**

```tsx
// apps/web/tests/ui-primitives.test.tsx
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
```

- [ ] **Step 2: 執行測試，確認會失敗**

Run：`./node_modules/.bin/vitest run tests/ui-primitives.test.tsx`
Expected：FAIL（找不到 `../components/ui`）

- [ ] **Step 3: 實作**

```tsx
// apps/web/components/ui/section.tsx
import type {ReactNode} from 'react';
export function Section({title,children,id}:{title?:string;children:ReactNode;id?:string}){
  return <section className="ui-section" id={id}>{title&&<h2 className="ui-section-title">{title}</h2>}{children}</section>;
}
```

```tsx
// apps/web/components/ui/list-row.tsx
import Link from 'next/link';
import type {ReactNode} from 'react';
import {UiIcon} from '../ui-icon';
export function ListRow({label,value,href,onClick,trailing='chevron'}:{label:ReactNode;value?:ReactNode;href?:string;onClick?:()=>void;trailing?:'chevron'|'none'|ReactNode}){
  const tail=trailing==='chevron'?<UiIcon name="arrow"/>:trailing==='none'?null:trailing;
  const body=<><span className="ui-row-label">{label}</span>{value!==undefined&&<span className="ui-row-value">{value}</span>}{tail&&<span className="ui-row-tail" aria-hidden={trailing==='chevron'}>{tail}</span>}</>;
  if(href)return <Link className="ui-row" href={href}>{body}</Link>;
  if(onClick)return <button type="button" className="ui-row" onClick={onClick}>{body}</button>;
  return <div className="ui-row">{body}</div>;
}
```

（`UiIcon` 的 `name="arrow"` 已經存在於 `components/ui-icon.tsx`；請先確認名稱，如果不同就改用正確的名稱。）

```tsx
// apps/web/components/ui/button.tsx
import type {ButtonHTMLAttributes,ReactNode} from 'react';
export function Button({variant,children,className='',...rest}:{variant:'primary'|'secondary'|'danger';children:ReactNode}&ButtonHTMLAttributes<HTMLButtonElement>){
  return <button type="button" {...rest} className={`ui-btn ui-btn-${variant} ${className}`.trim()}>{children}</button>;
}
```

```tsx
// apps/web/components/ui/tag.tsx
import type {ReactNode} from 'react';
export function Tag({tone,children}:{tone:'exercise'|'ai'|'warn'|'danger';children:ReactNode}){
  return <span className={`ui-tag ui-tag-${tone}`}>{children}</span>;
}
```

```tsx
// apps/web/components/ui/disclosure.tsx
import type {ReactNode} from 'react';
export function Disclosure({summary,children,defaultOpen=false,id}:{summary:ReactNode;children:ReactNode;defaultOpen?:boolean;id?:string}){
  return <details className="ui-disclosure" open={defaultOpen||undefined} id={id}><summary>{summary}</summary><div className="ui-disclosure-body">{children}</div></details>;
}
```

```tsx
// apps/web/components/ui/status-band.tsx
export function StatusBand({tone,label,countdown=null}:{tone:'danger'|'warn'|'exercise';label:string;countdown?:string|null}){
  return <div className={`ui-band ui-band-${tone}`} role="status"><strong>{label}</strong>{countdown&&<span role="timer" aria-live="off">{countdown}</span>}</div>;
}
```

```tsx
// apps/web/components/ui/bottom-sheet.tsx
import type {ReactNode} from 'react';
export function BottomSheet({peek,children,open,onToggle}:{peek:ReactNode;children:ReactNode;open:boolean;onToggle:()=>void}){
  return <section className="ui-sheet" data-open={open||undefined}>
    <button type="button" className="ui-sheet-head" aria-expanded={open} onClick={onToggle}><span className="ui-sheet-grip" aria-hidden="true"/>{peek}</button>
    {open&&<div className="ui-sheet-body">{children}</div>}
  </section>;
}
```

```ts
// apps/web/components/ui/index.ts
import './ui.css';
export {Section} from './section';export {ListRow} from './list-row';export {Button} from './button';
export {Tag} from './tag';export {Disclosure} from './disclosure';export {StatusBand} from './status-band';export {BottomSheet} from './bottom-sheet';
```

```css
/* apps/web/components/ui/ui.css — the only place allowed to use border-radius (plus map styles). */
.ui-section{padding:var(--sp-5) 0;}
.ui-section+.ui-section{padding-top:var(--sp-6)}
.ui-section-title{margin:0 0 var(--sp-3);font-size:var(--fs-meta);font-weight:600;color:var(--text-2);letter-spacing:.02em}
.ui-row{display:flex;align-items:center;gap:var(--sp-3);width:100%;min-height:48px;padding:var(--sp-3) 0;background:none;border:0;border-bottom:1px solid var(--line);color:var(--text);font:inherit;text-align:left;text-decoration:none;cursor:pointer}
div.ui-row{cursor:default}
.ui-row-label{flex:1;min-width:0;overflow-wrap:anywhere}
.ui-row-value{color:var(--text-2);font-size:var(--fs-meta)}
.ui-row-tail{color:var(--text-2);display:inline-flex}
.ui-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 var(--sp-4);border:0;border-radius:var(--radius);font:inherit;font-weight:600;cursor:pointer;transition:opacity var(--motion)}
.ui-btn:disabled{opacity:.45;cursor:default}
.ui-btn-primary,.ui-btn-danger{width:100%;min-height:52px}
.ui-btn-primary{background:var(--text);color:var(--bg)}
.ui-btn-danger{background:var(--danger);color:var(--bg)}
.ui-btn-secondary{background:none;color:var(--info);padding:0 var(--sp-2)}
.ui-tag{display:inline-flex;align-items:center;min-height:24px;padding:0 var(--sp-2);border-radius:999px;font-size:var(--fs-meta);font-weight:600}
.ui-tag-exercise{color:var(--bg);background:var(--exercise)}
.ui-tag-ai{color:var(--info);background:color-mix(in srgb,var(--info) 16%,transparent)}
.ui-tag-warn{color:var(--bg);background:var(--warn)}
.ui-tag-danger{color:var(--bg);background:var(--danger)}
.ui-disclosure summary{min-height:48px;display:flex;align-items:center;color:var(--text-2);font-size:var(--fs-meta);cursor:pointer;list-style:none}
.ui-disclosure summary::-webkit-details-marker{display:none}
.ui-disclosure summary::after{content:"›";margin-left:var(--sp-2);transition:transform var(--motion)}
.ui-disclosure[open] summary::after{transform:rotate(90deg)}
.ui-disclosure-body{padding-bottom:var(--sp-4)}
.ui-band{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);min-height:44px;padding:0 var(--gutter);font-weight:700}
.ui-band-danger{background:var(--danger);color:var(--bg)}
.ui-band-warn{background:var(--warn);color:var(--bg)}
.ui-band-exercise{background:var(--exercise);color:var(--bg)}
.ui-sheet{position:fixed;left:0;right:0;bottom:calc(64px + env(safe-area-inset-bottom));z-index:15;background:var(--bg);border-radius:var(--radius) var(--radius) 0 0;max-height:70vh;overflow:auto}
.ui-sheet-head{display:flex;flex-direction:column;align-items:center;gap:var(--sp-2);width:100%;min-height:56px;padding:var(--sp-2) var(--gutter);background:none;border:0;color:var(--text);font:inherit;cursor:pointer}
.ui-sheet-grip{width:36px;height:4px;border-radius:2px;background:var(--line)}
.ui-sheet-body{padding:0 var(--gutter) var(--sp-5)}
```

（`color-mix` 是 Chrome 111 以上支援的功能。真機 ROG Phone 6 的 Chrome 版本可以；如果測試環境 jsdom 不解析 CSS，也不影響結果。）

- [ ] **Step 4: 執行測試，確認通過**

Run：`./node_modules/.bin/vitest run tests/ui-primitives.test.tsx` 和 `./node_modules/.bin/tsc --noEmit`
Expected：7 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ui apps/web/tests/ui-primitives.test.tsx
git commit -m "feat(ui): cardless shared primitives (section, row, button, tag, disclosure, band, sheet)"
```

---

### Task 3: AppShell、三分頁與路由對應

**Files:**
- Create: `apps/web/lib/app-tabs.ts`、`apps/web/components/ui/app-shell.tsx`
- Modify: `apps/web/components/ui/index.ts`、`apps/web/components/ui/ui.css`、`apps/web/app/page.tsx`、`apps/web/app/[view]/page.tsx`、`apps/web/app/map/page.tsx`、`apps/web/components/live-dashboard.tsx`（只換掉最外層，lines 約 1291–1316）
- Test: `apps/web/tests/app-shell.test.tsx`、`apps/web/tests/app-tabs.test.ts`

**Interfaces:**
- Consumes：Task 2 的 `StatusBand`
- Produces：
  - `export type AppTab='now'|'map'|'more'`
  - `export const APP_TABS:{key:AppTab;href:string;icon:string;label:Record<Language,string>}[]`，順序為 now→`/dashboard`、map→`/map`、more→`/more`。label 依序是 現在／今／Now、地圖／地図／Map、更多／その他／More。`icon` 沿用 `UiIcon` 既有的名稱（請在 `components/ui-icon.tsx` 中挑選最接近的：home／map／more）。
  - `export function tabForView(view:string):AppTab`：dashboard、plan、sources、demo、trace、`/` → now；map → map；more、notifications → more
  - `export function shouldOpenBasis(view:string):boolean`：plan、sources 為 true
  - `AppShell({tab:AppTab; language:Language; band?:ReactNode; exerciseControls?:ReactNode; children})`：輸出 `band` → `<main class="ui-main">`（最大寬度 640px）→ 演練操作列（如果有）→ `<nav class="ui-tabs">`（固定在底部，每個分頁 ≥ 48px，目前的分頁有 `aria-current="page"`）

- [ ] **Step 1: 寫失敗的測試**

```ts
// apps/web/tests/app-tabs.test.ts
import {expect,it} from 'vitest';
import {APP_TABS,shouldOpenBasis,tabForView} from '../lib/app-tabs';
it('maps every legacy view to one of three tabs',()=>{
  expect(APP_TABS.map(t=>t.key)).toEqual(['now','map','more']);
  for(const v of ['dashboard','plan','sources','demo','trace'])expect(tabForView(v)).toBe('now');
  expect(tabForView('map')).toBe('map');
  for(const v of ['more','notifications'])expect(tabForView(v)).toBe('more');
  expect(shouldOpenBasis('plan')).toBe(true);expect(shouldOpenBasis('sources')).toBe(true);expect(shouldOpenBasis('dashboard')).toBe(false);
});
it('labels tabs in three languages',()=>{
  expect(APP_TABS[0].label).toEqual({'zh-TW':'現在',ja:'今',en:'Now'});
});
```

```tsx
// apps/web/tests/app-shell.test.tsx
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
  // band must come before main content in DOM order (first thing a reader meets)
  expect(host.firstElementChild?.firstElementChild?.className).toContain('ui-band');
});
```

舊網址守衛測試（Review Focus 3），加在 `apps/web/tests/app-tabs.test.ts`：

```ts
import {generateStaticParams} from '../app/[view]/page';
it('still statically generates every legacy view so old links never 404',()=>{
  expect(generateStaticParams().map(p=>p.view).sort()).toEqual(['dashboard','demo','more','notifications','plan','sources','trace'].sort());
});
```

- [ ] **Step 2: 執行測試，確認會失敗**

Run：`./node_modules/.bin/vitest run tests/app-tabs.test.ts tests/app-shell.test.tsx`
Expected：FAIL（缺少模組）

- [ ] **Step 3: 實作**

```ts
// apps/web/lib/app-tabs.ts
import type {Language} from './contracts';
export type AppTab='now'|'map'|'more';
export const APP_TABS:{key:AppTab;href:string;icon:string;label:Record<Language,string>}[]=[
  {key:'now',href:'/dashboard',icon:'home',label:{'zh-TW':'現在',ja:'今',en:'Now'}},
  {key:'map',href:'/map',icon:'map',label:{'zh-TW':'地圖',ja:'地図',en:'Map'}},
  {key:'more',href:'/more',icon:'more',label:{'zh-TW':'更多',ja:'その他',en:'More'}},
];
export function tabForView(view:string):AppTab{
  if(view==='map')return 'map';
  if(view==='more'||view==='notifications')return 'more';
  return 'now';
}
export const shouldOpenBasis=(view:string)=>view==='plan'||view==='sources';
```

```tsx
// apps/web/components/ui/app-shell.tsx
import Link from 'next/link';
import type {ReactNode} from 'react';
import type {Language} from '@/lib/contracts';
import {APP_TABS,type AppTab} from '@/lib/app-tabs';
import {UiIcon} from '../ui-icon';
export function AppShell({tab,language,band,exerciseControls,children}:{tab:AppTab;language:Language;band?:ReactNode;exerciseControls?:ReactNode;children:ReactNode}){
  return <div className="ui-app">
    {band}
    <main className="ui-main">{children}</main>
    {exerciseControls&&<div className="ui-exercise-controls">{exerciseControls}</div>}
    <nav className="ui-tabs" aria-label={language==='ja'?'メイン':language==='en'?'Main':'主選單'}>
      {APP_TABS.map(t=><Link key={t.key} href={t.href} aria-current={t.key===tab?'page':undefined}><UiIcon name={t.icon as never}/><span>{t.label[language]}</span></Link>)}
    </nav>
  </div>;
}
```

`ui.css` 加入：

```css
.ui-app{min-height:100dvh;background:var(--bg);color:var(--text);padding-bottom:calc(64px + env(safe-area-inset-bottom))}
.ui-main{max-width:var(--content-max);margin:0 auto;padding:0 var(--gutter) var(--sp-6)}
.ui-tabs{position:fixed;left:0;right:0;bottom:0;z-index:30;display:grid;grid-template-columns:repeat(3,1fr);height:calc(64px + env(safe-area-inset-bottom));padding-bottom:env(safe-area-inset-bottom);background:var(--bg);border-top:1px solid var(--line)}
.ui-tabs a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:48px;color:var(--text-2);font-size:12px;text-decoration:none}
.ui-tabs a[aria-current=page]{color:var(--text);font-weight:700}
.ui-exercise-controls{position:fixed;left:0;right:0;bottom:calc(64px + env(safe-area-inset-bottom));z-index:25;display:flex;gap:var(--sp-2);justify-content:center;padding:var(--sp-2) var(--gutter);background:var(--bg);border-top:1px solid var(--line)}
```

`index.ts` 加入 `export {AppShell} from './app-shell';`。

整合（這個階段只換外殼，內容先不動）：
- `live-dashboard.tsx` 最外層的 `<div className="live-shell …">` 改成 `<AppShell tab={tabForView(view)} language={language} band={…}>`。`band`：如果目前有關鍵接管（`criticalProtection`）或演練，就放一個 `StatusBand`（文字沿用目前接管標題）；否則為 `undefined`。
- 刪除 `live-topbar`、`desktop-primary-nav`、`mobile-primary-nav` 三個導覽，改由 AppShell 的分頁取代。語言選擇移到「更多」（Task 7 會做；這個階段先把 `<label className="live-language">` 原樣放進 `view==='more'` 的內容最上方，避免功能消失）。
- 「我需要幫助」按鈕（`distress-entry-button`）保持在 `<main>` 的最上方。
- `app/page.tsx`：`/` 改成 render `<LiveDashboard view="dashboard"/>`（規格 §4.6）。原本的 replay 示範入口改從「更多 → 演練與示範」進入（`/demo` 仍然可用）。
- `app/map/page.tsx`：最外層包上 `<AppShell tab="map" language={language}>`，刪除頁面自己的 header 返回鈕（語言改由「更多」設定）。
- `dashboard.tsx`（demo、trace）：最外層包上 `<AppShell tab="now" language={language} band={<StatusBand tone="exercise" label={…三語「演練」}/>} exerciseControls={…原本的 下一則更新／暫停／重新開始 按鈕…}>`，刪除原本的 sidebar。

- [ ] **Step 4: 執行測試**

Run：完整 `./node_modules/.bin/vitest run` 和 `./node_modules/.bin/tsc --noEmit`
Expected：新測試 PASS。既有測試中，如果有斷言依賴舊導覽的 class 或文字（`mobile-primary-nav`、`live-topbar`、`desktop-primary-nav`），請改成檢查 `nav.ui-tabs`，並在報告中逐一列出改了哪些斷言。安全相關的斷言（等級、指示文字、演練標籤、AI 標籤、依據時間）**不可以刪除或放寬**。

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/app-tabs.ts apps/web/components/ui apps/web/app apps/web/components/live-dashboard.tsx apps/web/components/dashboard.tsx apps/web/tests
git commit -m "feat(ui): one AppShell with Now/Map/More tabs replacing mobile and desktop navigation"
```

---

### Task 4: 「不使用框框」守衛測試

**Files:**
- Modify: `apps/web/tests/design-guard.test.ts`

**Interfaces:**
- Produces：`LEGACY_CSS_ALLOWLIST: string[]`（還沒改完的舊樣式檔清單）。每個後續階段完成時，就從清單中移除對應的檔案；第 4 階段結束時，清單只剩下 `components/simulation-map-ui.css`。

- [ ] **Step 1: 加入守衛測試**

```ts
import {readdirSync} from 'node:fs';
const WEB=resolve(__dirname,'..');
function cssFiles(dir:string):string[]{
  return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(e.name==='node_modules'||e.name==='.next'?[]:cssFiles(resolve(dir,e.name))):e.name.endsWith('.css')?[resolve(dir,e.name)]:[]);
}
/** Files not yet migrated. Shrinks every phase; must end as ['components/simulation-map-ui.css']. */
export const LEGACY_CSS_ALLOWLIST=['app/globals.css','components/simulation-map-ui.css','components/simulation-flat-ui.css','components/simulation-dashboard.css','components/disaster-test.css','components/official-hazard.css','components/simulation-geo.css','components/simulation-advice.css','components/distress.css','components/evacuation-route.css','components/plan-explanation.css'];
const ALLOWED_RADIUS=new Set(['components/ui/ui.css','app/tokens.css','components/simulation-map-ui.css']);
describe('cardless guard',()=>{
  const files=cssFiles(resolve(WEB,'app')).concat(cssFiles(resolve(WEB,'components')))
    .map(f=>f.slice(WEB.length+1).replace(/\\/g,'/'));
  it('no box-shadow anywhere outside legacy files',()=>{
    for(const f of files.filter(f=>!LEGACY_CSS_ALLOWLIST.includes(f)))
      expect(readFileSync(resolve(WEB,f),'utf8'),f).not.toMatch(/box-shadow\s*:/);
  });
  it('border-radius only in the shared ui stylesheet, tokens and map styles',()=>{
    for(const f of files.filter(f=>!LEGACY_CSS_ALLOWLIST.includes(f)&&!ALLOWED_RADIUS.has(f)))
      expect(readFileSync(resolve(WEB,f),'utf8'),f).not.toMatch(/border-radius\s*:/);
  });
  it('the legacy allowlist only shrinks (every listed file still exists)',()=>{
    for(const f of LEGACY_CSS_ALLOWLIST)expect(files,f).toContain(f);
  });
});
```

- [ ] **Step 2: 執行測試**

Run：`./node_modules/.bin/vitest run tests/design-guard.test.ts`
Expected：PASS。如果失敗，代表新的樣式檔用了陰影或圓角，請修正樣式，**不要把檔案加進允許清單**。

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/design-guard.test.ts
git commit -m "test(ui): cardless guard with a shrinking legacy allowlist"
```

---

# 第 2 階段：「現在」頁

### Task 5: NowScreen

**Files:**
- Create: `apps/web/components/now-screen.tsx`、`apps/web/tests/now-screen.test.tsx`
- Modify: `apps/web/components/live-dashboard.tsx`（`MobileScene` 與 `DesktopPreparedness` 中 dashboard／plan／sources 三個 view 的內容，改成 render `NowScreen`）

**Interfaces:**
- Consumes：`Section`、`Disclosure`、`Button`、`Tag`、`StatusBand`；既有的 `projection`（`live-presentation.ts` 的 `projectLive…`，請確認 live-dashboard 中實際的變數名稱）、`PlanHistory`、`SourceSummary`／`SourceReview`、`PlanExplanationPanel`
- Produces：`NowScreen({language; hero:string; heroTone:'normal'|'danger'|'warn'; basis:string|null; next:string[]; avoid:string[]; updatedLabel:string; exercise:boolean; openBasis:boolean; basisDetails:ReactNode; help:ReactNode})`。這是純呈現元件，所有資料都由呼叫端提供。

- [ ] **Step 1: 寫失敗的測試**

```tsx
// apps/web/tests/now-screen.test.tsx
// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it} from 'vitest';
import {NowScreen} from '../components/now-screen';
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const base={language:'zh-TW' as const,hero:'立刻往堅固建築物 3 樓以上或高處移動',heroTone:'danger' as const,basis:'氣象廳 大津波警報 · 14:51 發布',
  next:['確認家人位置'],avoid:['不要靠近海邊'],updatedLabel:'更新 14:52',exercise:false,openBasis:false,basisDetails:<p>history</p>,help:<button>我需要幫助</button>};
async function render(p=base){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<NowScreen {...p}/>));return host;}
it('orders hero, basis, help, next, avoid, updated — hero first',async()=>{
  const h=await render();
  const order=[...h.querySelectorAll('[data-now]')].map(e=>e.getAttribute('data-now'));
  expect(order).toEqual(['hero','basis','help','next','avoid','updated']);
  expect(h.querySelector('[data-now=hero]')?.tagName).toBe('H1');
});
it('has no card wrappers and keeps basis details collapsed unless openBasis',async()=>{
  const h=await render();
  expect((h.querySelector('details') as HTMLDetailsElement).open).toBe(false);
  await act(async()=>root.render(<NowScreen {...base} openBasis/>));
  expect((h.querySelector('details') as HTMLDetailsElement).open).toBe(true);
});
it('shows the exercise tag next to the basis in exercise mode',async()=>{
  const h=await render({...base,exercise:true});
  expect(h.querySelector('[data-now=basis] .ui-tag-exercise')?.textContent).toBe('演練');
});
it('omits empty next/avoid sections instead of rendering empty headings',async()=>{
  const h=await render({...base,next:[],avoid:[]});
  expect(h.querySelector('[data-now=next]')).toBeNull();expect(h.querySelector('[data-now=avoid]')).toBeNull();
});
```

另外加一個佈局測試（Review Focus 1），用固定 CSS 估算第一個畫面的高度：在 `apps/web/tests/now-screen.test.tsx` 中計算「狀態色帶 44 ＋ 主要指示最多 3 行 × 28px × 1.25 ＋ 依據 1 行 21 ＋ 間距 24×2 ＋ 主要按鈕 52」必須 ≤ 568 − 64（320×568 的畫面扣掉底部分頁），並以 Step 3 中實際使用的 CSS 數值為準。這是設計約束的回歸測試；真機截圖驗收在 Task 9。

```ts
it('fits band + 3-line hero + basis + help above the fold on a 320x568 phone',()=>{
  const band=44,hero=3*28*1.25,basis=21,gaps=24*2,help=52,fold=568-64;
  expect(band+hero+basis+gaps+help).toBeLessThanOrEqual(fold);
});
```

- [ ] **Step 2: 執行測試，確認會失敗**

Run：`./node_modules/.bin/vitest run tests/now-screen.test.tsx`
Expected：FAIL

- [ ] **Step 3: 實作**

```tsx
// apps/web/components/now-screen.tsx
import type {ReactNode} from 'react';
import type {Language} from '@/lib/contracts';
import {Disclosure,Section,Tag} from './ui';
const T={'zh-TW':{basis:'依據',next:'接下來',avoid:'避免',exercise:'演練'},ja:{basis:'根拠',next:'次に',avoid:'避ける',exercise:'演習'},en:{basis:'Basis',next:'Next',avoid:'Avoid',exercise:'Exercise'}} as const;
export function NowScreen({language,hero,heroTone,basis,next,avoid,updatedLabel,exercise,openBasis,basisDetails,help}:{
  language:Language;hero:string;heroTone:'normal'|'danger'|'warn';basis:string|null;next:string[];avoid:string[];
  updatedLabel:string;exercise:boolean;openBasis:boolean;basisDetails:ReactNode;help:ReactNode}){
  const t=T[language];
  return <div className="now">
    <h1 className={`now-hero now-hero-${heroTone}`} data-now="hero">{hero}</h1>
    <div className="now-basis" data-now="basis">
      {basis&&<p className="now-meta">{basis}</p>}{exercise&&<Tag tone="exercise">{t.exercise}</Tag>}
      <Disclosure summary={t.basis} defaultOpen={openBasis} id="basis">{basisDetails}</Disclosure>
    </div>
    <div className="now-help" data-now="help">{help}</div>
    {next.length>0&&<div data-now="next"><Section title={t.next}><ul className="now-list">{next.map((x,i)=><li key={i}>{x}</li>)}</ul></Section></div>}
    {avoid.length>0&&<div data-now="avoid"><Section title={t.avoid}><ul className="now-list">{avoid.map((x,i)=><li key={i}>{x}</li>)}</ul></Section></div>}
    <p className="now-meta" data-now="updated">{updatedLabel}</p>
  </div>;
}
```

在 `components/ui/ui.css` 加入（不建立新的樣式檔）：

```css
.now-hero{margin:var(--sp-5) 0 var(--sp-2);font-size:var(--fs-hero);font-weight:700;line-height:1.25}
.now-hero-danger{color:var(--text)}
.now-meta{margin:0;color:var(--text-2);font-size:var(--fs-meta)}
.now-basis{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2)}
.now-basis .ui-disclosure{flex-basis:100%}
.now-help{margin:var(--sp-5) 0}
.now-list{margin:0;padding-left:1.2em}
.now-list li+li{margin-top:var(--sp-2)}
```

整合（`live-dashboard.tsx`）：
- 找到 dashboard、plan、sources 三個 view 目前顯示主要指示、計畫和來源的地方（`MobileScene` 約 640–680 行、`DesktopPreparedness` 約 794–816 行）。改成一個 `NowScreen`：
  - `hero`：目前 NOW 行動的文字。沒有計畫時，用「目前沒有警報」（三語，加到 `live-i18n.ts`）。
  - `heroTone`：關鍵接管時用 `danger`；資料過期或離線時用 `warn`；其他用 `normal`。
  - `basis`：「{來源名稱} {警報種類} · {HH:MM} 發布」。沿用目前 `SourceSummary` 計算出的來源與時間；沒有官方依據時為 `null`。
  - `next`／`avoid`：目前計畫中 NEXT／AVOID 行動的文字。
  - `updatedLabel`：「更新 HH:MM」；離線時改成「離線 · 最後確認 HH:MM」（沿用 `displayTime` 與 `lastVerified`）。
  - `openBasis`：`shouldOpenBasis(view)`。
  - `basisDetails`：依序放入 `<PlanHistory/>`、`<SourceReview/>`（原本 sources 分頁的內容）、`<PlanExplanationPanel/>`。
  - `help`：現有的「我需要幫助」按鈕與 `DistressEntry`（從 `<main>` 最上方移到這裡；按鈕改用 `<Button variant="danger">`）。
- 刪除 `DesktopPreparedness` 中 dashboard／plan／sources 的分支，以及 `desktop-readiness-grid`。桌面與手機都用同一個 `NowScreen`（單欄、最大寬度 640px）。
- `AdaptiveHome` 中顯示同樣資訊（主要指示、計畫）的區塊，改由 `NowScreen` 取代。其餘只有 AdaptiveHome 才有的狀態訊息（例如沒有工作階段時的「開始」流程、位置設定入口），保留在 `NowScreen` 上方，並改用 `Section`／`ListRow`／`Button`。

- [ ] **Step 4: 執行測試**

Run：完整的 vitest 與 tsc
Expected：PASS。既有測試中依賴舊結構的斷言照 Task 3 的規則調整，並列入報告；安全相關斷言一律保留。

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/now-screen.tsx apps/web/components/ui/ui.css apps/web/components/live-dashboard.tsx apps/web/lib/live-i18n.ts apps/web/tests
git commit -m "feat(ui): Now screen with one hero instruction, collapsible basis and single layout"
```

---

### Task 6: 「我需要幫助」改用共用元件、修正 D1、文字盤點（現在頁）

**Files:**
- Modify: `apps/web/components/distress-panel.tsx`、`apps/web/components/sos-panel.tsx`、`apps/web/components/distress-entry.tsx`、`apps/web/lib/distress.ts`
- Delete: `apps/web/components/distress.css`（樣式移到 `ui.css`），並從 `LEGACY_CSS_ALLOWLIST` 移除這個檔案
- Create: `docs/UI_REDESIGN_TEXT_AUDIT.md`
- Test: `apps/web/tests/distress-panel.test.tsx`（修改）

**Interfaces:**
- Consumes：`Section`、`Button`、`Tag`、`Disclosure`
- Produces：`DistressPanel` 的 DOM 順序固定為：主要指示 → 依據與倒數 →（只有自己回報 TRAPPED／INJURED／MOBILITY_LIMITED 時）SOS → 狀況按鈕 → 錄音與打字 → （其他情況的）SOS → 更多細節

- [ ] **Step 1: 寫失敗的 D1 測試**

在 `apps/web/tests/distress-panel.test.tsx` 加入：

```tsx
it('keeps the primary instruction first even when AI suggests SOS (D1)',async()=>{
  // Render with snapshot level OFFICIAL_TSUNAMI and advice {suggest_sos:true}, no self-reported pin tags.
  // Reuse this file's existing render helpers and fixtures for an official snapshot + advice response.
  const h=await renderOfficialWithAdvice({suggest_sos:true});
  const primary=h.querySelector('.distress-primary-text')!;const sos=h.querySelector('[data-testid=sos-panel]')!;
  expect(primary.compareDocumentPosition(sos)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it('places SOS directly under the instruction only for self-reported TRAPPED',async()=>{
  const h=await renderWithConfirmedTags(['TRAPPED']);
  const primary=h.querySelector('.distress-primary-text')!;const next=primary.closest('[data-distress=primary]')!.nextElementSibling;
  expect(next?.querySelector('[data-testid=sos-panel]')).not.toBeNull();
});
```

`renderOfficialWithAdvice` 和 `renderWithConfirmedTags` 請用這個測試檔裡**既有**的 fixture 與 fetch stub 組出來：同一個檔案中已經有 OFFICIAL_TSUNAMI 和 advice 情境的測試，把共用的部分抽成這兩個 helper 即可。

- [ ] **Step 2: 執行測試，確認第一個會失敗**

Run：`./node_modules/.bin/vitest run tests/distress-panel.test.tsx`
Expected：D1 測試 FAIL（目前 AI 的 suggest_sos 會把 SOS 排在主要指示上方）

- [ ] **Step 3: 實作**

- `distress-panel.tsx`：把主要指示、依據與倒數包進 `<div data-distress="primary">`，永遠第一個 render。SOS 的位置：`selfPinned = shouldPinSos(confirmedTags, profile, level)` 而且原因是自己回報的標籤，才放在 primary 之後；**AI 的 `suggest_sos` 只在下方的 SOS 區顯示一個 `Tag tone="ai"`「AI 建議求救」，不改變位置**。
- 樣式：全部改用 `ui.css` 的 class。狀況按鈕改成膠囊切換（新增 `.ui-chip`、`.ui-chip[aria-pressed=true]`，圓角 999px，放在 `ui.css`）；錄音改用 `<Button variant="primary">`，打字改用 `<Button variant="secondary">`，求救用 `<Button variant="danger">`。
- 刪除 `distress.css`，並從 `LEGACY_CSS_ALLOWLIST` 移除它。
- 文字盤點：照規格 §5，把 `distressText`／`sosText` 中重複的「不代表地點或路線一定沒有危險」縮成一次（只放在 primary 底下的 `now-meta`）；把隱私說明縮成一句，並加上「了解更多」`Disclosure`。在 `docs/UI_REDESIGN_TEXT_AUDIT.md` 用表格記錄每個字串：位置、原文、處理（刪除／縮短／移位）、新文字。

- [ ] **Step 4: 執行測試**

Run：完整的 vitest、tsc、`design-guard`
Expected：PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components apps/web/lib/distress.ts apps/web/tests docs/UI_REDESIGN_TEXT_AUDIT.md
git rm apps/web/components/distress.css
git commit -m "feat(ui): distress panel on shared primitives; instruction stays first (D1); text audit"
```

---

# 第 3 階段：「地圖」頁

### Task 7: MapScreen 與底部抽屜

**Files:**
- Create: `apps/web/components/map-screen.tsx`、`apps/web/tests/map-screen.test.tsx`
- Modify: `apps/web/app/map/page.tsx`（只留下資料 hook 與狀態，版面交給 `MapScreen`）、`apps/web/components/simulation-reference-map.tsx`（移除圖例卡片，改成一行圖例）、`apps/web/components/{japan-shelter-panel,official-hazard-panel,evacuation-route-panel,designated-places-panel,disaster-map-panel}.tsx`（改成可以放進抽屜的「內容段落」，不再自帶標題卡片）
- Delete: `official-hazard.css`、`evacuation-route.css`、`simulation-geo.css`（樣式併入 `ui.css` 或刪除），並從允許清單移除

**Interfaces:**
- Produces：`MapScreen({language; map:ReactNode; layers:{key:string;label:string;on:boolean;toggle:()=>void}[]; legend:string|null; region:ReactNode; peek:string; sections:{title:string;content:ReactNode}[]; routeSection:ReactNode|null})`
- 圖層開關使用 `.ui-chip`（Task 6 新增）。

- [ ] **Step 1: 寫失敗的測試**

```tsx
// apps/web/tests/map-screen.test.tsx
// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
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
```

- [ ] **Step 2: 執行測試，確認會失敗**

Run：`./node_modules/.bin/vitest run tests/map-screen.test.tsx`
Expected：FAIL

- [ ] **Step 3: 實作**

```tsx
// apps/web/components/map-screen.tsx
'use client';
import {useState,type ReactNode} from 'react';
import type {Language} from '@/lib/contracts';
import {BottomSheet,Section} from './ui';
export function MapScreen({language,map,layers,legend,region,peek,sections,routeSection}:{language:Language;map:ReactNode;
  layers:{key:string;label:string;on:boolean;toggle:()=>void}[];legend:string|null;region:ReactNode;peek:string;
  sections:{title:string;content:ReactNode}[];routeSection:ReactNode|null}){
  const [open,setOpen]=useState(false);
  return <div className="map-screen">
    <div className="map-canvas">{map}</div>
    {region&&<div className="map-region">{region}</div>}
    {layers.length>0&&<div className="map-chips" role="group" aria-label={language==='ja'?'レイヤー':language==='en'?'Layers':'圖層'}>
      {layers.map(l=><button key={l.key} type="button" className="ui-chip" aria-pressed={l.on} onClick={l.toggle}>{l.label}</button>)}
    </div>}
    {legend&&<p className="map-legend">{legend}</p>}
    <BottomSheet peek={peek} open={open} onToggle={()=>setOpen(v=>!v)}>
      {routeSection&&<Section title={language==='ja'?'道路候補':language==='en'?'Road candidates':'道路候選'}>{routeSection}</Section>}
      {sections.map(s=><Section key={s.title} title={s.title}>{s.content}</Section>)}
    </BottomSheet>
  </div>;
}
```

在 `ui.css` 加入：

```css
.map-screen{position:fixed;inset:0 0 calc(64px + env(safe-area-inset-bottom)) 0;background:var(--bg)}
.map-canvas,.map-canvas>*{position:absolute;inset:0}
.map-region{position:absolute;top:var(--sp-3);left:var(--gutter);z-index:5}
.map-chips{position:absolute;left:0;right:0;bottom:72px;z-index:6;display:flex;gap:var(--sp-2);overflow-x:auto;padding:0 var(--gutter)}
.map-legend{position:absolute;left:var(--gutter);right:var(--gutter);bottom:128px;z-index:6;margin:0;color:var(--text-2);font-size:var(--fs-meta)}
```

在 `app/map/page.tsx` 中：
- `map`：現有的 `<SimulationReferenceMap …/>`，props 不變。
- `layers`：浸水想定（`showInundation`）、避難場所（`showPlaces`）、海嘯預報區（`showForecastLines`）、震度地域（`showIntensityRegions`）。
- `legend`：只有在有圖層開啟時才顯示，用三語各一句，從原本圖例卡片的文字精簡而來。原本的「不可作避難導航」等說明只保留一次，放在這行。
- `region`：原本地圖上的地區選擇。
- `peek`：「附近 N 處指定避難場所」（N = `mapPlaces.length`）。
- `sections`：依序為「避難場所」（`DesignatedPlacesPanel` 的列表內容＋`JapanShelterPanel` 的地區選擇與列表）、「官方資料」（`DisasterMapPanel`＋`OfficialHazardPanel` 的海嘯資料）。這些面板改成只輸出內容（標題交給 `Section`），而且不再有外框。
- `routeSection`：有路線候選或已選擇場所時，放 `EvacuationRoutePanel`；否則為 `null`。路線評估的 7 行狀態收成一行「還有 N 項未確認」＋`Disclosure`（規格 §5）。
- 歷史震央選擇從地圖頁移除（Task 8 會把它移到「更多 → 演練與示範」）。

刪除 `official-hazard.css`、`evacuation-route.css`、`simulation-geo.css`，必要的樣式改用 `ui.css` 的 class；從允許清單移除這三個檔案。

- [ ] **Step 4: 執行測試**

Run：完整的 vitest、tsc、design-guard
Expected：PASS（既有地圖測試依賴舊 class 的斷言照 Task 3 的規則調整並列出；地圖資料、隱私預設 `protectDeviceLocation=true`、路線 `ROAD_REFERENCE_ONLY` 等安全斷言一律保留）

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/map/page.tsx apps/web/components apps/web/tests
git rm apps/web/components/official-hazard.css apps/web/components/evacuation-route.css apps/web/components/simulation-geo.css
git commit -m "feat(ui): full-bleed map with layer chips, one-line legend and a single bottom sheet"
```

---

# 第 4 階段：「更多」頁、演練畫面、清除舊樣式

### Task 8: MoreScreen 與子頁

**Files:**
- Create: `apps/web/components/more-screen.tsx`、`apps/web/tests/more-screen.test.tsx`
- Modify: `apps/web/components/live-dashboard.tsx`（`view==='more'` 與 `view==='notifications'` 改成 render `MoreScreen`）

**Interfaces:**
- Produces：`MoreScreen({language; rows:{key:string;label:string;value?:string;href?:string;onClick?:()=>void}[]; subpage:ReactNode|null; onBack?:()=>void})`。`subpage` 不是 null 時，只顯示子頁內容與一個「返回」次要按鈕。

- [ ] **Step 1: 寫失敗的測試**

```tsx
// apps/web/tests/more-screen.test.tsx
// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('next/link',()=>({default:({children,...p}:React.ComponentProps<'a'>)=><a {...p}>{children}</a>}));
import {MoreScreen} from '../components/more-screen';
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('lists the nine settings rows in order as plain rows',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  const labels=['語言','外觀','電量模式','緊急聯絡人','位置與隱私','通知','資訊來源','演練與示範','關於'];
  await act(async()=>root.render(<MoreScreen language="zh-TW" subpage={null} rows={labels.map((label,i)=>({key:String(i),label,onClick:()=>{}}))}/>));
  expect([...host.querySelectorAll('.ui-row .ui-row-label')].map(e=>e.textContent)).toEqual(labels);
});
it('shows only the subpage and a back button when a subpage is open',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);const back=vi.fn();
  await act(async()=>root.render(<MoreScreen language="zh-TW" rows={[{key:'a',label:'語言'}]} subpage={<p>sub</p>} onBack={back}/>));
  expect(host.querySelector('.ui-row')).toBeNull();expect(host.textContent).toContain('sub');
  await act(async()=>(host.querySelector('.ui-btn-secondary') as HTMLButtonElement).click());expect(back).toHaveBeenCalled();
});
```

- [ ] **Step 2: 執行測試，確認會失敗**

Run：`./node_modules/.bin/vitest run tests/more-screen.test.tsx`
Expected：FAIL

- [ ] **Step 3: 實作**

```tsx
// apps/web/components/more-screen.tsx
import type {ReactNode} from 'react';
import type {Language} from '@/lib/contracts';
import {Button,ListRow} from './ui';
export function MoreScreen({language,rows,subpage,onBack}:{language:Language;rows:{key:string;label:string;value?:string;href?:string;onClick?:()=>void}[];subpage:ReactNode|null;onBack?:()=>void}){
  if(subpage)return <div className="more-sub"><Button variant="secondary" onClick={onBack}>{language==='ja'?'‹ 戻る':language==='en'?'‹ Back':'‹ 返回'}</Button>{subpage}</div>;
  return <div className="more"><h1 className="more-title">{language==='ja'?'その他':language==='en'?'More':'更多'}</h1>
    {rows.map(r=><ListRow key={r.key} label={r.label} value={r.value} href={r.href} onClick={r.onClick}/>)}</div>;
}
```

`ui.css`：`.more-title{margin:var(--sp-5) 0 var(--sp-3);font-size:var(--fs-title);font-weight:600}`

整合（`live-dashboard.tsx`）：用 `useState<string|null>` 管理目前的子頁。九列依序對應：
- **語言**：子頁是三個 `ListRow`，帶 ✓ 標示目前的語言。
- **外觀**：子頁是深色／跟隨系統／高對比。
- **電量模式**：子頁是既有的 `PowerControls`。
- **緊急聯絡人**：子頁是 `EmergencyContactsSetup`。
- **位置與隱私**：子頁是一句隱私說明＋「了解更多」`Disclosure`，加上既有的位置設定與 `ProfileForm`。
- **通知**：子頁是 `NotificationsScene`。`view==='notifications'` 時預設打開這個子頁。
- **資訊來源**：子頁是 `SourceReview`。
- **演練與示範**：子頁列出 `/demo`、`/simulation`、`/disaster-test` 的連結，以及從地圖頁移過來的歷史震央選擇。
- **關於**：子頁是版本號、離線準備狀態（`OfflineReadinessPanel`，只在這裡顯示，裡面的技術用語可以保留）、Handoff 連結。

刪除 `live-more-scene`、`desktop-settings` 等舊的 more 版面。把 Task 3 暫時放在 more 頁最上方的語言 `<label>` 移除（已經由「語言」子頁取代）。

- [ ] **Step 4: 執行測試**

Run：完整的 vitest、tsc
Expected：PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/more-screen.tsx apps/web/components/live-dashboard.tsx apps/web/components/ui/ui.css apps/web/tests
git commit -m "feat(ui): More screen as a plain settings list with subpages"
```

---

### Task 9: 演練畫面共用元件、清除舊樣式、驗收

**Files:**
- Modify: `apps/web/components/dashboard.tsx`（demo、trace）、`apps/web/components/simulation-screens.tsx`、`apps/web/components/disaster-test-lab.tsx`、`apps/web/app/simulation/page.tsx`、`apps/web/app/disaster-test/page.tsx`
- Delete: `simulation-flat-ui.css`、`simulation-dashboard.css`、`disaster-test.css`、`simulation-advice.css`、`plan-explanation.css`；把 `app/globals.css` 縮成只剩 reset 與焦點樣式（或刪除，改由 tokens.css 處理）
- Modify: `apps/web/tests/design-guard.test.ts`（`LEGACY_CSS_ALLOWLIST` 只剩 `['components/simulation-map-ui.css']`）
- Create: `docs/UI_REDESIGN_VALIDATION.md`

**Interfaces:**
- Consumes：`AppShell`、`NowScreen`、`MapScreen`、`StatusBand`、`Tag`

- [ ] **Step 1: 寫失敗的守衛測試**

把 `design-guard.test.ts` 裡的 `LEGACY_CSS_ALLOWLIST` 改成 `['components/simulation-map-ui.css']`，再加入一個「演練與真實共用元件」的測試：

```ts
it('exercise screens reuse the same Now/Map components as Live',()=>{
  for(const f of ['components/dashboard.tsx','components/simulation-screens.tsx','components/disaster-test-lab.tsx']){
    const src=readFileSync(resolve(WEB,f),'utf8');
    expect(src,f).toMatch(/AppShell/);
    expect(src,f).toMatch(/NowScreen|MapScreen/);
  }
});
```

- [ ] **Step 2: 執行測試，確認會失敗**

Run：`./node_modules/.bin/vitest run tests/design-guard.test.ts`
Expected：FAIL（舊樣式檔仍然存在，演練畫面也還沒改用共用元件）

- [ ] **Step 3: 實作**

- 三個演練畫面都包上 `AppShell`：
  - `band` 是紫色的 `<StatusBand tone="exercise">`（三語「演練」）；有官方等級時，改用 `tone="danger"`，標籤寫成「演練 · 大津波警報」。
  - `exerciseControls` 放「下一則更新 → ｜ 暫停 ｜ 重新開始」，用 `Button variant="secondary"`。
- 內容：
  - demo／trace 的計畫頁改用 `NowScreen`，資料來自 replay snapshot，與 Live 相同的欄位對應，`exercise=true`。
  - 「Agent 紀錄」「Judge」的內容移到 `basisDetails` 的最後一段，並放在 `Disclosure` 裡。
  - simulation 的地圖頁改用 `MapScreen`。
  - disaster-test 改用 `NowScreen`＋`Section`。
- 刪除上列的舊樣式檔；它們用到的必要樣式改用 `ui.css` 的 class。
- 文字盤點：照規格 §5 處理演練畫面的文字（技術用語只留在 `basisDetails` 的最後一段），並補進 `docs/UI_REDESIGN_TEXT_AUDIT.md`。

- [ ] **Step 4: 執行完整檢查**

Run：
```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit
node scripts/build.mjs
git checkout -- next-env.d.ts
```
（在 `apps/web` 執行；後端在 repo 根目錄執行 `uv run --project services/agent-api pytest services/agent-api/tests -p no:warnings -o addopts=""`，確認沒有受到影響。）
Expected：全部 PASS

- [ ] **Step 5: 真機驗收**

照 `docs/VNEXT_P2_8_DEVICE_ACCEPTANCE.md` 附錄 A 的方式，用 adb＋CDP 在 ROG Phone 6 上截圖，存到 `output/ui-redesign/`：
1. 「現在」頁：平常、OFFICIAL_TSUNAMI、離線。
2. 「我需要幫助」展開，以及 AI 建議求救時（確認 D1）。
3. 「地圖」：抽屜收合與展開。
4. 「更多」與一個子頁。
5. 演練（demo）的「現在」頁。
6. 用 DevTools 把視窗寬度設為 320px 和 360px，重複第 1 與第 3 項。

在 `docs/UI_REDESIGN_VALIDATION.md` 記錄：測試數量、build 結果、每張截圖的檢查結果，以及 Review Focus 1–5 的逐項確認。

- [ ] **Step 6: Commit**

```bash
git add apps/web docs/UI_REDESIGN_TEXT_AUDIT.md docs/UI_REDESIGN_VALIDATION.md output/ui-redesign
git commit -m "feat(ui): exercise screens share Live components; remove legacy stylesheets; validation"
```
