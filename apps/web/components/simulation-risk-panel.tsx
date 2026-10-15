'use client';

import type { Language } from '@/lib/contracts';
import type { GeospatialAssessment } from '@/lib/geospatial-exposure';

const copy={
  ja:{
    title:'位置と災害リスク',location:'端末の現在地を取得',clear:'位置を消去',
    pending:'位置情報は未取得です',requesting:'GPS 権限を確認中…',
    failure:'GPS を取得できません。端末の許可と精度を確認してください。',
    gps:'取得した GPS',accuracy:'測位誤差',distance:'震央との地表距離',distanceOnly:'距離のみ · 震度・安全性は判定できません',
    earthquake:'地震の安全性',tsunami:'津波・浸水リスク',unknown:'判定不能',
    tsunamiWarning:'歴史演習で津波警報が発表されました。海岸・河川付近では実際の警報に従い高台や指定の避難ビルへ。',
    noWarning:'現時点で演習の津波警報は未発生です。危険がない意味ではありません。',
    tsunamiMissing:'沿岸・標高・浸水想定の公式データがなく、浸水や安全な場所は特定できません。',
    shelters:'安全な避難先',notVerified:'開設状況・適性・経路が確認されていません。候補の認定・ナビは無効です。',
    privacy:'GPS は明示的な許可後に一度だけ取得し、ブラウザーのメモリーだけに保持します。AI やサーバーへ送信しません。',
    history:'気象庁の歴史震央情報',warning:'これは架空の訓練です。現実の緊急時には公式情報と現場の指示に従ってください。',
    outside:'この震央は東京都心の道路地図の表示外です。',
  },
  en:{
    title:'Position & hazard screening',location:'Use my GPS once',clear:'Forget location',
    pending:'Position not provided',requesting:'Requesting GPS permission…',
    failure:'GPS unavailable. Check browser permission and positional accuracy.',
    gps:'GPS observation',accuracy:'Accuracy radius',distance:'Surface distance to epicenter',distanceOnly:'Distance only · cannot predict shaking or safety',
    earthquake:'Earthquake safety',tsunami:'Tsunami / inundation',unknown:'UNDETERMINED',
    tsunamiWarning:'Historical tsunami warning reached. For a real alert near coast/rivers, follow official advice to higher ground or designated evacuation buildings.',
    noWarning:'No tsunami warning played yet. This does NOT mean there is no tsunami exposure.',
    tsunamiMissing:'Missing approved inundation, elevation and coastal exposure data; no safe locations can be identified.',
    shelters:'Verified safe destinations',notVerified:'Shelter opening, suitability and safe route unverified. Ranking and navigation are disabled.',
    privacy:'GPS is requested once after explicit consent and held in memory only, never sent to the AI or server.',
    history:'Archived JMA epicenter source',warning:'Historical EXERCISE only. In real emergencies follow current official alerts and local instructions.',
    outside:'The archived epicenter lies outside the central Tokyo reference map.',
  },
  'zh-TW':{
    title:'位置與災害風險',location:'使用目前 GPS 定位',clear:'清除定位',
    pending:'尚未提供位置',requesting:'正在要求 GPS 權限…',
    failure:'無法取得有效 GPS，請檢查定位權限和精度。',
    gps:'本機 GPS',accuracy:'定位誤差',distance:'距離震央的地表直線距離',distanceOnly:'距離只供參考，不能推算震度或證明安全',
    earthquake:'地震安全評估',tsunami:'海嘯與浸水風險',unknown:'無法判定',
    tsunamiWarning:'歷史模擬海嘯警報已發生。如現實中在海岸或河岸遇到警報，應遵從官方指示前往高地或指定避難建築。',
    noWarning:'模擬的海嘯警報尚未發生，但不代表沒有海嘯風險。',
    tsunamiMissing:'缺少已核實的浸水預測、地勢高度和海岸風險資料，不能判定哪些位置安全。',
    shelters:'已核實安全避難地點',notVerified:'未有可核實的開放狀態、災害適用性和安全路線；不會推薦或啟動導航。',
    privacy:'只在你按掣授權後取得一次 GPS，資料僅存於記憶體，不會送往 AI 或伺服器。',
    history:'日本氣象廳歷史震央資料',warning:'此為歷史演習；現實緊急情況請遵從最新官方警報及現場指示。',
    outside:'歷史震央位於東京都心參考道路地圖範圍以外。',
  }, 'zh-CN': {
    title:'位置与灾害风险',location:'使用目前 GPS 定位',clear:'清除定位',
    pending:'尚未提供位置',requesting:'正在要求 GPS 权限…',
    failure:'无法取得有效 GPS，请检查定位权限和精度。',
    gps:'本机 GPS',accuracy:'定位误差',distance:'距离震央的地表直线距离',distanceOnly:'距离只供参考，不能推算震度或证明安全',
    earthquake:'地震安全评估',tsunami:'海啸与浸水风险',unknown:'无法判定',
    tsunamiWarning:'历史仿真海啸警报已发生。如现实中在海岸或河岸遇到警报，应遵从官方指示前往高地或指定避难建筑。',
    noWarning:'仿真的海啸警报尚未发生，但不代表没有海啸风险。',
    tsunamiMissing:'缺少已核实的浸水预测、地势高度和海岸风险数据，不能判定哪些位置安全。',
    shelters:'已核实安全避难地点',notVerified:'未有可核实的开放状态、灾害适用性和安全路线；不会推荐或启动导航。',
    privacy:'只在你按掣授权后取得一次 GPS，数据仅存于内存，不会送往 AI 或服务器。',
    history:'日本气象厅历史震央数据',warning:'此为历史演习；现实紧急情况请遵从最新官方警报及现场指示。',
    outside:'历史震央位于东京都心参考道路地图范围以外。',
  },
} as const;

