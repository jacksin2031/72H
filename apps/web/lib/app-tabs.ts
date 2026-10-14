import type {Language} from './contracts';
import type {IconName} from '../components/ui-icon';
export type AppTab='now'|'map'|'more';
export const APP_TABS:{key:AppTab;href:string;icon:IconName;label:Record<Language,string>}[]=[
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
