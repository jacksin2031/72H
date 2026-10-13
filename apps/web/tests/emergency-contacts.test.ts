import {beforeEach,expect,it} from 'vitest';
import {loadSosProfile,saveSosProfile,setSosStorage,validateContact} from '../lib/emergency-contacts';

beforeEach(()=>{let value:unknown;setSosStorage({get:async()=>value,put:async(v)=>{value=v;}});});

it('validates names and phone numbers strictly',()=>{
  expect(validateContact({name:'媽媽',phone:'090-1234-5678'})).toEqual({name:'媽媽',phone:'090-1234-5678'});
  expect(validateContact({name:'',phone:'0901234'})).toBeNull();
  expect(validateContact({name:'x',phone:'javascript:alert(1)'})).toBeNull();
  expect(validateContact({name:'x'.repeat(41),phone:'0901234'})).toBeNull();
});
it('stores at most three contacts locally and round-trips them',async()=>{
  expect(await saveSosProfile({contacts:[1,2,3,4].map(i=>({name:`c${i}`,phone:`090000${i}`})),needsAssistance:true,mobilityLimited:false})).toBe(false);
  expect(await saveSosProfile({contacts:[{name:'c1',phone:'0900001'}],needsAssistance:true,mobilityLimited:true})).toBe(true);
  expect(await loadSosProfile()).toEqual({contacts:[{name:'c1',phone:'0900001'}],needsAssistance:true,mobilityLimited:true});
});
it('never sends contacts over the network',async()=>{
  const calls:unknown[]=[];const original=globalThis.fetch;globalThis.fetch=(async(...a:unknown[])=>{calls.push(a);return new Response('{}');}) as typeof fetch;
  await saveSosProfile({contacts:[{name:'c1',phone:'0900001'}],needsAssistance:false,mobilityLimited:false});await loadSosProfile();
  globalThis.fetch=original;expect(calls).toEqual([]);
});
