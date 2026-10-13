import type {LayerSpecification, VectorSourceSpecification, GeoJSONSourceSpecification, SymbolLayerSpecification} from 'maplibre-gl';

/** GSI schema: https://github.com/gsi-cyberjapan/gsivectortile-mapbox-gl-js
 * Geography only; no road accessibility, shelter classification or routing.
 */
export const REFERENCE_VECTOR_SOURCE:VectorSourceSpecification={
  type:'vector',tiles:['/api/reference-vectors/{z}/{x}/{y}?geometry=aligned-v1'],
  minzoom:4,maxzoom:16,bounds:[120,19,156,48],
};
export const REFERENCE_GLYPHS='/api/reference-glyphs/{fontstack}/{range}';
const source='gsi-reference';
const textLayout:SymbolLayerSpecification['layout']={
  'text-field':['coalesce',['get','annoChar'],['get','knj']], 'text-font':['NotoSansCJKjp-Regular'],
  'text-allow-overlap':false,'text-ignore-placement':false,
  'text-padding':5,'text-max-width':8,
};
const textPaint={'text-color':'#e1e9e4','text-halo-color':'#172c30','text-halo-width':1.8};
// Low-resolution GSI annotations sometimes split a word into character
// features. Use the full annotation once (the reading-bearing anchor), or a
// whole-word feature, so isolated characters do not become bogus place names.
const wholeAnnotation:import('maplibre-gl').ExpressionSpecification=['any',
  ['!',['has','annoChar']],['==',['get','knj'],['get','annoChar']],['has','kana']];

export const REFERENCE_VECTOR_LAYERS:LayerSpecification[]=[
  // A tile-local land base and its water polygons share one GSI geometry.
  // Missing tiles leave the verified Natural Earth overview visible below.
  {id:'reference-land',type:'fill',source,'source-layer':'72h-land-coverage',
    paint:{'fill-color':'#35574e','fill-antialias':false}},
  {id:'reference-water',type:'fill',source,'source-layer':'waterarea',
    paint:{'fill-color':'#0c2535'}},
  {id:'reference-rivers',type:'line',source,'source-layer':'river',minzoom:8,
    paint:{'line-color':'#518394','line-width':['interpolate',['linear'],['zoom'],8,.5,16,2]}},
  {id:'reference-buildings',type:'fill',source,'source-layer':'building',minzoom:14,
    paint:{'fill-color':'#547069','fill-opacity':.45}},
  {id:'reference-local-roads',type:'line',source,'source-layer':'road',minzoom:12,
    paint:{'line-color':'#78948b','line-opacity':.6,'line-width':['interpolate',['linear'],['zoom'],12,.5,17,2.2]}},
  {id:'reference-major-roads',type:'line',source,'source-layer':'road',minzoom:6,
    filter:['any',['==',['get','motorway'],1],['in',['get','rdCtg'],['literal',[0,1,3]]]],
    layout:{'line-cap':'round','line-join':'round'},
    paint:{'line-color':'#bdc5ad','line-opacity':.85,'line-width':['interpolate',['linear'],['zoom'],6,.6,10,1.3,16,3]}},
  {id:'reference-railways',type:'line',source,'source-layer':'railway',minzoom:8,
    paint:{'line-color':'#a0b5ba','line-dasharray':[3,2],'line-width':['interpolate',['linear'],['zoom'],8,.6,16,1.8]}},
  {id:'reference-coastline',type:'line',source,'source-layer':'72h-water-edges',
    paint:{'line-color':'#aad2c5','line-width':1.4}},
  {id:'reference-city-labels',type:'symbol',source,'source-layer':'label',minzoom:6,
    filter:['all',wholeAnnotation,['in',['get','annoCtg'],['literal',[110,140]]]],
    layout:{...textLayout,'text-size':['interpolate',['linear'],['zoom'],4,11,10,14]},paint:textPaint},
  {id:'reference-geographic-labels',type:'symbol',source,'source-layer':'label',minzoom:6,maxzoom:13,
    filter:['all',wholeAnnotation,['in',['get','annoCtg'],['literal',[311,314,315,316,321,322,343,345,346,351,352]]]],
    layout:{...textLayout,'text-size':11,'text-padding':8},
    paint:{...textPaint,'text-color':'#bfd1cc'}},
  {id:'reference-station-labels',type:'symbol',source,'source-layer':'label',minzoom:11,
    filter:['all',wholeAnnotation,['==',['get','annoCtg'],422]],
    layout:{...textLayout,'text-size':12,'text-offset':[0,.7],'text-anchor':'top'},
    paint:{...textPaint,'text-color':'#c6dce0'}},
  {id:'reference-place-labels',type:'symbol',source,'source-layer':'label',minzoom:13,
    filter:['all',wholeAnnotation,['has','knj'],['!',['in',['get','annoCtg'],['literal',[110,140,422]]]]],
    layout:{...textLayout,'text-size':11,'text-padding':7},paint:textPaint},
];

// Approximate overview anchors follow the region picker views, separating
// Chugoku and Shikoku. They are not city locations or administrative boundaries.
export const REFERENCE_REGIONS:GeoJSONSourceSpecification={type:'geojson',data:{
  type:'FeatureCollection',features:[
    ['北海道',142,43.5],['東北',140,38.5],['関東',139.7,35.7],
    ['中部',137,36.5],['近畿',135.5,34.7],['中国',133,35],
    ['四国',133.5,33.5],['九州',131,32.5],['沖縄',127.7,26.2],
  ].map(([name,lng,lat])=>({type:'Feature',properties:{name},geometry:{type:'Point',coordinates:[Number(lng),Number(lat)]}})),
}};
export const REFERENCE_REGION_LAYER:LayerSpecification={
  id:'reference-region-labels',type:'symbol',source:'reference-regions',maxzoom:6,
  layout:{'text-field':['get','name'],'text-font':['NotoSansCJKjp-Regular'],
    'text-size':11,'text-padding':4,'text-allow-overlap':false},paint:textPaint,
};
