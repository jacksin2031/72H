import type {Language} from './contracts';
/** Forecast-line legend state, derived from the same line states the map draws (solid = ACTIVE, grey dashed = anything else). */
export type ForecastLegendState='ACTIVE'|'MIXED'|'OLD'|'NONE';
export function forecastLegendState(states:readonly string[]):ForecastLegendState{
  if(!states.length)return 'NONE';
  const active=states.filter(s=>s==='ACTIVE').length;
  return active===states.length?'ACTIVE':active?'MIXED':'OLD';
}
const text:Record<Language,Record<ForecastLegendState,string>>={
  'zh-TW':{ACTIVE:'海嘯預報區：期限內電文（實線）',MIXED:'海嘯預報區：實線＝期限內電文，灰色虛線＝過期／未核實／取消',
    OLD:'海嘯預報區：灰色虛線＝過期／未核實／取消，並非目前資訊',NONE:'海嘯預報區：未取得可核實電文'}, 'zh-CN': {ACTIVE:'海啸预报区：期限内电文（实线）',MIXED:'海啸预报区：实线＝期限内电文，灰色虚线＝过期／未核实／取消',
    OLD:'海啸预报区：灰色虚线＝过期／未核实／取消，并非目前信息',NONE:'海啸预报区：未取得可核实电文'},
  ja:{ACTIVE:'津波予報区：期限内の電文（実線）',MIXED:'津波予報区：実線＝期限内の電文、灰色の破線＝期限切れ／未確認／取消',
    OLD:'津波予報区：灰色の破線＝期限切れ／未確認／取消・現在の情報ではない',NONE:'津波予報区：検証可能な電文なし'},
  en:{ACTIVE:'Tsunami areas: bulletin within reference time (solid)',MIXED:'Tsunami areas: solid = bulletin within reference time, grey dashed = old / unverified / cancelled',
    OLD:'Tsunami areas: grey dashed = old / unverified / cancelled, not current',NONE:'Tsunami areas: no verifiable bulletin'},
};
export const forecastLegendText=(language:Language,state:ForecastLegendState)=>text[language][state];
