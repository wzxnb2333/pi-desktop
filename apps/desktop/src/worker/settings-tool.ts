import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { allowedSettingsKeys, deniedSettingsKeys, manageSettingsToolSchema } from '../shared/settings-tools.ts';
import { modelResultContent } from '../shared/tool-results.ts';
import type { DesktopToolRunner } from './browser-tool.ts';

/** Wave 4a: settings reads plus a whitelisted patch. The whitelist lives in `shared/settings-tools.ts`.
 *
 * `patch` is written out as one optional property per allowed key instead of `Type.Record(Type.String(), …)`:
 * TypeBox renders that record as `patternProperties: {"^.*$": {}}`, and a gateway that validates tool schemas
 * strictly answers every request with a bodyless 400 — while the parameter itself looked harmless. An explicit
 * object also lets the provider reject an unknown key before the request is even sent.
 */
export function manageSettingsTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_settings', label: '管理桌面设置',
    description: `Read Pi Desktop settings, list the models and input options this app offers, or change presentation and behaviour preferences. Allowed patch keys: ${allowedSettingsKeys.join(', ')}. Everything else is refused with an explanation — ${Object.keys(deniedSettingsKeys).join(', ')} in particular, because permissions, capabilities, credentials and the sandbox are the user's decision, not the model's.`,
    parameters: Type.Object({
      action: Type.Union(['settings.read', 'settings.models', 'settings.inputCatalog', 'settings.apply'].map(value => Type.Literal(value))),
      patch: Type.Optional(Type.Object({
        theme: Type.Optional(Type.Union(['system', 'light', 'dark'].map(value => Type.Literal(value)))),
        fontSize: Type.Optional(Type.Number({ minimum: 12, maximum: 20 })),
        codeFontSize: Type.Optional(Type.Number({ minimum: 10, maximum: 24 })),
        uiFontFamily: Type.Optional(Type.String({ maxLength: 100 })),
        codeFontFamily: Type.Optional(Type.String({ maxLength: 100 })),
        accentColor: Type.Optional(Type.String({ maxLength: 7 })),
        backgroundColor: Type.Optional(Type.String({ maxLength: 7 })),
        foregroundColor: Type.Optional(Type.String({ maxLength: 7 })),
        editor: Type.Optional(Type.Union(['vscode', 'system'].map(value => Type.Literal(value)))),
        terminal: Type.Optional(Type.Union(['powershell', 'cmd', 'git-bash'].map(value => Type.Literal(value)))),
        sendShortcut: Type.Optional(Type.Union(['enter', 'ctrl-enter'].map(value => Type.Literal(value)))),
        notificationMode: Type.Optional(Type.Union(['unfocused', 'always', 'never'].map(value => Type.Literal(value)))),
        notifications: Type.Optional(Type.Boolean()),
        preventSleep: Type.Optional(Type.Boolean()),
        keepInTray: Type.Optional(Type.Boolean()),
        followUpMode: Type.Optional(Type.Union(['steer', 'followUp'].map(value => Type.Literal(value)))),
        thinking: Type.Optional(Type.Union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => Type.Literal(value)))),
        modelId: Type.Optional(Type.String({ maxLength: 200 })),
        promptTemplates: Type.Optional(Type.Array(Type.Object({
          id: Type.String({ minLength: 1, maxLength: 100 }), name: Type.String({ minLength: 1, maxLength: 80 }),
          text: Type.String({ minLength: 1, maxLength: 100000 }),
        }, { additionalProperties: false }))),
      }, { additionalProperties: false })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(manageSettingsToolSchema.parse(args), signal ?? AbortSignal.timeout(20000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}
