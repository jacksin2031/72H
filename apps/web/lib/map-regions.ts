import type {Language} from './contracts';
/** Region shortcuts shared by the in-map picker and the map screen's region slot ('' = all Japan). Value: "lng,lat,zoom". */
export const MAP_REGIONS:readonly {value:string;label:string}[]=[
  {value:'142,43.5,6',label:'北海道'},{value:'140,38.5,6',label:'東北'},
  {value:'139.7,35.7,11',label:'東京 / Tokyo'},{value:'137,36.5,6',label:'中部'},
  {value:'135.5,34.7,7',label:'近畿'},{value:'133,34.2,7',label:'中國・四國'},
  {value:'131,32.5,6',label:'九州'},{value:'127.7,26.2,8',label:'沖繩 / 沖縄'},
  {value:'124.2,24.4,8',label:'八重山'},{value:'142.2,27.1,8',label:'小笠原'},
  {value:'153.98,24.28,10',label:'南鳥島'},
];
export const mapRegionLabel=(language:Language)=>language==='ja'?'地図の地域':language==='en'?'Map region':'地圖地區';
export const mapOverviewLabel=(language:Language)=>language==='ja'?'日本全国を表示':language==='en'?'View all Japan':'顯示全日本';
