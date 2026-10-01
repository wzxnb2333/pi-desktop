import { z } from 'zod';
import { attachmentUploadSchema } from './attachments.ts';
import { composerRequests, draftSnapshotSchema, promptTemplateSchema, sendReceiptSchema } from './composer.ts';
import { contextReferenceSchema } from './input-context.ts';
import { lineCommentSchema, reviewRunSchema, reviewScopeSchema } from './reviews.ts';
import { roundSnapshotSchema } from './git-ranges.ts';
import { operationSchema } from './operations.ts';
import { projectEnvironmentSchema } from './project-environment.ts';
import { managedWorktreeSchema, worktreeRecoveryIssueSchema, worktreeCreationIssueSchema } from './worktrees.ts';
import { mcpSchema } from './mcp-schema.ts';
import { mcpToolPoliciesSchema } from './mcp-tool-policy.ts';
import { toolResultSchema } from './tool-results.ts';
import { browserUrlSchema, browserOriginSchema, browserSitePoliciesSchema } from './browser-tools.ts';
import { browserAnnotationSchema, annotationSelectionSchema } from './browser-annotations.ts';
import { browserClearSchema, browserDataRangeSchema } from './browser-history.ts';
import { artifactAnnotationSchema, artifactBoundsSchema, artifactPdfCaptureSchema } from './artifacts.ts';
import { annotationRectSchema } from './browser-annotations.ts';
import { pluginSchema, pluginSourceSchema } from './plugins.ts';
import { goalSchema, goalRequests } from './goals.ts';
import { memoryPreferencesSchema, memoryRequests } from './memories.ts';
import { subtaskSchema, subtaskRequests } from './subtasks.ts';
import { voicePreferencesSchema, voiceRequests } from './voice.ts';
import { messageInputSchema } from './message-input.ts';
import { timelineFocusTargetSchema } from './harness-tools.ts';
export { mcpSchema } from './mcp-schema.ts';

export const DATA_VERSION = 2;

// deny remains an internal read-only constraint for reviews and side conversations.
export const policySchema = z.enum(['ask', 'auto', 'full', 'deny']);
export const thinkingSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export const modelCatalogSchema = z.array(z.object({
  id: z.string(),
  models: z.array(z.object({
    id: z.string(),
    name: z.string(),
    api: z.string(),
    reasoning: z.boolean(),
    imageInput: z.boolean().optional(),
    thinkingLevels: z.array(thinkingSchema),
    contextWindow: z.number(),
    maxTokens: z.number(),
  })),
}));
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;
export const providerSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    baseUrl: z.string().max(2048).default(''),
    api: z
      .enum(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'])
      .default('openai-completions'),
    custom: z.boolean().default(false),
    reasoning: z.boolean().default(true),
    thinkingLevels: z.array(thinkingSchema).min(1).max(7).optional(),
    contextWindow: z.number().int().min(1024).max(10000000).default(128000),
    maxTokens: z.number().int().min(256).max(1000000).default(8192),
    hasKey: z.boolean().default(false),
  })
  .strict();
export const resourceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    kind: z.enum(['skill', 'extension']),
    enabled: z.boolean(),
  })
  .strict();
export const resourceDiagnosticSchema = z.object({
  kind: z.enum(['skill', 'extension']),
  type: z.enum(['warning', 'error', 'collision']),
  path: z.string().optional(),
  message: z.string(),
}).strict();
export const resourceLoadSchema = z.object({
  checkedAt: z.number(),
  diagnostics: z.array(resourceDiagnosticSchema),
}).strict();
export const resourceInspectionSchema = resourceLoadSchema.extend({
  directory: z.string(),
  descriptions: z.record(z.string(), z.string()),
}).strict();
export type ResourceDiagnostic = z.infer<typeof resourceDiagnosticSchema>;
export type ResourceInspection = z.infer<typeof resourceInspectionSchema>;
const fontFamilySchema = z.string().max(100).regex(/^[\p{L}\p{N} _-]*$/u).default('');
const themeColorSchema = z.union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/)]).default('');
export const appearanceSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  fontSize: z.number().min(12).max(20).default(14),
  uiFontFamily: fontFamilySchema,
  codeFontFamily: fontFamilySchema,
  codeFontSize: z.number().min(10).max(24).default(12),
  accentColor: themeColorSchema,
  backgroundColor: themeColorSchema,
  foregroundColor: themeColorSchema,
}).strict();
export const themeDocumentSchema = z.object({ version: z.literal(1), appearance: appearanceSchema }).strict();
export type Appearance = z.infer<typeof appearanceSchema>;
export const settingsSchema = z
  .object({
    ...appearanceSchema.shape,
    terminal: z.enum(['powershell', 'cmd', 'git-bash']).default('powershell'),
    editor: z.enum(['vscode', 'system']).default('vscode'),
    policy: policySchema.default('ask'),
    thinking: thinkingSchema.default('medium'),
    providerId: z.string().default(''),
    keepInTray: z.boolean().default(true),
    sendShortcut: z.enum(['enter', 'ctrl-enter']).default('enter'),
    notifications: z.boolean().optional(),
    notificationMode: z.enum(['unfocused', 'always', 'never']).default('unfocused'),
    preventSleep: z.boolean().default(false),
    memory: memoryPreferencesSchema.default({ enabled: false, autoGenerate: false }),
    subtasksEnabled: z.boolean().default(false),
    voice: voicePreferencesSchema.default(() => voicePreferencesSchema.parse({})),
    worktreeCleanup: z.object({ enabled: z.boolean().default(false), days: z.number().int().min(1).max(365).default(30) }).strict().default({ enabled: false, days: 30 }),
    pluginSources: z.array(pluginSourceSchema).max(50).default([]),
    followUpMode: z.enum(['steer', 'followUp']).default('followUp'),
    promptTemplates: z.array(promptTemplateSchema).max(100).default([]),
    shortcuts: z.record(z.string(), z.string()).optional(),
    providers: z.array(providerSchema).default([]),
    resources: z.array(resourceSchema).default([]),
    ignoredSkillPaths: z.array(z.string()).default([]),
    mcpServers: z.array(mcpSchema).default([]),
    mcpToolPolicies: mcpToolPoliciesSchema.default({}),
    browserSitePolicies: browserSitePoliciesSchema.default({}),
  })
  .strict();
