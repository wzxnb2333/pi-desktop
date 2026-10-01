import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { goalCheckpointSchema } from '../shared/goals.ts';
import { modelResultContent } from '../shared/tool-results.ts';
import type { DesktopToolRunner } from './browser-tool.ts';

export function goalTools(run: DesktopToolRunner): ToolDefinition[] {
  return [{ name: 'get_goal', label: '读取持续目标',
    description: 'Read the user-authorized persistent goal, current revision, criteria and run history. A plan is not a goal. Returns null if the user has not created a goal. This tool grants no extra permissions.',
    parameters: Type.Object({}), execute: async (_id, _args, signal) => {
      const result = await run({ action: 'goal.get' }, signal ?? AbortSignal.timeout(30000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  }, { name: 'update_goal', label: '更新持续目标',
    description: 'Checkpoint the active goal using its latest revision from get_goal. Supply criterion IDs, completed flags and concrete verification evidence. Do not mark unverified work complete. status completed requires every criterion complete and only takes effect after the turn succeeds. Use blocked for missing input/authorization/external dependencies. Cannot create, resume a paused goal, replace the objective or bypass task permissions.',
    parameters: Type.Object({ goalId: Type.String(), revision: Type.Integer(), summary: Type.String(),
      status: Type.Union(['active', 'blocked', 'completed'].map(value => Type.Literal(value))),
      checks: Type.Array(Type.Object({ id: Type.String(), completed: Type.Boolean(), evidence: Type.String() })),
    }), execute: async (_id, args, signal) => {
      const result = await run({ action: 'goal.update', ...goalCheckpointSchema.parse(args) }, signal ?? AbortSignal.timeout(30000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  }];
}
