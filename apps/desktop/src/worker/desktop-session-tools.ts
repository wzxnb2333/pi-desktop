import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { manageMessagesToolSchema, manageProjectsToolSchema, manageSessionsToolSchema, manageUiToolSchema, readSessionsToolSchema, sendToSessionToolSchema } from '../shared/session-tools.ts';
import { modelResultContent } from '../shared/tool-results.ts';
import type { DesktopToolRunner } from './browser-tool.ts';

/**
 * Wave 1 of the desktop tool surface. Each tool carries one family and forwards a validated request to the
 * main process, which re-validates and reuses the very op the matching UI control calls. Nothing here can
 * change permissions: the schemas have no such fields and the main process rejects them anyway.
 */
export function readSessionsTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'read_sessions', label: '读取会话上下文',
    description: 'Read other Pi Desktop sessions in this workspace: list them, read one session\'s user/assistant messages, or search text across sessions. Read-only and bounded (list 50, read 200 messages and 8000 characters each, search 200 hits); returns metadata, roles, text and excerpts, never drafts, credentials, tool secrets or permission state. Use it when the user asks about another chat or wants you to continue from earlier work.',
    parameters: Type.Object({
      action: Type.Union(['sessions.list', 'sessions.read', 'sessions.search'].map(value => Type.Literal(value))),
      threadId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      projectId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      query: Type.Optional(Type.String({ maxLength: 300 })),
      pinned: Type.Optional(Type.Boolean()), archived: Type.Optional(Type.Boolean()),
      since: Type.Optional(Type.Integer({ minimum: 0 })),
      roles: Type.Optional(Type.Array(Type.Union(['user', 'assistant'].map(value => Type.Literal(value))))),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
      maxChars: Type.Optional(Type.Integer({ minimum: 200, maximum: 20000 })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(readSessionsToolSchema.parse(args), signal ?? AbortSignal.timeout(15000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function manageSessionsTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_sessions', label: '管理会话',
    description: 'Create, select, rename, pin, archive, mark read, stop, resume, fork or delete a Pi Desktop session; every action matches the same control the user clicks. `sessions.delete` removes the desktop record, its session file and managed attachments behind the existing native confirmation. It never changes permissions, plan mode, tool policies or credentials.',
    parameters: Type.Object({
      action: Type.Union(['sessions.create', 'sessions.select', 'sessions.rename', 'sessions.pin', 'sessions.archive', 'sessions.markRead', 'sessions.stop', 'sessions.resume', 'sessions.fork', 'sessions.delete', 'sessions.quickChat', 'sessions.bindProject', 'sessions.keepSidechat', 'sessions.appendSidechat'].map(value => Type.Literal(value))),
      threadId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      projectId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      directoryId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      title: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
      entryId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      itemId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      pinned: Type.Optional(Type.Boolean()), archived: Type.Optional(Type.Boolean()), read: Type.Optional(Type.Boolean()),
      worktree: Type.Optional(Type.Boolean()),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(manageSessionsToolSchema.parse(args), signal ?? AbortSignal.timeout(20000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function sendToSessionTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'send_to_session', label: '给会话发送消息',
    description: 'Send a message into any Pi Desktop session, including other projects. A running session queues it as steer or followUp exactly like the user\'s composer; an idle session starts a normal turn. This is the only cross-session write: it never renames, archives, deletes, changes permissions or reads a session\'s private draft. The ask policy shows an approval card before the message is sent; auto and full send directly.',
    parameters: Type.Object({
      action: Type.Literal('sessions.send'),
      threadId: Type.String({ minLength: 1, maxLength: 200 }),
      text: Type.String({ minLength: 1, maxLength: 100000 }),
      queue: Type.Optional(Type.Union(['steer', 'followUp'].map(value => Type.Literal(value)))),
      requestId: Type.Optional(Type.String({ format: 'uuid' })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(sendToSessionToolSchema.parse(args), signal ?? AbortSignal.timeout(30000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function manageProjectsTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_projects', label: '管理项目',
    description: 'List projects with trust state and attached directories, add a project (pass `path`, or omit it to let the user pick a folder), set trust, add or remove an attached directory, or set trust/primary on one directory. Writes need an approval card under the ask policy; adding a project never bypasses the folder picker when no path is given.',
    parameters: Type.Object({
      action: Type.Union(['projects.list', 'projects.add', 'projects.trust', 'projects.directoryAdd', 'projects.directoryRemove', 'projects.directoryUpdate'].map(value => Type.Literal(value))),
      projectId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      directoryId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
      trusted: Type.Optional(Type.Boolean()), primary: Type.Optional(Type.Boolean()),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(manageProjectsToolSchema.parse(args), signal ?? AbortSignal.timeout(20000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function manageMessagesTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_messages', label: '管理当前会话消息',
    description: 'Operate on your own Pi Desktop chat the way the user does: copy one message to the clipboard, edit a user message or regenerate from it (the edited run becomes a new session that the workbench switches to, idempotent by requestId), switch the model, switch the reasoning level, or create a temporary sidechat anchored at a message. Every action targets the current chat only — there is no threadId — and none of them can change permissions, plan mode, tool policies or credentials.',
    parameters: Type.Object({
      action: Type.Union(['messages.copy', 'messages.revise', 'messages.setModel', 'messages.setThinking', 'messages.createSidechat'].map(value => Type.Literal(value))),
      itemId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      anchorItemId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      modelId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      thinking: Type.Optional(Type.Union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => Type.Literal(value)))),
      kind: Type.Optional(Type.Union(['edit', 'regenerate'].map(value => Type.Literal(value)))),
      text: Type.Optional(Type.String({ maxLength: 100000 })),
      requestId: Type.Optional(Type.String({ format: 'uuid' })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(manageMessagesToolSchema.parse(args), signal ?? AbortSignal.timeout(60000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function manageUiTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_ui', label: '管理工作台视图',
    description: 'Move the workbench the way the user would: collapse or expand a project group, open or hide the task summary, open or close an auxiliary panel (changes, files, browser, sidechat, review, terminal, subtasks), select a file in the files panel, or switch the attached directory. It only writes view state — never drafts, messages, permissions or window layout — and reports not_visible when the target session has no window.',
    parameters: Type.Object({
      action: Type.Union(['ui.collapseProject', 'ui.summary', 'ui.openPanel', 'ui.closePanel', 'ui.selectFile', 'ui.selectDirectory', 'ui.openExternal'].map(value => Type.Literal(value))),
      threadId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      projectId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      directoryId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      panel: Type.Optional(Type.Union(['changes', 'files', 'browser', 'sidechat', 'review', 'terminal', 'subtasks'].map(value => Type.Literal(value)))),
      path: Type.Optional(Type.String({ maxLength: 2000 })),
      open: Type.Optional(Type.Boolean()), collapsed: Type.Optional(Type.Boolean()),
      url: Type.Optional(Type.String({ maxLength: 4000 })), requestId: Type.Optional(Type.String({ format: 'uuid' })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(manageUiToolSchema.parse(args), signal ?? AbortSignal.timeout(15000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}
