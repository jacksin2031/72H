# 演練位置與全國道路參考線 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 演練可以使用預設地點、地圖點選或目前位置。全日本任一點都能顯示「道路參考線」到適用的指定場所，演練（含 311）和 Live 地圖都能使用。

**Architecture：**
- 演練點位只存在手機上。手機用現有的 `resolveDeviceArea` 把點位轉成 `area_ids`，再交給既有的 `SimulationLocation`。後端不會收到座標。
- 道路資料依固定格網（0.02° × 0.025°）由後端按需向 Overpass 取得，清理成和石卷資料包相同的圖格式，附上 SHA-256 後快取。
- 手機下載 3×3 個格網，驗證後存進 IndexedDB，合併成一張通用的道路圖，再用既有的最短路徑演算法算出參考線。

**Tech Stack：**
- 後端：FastAPI、Pydantic、httpx（已是依賴），測試用 pytest。
- 前端：Next.js 16、React 19、TypeScript、zod 4、IndexedDB，測試用 vitest/jsdom。

**Spec：** `docs/superpowers/specs/2026-10-15-drill-location-nationwide-roads-design.md`

## 與規格的差異（已裁定）
- 規格 §3.2 原本提到「新增位置來源 enum」。本計畫改為沿用既有的 `GPS`／`USER_SELECTED`：PRESET 與 MAP_PICK 對應到 USER_SELECTED，DEVICE_ONCE 對應到 GPS。點位只留在手機上，後端只收到 `area_ids`，結果和規格「Safety Core 視為 USER_SELECTED」一致，而且不需要改資料契約。
- 規格 §3.1 原本把預設地點放在 `historical_cases.py`。本計畫改放在前端的 `lib/drill-location.ts`，讓座標不必經過後端。

## Global Constraints

- 所有道路輸出都必須是 `role: 'ROAD_REFERENCE_ONLY'` 加上 `movement_authorized: false`。「最安全路線未判定」，避難所開放狀態一律顯示未知。
- `route_available` 絕不等於 `route_safe`。不編造道路、時間或來源；沒有資料就說沒有資料。
- 手機只把格網編號 `r{row}c{col}` 送給後端，絕不送精確座標。演練點位絕不寫入 Live 位置設定或 Live 快照。
- 格網：`TILE_LAT_DEG = 0.02`、`TILE_LNG_DEG = 0.025`。`row = floor(lat / 0.02)`、`col = floor(lng / 0.025)`。日本範圍限定在 lat 20.0–46.0、lng 122.0–154.0。
- 單一區塊上限：位元組 1,500,000、節點 20,000、路段 8,000、邊 40,000。合併後上限：節點 180,000、邊 360,000。
- 快取期限：後端 30 天。手機端區塊超過 30 天要加註「資料較舊（取得於 YYYY-MM-DD）」。
- 目的地：取直線距離最近的最多 5 處適用場所列在清單上；地圖只畫最近 3 處，每處 1 條主要參考線。海嘯情境只用 `kind==='EMERGENCY_SITE'` 且 `hazards.tsunami==='DESIGNATED'` 的場所；地震情境改用 `hazards.earthquake==='DESIGNATED'`。
- 固定說明每頁只出現一次：「道路參考線不是避難路線，最安全路線未判定。」（三語）。地圖署名加上「© OpenStreetMap contributors」。
- 演練畫面一律標示「演練」。不新增路線指示；主要指示仍由 Safety Core 決定。
- Overpass：同一時間只發 1 個請求，請求之間至少間隔 2 秒，每個 session 每分鐘最多 30 個區塊請求。遇到 429 或 5xx 時回傳 `503 ROAD_DATA_TEMPORARILY_UNAVAILABLE`，不自動重試。
- 測試不連線真實網路。後端用錄好的 Overpass 回應 fixture。
- 環境：
  - 全域 npm 已壞。在 `apps/web` 用 `./node_modules/.bin/vitest run`、`./node_modules/.bin/tsc --noEmit`、`node scripts/build.mjs`。
  - 新 worktree 缺少依賴時，用 `node C:/Users/jacks/AppData/Local/Temp/claude-npm/package/bin/npm-cli.js ci`。
  - 後端在 repo 根目錄執行 `uv run --project services/agent-api pytest services/agent-api/tests -p no:warnings -o addopts=""`。
  - 永遠不要 `git commit -a`，也不要提交 `apps/web/next-env.d.ts` 或 `.superpowers/`。
- 不部署。

## Review Focus

1. **高密度地區（東京都心）的區塊超過上限。** 預期：後端回傳 `413 ROAD_TILE_TOO_DENSE`，不截斷資料；手機顯示「此地區道路資料過於密集，無法顯示參考線」，不畫任何部分線條。（Task 3、Task 6）
2. **演練點位在海上或日本範圍外。** 預期：`resolveDeviceArea` 回傳 `OUTSIDE` 或 `UNAVAILABLE` 時不能開始演練，畫面顯示「此位置不在日本的市區町村範圍內」；後端拒絕超出範圍的格網編號。（Task 1、Task 3）
3. **離線時 3×3 只有部分區塊在快取裡。** 預期：只用已存的區塊計算，並標示「部分道路資料未下載」。起點或終點落在缺少的區塊時，顯示「此地區沒有道路參考資料（離線）」，不補線。（Task 6）
4. **使用者連續點地圖很多次。** 預期：上一次的下載被取消（AbortController），只顯示最後一個點的結果；後端的 session 限流不會因此被觸發。（Task 6、Task 8）
5. **附近沒有適用場所**（例如只有 `UNKNOWN` 的海嘯旗標）。預期：顯示「附近沒有符合條件的指定場所」，不把條件放寬成 `UNKNOWN`。（Task 7）

---

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `apps/web/lib/drill-location.ts`（新） | 演練點位型別、預設地點、轉成 `SimulationLocation` |
| `apps/web/components/drill-location-picker.tsx`（新） | 三種位置來源的 UI |
| `services/agent-api/agent_api/road_tiles.py`（新） | 格網計算、Overpass 查詢、清理與建圖、manifest |
| `services/agent-api/agent_api/road_tile_service.py`（新） | 快取、限流、HTTP 呼叫 |
| `services/agent-api/agent_api/main.py` | 新增 `GET /api/roads/tile/{tile_id}` |
| `apps/web/app/api/[...path]/route.ts` | 代理白名單加入 `roads/tile/r\d+c\d+`（只允許 GET） |
| `apps/web/lib/road-graph-core.ts`（新） | 通用道路圖型別、驗證、最短路徑（從 `evacuation-road-graph.ts` 抽出） |
| `apps/web/lib/evacuation-road-graph.ts` | 保留石卷資料包載入器，改成輸出通用圖 |
| `apps/web/lib/road-tiles.ts`（新） | 區塊下載、驗證、IndexedDB、合併 |
| `apps/web/lib/road-destinations.ts`（新） | 依災害過濾場所並計算參考線 |
| `apps/web/components/road-reference-section.tsx`（新） | 抽屜中的道路參考區（演練與 Live 共用） |
| `apps/web/components/simulation-screens.tsx`、`dashboard.tsx` | 演練地圖整合 |
| `apps/web/app/map/page.tsx`、`components/evacuation-route-panel.tsx`、`lib/distress-reachability.ts` | Live 改用通用圖 |
| `docs/VNEXT_EVACUATION_ROADS_SOURCE.md` | 更新來源說明（runtime 會經由後端呼叫 Overpass） |

---

### Task 1: 演練點位模型與預設地點

**Files:**
- Create: `apps/web/lib/drill-location.ts`
- Test: `apps/web/tests/drill-location.test.ts`

**Interfaces:**
- Consumes: `resolveDeviceArea(fix: AreaFix): Promise<AreaResolution>`（`lib/area-resolution.ts`），以及 `SimulationLocation`（`lib/simulation-advice.ts`：`{area_ids:string[]; source:'GPS'|'USER_SELECTED'; observed_at:string}`）
- Produces:
  - `type DrillPointSource = 'PRESET'|'MAP_PICK'|'DEVICE_ONCE'`
  - `type DrillPoint = {lat:number; lng:number; source:DrillPointSource; label:{ja:string;'zh-TW':string;en:string}; preset_id:string|null}`
  - `DRILL_PRESETS: Record<HistoricalId, readonly DrillPreset[]>`，其中 `DrillPreset = {id:string; lat:number; lng:number; label:{ja,'zh-TW',en}}`
  - `async function drillPointToLocation(point:DrillPoint, resolve=resolveDeviceArea, now=new Date()): Promise<{ok:true; location:SimulationLocation; areaLabel:string}|{ok:false; reason:'OUTSIDE'|'UNAVAILABLE'|'AMBIGUOUS'}>`

- [ ] **Step 1: 寫失敗的測試**

