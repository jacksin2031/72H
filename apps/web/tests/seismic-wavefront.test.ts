import { describe, expect, it } from 'vitest';
import { documentedEpicenters, greatCircleKm } from '../lib/geospatial-exposure';
import { seismicOriginsForMilestones, seismicWaveEndMs, seismicWavefronts, tohokuWaveOrigins, waveRadiusKm } from '../lib/seismic-wavefront';

const main=tohokuWaveOrigins[0];
const origin=Date.parse(main.observed_at_jst);
describe('historical time drives finite geodesic P/S wavefronts',()=>{
  it('waits for the exact origin and for waves to reach the surface from depth',()=>{
    expect(seismicWavefronts([main],origin-1).features).toHaveLength(0);
    expect(seismicWavefronts([main],origin).features).toHaveLength(0);
    expect(seismicWavefronts([main],origin+4000).features.map(f=>f.properties?.phase)).toEqual(['P']);
    expect(seismicWavefronts([main],origin+7000).features.map(f=>f.properties?.phase)).toEqual(['P','S']);
  });
  it('advances by physical kilometres and depth, with P ahead of S',()=>{
    const p=waveRadiusKm(main,origin+60_000,'P')!;
    const s=waveRadiusKm(main,origin+60_000,'S')!;
    expect(p).toBeGreaterThan(415);expect(p).toBeLessThan(422);
    expect(s).toBeGreaterThan(237);expect(s).toBeLessThan(241);
    expect(p).toBeGreaterThan(s);
    const deeper={...main,depth_km:100};
    expect(waveRadiusKm(deeper,origin+10_000,'P')).toBeNull();
    expect(waveRadiusKm({...main,depth_km:0},origin+10_000,'P')).toBeCloseTo(70,1);
  });
  it('uses geodesic geography and splits the dateline instead of painting across Japan',()=>{
    const datelineOrigin={...main,lat:24.28,lng:153.98};
    const data=seismicWavefronts([datelineOrigin],origin+480_000);
    const p=data.features.find(f=>f.properties?.phase==='P')!;
    expect(p.geometry.coordinates.length).toBeGreaterThan(1);
    for(const line of p.geometry.coordinates) {
      for(let i=1;i<line.length;i++)expect(Math.abs(line[i][0]-line[i-1][0])).toBeLessThan(180);
    }
    const point=p.geometry.coordinates[0][0];
    expect(greatCircleKm(datelineOrigin,{lng:point[0],lat:point[1]})).toBeCloseTo(p.properties!.radius_km,5);
  });
  it('does not loop or restart after time jumps, remounts, or rewinding',()=>{
    const a=seismicWavefronts([main],origin+30_000);
    const b=seismicWavefronts([main],origin+90_000);
    expect(b.features[0].properties!.radius_km).toBeGreaterThan(a.features[0].properties!.radius_km);
    expect(seismicWavefronts([main],origin+30_000)).toEqual(a);
    const end=seismicWaveEndMs([main])!;
    expect(end).toBeGreaterThan(origin);
    expect(seismicWavefronts([main],end).features).toHaveLength(0);
    expect(seismicWavefronts([main],end+10_000).features).toHaveLength(0);
  });
  it('uses the separate 311 aftershock origin, never the mainshock or warning timestamp',()=>{
    const selected=seismicOriginsForMilestones('tohoku-2011',[
      {kind:'EARTHQUAKE',at_jst:'2011-03-11T14:46:00+09:00'},
      {kind:'TSUNAMI_WARNING',at_jst:'2011-03-11T14:49:00+09:00'},
      {kind:'AFTERSHOCK',at_jst:'2011-03-11T15:15:00+09:00'},
    ]);
    expect(selected).toHaveLength(2);
    expect(selected[1].lat).toBeCloseTo(36.108333,5);
    const at=Date.parse(selected[1].observed_at_jst);
    expect(seismicWavefronts(selected,at-1).features).toHaveLength(0);
    const waves=seismicWavefronts(selected,at+20_000);
    expect(waves.features).toHaveLength(2);
    expect(waves.features.every(f=>f.properties!.origin_jst===selected[1].observed_at_jst)).toBe(true);
    expect(seismicOriginsForMilestones('tohoku-2011',[{kind:'AFTERSHOCK',at_jst:'2011-03-11T15:15:00+09:00'}])).toEqual([selected[1]]);
  });
  it('omits custom, unknown, undocumented aftershocks and invalid source inputs',()=>{
    expect(seismicOriginsForMilestones(null,[{kind:'EARTHQUAKE',at_jst:main.observed_at_jst}])).toEqual([]);
    expect(seismicOriginsForMilestones('noto-2024',[{kind:'AFTERSHOCK',at_jst:'2024-01-01T16:18:00+09:00'}])).toEqual([]);
    expect(seismicWaveEndMs([])).toBeNull();
    for(const invalid of [{...main,lat:NaN},{...main,depth_km:-1},{...main,observed_at_jst:'bad'}]) {
      expect(seismicWavefronts([invalid],origin+30_000).features).toHaveLength(0);
      expect(seismicWaveEndMs([invalid])).toBeNull();
    }
    expect(seismicWavefronts([documentedEpicenters['noto-2024']],NaN).features).toHaveLength(0);
  });
});
