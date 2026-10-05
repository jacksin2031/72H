import { expect, it } from 'vitest';
import { replayScenarioListSchema } from '../lib/replay-scenarios';

it('only accepts bounded unique registered scenario metadata and never paths', () => {
  expect(replayScenarioListSchema.parse([{ key: 'region-a-v1', name: 'Region A' }, { key: 'region-b-v1', name: 'Region B' }])).toHaveLength(2);
  expect(replayScenarioListSchema.safeParse([{ key: '../secrets', name: 'Hidden' }]).success).toBe(false);
  expect(replayScenarioListSchema.safeParse([{ key: 'region-a-v1', name: 'A' }, { key: 'region-a-v1', name: 'Other' }]).success).toBe(false);
  expect(replayScenarioListSchema.safeParse([]).success).toBe(false);
});
