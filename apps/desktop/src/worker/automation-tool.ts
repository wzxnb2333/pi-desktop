import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { automationToolSchema } from '../shared/automation-tools.ts';
import { modelResultContent } from '../shared/tool-results.ts';
import type { DesktopToolRunner } from './browser-tool.ts';

export function automationTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_automations', label: '管理本地自动化',
    description: 'Manage local schedules only when the user requests scheduling. Actions: automations.list, automations.save (configuration; omit id to create), automations.run/remove (automation id), automations.cancel (run id). destination current wakes this chat after it becomes idle; new creates a task in this project. Runs execute only while Pi Desktop or its tray process is running. Missed occurrences coalesce; uncertain interrupted runs require explicit retry. Task permissions remain a ceiling; plan/read-only mode permits listing only. Use stable IDs returned by list. Configuration changes apply to future triggers, not an already queued snapshot.',
    parameters: Type.Object({ action: Type.Union(['automations.list', 'automations.save', 'automations.run', 'automations.remove', 'automations.cancel'].map(value => Type.Literal(value))), id: Type.Optional(Type.String()),
      configuration: Type.Optional(Type.Object({ id: Type.Optional(Type.String()), name: Type.String(), prompt: Type.String(), destination: Type.Union([Type.Literal('current'), Type.Literal('new')]), intervalMinutes: Type.Integer({ minimum: 1, maximum: 525600 }), enabled: Type.Boolean(),
        schedule: Type.Optional(Type.Object({ kind: Type.Union(['daily', 'weekly', 'monthly'].map(value => Type.Literal(value))), time: Type.String(), timezone: Type.String(), weekday: Type.Optional(Type.Integer({ minimum: 0, maximum: 6 })), monthday: Type.Optional(Type.Integer({ minimum: 1, maximum: 31 })) })),
        execution: Type.Optional(Type.Object({ providerId: Type.Optional(Type.String()), thinking: Type.Optional(Type.Union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => Type.Literal(value)))), policy: Type.Optional(Type.Union(['ask', 'auto', 'deny'].map(value => Type.Literal(value)))), directoryId: Type.Optional(Type.String()), environment: Type.Union([Type.Literal('local'), Type.Literal('worktree')]), startPoint: Type.String() })),
      })),
    }), execute: async (_id, args, signal) => {
      const result = await run(automationToolSchema.parse(args), signal ?? AbortSignal.timeout(180000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}
