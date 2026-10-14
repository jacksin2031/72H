import { z } from 'zod';
import { mockLiveSnapshotSchema } from './mock-live-contract';
import { simulationAssessmentSchema } from './simulation-advice';
import { boundedText } from './disaster-map';

const historicalLabel = z.object({ ja: z.string(), en: z.string(), 'zh-TW': z.string() });
export const mockMilestoneSchema = z.object({
  at_jst: z.string(),
  kind: z.string(),
  label: historicalLabel,
  source_url: z.string().url(),
  historic_observation: z.boolean(),
  fed_to_safety_core: z.boolean(),
});
export const mockLiveResponseSchema = z.object({
  mode: z.literal('MOCK_LIVE'),
  current_step: z.number().int().nonnegative(),
  total_steps: z.number().int().positive().max(24),
  ai_modes: z.array(z.string()),
  battery: z.number().int().min(0).max(100).nullable(),
  snapshot: mockLiveSnapshotSchema,
  movement_assessment: simulationAssessmentSchema.nullable().optional().default(null),
  movement_assessment_history: z.array(simulationAssessmentSchema).max(24).optional().default([]),
  historical: z.object({
    case_id: z.string(),
    title: historicalLabel,
    source_url: z.string(),
    magnitude: z.string(),
    max_intensity: z.string(),
    milestones: z.array(mockMilestoneSchema),
    current_milestone: mockMilestoneSchema.nullable(),
    advisory_is_not_safety_core_input: z.boolean(),
  }).nullable().optional(),
}).superRefine((value,ctx)=>{
  const latest=value.movement_assessment,history=value.movement_assessment_history;
  if(value.current_step>value.total_steps || (latest && (latest.session_id!==value.snapshot.session_id || latest.step!==value.current_step
    ||latest.plan_id!==value.snapshot.situation.current_plan_id)) ||history.some((a,i)=>a.session_id!==value.snapshot.session_id||a.step!==i+1)
    ||(latest ? history.length!==value.current_step||JSON.stringify(latest)!==JSON.stringify(history.at(-1)) : history.length>0))
    ctx.addIssue({code:'custom',message:'Simulation assessment does not belong to current snapshot'});
});
export type MockLiveResponse = z.infer<typeof mockLiveResponseSchema>;
export async function mockLiveRequest(path: string, key: string, input: unknown, signal: AbortSignal) {
  // The path is derived exclusively from an internal UUID or the static start
  // route; never accept arbitrary URLs or browser-controlled paths.
  if (path !== 'start' && !/^[0-9a-f-]{36}\/next$/i.test(path)) throw new Error('Invalid simulation endpoint');
  const response = await fetch('/api/mock-live/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Drill-Key': key },
    body: JSON.stringify(input), cache: 'no-store', signal,
  });
  if (!response.ok) throw new Error('Simulation API unavailable (' + response.status + ')');
  return mockLiveResponseSchema.parse(JSON.parse((await boundedText(response,1_000_000)).text));
}