export const projectSchema = z
  .object({ id: z.string(), name: z.string(), path: z.string(), trusted: z.boolean(), createdAt: z.number(),
    primaryDirectoryId: z.string().optional(),
    environment: projectEnvironmentSchema.optional(),
    directories: z.array(z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(300), path: z.string(), trusted: z.boolean() }).strict()).max(50).optional(),
  })
  .strict();
// Omit defaults for absent patch keys. Zod applies inner defaults even through .partial().
export const settingsPatchSchema = z.record(z.string(), z.unknown()).transform((input, context): Partial<z.infer<typeof settingsSchema>> => {
  const parsed = settingsSchema.partial().safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    return z.NEVER;
  }
  return Object.fromEntries(Object.keys(input).map(key => [key, parsed.data[key as keyof typeof parsed.data]]));
});
export const timelineBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thinking'), text: z.string(), startedAt: z.number().optional(), completedAt: z.number().optional() }),
  z.object({ type: z.literal('toolCall'), id: z.string(), name: z.string(), args: z.string() }),
]);
export const toolDetailsSchema = z.object({ diff: z.string(), patch: z.string().optional(), firstChangedLine: z.number().int().optional() });
export const timelineSchema = z
  .object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'tool', 'notice']),
    text: z.string(),
    thinking: z.string().default(''),
    noticeKind: z.enum(['model-switch']).optional(),
    toolName: z.string().optional(),
    args: z.string().optional(),
    blocks: z.array(timelineBlockSchema).optional(),
    stopReason: z.enum(['pending', 'stop', 'length', 'toolUse', 'error', 'aborted', 'deferred']).optional(),
    startedAt: z.number().optional(),
    completedAt: z.number().optional(),
    details: toolDetailsSchema.optional(),
    toolResult: toolResultSchema.optional(),
    input: messageInputSchema.optional(),
    state: z.enum(['running', 'done', 'error']).default('done'),
    entryId: z.string().optional(),
    timestamp: z.number(),
  })
  .strict();
export const mcpToolSchema = z.object({ name: z.string(), label: z.string().optional(), description: z.string(), sourceName: z.string().optional() }).strict();
export const mcpStateSchema = z.object({ id: z.string(), state: z.enum(['connecting', 'connected', 'error', 'disconnected']), tools: z.array(mcpToolSchema).default([]), error: z.string().optional() });
export const threadSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    directoryId: z.string().optional(),
    title: z.string(),
    cwd: z.string(),
    status: z.enum(['idle', 'running', 'waiting', 'error', 'interrupted']).default('idle'),
    createdAt: z.number(),
    updatedAt: z.number(),
    archived: z.boolean().default(false),
    pinned: z.boolean().optional(),
    readAt: z.number().optional(),
    deletedAt: z.number().nullable().optional(),
    mcp: z.array(mcpStateSchema).optional(),
    resourceLoad: resourceLoadSchema.optional(),
    plans: z.record(z.string(), z.array(z.object({ text: z.string(), status: z.enum(['pending', 'in_progress', 'completed']) }))).optional(),
    usage: z.object({ input: z.number(), output: z.number(), total: z.number(), cost: z.number().optional(), contextTokens: z.number().nullable().optional(), contextWindow: z.number().optional(), contextPercent: z.number().nullable().optional() }).optional(),
    queue: z.array(z.object({ id: z.string().optional(), revision: z.number().int().nonnegative().optional(), text: z.string(), attachments: z.array(z.string()), kind: z.enum(['steer', 'followUp']), context: z.array(contextReferenceSchema).optional() })).optional(),
    sendReceipts: z.array(sendReceiptSchema).optional(),
    draftHistory: z.array(draftSnapshotSchema).max(20).optional(),
    recentFiles: z.array(z.object({ directoryId: z.string(), path: z.string(), at: z.number() }).strict()).max(50).optional(),
    sessionFile: z.string().optional(),
    revision: z.object({ parentThreadId: z.string(), itemId: z.string(), requestId: z.uuid(), fingerprint: z.string(), kind: z.enum(['edit', 'regenerate']) }).strict().optional(),
    providerId: z.string(),
    modelSwitchNotice: z.object({ from: z.string(), to: z.string() }).strict().optional(),
    thinking: thinkingSchema,
    policy: policySchema,
    planMode: z.boolean().default(false),
    worktreeBranch: z.string().optional(),
    workspaceRevision: z.number().int().nonnegative().optional(),
    baseCommit: z.string().optional(),
    items: z.array(timelineSchema).default([]),
    error: z.string().optional(),
    plan: z
      .array(z.object({ text: z.string(), status: z.enum(['pending', 'in_progress', 'completed']) }))
      .default([]),
    artifacts: z.array(z.string()).default([]),
    sources: z.array(z.string()).default([]),
    automationId: z.string().optional(),
    automationRunId: z.uuid().optional(),
    creationKey: z.string().max(10000).optional(),
    subtaskId: z.uuid().optional(),
    reviewed: z.boolean().default(false),
    sidechat: z.object({ parentThreadId: z.string(), parentTitle: z.string(), anchorItemId: z.string(), capturedAt: z.number(), temporary: z.boolean(), context: z.string().max(1000000), appendedItemIds: z.array(z.string()).optional() }).strict().optional(),
    review: reviewRunSchema.optional(),
    comments: z.array(lineCommentSchema).optional(),
    roundSnapshots: z.array(roundSnapshotSchema).optional(),
    browserAnnotations: z.array(browserAnnotationSchema).max(200).optional(),
    artifactAnnotations: z.array(artifactAnnotationSchema).max(200).optional(),
    goal: goalSchema.optional(),
  })
  .strict();