```ts
// apps/web/tests/drill-location.test.ts
import {describe,expect,it,vi} from 'vitest';
import {DRILL_PRESETS,drillPointToLocation,type DrillPoint} from '../lib/drill-location';

const point=(source:DrillPoint['source']):DrillPoint=>({lat:38.4196,lng:141.2946,source,label:{ja:'石巻・門脇','zh-TW':'石巻・門脇',en:'Ishinomaki Kadonowaki'},preset_id:source==='PRESET'?'tohoku-ishinomaki-kadonowaki':null});

describe('drill presets',()=>{
  it('has 2–3 presets inside Japan for every historical case',()=>{
    for(const [id,list] of Object.entries(DRILL_PRESETS)){
      expect(list.length,id).toBeGreaterThanOrEqual(2);expect(list.length,id).toBeLessThanOrEqual(3);
      for(const p of list){expect(p.lat).toBeGreaterThan(20);expect(p.lat).toBeLessThan(46);expect(p.lng).toBeGreaterThan(122);expect(p.lng).toBeLessThan(154);
        expect(p.label.ja&&p.label['zh-TW']&&p.label.en).toBeTruthy();}
    }
    expect(DRILL_PRESETS['tohoku-2011'].map(p=>p.id)).toEqual(['tohoku-ishinomaki-kadonowaki','tohoku-minamisanriku-shizugawa','tohoku-sendai-arahama']);
  });
});

describe('drillPointToLocation',()=>{
  const resolved=vi.fn(async()=>({status:'RESOLVED' as const,area_ids:['JP-MUNI-04202','JP-04','JP'],label:'石巻市'}));
  it('maps PRESET and MAP_PICK to USER_SELECTED and DEVICE_ONCE to GPS',async()=>{
    for(const [src,expected] of [['PRESET','USER_SELECTED'],['MAP_PICK','USER_SELECTED'],['DEVICE_ONCE','GPS']] as const){
      const r=await drillPointToLocation(point(src),resolved,new Date('2026-10-15T00:00:00Z'));
      expect(r).toEqual({ok:true,areaLabel:'石巻市',location:{area_ids:['JP-MUNI-04202','JP-04','JP'],source:expected,observed_at:'2026-10-15T00:00:00.000Z'}});
    }
  });
  it('never sends coordinates in the location payload',async()=>{
    const r=await drillPointToLocation(point('MAP_PICK'),resolved);
    expect(JSON.stringify(r)).not.toMatch(/38\.41|141\.29/);
  });
  it('refuses points outside a municipality',async()=>{
    for(const status of ['OUTSIDE','UNAVAILABLE','AMBIGUOUS'] as const){
      const r=await drillPointToLocation(point('MAP_PICK'),async()=>({status,area_ids:[],label:''}));
      expect(r).toEqual({ok:false,reason:status});
    }
  });
  it('passes accuracy 0 for preset/map points to the resolver',async()=>{
    const spy=vi.fn(resolved);await drillPointToLocation(point('MAP_PICK'),spy);
    expect(spy).toHaveBeenCalledWith({latitude:38.4196,longitude:141.2946,accuracy_m:0});
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run（在 `apps/web`）：`./node_modules/.bin/vitest run tests/drill-location.test.ts`
Expected：FAIL，原因是 `Cannot find module '../lib/drill-location'`。

- [ ] **Step 3: 實作**

```ts
// apps/web/lib/drill-location.ts
import {resolveDeviceArea} from './area-resolution';
import type {AreaFix,AreaResolution} from './area-geometry';
import type {SimulationLocation} from './simulation-advice';

export type HistoricalId='tohoku-2011'|'kobe-1995'|'kumamoto-2016'|'iburi-2018'|'noto-2024';
export type DrillPointSource='PRESET'|'MAP_PICK'|'DEVICE_ONCE';
type Label={ja:string;'zh-TW':string;en:string};
export type DrillPreset={id:string;lat:number;lng:number;label:Label};
export type DrillPoint={lat:number;lng:number;source:DrillPointSource;label:Label;preset_id:string|null};

/** Exercise-only representative points (approximate centres). Never a statement about real conditions. */
export const DRILL_PRESETS:Record<HistoricalId,readonly DrillPreset[]>={
  'tohoku-2011':[
    {id:'tohoku-ishinomaki-kadonowaki',lat:38.4196,lng:141.2946,label:{ja:'石巻・門脇','zh-TW':'石巻・門脇',en:'Ishinomaki Kadonowaki'}},
    {id:'tohoku-minamisanriku-shizugawa',lat:38.6766,lng:141.4469,label:{ja:'南三陸・志津川','zh-TW':'南三陸・志津川',en:'Minamisanriku Shizugawa'}},
    {id:'tohoku-sendai-arahama',lat:38.2213,lng:140.9800,label:{ja:'仙台・荒浜','zh-TW':'仙台・荒浜',en:'Sendai Arahama'}},
  ],
  'kobe-1995':[
    {id:'kobe-nagata',lat:34.6573,lng:135.1460,label:{ja:'神戸・長田','zh-TW':'神戶・長田',en:'Kobe Nagata'}},
    {id:'kobe-higashinada',lat:34.7200,lng:135.2650,label:{ja:'神戸・東灘','zh-TW':'神戶・東灘',en:'Kobe Higashinada'}},
  ],
  'kumamoto-2016':[
    {id:'kumamoto-mashiki',lat:32.7917,lng:130.8160,label:{ja:'益城町','zh-TW':'益城町',en:'Mashiki'}},
    {id:'kumamoto-chuo',lat:32.8031,lng:130.7079,label:{ja:'熊本市中央区','zh-TW':'熊本市中央區',en:'Kumamoto Chuo'}},
  ],
  'iburi-2018':[
    {id:'iburi-atsuma',lat:42.7240,lng:141.8780,label:{ja:'厚真町','zh-TW':'厚真町',en:'Atsuma'}},
    {id:'iburi-sapporo-kiyota',lat:42.9990,lng:141.4430,label:{ja:'札幌・清田','zh-TW':'札幌・清田',en:'Sapporo Kiyota'}},
  ],
  'noto-2024':[
    {id:'noto-wajima',lat:37.3906,lng:136.8992,label:{ja:'輪島市','zh-TW':'輪島市',en:'Wajima'}},
    {id:'noto-suzu',lat:37.4369,lng:137.2606,label:{ja:'珠洲市','zh-TW':'珠洲市',en:'Suzu'}},
  ],
};

export async function drillPointToLocation(point:DrillPoint,resolve:(fix:AreaFix)=>Promise<AreaResolution>=resolveDeviceArea,now=new Date())
  :Promise<{ok:true;location:SimulationLocation;areaLabel:string}|{ok:false;reason:'OUTSIDE'|'UNAVAILABLE'|'AMBIGUOUS'}>{
  const result=await resolve({latitude:point.lat,longitude:point.lng,accuracy_m:0});
  if(result.status!=='RESOLVED'||result.area_ids.length<2)return {ok:false,reason:result.status==='RESOLVED'?'UNAVAILABLE':result.status};
  return {ok:true,areaLabel:result.label,location:{area_ids:[...result.area_ids],source:point.source==='DEVICE_ONCE'?'GPS':'USER_SELECTED',observed_at:now.toISOString()}};
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run：`./node_modules/.bin/vitest run tests/drill-location.test.ts`
Expected：PASS。接著執行 `./node_modules/.bin/tsc --noEmit`，Expected：exit 0。

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/drill-location.ts apps/web/tests/drill-location.test.ts
git commit -m "feat(drill): drill point model and historical presets"
```

---

### Task 2: 演練位置選擇器（/disaster-test）

**Files:**
- Create: `apps/web/components/drill-location-picker.tsx`
- Modify: `apps/web/components/disaster-test-lab.tsx`（把「用戶所在地區」區塊換成選擇器，舊的都道府縣／市區町村選單保留為第四個選項「只選地區」）、`apps/web/components/ui/ui.css`
- Modify: `apps/web/lib/simulation-session.tsx`（session 狀態加入 `drillPoint: DrillPoint|null`，只存在記憶體）
- Test: `apps/web/tests/drill-location-picker.test.tsx`

**Interfaces:**
- Consumes: `DRILL_PRESETS`、`drillPointToLocation`、`DrillPoint`（Task 1），以及 `SimulationReferenceMap` 的 props `onReferencePoint`、`referencePoint`、`focusPoint`
- Produces: `DrillLocationPicker({language, caseId:HistoricalId|null, value:DrillPoint|null, onChange:(p:DrillPoint|null, location:SimulationLocation|null, areaLabel:string)=>void, geolocate?:()=>Promise<{lat:number;lng:number}>})`。演練 session 新增 `drillPoint`，供 Task 8 使用。

- [ ] **Step 1: 寫失敗的測試**

```tsx
// apps/web/tests/drill-location-picker.test.tsx
// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../lib/area-resolution',()=>({resolveDeviceArea:vi.fn(async()=>({status:'RESOLVED',area_ids:['JP-MUNI-04202','JP-04','JP'],label:'石巻市'}))}));
vi.mock('../components/simulation-reference-map',()=>({SimulationReferenceMap:(p:{onReferencePoint?:(x:{lat:number;lng:number})=>void})=>
  <button data-testid="fake-map" onClick={()=>p.onReferencePoint?.({lat:38.9,lng:141.57})}>map</button>}));
import {DrillLocationPicker} from '../components/drill-location-picker';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();localStorage.clear();});
const mount=async(props:Partial<React.ComponentProps<typeof DrillLocationPicker>>={})=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);const onChange=vi.fn();
  await act(async()=>root.render(<DrillLocationPicker language="zh-TW" caseId="tohoku-2011" value={null} onChange={onChange} {...props}/>));return onChange;};
const click=async(text:string)=>act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(text))!.click();});

