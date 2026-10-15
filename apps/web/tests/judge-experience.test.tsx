// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JudgeExperience } from '../components/judge-experience';
import * as api from '../lib/judge-experience';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mockLiveResponseSchema } from '../lib/mock-live-envelope';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let el: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; el?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });
async function mount() { el = document.createElement('div'); document.body.append(el); root = createRoot(el); await act(async () => root!.render(<JudgeExperience />)); }
function recordedSteps() { return (JSON.parse(readFileSync(resolve(__dirname, 'fixtures/judge-311.json'), 'utf8')) as unknown[]).map(s => mockLiveResponseSchema.parse(s)); }
describe('311 judge experience', () => {
  it('processes each real recorded envelope only on a click and reports actual fallback results and retained plan history', async () => {
    const steps = (JSON.parse(readFileSync(resolve(__dirname, 'fixtures/judge-311.json'), 'utf8')) as unknown[]).map(s => mockLiveResponseSchema.parse(s));
    vi.useFakeTimers({toFake: ['Date']}); vi.setSystemTime(Date.parse(steps[1].snapshot.situation.updated_at));
    const replies = [...steps];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(replies.shift())));
    vi.stubGlobal('fetch', fetcher);
    await mount();
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid=judge-start]')!.click());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-testid=judge-current-event]')?.textContent).toContain('14:46');
    expect(el.querySelector('[data-now=hero]')?.textContent).toBe(steps[1].snapshot.plan_actions.find(a => a.category === 'NOW')?.text);
    for (let step = 2; step <= 4; step++) {
      await act(async () => el.querySelector<HTMLButtonElement>('[data-testid=judge-next]')!.click());
      expect(fetcher).toHaveBeenCalledTimes(step + 1);
      expect(el.querySelector('[data-testid=judge-current-event]')?.textContent).toContain(`${step} / 4`);
      expect(el.querySelector('[data-now=hero]')?.textContent).not.toContain(api.judgeText.ja.expired);
      expect(el.querySelector('[data-testid=judge-change]')?.textContent).not.toContain('Synthetic replay');
      expect(el.querySelector('[data-now=hero]')?.textContent).not.toBe(steps[step].snapshot.plan_actions.find(a => a.plan_id === steps[step].snapshot.situation.current_plan_id && a.category === 'NOW' && a.safety_decision === 'BLOCK')?.text);
    }
    expect(el.querySelector('[data-testid=judge-next]')).toBeNull();
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid=judge-review]')!.click());
    expect(el.querySelector('[data-testid=judge-summary]')?.textContent).toContain('実行成功: 0');
    expect(el.querySelector('[data-testid=judge-summary]')?.textContent).toContain('フォールバック: 4');
    expect(el.querySelectorAll('.judge-history-plan')).toHaveLength(steps[4].snapshot.plans.length);
    expect(el.querySelector('[data-testid=judge-summary]')?.textContent).toContain('今すぐ上の階・高い場所へ');
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(localStorage.getItem('72h-live-session')).toBeNull();
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid=judge-restart]')!.click());
    expect(el.querySelector('[data-testid=judge-intro]')).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it('does not revive prior guidance on reconnection; a newly evaluated event is required', async () => {
    const steps = recordedSteps();
    vi.useFakeTimers({toFake: ['Date']}); vi.setSystemTime(Date.parse(steps[1].snapshot.situation.updated_at));
    const replies = [...steps]; const fetcher = vi.fn(async () => new Response(JSON.stringify(replies.shift()))); vi.stubGlobal('fetch', fetcher);
    await mount(); await act(async () => el.querySelector<HTMLButtonElement>('[data-testid=judge-start]')!.click());
    const hero = el.querySelector('[data-now=hero]')?.textContent;
    await act(async () => window.dispatchEvent(new Event('offline')));
    expect(el.querySelector('[data-now=hero]')?.textContent).toBe(api.judgeText.ja.expired);
    expect(el.querySelector<HTMLButtonElement>('[data-testid=judge-next]')!.disabled).toBe(true);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(el.querySelector('[data-now=hero]')?.textContent).not.toBe(hero);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid=judge-next]')!.click());
    expect(el.querySelector('[data-now=hero]')?.textContent).not.toBe(api.judgeText.ja.expired);
  });
  it('expires a plan while the page remains open and makes no automatic step requests', async () => {
    const steps = recordedSteps();
    vi.useFakeTimers(); vi.setSystemTime(Date.parse(steps[1].snapshot.situation.updated_at));
    const replies = [...steps]; const fetcher = vi.fn(async () => new Response(JSON.stringify(replies.shift()))); vi.stubGlobal('fetch', fetcher);
    await mount(); await act(async () => el.querySelector<HTMLButtonElement>('[data-testid=judge-start]')!.click());
    const plan = steps[1].snapshot.plans.find(p => p.id === steps[1].snapshot.situation.current_plan_id)!;
    vi.setSystemTime(Date.parse(plan.expires_at) + 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(el.querySelector('[data-now=hero]')?.textContent).toBe(api.judgeText.ja.expired);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects an event jump and requires a fresh run without showing that plan', async () => {
    const steps = recordedSteps(); const replies = [steps[0], steps[3]];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(replies.shift()))));
    await mount(); await act(async () => el.querySelector<HTMLButtonElement>('[data-testid=judge-start]')!.click());
    expect(el.querySelector('[role=alert]')?.textContent).toBe(api.judgeText.ja.error);
    expect(el.querySelector('[data-now=hero]')).toBeNull();
    expect(el.querySelector('[data-testid=judge-next]')).toBeNull();
  });
  it('opens in Japanese with one start action, no location permission or automatic requests', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await mount();
    expect(el.querySelector('h1')?.textContent).toBe('警報の、その先へ。');
    expect(el.textContent).toContain('石巻');
    expect(el.querySelector('[data-testid=judge-start]')).not.toBeNull();
    expect(el.querySelector('input[type=password]')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('locks an in-flight start against double clicks and aborts when leaving', async () => {
    const request = vi.spyOn(api, 'judgeRequest').mockImplementation(() => new Promise(() => {}));
    await mount();
    const start = el.querySelector<HTMLButtonElement>('[data-testid=judge-start]')!;
    await act(async () => { start.click(); start.click(); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(start.disabled).toBe(true);
    expect(el.querySelector<HTMLSelectElement>('select')?.disabled).toBe(true);
    const signal = request.mock.calls[0][1];
    await act(async () => root!.unmount()); root = null;
    expect(signal.aborted).toBe(true);
  });
  it('shows a restart on failure and never silently retries an ambiguous event', async () => {
    const request = vi.spyOn(api, 'judgeRequest').mockRejectedValue(new Error('503'));
    await mount();
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid=judge-start]')!.click());
    expect(el.querySelector('[role=alert]')).not.toBeNull();
    expect(el.querySelector('[data-testid=judge-restart]')).not.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid=judge-next]')).toBeNull();
  });
});