export const automationSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    projectId: z.string(),
    prompt: z.string().min(1),
    intervalMinutes: z.number().int().min(1).max(525600),
    enabled: z.boolean(),
    nextRunAt: z.number(),
    lastRunAt: z.number().optional(),
    lastThreadId: z.string().optional(),
    targetThreadId: z.string().min(1).max(200).optional(),
    execution: z.object({ providerId: z.string().max(100).optional(), thinking: thinkingSchema.optional(), policy: policySchema.optional(), directoryId: z.string().max(200).optional(), environment: z.enum(['local', 'worktree']).default('local'), startPoint: z.string().min(1).max(3000).default('HEAD') }).strict().optional(),
    schedule: z.object({ kind: z.enum(['daily', 'weekly', 'monthly']), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timezone: z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }), weekday: z.number().int().min(0).max(6).default(1), monthday: z.number().int().min(1).max(31).default(1) }).optional(),
  })
  .strict();

// Layout scales ported from the reference: sidebar is clamp(240, 275, min(520, viewport - 320)).
export const automationRunSchema = z.object({
  id: z.uuid(), automationId: z.string(), configuration: automationSchema, scheduledAt: z.number(), createdAt: z.number(),
  manual: z.boolean(), status: z.enum(['queued', 'preparing', 'running', 'succeeded', 'failed', 'interrupted', 'cancelled']),
  threadId: z.string().optional(), startedAt: z.number().optional(), finishedAt: z.number().optional(), error: z.string().optional(),
  merged: z.number().int().nonnegative().default(0),
}).strict();
export type AutomationRun = z.infer<typeof automationRunSchema>;
export const SIDEBAR_WIDTH = { min: 240, max: 520, default: 275 } as const;
// Storage ceiling only; the renderer preserves 320px of conversation at every viewport.
// The pinned light 1440px scene needs an 847px pane, beyond the former 760px cap.
export const REVIEW_WIDTH = { min: 280, max: 1920, default: 390 } as const;
export const TERMINAL_HEIGHT = { min: 120, max: 800, default: 240 } as const;

export const reviewTabSchema = z.enum(['summary', 'changes', 'files', 'browser', 'plan', 'artifacts', 'sidechat', 'review', 'terminal', 'subtasks', 'subtask']);
export const panelTabSchema = z.object({ id: z.string().min(1).max(200), kind: z.enum(['browser', 'changes', 'files', 'sidechat', 'review', 'terminal', 'subtasks', 'subtask']) }).strict();
export type PanelTab = z.infer<typeof panelTabSchema>;
export const viewSchema = z.enum(['thread', 'settings', 'skills', 'automations', 'inbox']);

// Per-task state: what an individual task shows. Kept apart from the frame-level state below.
export const uiThreadSchema = z
  .object({
    reviewTab: reviewTabSchema.default('changes'),
    terminalOpen: z.boolean().default(false),
    selectedPath: z.string().max(2000).default(''),
    fileDirectory: z.string().max(2000).optional(),
    expandedDirectories: z.array(z.string().max(2000)).max(5000).optional(),
    fileTreeFocus: z.string().max(2000).optional(),
    fileLocation: z.object({ id: z.string().min(1).max(200), path: z.string().min(1).max(2000), line: z.number().int().positive(), column: z.number().int().positive().optional() }).strict().optional(),
    folds: z.record(z.string(), z.boolean()).default(() => ({})),
    draft: z.object({ text: z.string().max(1000000), attachments: z.array(z.string()).max(1000) }).optional(),
    contextReferences: z.array(contextReferenceSchema).max(1000).optional(),
    directoryId: z.string().max(200).optional(),
    sidechatId: z.string().max(200).optional(),
    directoryViews: z.record(z.string(), z.object({
      selectedPath: z.string().max(2000).optional(), fileDirectory: z.string().max(2000).optional(),
      expandedDirectories: z.array(z.string().max(2000)).max(5000).optional(), fileTreeFocus: z.string().max(2000).optional(),
      fileLocation: z.object({ id: z.string().min(1).max(200), path: z.string().min(1).max(2000), line: z.number().int().positive(), column: z.number().int().positive().optional() }).strict().optional(),
      openFiles: z.array(z.string()).optional(),
    }).strict()).optional(),
    terminalProfiles: z.array(z.object({ id: z.string(), title: z.string(), shell: settingsSchema.shape.terminal })).optional(),
    scroll: z.object({ itemId: z.string(), offset: z.number(), follow: z.boolean() }).optional(),
    openFiles: z.array(z.string()).optional(),
    browserTabs: z.array(z.object({ id: z.string(), url: z.string(), title: z.string() })).optional(),
    closedBrowserTabs: z.array(z.object({ id: z.string(), url: z.string(), title: z.string() })).optional(),
    activeBrowserTab: z.string().optional(),
    activePanelTab: z.string().max(200).optional(),
    panelTabs: z.array(panelTabSchema).max(500).optional(),
  })
  .strict();

export const uiSchema = z
  .object({
    locale: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
    sidebarWidth: z.number().int().min(SIDEBAR_WIDTH.min).max(SIDEBAR_WIDTH.max).default(SIDEBAR_WIDTH.default),
    reviewWidth: z.number().int().min(REVIEW_WIDTH.min).max(REVIEW_WIDTH.max).default(REVIEW_WIDTH.default),
    terminalHeight: z
      .number()
      .int()
      .min(TERMINAL_HEIGHT.min)
      .max(TERMINAL_HEIGHT.max)
      .default(TERMINAL_HEIGHT.default),
    sidebarOpen: z.boolean().default(true),
    reviewOpen: z.boolean().default(false),
    summaryOpen: z.boolean().optional(),
    view: viewSchema.default('thread'),
    activeThreadId: z.string().max(200).default(''),
    showArchived: z.boolean().default(false),
    diffSplit: z.boolean().default(false),
    openThreads: z.array(z.string()).optional(),
    closedThreads: z.array(z.string()).optional(),
    collapsedProjects: z.array(z.string()).optional(),
    threads: z.record(z.string(), uiThreadSchema).default(() => ({})),
  })
  .strict();