it('offers the case presets and emits a USER_SELECTED location without coordinates',async()=>{
  const onChange=await mount();await click('石巻・門脇');
  const [point,location,label]=onChange.mock.calls.at(-1)!;
  expect(point).toMatchObject({source:'PRESET',preset_id:'tohoku-ishinomaki-kadonowaki'});
  expect(location).toMatchObject({source:'USER_SELECTED',area_ids:['JP-MUNI-04202','JP-04','JP']});expect(label).toBe('石巻市');
});
it('map pick requires confirming the tapped point',async()=>{
  const onChange=await mount();await click('在地圖上選點');
  await act(async()=>(host.querySelector('[data-testid=fake-map]') as HTMLButtonElement).click());
  expect(onChange).not.toHaveBeenCalled();await click('使用這個位置');
  expect(onChange.mock.calls.at(-1)![0]).toMatchObject({source:'MAP_PICK',lat:38.9,lng:141.57});
});
it('device location reads once and maps to GPS',async()=>{
  const geolocate=vi.fn(async()=>({lat:38.43,lng:141.30}));const onChange=await mount({geolocate});await click('我的目前位置');
  expect(geolocate).toHaveBeenCalledTimes(1);expect(onChange.mock.calls.at(-1)![1]).toMatchObject({source:'GPS'});
});
it('collapses to one summary line once a point is chosen and never writes Live storage',async()=>{
  await mount({value:{lat:38.4196,lng:141.2946,source:'PRESET',preset_id:'tohoku-ishinomaki-kadonowaki',label:{ja:'石巻・門脇','zh-TW':'石巻・門脇',en:'x'}}});
  expect(host.textContent).toContain('石巻・門脇 · 演練位置');expect(host.querySelectorAll('button').length).toBeLessThanOrEqual(2);
  expect(Object.keys(localStorage)).toEqual([]);
});
it('shows a clear message when the point is outside Japan municipalities',async()=>{
  const {resolveDeviceArea}=await import('../lib/area-resolution');
  vi.mocked(resolveDeviceArea).mockResolvedValueOnce({status:'OUTSIDE',area_ids:[],label:''});
  const onChange=await mount();await click('石巻・門脇');
  expect(host.textContent).toContain('此位置不在日本的市區町村範圍內');expect(onChange).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run：`./node_modules/.bin/vitest run tests/drill-location-picker.test.tsx`
Expected：FAIL，原因是找不到 module。

- [ ] **Step 3: 實作**

`components/drill-location-picker.tsx`：
- 未選時：
  - 用 `Section` 包住，標題是三語的「演練位置」。
  - 內容：預設地點的 `.ui-chip` 按鈕（`DRILL_PRESETS[caseId]`）、「在地圖上選點」次要按鈕、「我的目前位置」次要按鈕。
- 地圖點選：
  - 展開一個 `.drill-map` 區塊（高度 `clamp(280px,50dvh,420px)`）。
  - 區塊內放 `SimulationReferenceMap`，傳入 `compact`、`legend="none"`、`referencePoint={pending}`、`onReferencePoint={setPending}`。
  - 下方放「使用這個位置」主要按鈕和「取消」次要按鈕。
- 目前位置：
  - 預設 `geolocate` 呼叫 `navigator.geolocation.getCurrentPosition`，只讀一次，`maximumAge:0`、`timeout:15000`。
  - 失敗時顯示「無法取得目前位置」。
- 共通流程：
  - 每個選擇都呼叫 `drillPointToLocation`。
  - 失敗時顯示對應三語訊息。`OUTSIDE` 是「此位置不在日本的市區町村範圍內」；`UNAVAILABLE` 和 `AMBIGUOUS` 是「無法判斷此位置所屬的市區町村」。
  - 成功時呼叫 `onChange`。
- 已選時：只顯示一行 `{label} · 演練位置`，加上「更改」次要按鈕。
- 不讀寫 `localStorage` 和 IndexedDB。

`disaster-test-lab.tsx`：
- 用 `DrillLocationPicker` 取代原本「使用目前 GPS 地區／選擇目前所在地區」的兩個按鈕。
- 原本的都道府縣／市區町村選擇器放進 `Disclosure`，標題「只選地區（不顯示道路參考線）」。
- 選擇器的 `onChange` 同時設定 `locationContext` 和 session 的 `drillPoint`。只選地區時，`drillPoint` 設為 null。

`simulation-session.tsx`：
- session 型別加入 `drillPoint: DrillPoint|null`。
- 與 `accessKey` 一樣只放在記憶體，不持久化。

`ui.css`：`.drill-map{height:clamp(280px,50dvh,420px);position:relative;margin-block:var(--sp-3)}`。

- [ ] **Step 4: 執行測試**

Run：
- `./node_modules/.bin/vitest run tests/drill-location-picker.test.tsx tests/disaster-test*.test.tsx`
- `./node_modules/.bin/tsc --noEmit`

Expected：PASS。既有的 disaster-test 測試如果是針對被取代的兩個按鈕，就改成針對選擇器，但保留原本的斷言意圖。

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/drill-location-picker.tsx apps/web/components/disaster-test-lab.tsx apps/web/lib/simulation-session.tsx apps/web/components/ui/ui.css apps/web/tests
git commit -m "feat(drill): preset, map-pick and current-location drill points"
```

---

### Task 3: 後端格網與道路圖建置（純函式）

**Files:**
- Create: `services/agent-api/agent_api/road_tiles.py`
- Create: `services/agent-api/tests/fixtures/overpass_tile_small.json`（手寫的小型 Overpass 回應：3 條 way、8 個 node；其中 1 條 `highway=service` 加 `service=driveway`，必須被排除；1 條 `access=private`，必須被排除）
- Test: `services/agent-api/tests/test_road_tiles.py`

**Interfaces:**
- Produces:
  - `TILE_LAT_DEG=0.02`、`TILE_LNG_DEG=0.025`
  - `parse_tile_id(tile_id:str)->tuple[int,int]`：格式錯誤或超出日本範圍時 raise `ValueError`
  - `tile_bounds(row:int,col:int)->tuple[float,float,float,float]`：回傳 (south,west,north,east)
  - `overpass_query(bounds)->str`
  - `build_tile_graph(tile_id:str, overpass:dict, raw_bytes:bytes, retrieved_at:datetime)->dict`：回傳 JSON-ready 的 dict；超過上限時 raise `TileTooDense`
  - `class TileTooDense(Exception)`

圖格式沿用石卷資料包的欄位：`nodes`、`ways`、`edges`，邊的第 4 欄是方向碼 1/2。不同點如下：
- `schema_version: 2`
- `pack_id: "osm-tile-{tile_id}-v1"`
- `bounds` 是格網範圍加上 0.002° 緩衝
- `capacity: [20000, 40000]`
- `source.retrieved_at`、`source.osm_base_timestamp`、`source.raw_sha256`、`source.query_sha256` 都是實際值
- 另加 `content_sha256`：排除此欄位後，canonical JSON（`separators=(',',':')`、`ensure_ascii=False`、`sort_keys=False`）的 SHA-256

- [ ] **Step 1: 寫失敗的測試**

```python
# services/agent-api/tests/test_road_tiles.py
import hashlib, json
from datetime import datetime, timezone
from pathlib import Path
import pytest
from agent_api.road_tiles import (TILE_LAT_DEG, TILE_LNG_DEG, TileTooDense, build_tile_graph,
                                  overpass_query, parse_tile_id, tile_bounds)

FIXTURE = Path(__file__).parent / "fixtures" / "overpass_tile_small.json"
AT = datetime(2026, 10, 15, tzinfo=timezone.utc)

def test_tile_id_round_trip_and_bounds():
    row, col = parse_tile_id("r1920c5651")
    assert (row, col) == (1920, 5651)
    s, w, n, e = tile_bounds(row, col)
    assert s == pytest.approx(1920 * TILE_LAT_DEG) and n == pytest.approx(s + TILE_LAT_DEG)
    assert w == pytest.approx(5651 * TILE_LNG_DEG) and e == pytest.approx(w + TILE_LNG_DEG)

@pytest.mark.parametrize("bad", ["", "r1c", "x1c2", "r-1c5", "r999c5651", "r1920c99999", "r1920c5651;", "R1920C5651"])
def test_tile_id_rejects_malformed_or_outside_japan(bad):
    with pytest.raises(ValueError):
        parse_tile_id(bad)

def test_query_is_fixed_and_bounded():
    q = overpass_query(tile_bounds(1920, 5651))
    assert q.startswith("[out:json][timeout:45];") and "out body qt;" in q
    assert "service" in q and "sidewalk" in q and "foot" in q
    assert q.count("(38.4,141.275,38.42,141.3)") == 3

def test_build_filters_and_labels_reference_only():
    raw = FIXTURE.read_bytes()
    g = build_tile_graph("r1920c5651", json.loads(raw), raw, AT)
    assert g["role"] == "ROAD_REFERENCE_ONLY" and g["movement_authorized"] is False
    assert g["schema_version"] == 2 and g["pack_id"] == "osm-tile-r1920c5651-v1"
    tags = [w[1] for w in g["ways"]]
    assert all(t.get("service") != "driveway" and t.get("access") != "private" for t in tags)
    assert g["counts"] == [len(g["nodes"]), len(g["ways"]), len(g["edges"])]
    assert g["source"]["raw_sha256"] == hashlib.sha256(raw).hexdigest()
    body = {k: v for k, v in g.items() if k != "content_sha256"}
    assert g["content_sha256"] == hashlib.sha256(json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()

def test_nodes_outside_buffered_bounds_are_dropped_not_kept():
    raw = FIXTURE.read_bytes(); data = json.loads(raw)
    data["elements"].append({"type": "node", "id": 999999, "lat": 10.0, "lon": 10.0})
    g = build_tile_graph("r1920c5651", data, raw, AT)
    assert all(n[0] != 999999 for n in g["nodes"])

def test_too_dense_raises():
    raw = FIXTURE.read_bytes(); data = json.loads(raw)
    base = {"type": "node", "lat": 38.41, "lon": 141.28}
    data["elements"] += [dict(base, id=10_000_000 + i) for i in range(20_001)]
    data["elements"].append({"type": "way", "id": 77, "nodes": [10_000_000 + i for i in range(20_001)], "tags": {"highway": "footway"}})
    with pytest.raises(TileTooDense):
        build_tile_graph("r1920c5651", data, raw, AT)
```

fixture 內容由實作者依照上面的條件手寫，所有座標都要在 (38.40–38.42, 141.275–141.30) 範圍內。

- [ ] **Step 2: 執行測試，確認失敗**

Run：`uv run --project services/agent-api pytest services/agent-api/tests/test_road_tiles.py -p no:warnings -o addopts=""`
Expected：FAIL，原因是 `ModuleNotFoundError: agent_api.road_tiles`。

- [ ] **Step 3: 實作**

```python
# services/agent-api/agent_api/road_tiles.py
"""Nationwide road-reference tiles: fixed grid, fixed Overpass query, ROAD_REFERENCE_ONLY output.

A tile is a road-graph snapshot for reference lines only. It never establishes route safety,
passability, accessibility or movement authority. Callers send a tile id, never a coordinate.
"""
from __future__ import annotations
import hashlib, json, math, re
from datetime import datetime

TILE_LAT_DEG = 0.02
TILE_LNG_DEG = 0.025
BUFFER_DEG = 0.002
LAT_RANGE = (20.0, 46.0)
LNG_RANGE = (122.0, 154.0)
MAX_NODES, MAX_WAYS, MAX_EDGES, MAX_BYTES = 20_000, 8_000, 40_000, 1_500_000
MAX_SEGMENT_M = 1_000
ENDPOINT = "https://overpass-api.de/api/interpreter"
_ID = re.compile(r"^r(\d{1,4})c(\d{1,4})$")
BASIC = {"footway", "path", "pedestrian", "steps", "living_street", "residential", "unclassified", "tertiary", "service"}


class TileTooDense(Exception):
    pass


def parse_tile_id(tile_id: str) -> tuple[int, int]:
    match = _ID.fullmatch(tile_id or "")
    if not match:
        raise ValueError("Invalid tile id")
    row, col = int(match[1]), int(match[2])
    s, w, n, e = tile_bounds(row, col)
    if s < LAT_RANGE[0] or n > LAT_RANGE[1] or w < LNG_RANGE[0] or e > LNG_RANGE[1]:
        raise ValueError("Tile outside Japan range")
    return row, col


def tile_bounds(row: int, col: int) -> tuple[float, float, float, float]:
    s, w = round(row * TILE_LAT_DEG, 6), round(col * TILE_LNG_DEG, 6)
    return s, w, round(s + TILE_LAT_DEG, 6), round(w + TILE_LNG_DEG, 6)


def _box(b): return f"({b[0]:g},{b[1]:g},{b[2]:g},{b[3]:g})"


def overpass_query(bounds) -> str:
    box = _box(bounds)
    return ("[out:json][timeout:45];(\n"
            f'way["highway"~"^(footway|path|pedestrian|steps|living_street|residential|unclassified|tertiary|service)$"]{box};\n'
            f'way["highway"~"^(secondary|primary)$"]["sidewalk"~"^(yes|both|left|right)$"]{box};\n'
            f'way["highway"~"^(secondary|primary)$"]["foot"~"^(yes|designated|permissive)$"]{box};\n'
            ");out body;>;out body qt;")


def _eligible(tags: dict) -> bool:
    hw = tags.get("highway", "")
    walk = tags.get("sidewalk") in {"yes", "both", "left", "right"} or tags.get("foot") in {"yes", "designated", "permissive"}
    if hw not in BASIC and not (hw in {"primary", "secondary"} and walk):
        return False
    for key, ok in (("access", {"yes", "permissive"}), ("foot", {"yes", "designated", "permissive"}), ("access:foot", {"yes", "designated", "permissive"})):
        if key in tags and tags[key] not in ok:
            return False
    if "access:conditional" in tags or "foot:conditional" in tags or tags.get("motorroad") == "yes":
        return False
    if tags.get("service") in {"driveway", "parking_aisle", "drive-through"}:
        return False
    if "oneway:foot" in tags and tags["oneway:foot"] not in {"no", "yes", "true", "false", "1", "0", "-1"}:
        return False
    return True


def _haversine(a, b) -> float:
    r = math.pi / 180
    h = math.sin((b[0] - a[0]) * r / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin((b[1] - a[1]) * r / 2) ** 2
    return 2 * 6_371_008.8 * math.asin(min(1.0, math.sqrt(h)))


def build_tile_graph(tile_id: str, overpass: dict, raw_bytes: bytes, retrieved_at: datetime) -> dict:
    row, col = parse_tile_id(tile_id)
    s, w, n, e = tile_bounds(row, col)
    bounds = [round(s - BUFFER_DEG, 6), round(w - BUFFER_DEG, 6), round(n + BUFFER_DEG, 6), round(e + BUFFER_DEG, 6)]
    inside = lambda lat, lng: bounds[0] <= lat <= bounds[2] and bounds[1] <= lng <= bounds[3]
    elements = overpass.get("elements") or []
    coords = {el["id"]: (el["lat"], el["lon"], el.get("tags") or {}) for el in elements
              if el.get("type") == "node" and isinstance(el.get("lat"), (int, float)) and inside(el["lat"], el["lon"])}
    if len(coords) > MAX_NODES * 3:
        raise TileTooDense(tile_id)
    ways, node_index, nodes, edges, seen = [], {}, [], [], set()
    for el in elements:
        if el.get("type") != "way" or not _eligible(el.get("tags") or {}):
            continue
        tags = el["tags"]
        foot = tags.get("oneway:foot")
        code = 1 if foot in {"yes", "true", "1"} else 2 if foot == "-1" else None
        way_index = len(ways)
        added = False
        refs = el.get("nodes") or []
        for a, b in zip(refs, refs[1:]):
            if a not in coords or b not in coords or a == b:
                continue
            d = _haversine(coords[a][:2], coords[b][:2])
            if not (0 < d <= MAX_SEGMENT_M):
                continue
            for ref in (a, b):
                if ref not in node_index:
                    node_index[ref] = len(nodes)
                    lat, lng, ntags = coords[ref]
                    nodes.append([ref, lat, lng, ntags] if ntags else [ref, lat, lng])
            key = (node_index[a], node_index[b], way_index, code)
            if key in seen:
                continue
            seen.add(key)
            edges.append([node_index[a], node_index[b], way_index] + ([code] if code else []))
            added = True
        if added:
            ways.append([el["id"], tags])
        if len(nodes) > MAX_NODES or len(ways) > MAX_WAYS or len(edges) > MAX_EDGES:
            raise TileTooDense(tile_id)
    query = overpass_query((s, w, n, e))
    body = {
        "schema_version": 2, "pack_id": f"osm-tile-{tile_id}-v1", "role": "ROAD_REFERENCE_ONLY",
        "movement_authorized": False, "built_at": retrieved_at.isoformat(), "bounds": bounds,
        "capacity": [MAX_NODES, MAX_EDGES], "counts": [len(nodes), len(ways), len(edges)],
        "source": {"name": "OpenStreetMap contributors", "endpoint": ENDPOINT,
                   "copyright_url": "https://www.openstreetmap.org/copyright", "license": "ODbL-1.0",
                   "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
                   "osm_base_timestamp": (overpass.get("osm3s") or {}).get("timestamp_osm_base"),
                   "retrieved_at": retrieved_at.isoformat(),
                   "raw_sha256": hashlib.sha256(raw_bytes).hexdigest(),
                   "query_sha256": hashlib.sha256(query.encode()).hexdigest()},
        "nodes": nodes, "ways": ways, "edges": edges,
    }
    canonical = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()
    if len(canonical) > MAX_BYTES:
        raise TileTooDense(tile_id)
    body["content_sha256"] = hashlib.sha256(canonical).hexdigest()
    return body
```

注意：
- 沒有任何邊的 node 不會被加入，所以節點一定都有相連，這點和石卷的驗證規則一致。
- 沒有任何邊的 way 也不會被加入。
- 測試裡的 `"(38.4,141.275,38.42,141.3)"` 是 `_box` 用 `:g` 格式化 `tile_bounds(1920,5651)` 得到的字串。如果實際格式不同，要以實際值為準修正測試，但仍然要斷言三段查詢都使用同一個範圍。

- [ ] **Step 4: 執行測試，確認通過**

Run：同 Step 2。Expected：PASS。

- [ ] **Step 5: Commit**

```bash
git add services/agent-api/agent_api/road_tiles.py services/agent-api/tests/test_road_tiles.py services/agent-api/tests/fixtures/overpass_tile_small.json
git commit -m "feat(roads): fixed-grid OSM road tile builder (reference only)"
```

---

### Task 4: 後端 API、快取、限流與代理白名單

**Files:**
- Create: `services/agent-api/agent_api/road_tile_service.py`
- Modify: `services/agent-api/agent_api/main.py`（`create_app` 接受 `road_tiles: RoadTileService | None = None` 並註冊路由）、`apps/web/app/api/[...path]/route.ts`
- Test: `services/agent-api/tests/test_road_tile_api.py`、`apps/web/tests/api-proxy.test.ts`（擴充既有的檔案；若沒有既有檔案就新增）

**Interfaces:**
- Consumes: `parse_tile_id`、`build_tile_graph`、`overpass_query`、`tile_bounds`、`TileTooDense`（Task 3）
- Produces:
  - `class RoadTileService(fetch: Callable[[str], Awaitable[tuple[int, bytes]]] | None = None, cache_dir: Path | None = None, clock=time.monotonic, now=lambda: datetime.now(timezone.utc))`
  - 方法 `async get(tile_id: str, session_key: str) -> dict`，可能 raise `TileUnavailable`、`TileTooDense`、`ValueError`、`TileRateLimited`
  - HTTP `GET /api/roads/tile/{tile_id}`，狀態碼對應如下：

| 狀態碼 | 情況 | 回應內容 |
|---|---|---|
| 200 | 成功 | 圖 JSON，加上 `Cache-Control: public, max-age=86400` |
| 400 | tile id 不合法 | — |
| 413 | 區塊太密集 | `{"detail":"ROAD_TILE_TOO_DENSE"}` |
| 429 | session 超過限流 | — |
| 503 | 暫時無法取得 | `{"detail":"ROAD_DATA_TEMPORARILY_UNAVAILABLE"}` |

  - session key 取自 `X-Road-Session` header：手機每次啟動產生一個隨機 UUID。沒有這個 header 時用 `"anonymous"`。

- [ ] **Step 1: 寫失敗的測試**

```python
# services/agent-api/tests/test_road_tile_api.py
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from agent_api.main import create_app
from agent_api.road_tile_service import RoadTileService

RAW = (Path(__file__).parent / "fixtures" / "overpass_tile_small.json").read_bytes()

def client(fetch, tmp_path, **kw):
    svc = RoadTileService(fetch=fetch, cache_dir=tmp_path, **kw)
    return TestClient(create_app(road_tiles=svc)), svc

def test_success_then_cache(tmp_path):
    calls = []
    async def fetch(q): calls.append(q); return 200, RAW
    c, _ = client(fetch, tmp_path)
    a = c.get("/api/roads/tile/r1920c5651"); b = c.get("/api/roads/tile/r1920c5651")
    assert a.status_code == b.status_code == 200 and len(calls) == 1
    body = a.json()
    assert body["role"] == "ROAD_REFERENCE_ONLY" and body["movement_authorized"] is False
    assert a.headers["cache-control"] == "public, max-age=86400"

def test_rejects_coordinates_and_bad_ids(tmp_path):
    async def fetch(q): raise AssertionError("must not call Overpass")
    c, _ = client(fetch, tmp_path)
    for path in ["r1920c5651x", "38.41,141.28", "r9999c1"]:
        assert c.get(f"/api/roads/tile/{path}").status_code in (400, 404)
    assert c.get("/api/roads/tile/r1920c5651?lat=38.4&lng=141.2").status_code == 400

@pytest.mark.parametrize("status", [429, 500, 504])
def test_upstream_failure_is_503_without_retry(tmp_path, status):
    calls = []
    async def fetch(q): calls.append(q); return status, b"busy"
    c, _ = client(fetch, tmp_path)
    r = c.get("/api/roads/tile/r1920c5651")
    assert r.status_code == 503 and r.json()["detail"] == "ROAD_DATA_TEMPORARILY_UNAVAILABLE" and len(calls) == 1

def test_malformed_upstream_is_503_and_not_cached(tmp_path):
    async def fetch(q): return 200, b"{not json"
    c, _ = client(fetch, tmp_path)
    assert c.get("/api/roads/tile/r1920c5651").status_code == 503
    assert not list(tmp_path.glob("*.json"))

def test_session_rate_limit(tmp_path):
    async def fetch(q): return 200, RAW
    c, _ = client(fetch, tmp_path, per_session_per_minute=2)
    h = {"X-Road-Session": "s1"}
    codes = [c.get(f"/api/roads/tile/r1920c{5651 + i}", headers=h).status_code for i in range(3)]
    assert codes == [200, 200, 429]

def test_cache_expires_after_30_days(tmp_path):
    from datetime import datetime, timedelta, timezone
    calls = []; clock = {"now": datetime(2026, 10, 15, tzinfo=timezone.utc)}
    async def fetch(q): calls.append(q); return 200, RAW
    c, _ = client(fetch, tmp_path, now=lambda: clock["now"])
    c.get("/api/roads/tile/r1920c5651"); clock["now"] += timedelta(days=31); c.get("/api/roads/tile/r1920c5651")
    assert len(calls) == 2
```

在 `apps/web/tests/api-proxy.test.ts` 加入：

```ts
import {isAllowedApiProxyPath,isAllowedApiProxyMethod} from '../app/api/[...path]/route';
it('allows only GET road tiles by grid id',()=>{
  expect(isAllowedApiProxyPath('roads/tile/r1920c5651')).toBe(true);
  for(const p of ['roads/tile/38.4,141.2','roads/tile/r1920c5651/x','roads/tile/r1c'])expect(isAllowedApiProxyPath(p)).toBe(false);
  expect(isAllowedApiProxyMethod('roads/tile/r1920c5651','GET')).toBe(true);
  expect(isAllowedApiProxyMethod('roads/tile/r1920c5651','POST')).toBe(false);
});
```

（`route.ts` 中檢查方法的函式，名稱以實際 export 的為準。如果目前沒有 export，就把它 export 出來。）

- [ ] **Step 2: 執行測試，確認失敗**

Run：
- `uv run --project services/agent-api pytest services/agent-api/tests/test_road_tile_api.py -p no:warnings -o addopts=""`
- 在 `apps/web`：`./node_modules/.bin/vitest run tests/api-proxy.test.ts`

Expected：兩者都 FAIL。

- [ ] **Step 3: 實作**

`road_tile_service.py`：
- 預設的 `fetch` 用 `httpx.AsyncClient(timeout=50)` 對 `ENDPOINT` POST `data=<query>`。header 加上 `User-Agent: 72H-road-reference/1.0 (+https://github.com/jacksin2031/72H)`。
- 全域用一個 `asyncio.Lock` 讓 Overpass 請求排隊，並記錄最後一次請求時間；兩次請求至少間隔 2 秒，用 `await asyncio.sleep` 等待。
- 快取：
  - 檔案存在 `cache_dir/{tile_id}.json`。預設目錄是 `Path(os.environ.get("ROAD_TILE_CACHE_DIR", tempfile.gettempdir())) / "72h-road-tiles"`。
  - 讀取時檢查 `source.retrieved_at` 是否在 30 天內，也檢查 `content_sha256` 是否正確；不符合就當作沒有快取。
  - 寫入時先寫暫存檔，再用 `os.replace` 換上。
- session 限流：記錄每個 session key 最近 60 秒內的時間戳，預設每分鐘 30 次。快取命中也要計數。
- 錯誤處理：
  - 上游狀態碼不是 200、JSON 解析失敗、或 `osm3s` 欄位不存在，都 raise `TileUnavailable`。
  - `TileTooDense` 照原樣傳出，不寫入快取。

`main.py`：
- 端點：`@application.get("/api/roads/tile/{tile_id}")`。
- 有任何 query string 時回 400。
- 例外與狀態碼的對應：`ValueError`→400、`TileTooDense`→413、`TileRateLimited`→429、`TileUnavailable`→503。
- 回應加上 `Cache-Control` header。

`route.ts`：
- `allowed` 正則加入 `roads\/tile\/r\d{1,4}c\d{1,4}`。
- 方法檢查加入 `if (/^roads\/tile\/r\d{1,4}c\d{1,4}$/.test(path)) return method === 'GET';`。
- 轉發時一併帶上 `X-Road-Session` header。

- [ ] **Step 4: 執行測試，確認通過**

Run：同 Step 2，再執行完整的後端測試套件。Expected：PASS。

- [ ] **Step 5: Commit**

```bash
git add services/agent-api/agent_api/road_tile_service.py services/agent-api/agent_api/main.py services/agent-api/tests/test_road_tile_api.py apps/web/app/api apps/web/tests/api-proxy.test.ts
git commit -m "feat(roads): cached, rate-limited road tile endpoint"
```

---

### Task 5: 前端通用道路圖（從石卷資料包抽出）

**Files:**
- Create: `apps/web/lib/road-graph-core.ts`
- Modify: `apps/web/lib/evacuation-road-graph.ts`、`apps/web/lib/distress-reachability.ts`、`apps/web/components/evacuation-route-panel.tsx`、`apps/web/components/distress-entry.tsx`、`apps/web/components/distress-panel.tsx`
- Test: `apps/web/tests/road-graph-core.test.ts`；既有的 `tests/evacuation-road-graph.test.ts` 必須全部繼續通過，不可刪除任何斷言

**Interfaces:**
- Produces（`road-graph-core.ts`）：
  - `type RoadReferenceGraph = Readonly<{role:'ROAD_REFERENCE_ONLY'; movement_authorized:false; bounds:RoadBounds; nodes:readonly RoadGraphNode[]; ways:readonly RoadGraphWay[]; edges:readonly RoadGraphEdge[]; sources:readonly {pack_id:string; retrieved_at:string; osm_base_timestamp:string|null}[]}>`
  - `function buildReferenceGraph(input:{bounds:RoadBounds; nodes; ways; edges; sources}, limits={maxNodes:180_000, maxEdges:360_000}): RoadReferenceGraph`：違反任何不變量（角色、計數、範圍、合格路段、邊長、連通）就 throw
  - `function findRoadCandidates(graph:RoadReferenceGraph, origin:RoadPoint, destination:RoadPoint): RoadCandidateResult`：演算法與現有的 `findEvacuationRoadCandidates` 相同；`MAX_EDGE_RELAXATIONS_PER_SEARCH` 改成 `Math.max(40_000, graph.edges.length * 4)`
  - 從 `evacuation-road-graph.ts` 搬過來並 re-export 的型別：`RoadPoint`、`RoadBounds`、`RoadCandidate`、`RoadCandidateResult`、`RoadGraphNode`、`RoadGraphWay`、`RoadGraphEdge`、`tagsAreCandidateEligible`、`haversine`
- `evacuation-road-graph.ts`：
  - `loadEvacuationRoadGraph()` 保持石卷的所有固定檢查（雜湊、位元組數、範圍、試點節點），並另外 export `ishinomakiReferenceGraph(pack:RoadGraphPack):RoadReferenceGraph`。
  - `findEvacuationRoadCandidates(pack, …)` 保留，內部改成呼叫 `findRoadCandidates(ishinomakiReferenceGraph(pack), …)`，確保既有測試照常通過。

- [ ] **Step 1: 寫失敗的測試**

```ts
// apps/web/tests/road-graph-core.test.ts
import {describe,expect,it} from 'vitest';
import {buildReferenceGraph,findRoadCandidates} from '../lib/road-graph-core';

const bounds={south:38.40,west:141.27,north:38.42,east:141.30};
const road={highway:'residential'};
const line=(n:number)=>({bounds,sources:[{pack_id:'t',retrieved_at:'2026-10-15T00:00:00Z',osm_base_timestamp:null}],
  nodes:Array.from({length:n},(_,i)=>({osm_id:i+1,lat:38.41,lng:141.28+i*0.001,tags:{}})),
  ways:[{osm_id:1,tags:road}],
  edges:Array.from({length:n-1},(_,i)=>({from_node_index:i,to_node_index:i+1,way_index:0,direction:'BIDIRECTIONAL' as const,distance_m:0}))});

describe('buildReferenceGraph',()=>{
  it('is always reference-only and recomputes edge lengths',()=>{
    const g=buildReferenceGraph(line(5));
    expect(g.role).toBe('ROAD_REFERENCE_ONLY');expect(g.movement_authorized).toBe(false);
    expect(g.edges[0].distance_m).toBeGreaterThan(80);
  });
  it('rejects nodes outside bounds, ineligible ways, disconnected nodes and oversize graphs',()=>{
    expect(()=>buildReferenceGraph({...line(3),nodes:[...line(3).nodes,{osm_id:99,lat:10,lng:10,tags:{}}]})).toThrow();
    expect(()=>buildReferenceGraph({...line(3),ways:[{osm_id:1,tags:{highway:'motorway'}}]})).toThrow();
    expect(()=>buildReferenceGraph(line(5),{maxNodes:4,maxEdges:100})).toThrow();
  });
});

describe('findRoadCandidates',()=>{
  it('finds a reference candidate along the line and never authorizes movement',()=>{
    const g=buildReferenceGraph(line(10));
    const r=findRoadCandidates(g,{lat:38.41,lng:141.28},{lat:38.41,lng:141.288});
    expect(r.reason).toBeNull();expect(r.candidates[0].distance_m).toBeGreaterThan(600);
    expect(r.map_layer).toBe('ROAD_REFERENCE_ONLY');expect(r.movement_authorized).toBe(false);
  });
  it('reports OUTSIDE_PACK_BOUNDS rather than inventing a line',()=>{
    const r=findRoadCandidates(buildReferenceGraph(line(4)),{lat:38.41,lng:141.28},{lat:35.0,lng:139.0});
    expect(r.candidates).toEqual([]);expect(r.reason).toBe('OUTSIDE_PACK_BOUNDS');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run：`./node_modules/.bin/vitest run tests/road-graph-core.test.ts`
Expected：FAIL，原因是找不到 module。

- [ ] **Step 3: 實作**

把 `evacuation-road-graph.ts` 裡和石卷無關的部分搬到 `road-graph-core.ts`：
- `haversine`、`isWithinBounds`、`tagsAreCandidateEligible`
- `MinHeap`、`shortestPath`、`nearestNode`、`plausiblePath`、`pathToCandidate`、`physicalEdgeKey`、`emptyResult`

`buildReferenceGraph` 的驗證項目和現有 `parseAndBuildPack` 的通用部分相同：
- 節點必須在範圍內。
- osm_id 不可重複。
- 路段必須符合 `tagsAreCandidateEligible`。
- 邊的參照必須合法，長度在 0 到 1000 m 之間。
- 方向碼必須和 `oneway:foot` 一致。
- 每個節點都必須至少連著一條邊。
- 不可超過上限。

`buildAdjacency` 改成只看 `RoadReferenceGraph` 的不變量，不再比對石卷的常數；石卷的常數檢查留在 `ishinomakiReferenceGraph` 裡。

`distress-reachability.ts`、`evacuation-route-panel.tsx`、`distress-entry.tsx`、`distress-panel.tsx`：這一個 Task 先保持行為不變，只把型別改成接受 `RoadReferenceGraph`（傳入 `ishinomakiReferenceGraph(pack)`）。全國資料在 Task 9 才接上。

- [ ] **Step 4: 執行測試**

Run：
- `./node_modules/.bin/vitest run tests/road-graph-core.test.ts tests/evacuation-road-graph.test.ts tests/distress*.test.ts* tests/evacuation-route*.test.tsx`
- `./node_modules/.bin/tsc --noEmit`

Expected：PASS，既有測試沒有刪除任何斷言。

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/road-graph-core.ts apps/web/lib/evacuation-road-graph.ts apps/web/lib/distress-reachability.ts apps/web/components/evacuation-route-panel.tsx apps/web/components/distress-entry.tsx apps/web/components/distress-panel.tsx apps/web/tests/road-graph-core.test.ts
git commit -m "refactor(roads): generic reference graph core; Ishinomaki pack as one source"
```

---

### Task 6: 手機端區塊下載、驗證、儲存與合併

**Files:**
- Create: `apps/web/lib/road-tiles.ts`
- Test: `apps/web/tests/road-tiles.test.ts`

**Interfaces:**
- Consumes: `buildReferenceGraph`、`RoadReferenceGraph`（Task 5）
- Produces:
  - `tileIdFor(lat:number,lng:number):string`，回傳 `r{floor(lat/0.02)}c{floor(lng/0.025)}`
  - `tilesAround(lat:number,lng:number):string[]`：3×3 共 9 個，順序固定為列優先
  - `type RoadTileState = {status:'READY'; graph:RoadReferenceGraph; missing:string[]; oldestRetrievedAt:string; stale:boolean; persisted:boolean} | {status:'UNAVAILABLE'; reason:'OFFLINE_NO_DATA'|'TOO_DENSE'|'TEMPORARILY_UNAVAILABLE'|'INVALID_DATA'}`
  - `async function loadRoadTilesAround(point:{lat:number;lng:number}, opts:{signal?:AbortSignal; fetchTile?:(id:string,signal?:AbortSignal)=>Promise<Response>; store?:TileStore; now?:Date; online?:boolean}): Promise<RoadTileState>`
  - `interface TileStore {get(id:string):Promise<unknown|null>; put(id:string,value:unknown):Promise<void>}`，預設用 IndexedDB 的 `72h-roads` / `tiles`；IndexedDB 不能用時改用記憶體，並設 `persisted:false`

規則：
- 先讀取 store。如果 store 已經有該區塊，且 `retrieved_at` 在 30 天內，就不重新下載。
- 下載的資料必須依序通過三個檢查，否則就不能用也不能存：
  - 用 zod 驗證格式：`schema_version` 等於 2、`role` 等於 `ROAD_REFERENCE_ONLY`、`movement_authorized` 等於 false。
  - 重算 `content_sha256` 必須相符：以 `JSON.stringify` 序列化移除該欄位後的物件，用 `crypto.subtle.digest('SHA-256')` 計算。
  - 用 `buildReferenceGraph` 驗證圖。
- 413 回應對應 `TOO_DENSE`，此時整個結果都是 `UNAVAILABLE`，不畫任何部分線條。
- 離線時（`online===false`，或下載失敗但 store 裡有部分區塊）只用已存的區塊，把缺少的區塊列在 `missing`。如果一個區塊都沒有，回傳 `OFFLINE_NO_DATA`。
- 中央區塊（演練點位所在的區塊）缺少時，回傳 `UNAVAILABLE` 加 `OFFLINE_NO_DATA`。
- 下載時帶上 `X-Road-Session` header，值是模組層級的 `crypto.randomUUID()`。
- `signal` 中止時立即停止，不寫入 store。

- [ ] **Step 1: 寫失敗的測試**

```ts
// apps/web/tests/road-tiles.test.ts
import {describe,expect,it,vi} from 'vitest';
import {loadRoadTilesAround,tileIdFor,tilesAround} from '../lib/road-tiles';

async function sha(o:object){const b=new TextEncoder().encode(JSON.stringify(o));const d=await crypto.subtle.digest('SHA-256',b);return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function tile(id:string,retrieved='2026-10-15T00:00:00+00:00'){
  const m=/^r(\d+)c(\d+)$/.exec(id)!;const s=+m[1]*0.02,w=+m[2]*0.025;
  const body={schema_version:2,pack_id:`osm-tile-${id}-v1`,role:'ROAD_REFERENCE_ONLY',movement_authorized:false,built_at:retrieved,
    bounds:[s-0.002,w-0.002,s+0.022,w+0.027],capacity:[20000,40000],counts:[2,1,1],
    source:{name:'OpenStreetMap contributors',endpoint:'https://overpass-api.de/api/interpreter',copyright_url:'https://www.openstreetmap.org/copyright',license:'ODbL-1.0',license_url:'https://opendatacommons.org/licenses/odbl/1-0/',osm_base_timestamp:null,retrieved_at:retrieved,raw_sha256:'0'.repeat(64),query_sha256:'0'.repeat(64)},
    nodes:[[Number(m[1])*100000+Number(m[2]),s+0.005,w+0.005],[Number(m[1])*100000+Number(m[2])+1,s+0.005,w+0.006]],ways:[[Number(m[2]),{highway:'residential'}]],edges:[[0,1,0]]};
  return {...body,content_sha256:await sha(body)};
}
const memStore=()=>{const m=new Map<string,unknown>();return {m,get:async(k:string)=>m.get(k)??null,put:async(k:string,v:unknown)=>{m.set(k,v);}};};
const P={lat:38.41,lng:141.28};

describe('tile ids',()=>{
  it('maps a point to its grid tile and 3×3 neighbourhood',()=>{
    expect(tileIdFor(38.41,141.28)).toBe('r1920c5651');
    expect(tilesAround(38.41,141.28)).toHaveLength(9);expect(tilesAround(38.41,141.28)[4]).toBe('r1920c5651');
  });
});

describe('loadRoadTilesAround',()=>{
  it('downloads, validates, stores and merges nine tiles',async()=>{
    const store=memStore();const fetchTile=vi.fn(async(id:string)=>Response.json(await tile(id)));
    const r=await loadRoadTilesAround(P,{fetchTile,store,now:new Date('2026-10-16T00:00:00Z'),online:true});
    expect(r.status).toBe('READY');expect(fetchTile).toHaveBeenCalledTimes(9);expect(store.m.size).toBe(9);
    if(r.status==='READY'){expect(r.graph.role).toBe('ROAD_REFERENCE_ONLY');expect(r.missing).toEqual([]);expect(r.stale).toBe(false);}
  });
  it('rejects and does not store a tile whose hash does not match',async()=>{
    const store=memStore();const fetchTile=vi.fn(async(id:string)=>Response.json({...await tile(id),content_sha256:'f'.repeat(64)}));
    const r=await loadRoadTilesAround(P,{fetchTile,store,online:true});
    expect(r).toEqual({status:'UNAVAILABLE',reason:'INVALID_DATA'});expect(store.m.size).toBe(0);
  });
  it('offline uses stored tiles only and reports missing ones; never fetches',async()=>{
    const store=memStore();for(const id of tilesAround(P.lat,P.lng).slice(3,6))store.m.set(id,await tile(id));
    const fetchTile=vi.fn();const r=await loadRoadTilesAround(P,{fetchTile,store,online:false});
    expect(fetchTile).not.toHaveBeenCalled();expect(r.status).toBe('READY');
    if(r.status==='READY')expect(r.missing).toHaveLength(6);
  });
  it('offline without the centre tile is OFFLINE_NO_DATA',async()=>{
    const r=await loadRoadTilesAround(P,{fetchTile:vi.fn(),store:memStore(),online:false});
    expect(r).toEqual({status:'UNAVAILABLE',reason:'OFFLINE_NO_DATA'});
  });
  it('a too-dense tile makes the whole result unavailable (no partial lines)',async()=>{
    const fetchTile=vi.fn(async(id:string)=>id==='r1920c5651'?new Response('{"detail":"ROAD_TILE_TOO_DENSE"}',{status:413}):Response.json(await tile(id)));
    expect(await loadRoadTilesAround(P,{fetchTile,store:memStore(),online:true})).toEqual({status:'UNAVAILABLE',reason:'TOO_DENSE'});
  });
  it('marks tiles older than 30 days as stale with the retrieval date',async()=>{
    const store=memStore();for(const id of tilesAround(P.lat,P.lng))store.m.set(id,await tile(id,'2026-08-01T00:00:00+00:00'));
    const r=await loadRoadTilesAround(P,{fetchTile:vi.fn(async()=>new Response('',{status:503})),store,now:new Date('2026-10-15T00:00:00Z'),online:true});
    expect(r.status==='READY'&&r.stale&&r.oldestRetrievedAt.startsWith('2026-08-01')).toBe(true);
  });
  it('an aborted load stores nothing',async()=>{
    const store=memStore();const abort=new AbortController();abort.abort();
    await expect(loadRoadTilesAround(P,{signal:abort.signal,fetchTile:vi.fn(),store,online:true})).rejects.toThrow();
    expect(store.m.size).toBe(0);
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run：`./node_modules/.bin/vitest run tests/road-tiles.test.ts`
Expected：FAIL。

- [ ] **Step 3: 實作**

在 `lib/road-tiles.ts` 依上面的規則實作：
- tile 的 zod schema 照 Task 3 的輸出逐欄定義，用 `.strict()`。
- 合併多個區塊時：
  - 用 osm_id 去除重複節點，邊界上的節點會出現在相鄰區塊。
  - 重新編號 nodes、ways、edges。
  - 用 way 的 osm_id 和兩端 node 的 osm_id 去除重複的邊。
  - 合併後的 `bounds` 取所有區塊的外框。
- 然後呼叫 `buildReferenceGraph`。
- 下載 9 個區塊時，最多 3 個同時進行。

- [ ] **Step 4: 執行測試，確認通過**

Run：`./node_modules/.bin/vitest run tests/road-tiles.test.ts && ./node_modules/.bin/tsc --noEmit`
Expected：PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/road-tiles.ts apps/web/tests/road-tiles.test.ts
git commit -m "feat(roads): device tile loader with hash check, IndexedDB cache and offline use"
```

---

### Task 7: 目的地與參考線計算

**Files:**
- Create: `apps/web/lib/road-destinations.ts`
- Test: `apps/web/tests/road-destinations.test.ts`

**Interfaces:**
- Consumes: `findRoadCandidates`、`RoadReferenceGraph`（Task 5），以及 `JapanShelterPlace`（`lib/japan-shelters.ts`，其中 `hazards` 的鍵是 `hazardKeys`，值是 `DESIGNATED|NOT_DESIGNATED|UNKNOWN`）
- Produces:
  - `type RoadHazard='tsunami'|'earthquake'`
  - `type RoadDestination={place:JapanShelterPlace; straight_m:number; road:RoadCandidate|null; reason:RoadCandidateReason|null}`
  - `function roadDestinations(graph:RoadReferenceGraph|null, origin:{lat:number;lng:number}, places:readonly JapanShelterPlace[], hazard:RoadHazard): {destinations:RoadDestination[]; none:boolean}`
    - 過濾條件：`kind==='EMERGENCY_SITE' && hazards[hazard]==='DESIGNATED'`。
    - 依直線距離取最近 5 處。
    - 只對前 3 處計算參考線，只取主要那一條（`candidates[0]`）。
    - `graph` 是 null 時，`road` 一律為 null。
    - 沒有任何符合條件的場所時，`none:true`。

- [ ] **Step 1: 寫失敗的測試**

```ts
// apps/web/tests/road-destinations.test.ts
import {expect,it} from 'vitest';
import {roadDestinations} from '../lib/road-destinations';
import type {JapanShelterPlace} from '../lib/japan-shelters';
const place=(id:string,lat:number,lng:number,tsunami:'DESIGNATED'|'NOT_DESIGNATED'|'UNKNOWN',kind:'EMERGENCY_SITE'|'SHELTER'='EMERGENCY_SITE')=>({
  id,common_id:id,name:id,address:'',lat,lng,kind,notes:'',municipality_id:'04202',municipality_name:'石巻市',designation_updated_at:null,
  hazards:{flood:'UNKNOWN',landslide:'UNKNOWN',storm_surge:'UNKNOWN',earthquake:'DESIGNATED',tsunami,large_fire:'UNKNOWN',inland_flood:'UNKNOWN',volcano:'UNKNOWN'}}) as unknown as JapanShelterPlace;
const O={lat:38.41,lng:141.28};

it('keeps only DESIGNATED emergency sites for the hazard, nearest five, roads for three',()=>{
  const places=[...Array.from({length:7},(_,i)=>place('d'+i,38.41+i*0.001,141.28,'DESIGNATED')),place('u',38.4101,141.28,'UNKNOWN'),place('n',38.4102,141.28,'NOT_DESIGNATED'),place('s',38.4103,141.28,'DESIGNATED','SHELTER')];
  const r=roadDestinations(null,O,places,'tsunami');
  expect(r.destinations.map(d=>d.place.id)).toEqual(['d0','d1','d2','d3','d4']);expect(r.none).toBe(false);
  expect(r.destinations.every(d=>d.road===null)).toBe(true);
});
it('does not widen to UNKNOWN when nothing qualifies',()=>{
  const r=roadDestinations(null,O,[place('u',38.41,141.28,'UNKNOWN')],'tsunami');
  expect(r).toEqual({destinations:[],none:true});
});
it('uses the earthquake flag for earthquake drills',()=>{
  const r=roadDestinations(null,O,[place('x',38.41,141.28,'NOT_DESIGNATED')],'earthquake');
  expect(r.destinations.map(d=>d.place.id)).toEqual(['x']);
});
```

- [ ] **Step 2–4：** 先執行，確認 FAIL。實作時直線距離用 `road-graph-core` 的 `haversine`。再執行，確認 PASS，並跑 `tsc`。

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/road-destinations.ts apps/web/tests/road-destinations.test.ts
git commit -m "feat(roads): hazard-filtered nearest designated places with reference lines"
```

---

### Task 8: 演練地圖整合（道路參考區、置中、圖層）

**Files:**
- Create: `apps/web/components/road-reference-section.tsx`
- Modify:
  - `apps/web/components/simulation-reference-map.tsx`：`referenceRoute` 改成 `referenceRoutes?: readonly RoadCandidate[]`，舊的 prop 保留為別名
  - `apps/web/components/simulation-screens.tsx`：/simulation 的地圖分頁
  - `apps/web/components/dashboard.tsx`：/demo 的地圖分頁
  - `apps/web/components/ui/ui.css`
  - `docs/UI_REDESIGN_TEXT_AUDIT.md`
- Test: `apps/web/tests/road-reference-section.test.tsx`、`apps/web/tests/simulation-map-roads.test.tsx`

**Interfaces:**
- Consumes: `loadRoadTilesAround`、`RoadTileState`（Task 6），`roadDestinations`（Task 7），`loadJapanShelterCatalog`、`loadJapanShelterPrefecture`，session 的 `drillPoint`（Task 2）
- Produces:
  - `useRoadReference(point:{lat:number;lng:number}|null, hazard:RoadHazard, prefectureCode:string|null)`，回傳 `{state:'IDLE'|'LOADING'|'READY'|'ERROR'; tiles:RoadTileState|null; result:{destinations:RoadDestination[]; none:boolean}|null; retry:()=>void}`
    - 點位改變時，先中止上一次的載入。
  - `RoadReferenceSection({language, exercise:boolean, hazard, reference})`：渲染抽屜裡的列表和狀態訊息
  - `roadPeekText(language, hazard, reference)`：抽屜收合時那一行文字

**文字（三語，`roadPeekText` 與 `RoadReferenceSection`）**

| 情況 | zh-TW | ja | en |
|---|---|---|---|
| 正在載入 | 正在取得道路資料… | 道路データを取得中… | Loading road data… |
| 已就緒 | 附近 {N} 處海嘯適用指定場所 · 道路參考 | 近くの津波対応指定場所 {N} か所 · 道路参考 | {N} tsunami-designated places nearby · road reference |
| 已就緒（地震） | 把「海嘯適用」換成「地震適用」 | 同左（地震対応） | 同左（earthquake-designated） |
| 沒有點位 | 請選擇一個點以顯示道路參考線 | （三語） | （三語） |
| 附近沒有場所 | 附近沒有符合條件的指定場所 | （三語） | （三語） |
| 失敗 | 無法取得此地區道路資料，附「重試」次要按鈕 | （三語） | （三語） |
| `TOO_DENSE` | 此地區道路資料過於密集，無法顯示參考線 | （三語） | （三語） |
| `OFFLINE_NO_DATA` | 此地區沒有道路參考資料（離線） | （三語） | （三語） |
| 有缺少的區塊 | 部分道路資料未下載 | （三語） | （三語） |
| 資料較舊 | 資料較舊（取得於 YYYY-MM-DD） | （三語） | （三語） |

其他固定內容：
- 列表每一列：`{名稱} · 直線 {km} · 道路 {km}（參考）`；`road===null` 時寫 `道路 —`。開放狀態不顯示。
- 固定說明只出現一次：「道路參考線不是避難路線，最安全路線未判定。」
- 署名：「© OpenStreetMap contributors」。
- 演練時列表上方加 `Tag`「演練」。

- [ ] **Step 1: 寫失敗的測試**

```tsx
// apps/web/tests/road-reference-section.test.tsx
// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it} from 'vitest';
import {RoadReferenceSection,roadPeekText} from '../components/road-reference-section';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const render=async(el:React.ReactElement)=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(el));};
const ready=(n:number,stale=false)=>({state:'READY' as const,retry:()=>{},tiles:{status:'READY' as const,graph:{} as never,missing:[],oldestRetrievedAt:'2026-08-01T00:00:00Z',stale,persisted:true},
  result:{none:false,destinations:Array.from({length:n},(_,i)=>({place:{id:'p'+i,name:'場所'+i} as never,straight_m:1200+i,road:i<3?{distance_m:1500,coordinates:[],id:'candidate-1',origin_gap_m:1,destination_gap_m:1,road_names:[]}:null,reason:null}))}});

it('peek text counts tsunami-designated places',()=>{
  expect(roadPeekText('zh-TW','tsunami',ready(5))).toBe('附近 5 處海嘯適用指定場所 · 道路參考');
  expect(roadPeekText('zh-TW','earthquake',ready(2))).toBe('附近 2 處地震適用指定場所 · 道路參考');
});
it('lists places with reference distances, one disclaimer, OSM attribution and the exercise tag',async()=>{
  await render(<RoadReferenceSection language="zh-TW" exercise hazard="tsunami" reference={ready(5)}/>);
  expect(host.textContent).toContain('場所0 · 直線 1.2 km · 道路 1.5 km（參考）');expect(host.textContent).toContain('場所4 · 直線 1.2 km · 道路 —');
  expect(host.textContent!.split('道路參考線不是避難路線，最安全路線未判定。').length-1).toBe(1);
  expect(host.textContent).toContain('© OpenStreetMap contributors');expect(host.textContent).toContain('演練');
  expect(host.textContent).not.toMatch(/開放中|安全路線[:：]/);
});
it('shows the stale date, too-dense and offline messages without lines',async()=>{
  await render(<RoadReferenceSection language="zh-TW" exercise={false} hazard="tsunami" reference={ready(1,true)}/>);
  expect(host.textContent).toContain('資料較舊（取得於 2026-08-01）');
  await act(async()=>root.render(<RoadReferenceSection language="zh-TW" exercise={false} hazard="tsunami" reference={{state:'READY',retry:()=>{},result:null,tiles:{status:'UNAVAILABLE',reason:'TOO_DENSE'}}}/>));
  expect(host.textContent).toContain('此地區道路資料過於密集，無法顯示參考線');
});
it('error offers a retry button',async()=>{
  let retried=false;
  await render(<RoadReferenceSection language="zh-TW" exercise hazard="tsunami" reference={{state:'ERROR',retry:()=>{retried=true;},result:null,tiles:null}}/>);
  await act(async()=>(host.querySelector('.ui-btn-secondary') as HTMLButtonElement).click());expect(retried).toBe(true);
});
```

`simulation-map-roads.test.tsx`（mock 掉 `road-tiles`、`japan-shelters` 和 `SimulationReferenceMap`，只記錄收到的 props）要斷言以下幾點：
- 有 `drillPoint` 時，地圖的 `focusPoint` 等於該點，`zoom` 為 14。
- 圖層膠囊出現「道路參考」，而且預設 `aria-pressed="true"`。
- `referenceRoutes` 最多 3 條。
- 沒有 `drillPoint` 時，抽屜收合那一行是「請選擇一個點以顯示道路參考線」，`loadRoadTilesAround` 沒有被呼叫。
- 311 演練中出現海嘯警報後，`hazard` 是 `'tsunami'`。判斷依據是：快照 `distress.level==='OFFICIAL_TSUNAMI'`，或歷史 milestone 已經到達 TSUNAMI_WARNING。
- 熊本演練的 `hazard` 是 `'earthquake'`。
- 連續改兩次 `drillPoint` 時，第一次的 `signal` 被中止。

- [ ] **Step 2: 執行測試，確認失敗**

Run：`./node_modules/.bin/vitest run tests/road-reference-section.test.tsx tests/simulation-map-roads.test.tsx`
Expected：FAIL。

- [ ] **Step 3: 實作**

- `road-reference-section.tsx`：照上面的表實作 `useRoadReference`、`RoadReferenceSection` 和 `roadPeekText`。
  - 都道府縣代碼取 `area_ids` 中 `JP-` 加兩位數的那一個。
  - 用 `loadJapanShelterPrefecture` 載入該都道府縣的場所。
- `simulation-reference-map.tsx`：`referenceRoutes` 每條線用既有的參考線樣式畫出，並沿用 `ROAD_REFERENCE_ONLY` 的圖層命名。
- `simulation-screens.tsx` 和 `dashboard.tsx` 的地圖分頁：
  - `focusPoint={drillPoint&&{...drillPoint,zoom:14}}`。
  - 新增「道路參考」圖層膠囊。
  - `BottomSheet` 的收合那一行在有點位時用 `roadPeekText`；`sections` 加入 `RoadReferenceSection`。
  - 地圖上已有的另一則「不是避難路線」說明要合併，確保整頁只出現一次。
- `docs/UI_REDESIGN_TEXT_AUDIT.md`：加入新增文字的列。

- [ ] **Step 4: 執行測試**

Run：完整的 vitest、`tsc`，以及 `design-guard`（新的 CSS 只能用 tokens）。
Expected：PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/components apps/web/lib apps/web/tests docs/UI_REDESIGN_TEXT_AUDIT.md
git commit -m "feat(drill): road reference lines on exercise maps"
```

---

### Task 9: Live 地圖頁改用全國區塊

**Files:**
- Modify: `apps/web/app/map/page.tsx`、`apps/web/components/evacuation-route-panel.tsx`、`apps/web/lib/distress-reachability.ts`、`apps/web/components/distress-entry.tsx`
- Test: `apps/web/tests/map-live-roads.test.tsx`；既有的 `tests/evacuation-route-panel.test.tsx` 和 `tests/distress-reachability*.test.ts` 必須繼續通過

**Interfaces:**
- Consumes: `useRoadReference`、`RoadReferenceSection`（Task 8）
- Produces: Live 的 `/map` 在使用者選的點或 GPS 點（`protectDeviceLocation` 開啟時只用使用者選的點）周圍顯示道路參考區。石卷的內建資料包在點位位於其範圍內、而且區塊無法取得時作為備援。

- [ ] **Step 1: 寫失敗的測試**

`map-live-roads.test.tsx`（mock 掉 `road-tiles`）要斷言以下幾點：
- 在 /map 選一個氣仙沼的點（38.9, 141.57）後，`loadRoadTilesAround` 被呼叫，呼叫參數就是這個點。
- `protectDeviceLocation` 開啟、而且只有 GPS 沒有選點時，不呼叫 `loadRoadTilesAround`，並顯示「請選擇一個點以顯示道路參考線」。
- 點位在石卷範圍內、而且區塊回傳 `TEMPORARILY_UNAVAILABLE` 時，改用 `loadEvacuationRoadGraph` 的資料，畫面顯示參考線。
- 整頁的「道路參考線不是避難路線，最安全路線未判定。」只出現一次。

- [ ] **Step 2–4：** 先確認 FAIL。實作時：
  - `evacuation-route-panel.tsx` 內部改用 `useRoadReference` 加 `RoadReferenceSection`，同時保留既有的試點起點按鈕，但只在石卷範圍內顯示。
  - `distress-reachability.ts` 改成接受 `RoadReferenceGraph|null`。
  - `distress-entry.tsx` 在有使用者點位時，優先用區塊圖，否則用石卷資料包。

  再確認完整 vitest 和 `tsc` 都 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/map/page.tsx apps/web/components/evacuation-route-panel.tsx apps/web/lib/distress-reachability.ts apps/web/components/distress-entry.tsx apps/web/tests
git commit -m "feat(roads): Live map uses nationwide road reference tiles"
```

---

### Task 10: 文件、建置與真機驗收

**Files:**
- Modify: `docs/VNEXT_EVACUATION_ROADS_SOURCE.md`。增加一節「全國道路參考區塊」，內容包括：
  - runtime 會經由後端以固定查詢呼叫 Overpass；
  - 格網規格；
  - 手機只送格網編號；
  - 快取、限流和上限；
  - ODbL 授權標示；
  - 同樣的「嚴格解讀界線」。
  - 原本寫著「runtime never calls Overpass」的句子要改成只描述石卷內建資料包。
- Modify: `scripts/build_offline_map.py`。把第一行 docstring 改成「This offline map-pack builder never runs at runtime; road-reference tiles are fetched by the API (see road_tiles.py).」
- Create: `docs/DRILL_ROADS_DEVICE_VALIDATION.md`
- Create: `output/drill-roads/`（截圖）

- [ ] **Step 1：** 執行完整檢查。
  - 在 `apps/web` 執行：`./node_modules/.bin/vitest run`、`./node_modules/.bin/tsc --noEmit`、`node scripts/build.mjs`、`git checkout -- next-env.d.ts`。
  - 後端執行完整的 pytest。
  - Expected：全部 PASS。
- [ ] **Step 2：** 真機驗收（ROG Phone 6，adb＋CDP，production build，port 3039/8019），依規格 §7.2 的 1–5 項執行：
  - 第 3 項用 `api.log` 確認請求路徑只有 `/api/roads/tile/r…c…`，沒有任何座標。
  - 第 4 項用 CDP 的 `Network.emulateNetworkConditions` 模擬斷網，不切換手機本身的網路。
  - 不按撥號、簡訊或求救。
  - 結束後清理：停止服務、移除 adb 規則、刪除臨時演練密鑰。
- [ ] **Step 3：** 把結果寫進 `docs/DRILL_ROADS_DEVICE_VALIDATION.md`，每項標 PASS／FAIL／NOT RUN，附上截圖檔名、限制和清理紀錄。
- [ ] **Step 4: Commit**

```bash
git add docs/VNEXT_EVACUATION_ROADS_SOURCE.md scripts/build_offline_map.py docs/DRILL_ROADS_DEVICE_VALIDATION.md output/drill-roads
git commit -m "docs(roads): nationwide road tile provenance and device validation"
```
