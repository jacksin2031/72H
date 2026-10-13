import {expect,it} from 'vitest';
import {buildSosMessage,distressText,shouldPinSos,smsHref} from '../lib/distress';
const empty={contacts:[],needsAssistance:false,mobilityLimited:false};
it('pins SOS for trapped, injured or mobility-limited, or a pre-set assistance need at level >= 1',()=>{
  expect(shouldPinSos(['TRAPPED'],empty,'NONE')).toBe(true);
  expect(shouldPinSos(['WATER_RISING'],empty,'USER_REPORTED')).toBe(false);
  expect(shouldPinSos([],{...empty,needsAssistance:true},'USER_REPORTED')).toBe(true);
  expect(shouldPinSos([],{...empty,needsAssistance:true},'NONE')).toBe(false);
  expect(shouldPinSos([],{...empty,mobilityLimited:true},'OFFICIAL_TSUNAMI')).toBe(true);
});
it('builds a user-sent message with location, accuracy and time, never claiming to be official',()=>{
  const m=buildSosMessage({language:'zh-TW',tags:['MOBILITY_LIMITED','WATER_RISING'],lat:38.43337,lng:141.30371,accuracy_m:12,at:Date.parse('2026-10-13T08:00:00Z')});
  expect(m).toContain('38.43337,141.30371');expect(m).toContain('±12 m');expect(m).toContain('https://maps.google.com/?q=38.43337,141.30371');
  expect(m).toContain('由使用者送出');expect(m).not.toMatch(/官方發布|公式発表/);
  expect(buildSosMessage({language:'en',tags:['TRAPPED'],lat:null,lng:null,accuracy_m:null,at:0})).toContain('Location unavailable');
});
it('encodes sms recipients and body safely',()=>{
  expect(smsHref(['090-1','+81 3'],'a&b?c')).toBe('sms:090-1,+81%203?body=a%26b%3Fc');
});
it('distressText has the same keys in every language and never promises safety',()=>{
  const keys=Object.keys(distressText.en).sort();
  expect(Object.keys(distressText.ja).sort()).toEqual(keys);expect(Object.keys(distressText['zh-TW']).sort()).toEqual(keys);
  for(const k of ['vertical','verticalNow','goTo','roadCandidateNotice','exercise','aiSuggestion','aiUnavailable','countdown','speak','mute','replay','chooseSituation','confirm','record','stopRecording','typeInstead','offlineReason'])expect(keys).toContain(k);
  expect(JSON.stringify(distressText)).not.toMatch(/保證安全|安全を保証|guaranteed safe/i);
  expect(distressText.en.goTo).toContain('{name}');
});