export const uiFramePatchSchema = z.record(z.string(), z.unknown()).transform((input, context): Partial<Omit<z.infer<typeof uiSchema>, 'threads'>> => {
  const parsed = uiSchema.omit({ threads: true }).partial().safeParse(input);
  if (!parsed.success) { for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message }); return z.NEVER; }
  return Object.fromEntries(Object.keys(input).map(key => [key, parsed.data[key as keyof typeof parsed.data]]));
});
export const dataSchema = z
  .object({
    memoryRevision: z.number().int().nonnegative().default(0),
    version: z.literal(DATA_VERSION),
    projects: z.array(projectSchema),
    threads: z.array(threadSchema),
    settings: settingsSchema,
    automations: z.array(automationSchema),
    automationRuns: z.array(automationRunSchema).default([]),
    subtasks: z.array(subtaskSchema).default([]),
    operations: z.array(operationSchema).default([]),
    worktrees: z.array(managedWorktreeSchema).default([]),
    worktreeRecoveryIssues: z.array(worktreeRecoveryIssueSchema).optional(),
    worktreeCreationIssues: z.array(worktreeCreationIssueSchema).optional(),
    plugins: z.array(pluginSchema).default([]),
    pluginCleanupErrors: z.array(z.string()).default([]),
    ui: uiSchema.default(() => uiSchema.parse({})),
    windows: z.record(z.string().max(240), z.object({
      kind: z.enum(['main', 'task', 'quick']),
      open: z.boolean(),
      frame: uiSchema.omit({ threads: true, locale: true }),
      bounds: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(400).max(10000), height: z.number().int().min(300).max(10000) }).strict().optional(),
      maximized: z.boolean().optional(),
    }).strict()).optional(),
  })
  .strict();
export const approvalSchema = z
  .object({
    id: z.string(),
    threadId: z.string(),
    tool: z.string(),
    description: z.string(),
    kind: z.enum(['action', 'confirm', 'input', 'select']),
    scope: z.literal('external-tools').optional(),
    review: z.object({ risk: z.enum(['high', 'uncertain']), reason: z.string().max(2000), model: z.string() }).strict().optional(),
    options: z.array(z.string()).optional(),
  })
  .strict();
export const terminalSchema = z
  .object({
    id: z.string(),
    profileId: z.string().optional(),
    threadId: z.string(),
    title: z.string(),
    exited: z.boolean(),
    output: z.string(),
    outputOffset: z.number().int().nonnegative().optional(),
    exitCode: z.number().int().optional(),
    operationId: z.string().optional(),
  })
  .strict();
