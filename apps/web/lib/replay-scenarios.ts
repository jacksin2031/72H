import { z } from 'zod';
import { replayScenarioOptionSchema } from './contracts';

export const replayScenarioListSchema = z.array(replayScenarioOptionSchema.extend({ key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,95}$/), name: z.string().trim().min(1).max(240) }).strict()).min(1).max(8).refine(items => new Set(items.map(item => item.key)).size === items.length, 'Duplicate scenario key');
