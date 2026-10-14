import {expect,it} from 'vitest';
import {APP_TABS,shouldOpenBasis,tabForView} from '../lib/app-tabs';
import {generateStaticParams} from '../app/[view]/page';
it('maps every legacy view to one of three tabs',()=>{
  expect(APP_TABS.map(t=>t.key)).toEqual(['now','map','more']);
  for(const v of ['dashboard','plan','sources','demo','trace'])expect(tabForView(v)).toBe('now');
  expect(tabForView('map')).toBe('map');
  for(const v of ['more','notifications'])expect(tabForView(v)).toBe('more');
  expect(shouldOpenBasis('plan')).toBe(true);expect(shouldOpenBasis('sources')).toBe(true);expect(shouldOpenBasis('dashboard')).toBe(false);
});
it('labels tabs in three languages',()=>{
  expect(APP_TABS[0].label).toEqual({'zh-TW':'現在',ja:'今',en:'Now'});
});
it('still statically generates every legacy view so old links never 404',()=>{
  expect(generateStaticParams().map(p=>p.view).sort()).toEqual(['dashboard','demo','more','notifications','plan','sources','trace'].sort());
});
