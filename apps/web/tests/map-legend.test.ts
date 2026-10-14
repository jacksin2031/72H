import {expect,it} from 'vitest';
import {forecastLegendState,forecastLegendText} from '../lib/map-legend';
it('calls forecast lines current only when every drawn line is ACTIVE',()=>{
  expect(forecastLegendState(['ACTIVE','ACTIVE'])).toBe('ACTIVE');
  expect(forecastLegendState(['ACTIVE','STALE'])).toBe('MIXED');
  expect(forecastLegendState(['STALE','CANCELLED','CONFLICT'])).toBe('OLD');
  expect(forecastLegendState([])).toBe('NONE');
});
it('explains grey dashed lines as old / unverified / cancelled in all three languages when any line is not ACTIVE',()=>{
  for(const state of ['MIXED','OLD'] as const){
    expect(forecastLegendText('zh-TW',state)).toContain('灰色虛線＝過期／未核實／取消');
    expect(forecastLegendText('ja',state)).toContain('灰色の破線＝期限切れ／未確認／取消');
    expect(forecastLegendText('en',state)).toContain('grey dashed = old / unverified / cancelled');
  }
  for(const language of ['zh-TW','ja','en'] as const)for(const state of ['OLD','NONE'] as const)
    expect(forecastLegendText(language,state)).not.toMatch(/最新|期限內電文（|期限内の電文（|latest|within reference time/);
});
