export type HistoricTimePoint = { at_jst: string; kind: string };
export type TimeMode = 'REALTIME' | 'FAST_RANGE' | 'ACCELERATED';
export const MOCK_SESSION_SAFE_WAIT_MS = 28 * 60 * 1000;

export function selectHistoricalRange<T extends HistoricTimePoint>(
  events: readonly T[], startLocal: string, endLocal: string,
): T[] {
  const first = Date.parse(startLocal + ':00+09:00');
  const last = Date.parse(endLocal + ':00+09:00');
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) return [];
  return events.filter(e => {
    const at = Date.parse(e.at_jst);
    return Number.isFinite(at) && first <= at && at <= last;
  });
}

export function historicalGapMs(previous: HistoricTimePoint, next: HistoricTimePoint): number {
  const gap = Date.parse(next.at_jst) - Date.parse(previous.at_jst);
  if (!Number.isFinite(gap) || gap < 0) throw new Error('Invalid historical timeline order');
  return gap;
}

export function canPlayRealtime(events: readonly HistoricTimePoint[]): boolean {
  return events.every((event, index) => index === 0
    || historicalGapMs(events[index - 1], event) <= MOCK_SESSION_SAFE_WAIT_MS);
}

export function sleepHistoricalGap(ms: number, signal: AbortSignal, onRemaining: (seconds: number) => void): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Exercise stopped'));
  if (ms <= 0) { onRemaining(0); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const update = () => onRemaining(Math.max(0, Math.ceil((ms - (Date.now() - started)) / 1000)));
    let timer = 0;
    let ticker = 0;
    const cleanup = () => {
      clearTimeout(timer); clearInterval(ticker);
      signal.removeEventListener('abort', abort);
      onRemaining(0);
    };
    const abort = () => { cleanup(); reject(new Error('Exercise stopped')); };
    signal.addEventListener('abort', abort, { once: true });
    update();
    ticker = setInterval(update, 1000) as unknown as number;
    timer = setTimeout(() => { cleanup(); resolve(); }, ms) as unknown as number;
  });
}

export type Acceleration = 10 | 60 | 300 | 600 | 3600;
export const ACCELERATION_OPTIONS: readonly Acceleration[] = [10, 60, 300, 600, 3600];
export const MAX_PRE_ROLL_HOURS = 24;
export const MAX_ACCELERATED_REAL_WAIT_MS = 10 * 60 * 1000;

export function jstInputFromEpoch(epochMs: number): string {
  if (!Number.isFinite(epochMs)) throw new Error('Invalid simulation clock');
  return new Date(epochMs + 9 * 60 * 60 * 1000).toISOString().slice(0,16);
}

export function jstEpoch(input: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(input)) return NaN;
  return Date.parse(input + '+09:00');
}

export function validAcceleratedPrelude(startJst: string, firstMilestone: string, rate: Acceleration): boolean {
  const begin=jstEpoch(startJst);
  const target=Date.parse(firstMilestone);
  const gap=target-begin;
  return ACCELERATION_OPTIONS.includes(rate) && Number.isFinite(begin) && Number.isFinite(target)
    && gap>0 && gap<=MAX_PRE_ROLL_HOURS*60*60*1000
    && gap/rate<=MAX_ACCELERATED_REAL_WAIT_MS;
}

/** Drives only an in-page synthetic clock. Does not change browser/device time.
 * Uses elapsed monotonic-ish wall time so throttled background tabs cannot
 * silently extend or duplicate the source event schedule. AI waits pause it.
 */
export function advanceVirtualClock(
  fromIso: string, toIso: string, rate: number, signal: AbortSignal,
  onTick: (epochMs: number, remainingSeconds: number) => void,
): Promise<void> {
  const from=Date.parse(fromIso), to=Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to<from || !Number.isFinite(rate) || rate<=0)
    return Promise.reject(new Error('Invalid accelerated exercise interval'));
  if (signal.aborted) return Promise.reject(new Error('Exercise stopped'));
  const virtualGap=to-from;
  const realDuration=virtualGap/rate;
  if (realDuration===0) { onTick(to,0); return Promise.resolve(); }
  return new Promise((resolve,reject)=>{
    const started=Date.now();
    let interval: ReturnType<typeof setInterval> | null = null;
    const cleanup=()=>{
      if(interval!==null)clearInterval(interval);
      signal.removeEventListener('abort',abort);
    };
    const abort=()=>{cleanup();reject(new Error('Exercise stopped'));};
    const update=()=>{
      const realElapsed=Math.max(0,Date.now()-started);
      const simulated=Math.min(to,from+realElapsed*rate);
      const remain=Math.max(0,Math.ceil((realDuration-realElapsed)/1000));
      onTick(simulated,remain);
      if (realElapsed>=realDuration) {cleanup();resolve();}
    };
    signal.addEventListener('abort',abort,{once:true});
    interval=setInterval(update,200);
    update();
  });
}