const id = z.string().min(1).max(200);
export const webUrlSchema = browserUrlSchema;
export const localUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    !url.username &&
    !url.password
  );
}, '预览仅允许 localhost、127.0.0.1 或 ::1');
export const requestSchema = z.discriminatedUnion('op', [
  ...goalRequests,
  ...memoryRequests,
  ...subtaskRequests,
  ...voiceRequests,
  z.object({ op: z.literal('plugin.pick'), kind: z.enum(['directory', 'archive', 'source']) }).strict(),
  z.object({ op: z.literal('plugin.catalog') }).strict(),
  z.object({ op: z.literal('plugin.start'), requestId: z.uuid(), action: z.enum(['install', 'update', 'enable', 'disable', 'rollback', 'uninstall']), pluginId: z.string().max(100).default(''), source: z.string().max(3000).default(''), hash: z.string().max(64).default('') }).strict(),
  z.object({ op: z.literal('plugin.cancel'), requestId: z.uuid() }).strict(),
  z.object({ op: z.literal('project.environment'), projectId: id, environment: projectEnvironmentSchema, base: projectEnvironmentSchema }).strict(),
  z.object({ op: z.literal('project.action'), threadId: id, directoryId: id.optional(), requestId: z.uuid(), kind: z.enum(['initialization', 'cleanup', 'action']), actionId: z.string().default('') }).strict(),
  z.object({ op: z.literal('worktree.start'), threadId: id, directoryId: id.optional(), requestId: z.uuid(), action: z.enum(['create', 'migrate']), startPoint: z.string().min(1).max(3000).default('HEAD'), destination: z.enum(['local', 'worktree']).default('worktree') }).strict(),
  z.object({ op: z.literal('worktree.manage'), threadId: id, worktreeId: z.uuid(), requestId: z.uuid(), action: z.enum(['archive', 'restore', 'usage', 'cleanup']) }).strict(),
  z.object({ op: z.literal('worktree.creationRecovery'), threadId: id, recoveryId: z.string().max(200), requestId: z.uuid(), action: z.enum(['refresh', 'open', 'folder']) }).strict(),
  z.object({ op: z.literal('worktree.recycle'), threadId: id, requestId: z.uuid() }).strict(),
  z.object({ op: z.literal('worktree.recovery'), threadId: id, requestId: z.uuid(), recoveryId: id, action: z.enum(['retry', 'open']) }).strict(),
  z.object({ op: z.literal('review.start'), threadId: id, directoryId: id.optional(), scope: reviewScopeSchema, ref: z.string().max(3000).default(''), instructions: z.string().max(20000).default('') }).strict(),
  z.object({ op: z.literal('review.cancel'), threadId: id }).strict(),
  z.object({ op: z.literal('review.inspect'), threadId: id }).strict(),
  z.object({ op: z.literal('review.file'), threadId: id, path: z.string().max(2000) }).strict(),
  z.object({ op: z.literal('review.finding'), threadId: id, findingId: id, ignored: z.boolean().optional(), feedback: z.string().min(1).max(10000).optional() }).strict(),
  z.object({ op: z.literal('review.locate'), threadId: id, findingId: id }).strict(),
  z.object({ op: z.literal('comment.add'), threadId: id, directoryId: id.optional(), path: z.string().min(1).max(2000), version: z.string(), line: z.number().int().positive(), endLine: z.number().int().positive(), body: z.string().min(1).max(10000) }).strict(),
  z.object({ op: z.literal('comment.list'), threadId: id }).strict(),
  z.object({ op: z.literal('comment.locate'), threadId: id, commentId: id }).strict(),
  z.object({ op: z.literal('comment.remove'), threadId: id, commentId: id }).strict(),
  z.object({ op: z.literal('bootstrap') }).strict(),
  z.object({ op: z.literal('models.catalog') }).strict(),
  z.object({ op: z.literal('project.add') }).strict(),
  z.object({ op: z.literal('project.directoryAdd'), projectId: id }).strict(),
  z.object({ op: z.literal('project.directoryUpdate'), projectId: id, directoryId: id, primary: z.boolean().optional(), trusted: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('project.directoryRemove'), projectId: id, directoryId: id }).strict(),
  z.object({ op: z.literal('project.trust'), id, trusted: z.boolean() }).strict(),
  z.object({ op: z.literal('chat.create'), requestId: z.uuid() }).strict(),
  z.object({ op: z.literal('thread.create'), projectId: z.string().max(200), directoryId: id.optional(), worktree: z.boolean().default(false), startPoint: z.string().min(1).max(3000).optional(), requestId: z.uuid().optional() }).strict(),
  z.object({ op: z.literal('thread.bindProject'), id, projectId: id, directoryId: id.optional() }).strict(),
  z.object({ op: z.literal('sidechat.create'), threadId: id, anchorItemId: id.optional(), requestId: z.uuid().optional() }).strict(),
  z.object({ op: z.literal('sidechat.keep'), threadId: id }).strict(),
  z.object({ op: z.literal('sidechat.append'), threadId: id, itemId: id }).strict(),
  z
    .object({
      op: z.literal('thread.update'),
      id,
      title: z.string().optional(),
      archived: z.boolean().optional(),
      pinned: z.boolean().optional(),
      readAt: z.number().optional(),
      deletedAt: z.number().nullable().optional(),
      reviewed: z.boolean().optional(),
      providerId: z.string().optional(),
      thinking: thinkingSchema.optional(),
      policy: policySchema.optional(),
      planMode: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('thread.send'),
      id,
      requestId: z.uuid().optional(),
      text: z.string().max(100000),
      attachments: z.array(z.string()).max(10).default([]),
      queue: z.enum(['steer', 'followUp']).optional(),
      context: z.array(contextReferenceSchema).max(20).optional(),
    })
    .strict(),
  z.object({ op: z.literal('thread.stop'), id }).strict(),
  z.object({ op: z.literal('thread.resume'), id }).strict(),
  z.object({ op: z.literal('thread.fork'), id, entryId: z.string().optional(), worktree: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('thread.revise'), threadId: id, itemId: id, requestId: z.uuid(), kind: z.enum(['edit', 'regenerate']), text: z.string().max(100000).optional() }).strict(),
  z.object({ op: z.literal('thread.export'), id, format: z.enum(['markdown', 'json', 'html']) }).strict(),
  z.object({ op: z.literal('thread.purge'), id }).strict(),
  z.object({ op: z.literal('thread.queueClear'), id }).strict(),
  z.object({ op: z.literal('thread.inWorktree'), projectId: id, directoryId: id.optional(), path: z.string().min(1), reveal: z.boolean().default(false) }).strict(),
  z.object({ op: z.literal('thread.compact'), id }).strict(),
  z
    .object({ op: z.literal('approval.reply'), id, approved: z.boolean(), value: z.string().optional() })
    .strict(),
  z.object({ op: z.literal('attachment.pick'), threadId: id }).strict(),
  ...composerRequests,
  z.object({ op: z.literal('input.catalog'), threadId: id }).strict(),
  z.object({ op: z.literal('attachment.add'), threadId: id, files: z.array(attachmentUploadSchema).min(1).max(10) }).strict(),
  z.object({ op: z.literal('settings.save'), settings: settingsSchema }).strict(),
  z.object({ op: z.literal('settings.patch'), patch: settingsPatchSchema, base: settingsPatchSchema.optional() }).strict(),
  z.object({ op: z.literal('theme.import') }).strict(),
  z.object({ op: z.literal('theme.export'), appearance: appearanceSchema }).strict(),
  // Layout remains independent of settings and does not invalidate worker configuration.
  z.object({ op: z.literal('ui.update'), ui: uiSchema, frame: uiFramePatchSchema.optional() }).strict(),
  z.object({ op: z.literal('ui.threadUpdate'), threadId: id, thread: uiThreadSchema }).strict(),
  z.object({ op: z.literal('ui.threadPatch'), threadId: id, patch: z.object({ reviewTab: reviewTabSchema.optional(), terminalOpen: z.boolean().optional(), selectedPath: z.string().max(2000).optional(), fileDirectory: uiThreadSchema.shape.fileDirectory, expandedDirectories: uiThreadSchema.shape.expandedDirectories, fileTreeFocus: uiThreadSchema.shape.fileTreeFocus, fileLocation: uiThreadSchema.shape.fileLocation, folds: z.record(z.string(), z.boolean()).optional(), draft: uiThreadSchema.shape.draft, sidechatId: uiThreadSchema.shape.sidechatId, contextReferences: uiThreadSchema.shape.contextReferences, directoryId: uiThreadSchema.shape.directoryId, directoryViews: uiThreadSchema.shape.directoryViews, scroll: uiThreadSchema.shape.scroll, openFiles: uiThreadSchema.shape.openFiles, browserTabs: uiThreadSchema.shape.browserTabs, closedBrowserTabs: uiThreadSchema.shape.closedBrowserTabs, activeBrowserTab: uiThreadSchema.shape.activeBrowserTab, activePanelTab: uiThreadSchema.shape.activePanelTab, panelTabs: uiThreadSchema.shape.panelTabs }).strict() }).strict(),
  z.object({ op: z.literal('provider.key'), id, key: z.string().max(16000), base: providerSchema.optional() }).strict(),
  z.object({ op: z.literal('resource.pick'), kind: z.enum(['skill', 'extension']) }).strict(),
  z
    .object({
      op: z.literal('resource.create'),
      name: z.string().min(1).max(100),
      content: z.string().min(1).max(200000),
    })
    .strict(),
  z.object({ op: z.literal('mcp.test'), id, requestId: z.uuid().optional(), base: mcpSchema.optional() }).strict(),
  z.object({ op: z.literal('mcp.testCancel'), requestId: z.uuid() }).strict(),
  z.object({ op: z.literal('mcp.resource'), threadId: id, itemId: id, index: z.number().int().min(0).max(255), requestId: z.uuid() }).strict(),
  z.object({ op: z.literal('mcp.oauthStatus'), id }).strict(),
  z.object({ op: z.literal('mcp.oauthStart'), id, requestId: z.uuid(), action: z.enum(['login', 'refresh', 'revoke']), base: mcpSchema.optional() }).strict(),
  z.object({ op: z.literal('mcp.oauthCancel'), requestId: z.uuid() }).strict(),
  z.object({ op: z.literal('mcp.retry'), threadId: id, requestId: z.uuid().optional() }).strict(),
  z.object({ op: z.literal('mcp.secret'), id, value: z.record(z.string(), z.string()), base: mcpSchema.optional() }).strict(),
  z.object({ op: z.literal('mcp.secretStatus'), id, base: mcpSchema.optional() }).strict(),
  z.object({ op: z.literal('automation.save'), automation: automationSchema, base: automationSchema.nullable().optional() }).strict(),
  z.object({ op: z.literal('automation.cancel'), runId: z.uuid() }).strict(),
  z.object({ op: z.literal('automation.remove'), id, base: automationSchema.optional() }).strict(),
  z.object({ op: z.literal('automation.run'), id }).strict(),
  z.object({ op: z.literal('git.status'), threadId: id, directoryId: id.optional() }).strict(),
  z.object({ op: z.literal('git.inspect'), threadId: id, directoryId: id.optional() }).strict(),
  z.object({ op: z.literal('pr.status'), threadId: id, directoryId: id.optional() }).strict(),
  z.object({ op: z.literal('pr.start'), threadId: id, directoryId: id.optional(), requestId: z.uuid(), action: z.enum(['view', 'create']), selector: z.string().max(2000).default(''), title: z.string().max(1000).default(''), body: z.string().max(50000).default(''), base: z.string().max(300).default(''), draft: z.boolean().default(true) }).strict(),
  z.object({ op: z.literal('operation.cancel'), threadId: id, requestId: z.uuid() }).strict(),
  z.object({ op: z.literal('git.show'), threadId: id, directoryId: id.optional(), ref: z.string().regex(/^[0-9a-f]{7,64}$/) }).strict(),
  z.object({ op: z.literal('git.conflict'), threadId: id, directoryId: id.optional(), path: z.string() }).strict(),
  z.object({ op: z.literal('git.cancel'), threadId: id, directoryId: id.optional(), requestId: id }).strict(),
  z.object({ op: z.literal('git.processProblems'), threadId: id, directoryId: id.optional() }).strict(),
  z.object({ op: z.literal('git.retryStop'), threadId: id, directoryId: id.optional(), processId: z.uuid() }).strict(),
  z.object({ op: z.literal('git.action'), threadId: id, directoryId: id.optional(), requestId: id.optional(), action: z.enum(['stage', 'unstage', 'stageHunk', 'unstageHunk', 'commitStaged', 'branchCreate', 'branchTrack', 'branchSwitch', 'branchDelete', 'upstream', 'fetch', 'pull', 'push', 'merge', 'rebase', 'continue', 'abort', 'resolved', 'worktreeRemove']), paths: z.array(z.string()).default([]), value: z.string().max(3000).default(''), startPoint: z.string().max(3000).optional(), remote: z.string().default('origin'), strategy: z.enum(['ff-only', 'merge', 'rebase']).default('ff-only'), patch: z.string().max(1000000).optional() }).strict(),
  z.object({ op: z.literal('git.diff'), threadId: id, directoryId: id.optional(), path: z.string().default(''), mode: z.enum(['all', 'staged', 'unstaged']).optional() }).strict(),
  z.object({ op: z.literal('git.range'), threadId: id, directoryId: id.optional(), path: z.string().default(''), mode: z.enum(['branch', 'turn']), ref: z.string().max(3000).default('') }).strict(),
  z.object({ op: z.literal('git.hunkRevert'), threadId: id, directoryId: id.optional(), path: z.string().min(1), patch: z.string().min(1).max(1000000), version: z.string(), mode: z.enum(['all', 'unstaged']) }).strict(),
  z.object({ op: z.literal('git.hunkRestore'), threadId: id, directoryId: id.optional(), recoveryId: z.uuid() }).strict(),
  z.object({ op: z.literal('git.recoveries'), threadId: id, directoryId: id.optional(), path: z.string().optional() }).strict(),
  z.object({ op: z.literal('git.hunkVersion'), threadId: id, directoryId: id.optional(), path: z.string().min(1) }).strict(),
  z.object({ op: z.literal('git.revert'), threadId: id, directoryId: id.optional(), path: z.string().min(1) }).strict(),
  z
    .object({
      op: z.literal('git.commit'), directoryId: id.optional(),
      threadId: id,
      message: z.string().min(1).max(3000),
      paths: z.array(z.string()).min(1),
    })
    .strict(),
  z.object({ op: z.literal('git.apply'), threadId: id, directoryId: id.optional() }).strict(),
  z.object({ op: z.literal('file.list'), threadId: id, directoryId: id.optional(), path: z.string().default('') }).strict(),
  z.object({ op: z.literal('file.read'), threadId: id, directoryId: id.optional(), path: z.string() }).strict(),
  z.object({ op: z.literal('artifact.open'), threadId: id, directoryId: id, path: z.string().min(1).max(4000), requestId: z.uuid() }).strict(),
  z.object({ op: z.literal('artifact.close'), threadId: id, previewId: z.uuid() }).strict(),
  z.object({ op: z.literal('artifact.status'), threadId: id, previewId: z.uuid() }).strict(),
  z.object({ op: z.literal('artifact.stop'), threadId: id, previewId: z.uuid() }).strict(),
  z.object({ op: z.literal('artifact.bounds'), threadId: id, previewId: z.uuid(), bounds: artifactBoundsSchema }).strict(),
  z.object({ op: z.literal('artifact.network'), threadId: id, previewId: z.uuid(), origin: browserOriginSchema, allowed: z.boolean() }).strict(),
  z.object({ op: z.literal('artifact.capture'), threadId: id, previewId: z.uuid(), pdf: artifactPdfCaptureSchema.optional() }).strict(),
  z.object({ op: z.literal('artifact.annotationSave'), threadId: id, captureId: z.uuid(), rect: annotationRectSchema, comment: z.string().trim().min(1).max(10000) }).strict(),
  z.object({ op: z.literal('artifact.annotationDiscard'), threadId: id, captureId: z.uuid() }).strict(),
  z.object({ op: z.literal('artifact.annotation'), threadId: id, annotationId: z.uuid(), action: z.enum(['read', 'remove', 'attach']) }).strict(),
  z.object({ op: z.literal('file.write'), threadId: id, directoryId: id.optional(), path: z.string(), content: z.string().max(1000000), version: z.string() }).strict(),
  z.object({ op: z.literal('file.dirty'), dirty: z.boolean() }).strict(),
  z.object({ op: z.literal('file.search'), threadId: id, directoryId: id.optional(), requestId: id, query: z.string().min(1).max(500), content: z.boolean().default(false), cursor: z.uuid().optional() }).strict(),
  z.object({ op: z.literal('file.search.cancel'), threadId: id, directoryId: id.optional(), requestId: id }).strict(),
  z.object({ op: z.literal('file.reveal'), threadId: id, directoryId: id.optional(), path: z.string() }).strict(),
  z.object({ op: z.literal('resource.refresh') }).strict(),
  z.object({ op: z.literal('resource.inspect') }).strict(),
  z.object({ op: z.literal('resource.open'), id, reveal: z.boolean().default(false) }).strict(),
  z.object({ op: z.literal('file.open'), threadId: id, directoryId: id.optional(), path: z.string().default('') }).strict(),
  z.object({ op: z.literal('terminal.open'), threadId: id, profileId: id.optional() }).strict(),
  z.object({ op: z.literal('terminal.input'), id, data: z.string().max(100000) }).strict(),
  z
    .object({
      op: z.literal('terminal.resize'),
      id,
      cols: z.number().int().min(2).max(500),
      rows: z.number().int().min(2).max(300),
    })
    .strict(),
  z.object({ op: z.literal('terminal.close'), id }).strict(),
  z.object({ op: z.literal('terminal.rename'), id, title: z.string().min(1).max(100) }).strict(),
  z.object({ op: z.literal('browser.select'), threadId: id, tabId: id }).strict(),
  z.object({ op: z.literal('browser.site'), origin: browserOriginSchema, policy: z.enum(['ask', 'allow', 'deny']) }).strict(),
  z.object({ op: z.literal('browser.history'), query: z.string().max(1000).default(''), offset: z.number().int().min(0).max(10000).default(0), limit: z.number().int().min(1).max(200).default(100) }).strict(),
  z.object({ op: z.literal('browser.data'), range: browserDataRangeSchema }).strict(),
  z.object({ op: z.literal('browser.clear'), requestId: z.uuid(), options: browserClearSchema }).strict(),
  z.object({ op: z.literal('browser.clearCancel'), requestId: z.uuid() }).strict(),
  z.object({ op: z.literal('browser.annotationCapture'), threadId: id, tabId: id }).strict(),
  z.object({ op: z.literal('browser.annotationDiscard'), threadId: id, captureId: z.uuid() }).strict(),
  z.object({ op: z.literal('browser.annotationSave'), threadId: id, captureId: z.uuid(), selection: annotationSelectionSchema }).strict(),
  z.object({ op: z.literal('browser.annotation'), threadId: id, annotationId: z.uuid(), action: z.enum(['read', 'remove', 'attach']) }).strict(),
  z.object({ op: z.literal('browser.tab'), threadId: id, action: z.enum(['new', 'restore', 'close']), tabId: id.optional() }).strict(),
  z.object({ op: z.literal('browser.open'), threadId: id, tabId: id, url: webUrlSchema }).strict(),
  z.object({ op: z.literal('browser.action'), threadId: id, tabId: id, action: z.enum(['back', 'forward', 'reload', 'stop', 'close', 'focus', 'zoomIn', 'zoomOut', 'zoomReset', 'clearSite', 'clearAll', 'permissions']) }).strict(),
  z.object({ op: z.literal('browser.find'), threadId: id, tabId: id, text: z.string().max(1000), forward: z.boolean().default(true) }).strict(),
  z.object({ op: z.literal('browser.download'), id, action: z.enum(['cancel', 'reveal']) }).strict(),
  z.object({ op: z.literal('browser.downloads') }).strict(),
  z.object({ op: z.literal('preview.open'), url: localUrlSchema }).strict(),
  z
    .object({
      op: z.literal('preview.bounds'),
      bounds: z
        .object({
          x: z.number().int().min(0),
          y: z.number().int().min(0),
          width: z.number().int().min(0),
          height: z.number().int().min(0),
          occluded: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ op: z.literal('preview.close') }).strict(),
  z.object({ op: z.literal('preview.refresh') }).strict(),
  z
    .object({
      op: z.literal('external.open'),
      url: z.url().refine((v) => ['https:', 'http:'].includes(new URL(v).protocol)),
    })
    .strict(),
  z.object({ op: z.literal('window'), action: z.enum(['minimize', 'maximize', 'close']) }).strict(),
  z.object({ op: z.literal('window.open'), kind: z.enum(['task', 'quick']), threadId: id.optional() }).strict(),
  z.object({ op: z.literal('window.shortcut'), retry: z.boolean().default(false) }).strict(),
]);
export const globalShortcutStateSchema = z.object({ requested: z.string(), registered: z.string(), error: z.string() }).strict();
export type ShortcutStatus = z.infer<typeof globalShortcutStateSchema>;
export const bootstrapSchema = z
  .object({
    data: dataSchema,
    approvals: z.array(approvalSchema),
    terminals: z.array(terminalSchema),
    version: z.string(),
  })
  .strict();
export const browserFindSchema = z.object({ text: z.string().max(1000), requestId: z.number().int().nonnegative(), matches: z.number().int().nonnegative(), active: z.number().int().nonnegative(), pending: z.boolean() }).strict();
export type BrowserFindState = z.infer<typeof browserFindSchema>;
export const desktopEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('terminal.created'), terminal: terminalSchema }),
  z.object({ type: z.literal('state'), data: dataSchema }),
  z.object({ type: z.literal('approvals'), approvals: z.array(approvalSchema) }),
  z.object({
    type: z.literal('terminal'),
    id: z.string(),
    threadId: z.string(),
    data: z.string(),
    offset: z.number().int().nonnegative().optional(),
    exited: z.boolean().optional(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('gitProcessesChanged') }),
  z.object({ type: z.literal('browser'), threadId: z.string(), tabId: z.string(), url: z.string(), title: z.string(), loading: z.boolean(), back: z.boolean(), forward: z.boolean(), error: z.string().optional(), zoom: z.number(), matches: z.number().optional(), find: browserFindSchema.optional() }),
  z.object({ type: z.literal('preview.snapshot'), threadId: z.string(), tabId: z.string(), image: z.string() }),
  z.object({ type: z.literal('panel.command'), threadId: z.string(), tabId: z.string(), command: z.enum(['openBrowser', 'openReview', 'closePanelTab', 'nextPanelTab', 'previousPanelTab']) }),
  z.object({ type: z.literal('timeline.focus'), threadId: z.string(), target: timelineFocusTargetSchema }).strict(),
  z.object({ type: z.literal('download'), id: z.string(), name: z.string(), received: z.number(), total: z.number(), state: z.enum(['progressing', 'completed', 'cancelled', 'interrupted']) }),
]);
export type Policy = z.infer<typeof policySchema>;
export type Provider = z.infer<typeof providerSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type TimelineItem = z.infer<typeof timelineSchema>;
export type DesktopData = z.infer<typeof dataSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type Automation = z.infer<typeof automationSchema>;
export type McpConfig = z.infer<typeof mcpSchema>;
export type DesktopRequest = z.infer<typeof requestSchema>;
export type DesktopEvent = z.infer<typeof desktopEventSchema>;
export type Bootstrap = z.infer<typeof bootstrapSchema>;
export type TerminalInfo = z.infer<typeof terminalSchema>;
export type UiState = z.infer<typeof uiSchema>;
export type UiThread = z.infer<typeof uiThreadSchema>;
export type ReviewTab = z.infer<typeof reviewTabSchema>;
export type View = z.infer<typeof viewSchema>;
export interface GitFile {
  path: string;
  status: string;
  staged: boolean;
}
export interface GitStatus {
  branch: string;
  files: GitFile[];
  available: boolean;
  error?: string;
  stats?: { added: number; removed: number };
}
export interface GitInspection {
  branches: string[];
  remoteBranches: { ref: string; remote: string; name: string }[];
  remotes: string[];
  upstream: string;
  operation: 'merge' | 'rebase' | '';
  commits: { id: string; subject: string; author: string; date: string }[];
  worktrees: { path: string; branch: string; commit: string }[];
}
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
}
export interface FileContent {
  path: string;
  content: string;
  kind: 'text' | 'image' | 'binary';
  truncated: boolean;
  version?: string;
  writable?: boolean;
}
export interface FileSearchResult { path: string; line?: number; text?: string; }
export const FILE_SEARCH_PAGE_SIZE = 200;
export const fileSearchProgressSchema = z.object({
  files: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  excludedDirectories: z.number().int().nonnegative(),
  unreadable: z.number().int().nonnegative(),
  binary: z.number().int().nonnegative(),
  encoding: z.number().int().nonnegative(),
  oversized: z.number().int().nonnegative(),
}).strict();
export const fileSearchPageSchema = z.object({
  threadId: z.string(), requestId: z.string(),
  matches: z.array(z.object({ path: z.string(), line: z.number().int().positive().optional(), text: z.string().optional() }).strict()).max(FILE_SEARCH_PAGE_SIZE),
  progress: fileSearchProgressSchema,
  cursor: z.uuid().optional(), done: z.boolean(),
}).strict().refine(page => page.done === (page.cursor === undefined), { message: '搜索分页状态不一致' });
export type FileSearchProgress = z.infer<typeof fileSearchProgressSchema>;
export type FileSearchPage = z.infer<typeof fileSearchPageSchema>;
export interface DesktopBridge {
  invoke(request: DesktopRequest): Promise<unknown>;
  onEvent(callback: (event: DesktopEvent) => void): () => void;
}
export const defaultData = (): DesktopData => ({
  memoryRevision: 0,
  version: DATA_VERSION,
  projects: [],
  threads: [],
  settings: settingsSchema.parse({}),
  automations: [],
  automationRuns: [],
  subtasks: [],
  operations: [],
  worktrees: [],
  plugins: [],
  pluginCleanupErrors: [],
  ui: uiSchema.parse({}),
});
