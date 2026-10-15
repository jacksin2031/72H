import {describe,expect,it,vi} from 'vitest';
import {DRILL_PRESETS,drillPointToLocation,type DrillPoint} from '../lib/drill-location';

const point=(source:DrillPoint['source']):DrillPoint=>({lat:38.4196,lng:141.2946,source,label:{ja:'石巻・門脇','zh-TW':'石巻・門脇', 'zh-CN': '石巻・门脇',en:'Ishinomaki Kadonowaki'},preset_id:source==='PRESET'?'tohoku-ishinomaki-kadonowaki':null});

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
  it('maps every drill source to USER_SELECTED (never GPS, so no live 120s freshness rule applies)',async()=>{
    for(const [src,expected] of [['PRESET','USER_SELECTED'],['MAP_PICK','USER_SELECTED'],['DEVICE_ONCE','USER_SELECTED']] as const){
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
  it('forwards real device accuracy for DEVICE_ONCE only',async()=>{
    const spy=vi.fn(resolved);await drillPointToLocation({...point('DEVICE_ONCE'),accuracy_m:10},spy);
    expect(spy).toHaveBeenCalledWith({latitude:38.4196,longitude:141.2946,accuracy_m:10});
  });
  it('passes accuracy 0 for preset/map points to the resolver',async()=>{
    const spy=vi.fn(resolved);await drillPointToLocation(point('MAP_PICK'),spy);
    expect(spy).toHaveBeenCalledWith({latitude:38.4196,longitude:141.2946,accuracy_m:0});
  });
});
