'use client';
import {useState,type ReactNode} from 'react';
import type {Language} from '@/lib/contracts';
import {BottomSheet,Section} from './ui';

/** Full-bleed map, one row of layer chips, one legend line and a single bottom sheet of titled sections (no card frames). */
/** keepSheetMounted (default true) keeps closed sheet content mounted so panel state survives; the exercise map passes false so its GPS / risk panel only exists while the sheet is open. */
export function MapScreen({language,map,layers,legend,region,peek,sections,routeSection,keepSheetMounted=true}:{language:Language;map:ReactNode;keepSheetMounted?:boolean;
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
    <BottomSheet peek={peek} open={open} onToggle={()=>setOpen(v=>!v)} keepMounted={keepSheetMounted}>
      {routeSection&&<Section title={language==='ja'?'道路候補':language==='en'?'Road candidates':'道路候選'}>{routeSection}</Section>}
      {sections.map(s=><Section key={s.title} title={s.title}>{s.content}</Section>)}
    </BottomSheet>
  </div>;
}
