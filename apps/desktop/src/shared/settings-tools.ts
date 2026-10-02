import { z } from 'zod';

/**
 * Wave 4a: settings, with the boundary written down as data. The model may change how the app looks and
 * behaves for itself; it may never change the permission plane, capabilities, credentials or anything that
 * decides what the model is allowed to do. Denied keys are a hard error, not a silent drop, so a model that
 * tries to raise its own privileges is told no instead of believing it succeeded.
 */

/** Top-level settings keys the model may patch, with the reason each one is harmless. */
export const allowedSettingsKeys = ['theme', 'fontSize', 'uiFontFamily', 'codeFontFamily', 'codeFontSize', 'accentColor', 'backgroundColor', 'foregroundColor',
  'editor', 'terminal', 'sendShortcut', 'notificationMode', 'notifications', 'preventSleep', 'keepInTray', 'followUpMode', 'thinking', 'modelId', 'promptTemplates'] as const;

/** Keys that exist in settings but stay out of reach, with why — used by the tool description and the guard test. */
export const deniedSettingsKeys: Record<string, string> = {
  policy: '权限策略',
  modelProviders: '供应商与凭据',
  models: '模型定义（含供应商绑定）',
  mcpServers: 'MCP 服务器与凭据',
  mcpToolPolicies: 'MCP 工具策略',
  browserSitePolicies: '浏览器站点策略',
  pluginSources: '插件来源（第三方代码安装）',
  ignoredSkillPaths: '技能加载策略',
  voice: '麦克风与语音凭据',
  memory: '记忆能力开关（隐私边界）',
  subtasksEnabled: '子任务能力开关',
  worktreeCleanup: '自动清理策略',
  shortcuts: '键盘绑定',
  resources: '技能与扩展开关',
};

export const manageSettingsToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('settings.read') }).strict(),
  z.object({ action: z.literal('settings.models') }).strict(),
  z.object({ action: z.literal('settings.inputCatalog') }).strict(),
  z.object({ action: z.literal('settings.apply'), patch: z.record(z.string(), z.unknown()) }).strict()
    .superRefine((value, context) => {
      const keys = Object.keys(value.patch);
      if (!keys.length) context.addIssue({ code: 'custom', path: ['patch'], message: 'patch 不能为空' });
      for (const key of keys)
        if (!(allowedSettingsKeys as readonly string[]).includes(key))
          context.addIssue({ code: 'custom', path: ['patch', key], message: `不允许修改 ${key}${deniedSettingsKeys[key] ? '（' + deniedSettingsKeys[key] + '）' : ''}` });
    }),
]);

export type ManageSettingsToolRequest = z.infer<typeof manageSettingsToolSchema>;
