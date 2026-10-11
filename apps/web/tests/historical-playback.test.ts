import { describe, it, expect, vi, afterEach } from 'vitest';
import { ACCELERATION_OPTIONS, advanceVirtualClock, canPlayRealtime, historicalGapMs, jstEpoch, jstInputFromEpoch,
 validAcceleratedPrelude, selectHistoricalRange, sleepHistoricalGap } from '../lib/historical-playback';

const tohoku = [
  { at_jst:'2011-03-11T14:46:00+09:00', kind:'EARTHQUAKE' },
  { at_jst:'2011-03-11T14:49:00+09:00', kind:'TSUNAMI_WARNING' },
  { at_jst:'2011-03-11T15:14:00+09:00', kind:'TSUNAMI_UPGRADE' },
  { at_jst:'2011-03-11T15:15:00+09:00', kind:'AFTERSHOCK' },
];
describe('historical time travel controls', () => {
  it('selects inclusive Japanese historical range without real-time waiting', () => {
    expect(selectHistoricalRange(tohoku,'2011-03-11T14:46','2011-03-11T15:00').map(x=>x.kind))
      .toEqual(['EARTHQUAKE','TSUNAMI_WARNING']);
    expect(selectHistoricalRange(tohoku,'2011-03-11T14:50','2011-03-11T15:13')).toEqual([]);
    expect(selectHistoricalRange(tohoku,'2011-03-11T15:15','2011-03-11T14:46')).toEqual([]);
  });
  it('uses actual chronological spacing for realtime, not source API wait', () => {
    expect(historicalGapMs(tohoku[0],tohoku[1])).toBe(3*60*1000);
    expect(historicalGapMs(tohoku[1],tohoku[2])).toBe(25*60*1000);
    expect(canPlayRealtime(tohoku)).toBe(true);
    expect(canPlayRealtime([
      {at_jst:'2016-04-14T21:26:00+09:00',kind:'EARTHQUAKE'},
      {at_jst:'2016-04-16T01:25:00+09:00',kind:'AFTERSHOCK'},
    ])).toBe(false);
  });
  it('skips elapsed waiting in fast range and stops timer on cancellation', async () => {
    const controller=new AbortController();
    const delays:number[]=[];
    await sleepHistoricalGap(0,controller.signal, n=>delays.push(n));
    expect(delays).toEqual([0]);
    controller.abort();
    await expect(sleepHistoricalGap(500,controller.signal,()=>{})).rejects.toThrow('Exercise stopped');
  });
});

afterEach(()=>vi.useRealTimers());

describe('accelerated disaster prelude and switch to normal speed',()=>{
  it('validates JST clock, pre-roll and max actual wait',()=>{
    const earthquake='2011-03-11T14:46:00+09:00';
    expect(ACCELERATION_OPTIONS).toEqual([10,60,300,600,3600]);
    expect(jstInputFromEpoch(jstEpoch('2011-03-11T13:46'))).toBe('2011-03-11T13:46');
    expect(validAcceleratedPrelude('2011-03-11T13:46',earthquake,600)).toBe(true);
    expect(validAcceleratedPrelude('2011-03-11T14:46',earthquake,600)).toBe(false);
    expect(validAcceleratedPrelude('2011-03-10T13:45',earthquake,3600)).toBe(false);
    expect(validAcceleratedPrelude('2011-03-11T13:46',earthquake,10)).toBe(true);
    expect(validAcceleratedPrelude('2011-03-11T00:00',earthquake,10)).toBe(false);
    expect(validAcceleratedPrelude('2011-03-11T13:46',earthquake,123 as never)).toBe(false);
  });
  it('fast-forwards 60 virtual minutes in 6 physical seconds then resolves exactly at disaster time',async()=>{
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T03:00:00Z'));
    const seen:number[]=[];
    const abort=new AbortController();
    const task=advanceVirtualClock('2011-03-11T13:46:00+09:00','2011-03-11T14:46:00+09:00',600,abort.signal,(ms)=>seen.push(ms));
    expect(seen[0]).toBe(Date.parse('2011-03-11T13:46:00+09:00'));
    await vi.advanceTimersByTimeAsync(6000);
    await task;
    expect(seen.at(-1)).toBe(Date.parse('2011-03-11T14:46:00+09:00'));
  });
  it('aborts pending pre-roll immediately and never executes its subsequent event',async()=>{
    vi.useFakeTimers();
    const controller=new AbortController();
    const running=advanceVirtualClock('2011-03-11T13:46:00+09:00','2011-03-11T14:46:00+09:00',
      60,controller.signal,()=>{});
    controller.abort();
    await expect(running).rejects.toThrow('Exercise stopped');
  });
});