export function SimulationRiskPanel({language,assessment,gpsState,gpsError,requestLocation,clearLocation}:{
  language:Language;assessment:GeospatialAssessment;
  gpsState:'idle'|'requesting'|'ready'|'error';gpsError:string;
  requestLocation:()=>void;clearLocation:()=>void;
}) {
  const t=copy[language];
  const {epicenter,seismic,tsunami,user_location}=assessment;
  return <section className="sim-risk-panel" data-testid="simulation-risk-panel">
    <div className="sim-risk-header"><h2>{t.title}</h2><span className="sim-risk-exercise">EXERCISE · NO SAFETY CLEARANCE</span></div>
    <div className="sim-risk-gps">
      {user_location?<div className="sim-risk-gps-observed"><strong>{t.gps}</strong>
        <p>{user_location.lat.toFixed(4)}°, {user_location.lng.toFixed(4)}° · {t.accuracy} ±{Math.round(user_location.accuracy_m)}m</p></div>
        :<p>{gpsState==='requesting'?t.requesting:gpsState==='error'?t.failure:t.pending}</p>}
      {gpsState==='ready'&&user_location ? <button type="button" onClick={clearLocation}>{t.clear}</button>
        :<button type="button" onClick={requestLocation} disabled={gpsState==='requesting'} data-testid="simulation-request-gps">{t.location}</button>}
    </div>
    <div className="sim-risk-entry">
      <h3>{t.earthquake} <span className="sim-risk-unknown">{t.unknown}</span></h3>
      <p>{t.distance}: <strong data-testid="epicentral-distance">{seismic.surface_distance_km===null?'—':seismic.surface_distance_km.toLocaleString()+' km'}</strong></p>
      {seismic.min_distance_km!==null&&seismic.max_distance_km!==null&&seismic.min_distance_km<seismic.max_distance_km&&<small>
        {seismic.min_distance_km.toFixed(1)}–{seismic.max_distance_km.toFixed(1)} km ({t.accuracy})
      </small>}
      <p className="sim-risk-limits">{t.distanceOnly}</p>
      {epicenter&&<a href={epicenter.source_url} target="_blank" rel="noopener noreferrer">{t.history} ↗</a>}
    </div>
    <div className={tsunami.warning_active?'sim-risk-entry sim-risk-tsunami-on':'sim-risk-entry'}>
      <h3>{t.tsunami} <span className="sim-risk-unknown">{t.unknown}</span></h3>
      <p className="sim-risk-alert">{tsunami.warning_active?t.tsunamiWarning:t.noWarning}</p>
      <p>{t.tsunamiMissing}</p>
      <a href="https://www.jma.go.jp/jma/kishou/know/jishin/tsunami_bosai/index.html"
        target="_blank" rel="noopener noreferrer">JMA · {t.tsunami} ↗</a>
    </div>
    <div className="sim-risk-entry">
      <h3>{t.shelters} <span className="sim-risk-unknown">{t.unknown}</span></h3>
      <p>{t.notVerified}</p>
    </div>
    <p className="sim-risk-privacy">{t.privacy}</p>
    <p className="sim-risk-alert">{t.warning}</p>
  </section>;
}
