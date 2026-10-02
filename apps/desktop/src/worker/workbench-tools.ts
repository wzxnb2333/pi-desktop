import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { manageCommentsToolSchema, manageFilesToolSchema, manageGitToolSchema, managePreviewToolSchema, manageReviewToolSchema, manageTerminalToolSchema, manageWindowsToolSchema, manageWorktreesToolSchema } from '../shared/workbench-tools.ts';
import { modelResultContent } from '../shared/tool-results.ts';
import type { DesktopToolRunner } from './browser-tool.ts';

/**
 * Wave 3: the workbench families. Reads are free, writes go through the same gate the UI uses (the `ask`
 * policy raises an approval card in the main process). None of these tools can change permissions, plan
 * mode, tool policies or credentials, and none can type into a terminal.
 */
export function manageReviewTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_review', label: '管理代码审查',
    description: 'Start or cancel a Pi Desktop code review of the current task, or read what a finished review found: inspect the run, read the reviewed snapshot of one file, ignore/annotate a finding, or move the window to it. Starting a review needs approval under the ask policy because it spends model tokens. It never edits files, never applies a fix by itself and never changes permissions.',
    parameters: Type.Object({
      action: Type.Union(['review.start', 'review.cancel', 'review.inspect', 'review.read', 'review.finding', 'review.locate'].map(value => Type.Literal(value))),
      scope: Type.Optional(Type.Union(['uncommitted', 'branch', 'commit'].map(value => Type.Literal(value)))),
      ref: Type.Optional(Type.String({ maxLength: 3000 })),
      instructions: Type.Optional(Type.String({ maxLength: 20000 })),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
      directoryId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      findingId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      ignored: Type.Optional(Type.Boolean()), feedback: Type.Optional(Type.String({ minLength: 1, maxLength: 10000 })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(manageReviewToolSchema.parse(args), signal ?? AbortSignal.timeout(60000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function manageGitTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_git', label: '管理 Git 与变更',
    description: 'Read or change the current task\'s git state: status, inspect, diff, range, one commit\'s info, recoveries, process problems and hunk versions are read-only; run (stage/unstage/branch/fetch/pull/push/merge/rebase/continue/abort/resolved), commit, apply, revert, hunkRevert/hunkRestore, conflict and retryStop write to the repository and need approval under the ask policy. Prefer reading hunkVersion before hunkRevert so the patch cannot go stale. It never changes permissions or plan mode.',
    parameters: Type.Object({
      action: Type.Union(['git.status', 'git.inspect', 'git.diff', 'git.range', 'git.commitInfo', 'git.recoveries', 'git.processProblems', 'git.hunkVersion', 'git.run', 'git.commit', 'git.apply', 'git.revert', 'git.hunkRevert', 'git.hunkRestore', 'git.conflict', 'git.retryStop', 'git.cancel'].map(value => Type.Literal(value))),
      path: Type.Optional(Type.String({ maxLength: 4000 })),
      directoryId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      mode: Type.Optional(Type.Union(['all', 'staged', 'unstaged', 'branch', 'turn'].map(value => Type.Literal(value)))),
      ref: Type.Optional(Type.String({ maxLength: 3000 })),
      operation: Type.Optional(Type.Union(['stage', 'unstage', 'stageHunk', 'unstageHunk', 'commitStaged', 'branchCreate', 'branchTrack', 'branchSwitch', 'branchDelete', 'upstream', 'fetch', 'pull', 'push', 'merge', 'rebase', 'continue', 'abort', 'resolved', 'worktreeRemove'].map(value => Type.Literal(value)))),
      paths: Type.Optional(Type.Array(Type.String({ maxLength: 4000 }))),
      value: Type.Optional(Type.String({ maxLength: 3000 })),
      startPoint: Type.Optional(Type.String({ minLength: 1, maxLength: 3000 })),
      remote: Type.Optional(Type.String({ maxLength: 200 })),
      strategy: Type.Optional(Type.Union(['ff-only', 'merge', 'rebase'].map(value => Type.Literal(value)))),
      patch: Type.Optional(Type.String({ maxLength: 1000000 })),
      version: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      message: Type.Optional(Type.String({ minLength: 1, maxLength: 3000 })),
      recoveryId: Type.Optional(Type.String({ format: 'uuid' })),
      processId: Type.Optional(Type.String({ format: 'uuid' })),
      requestId: Type.Optional(Type.String({ format: 'uuid' })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(manageGitToolSchema.parse(args), signal ?? AbortSignal.timeout(120000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function manageWorktreesTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_worktrees', label: '管理 Worktree',
    description: 'Create or migrate the current task into a git worktree, switch a worktree between archive/restore/usage/cleanup, recycle the task\'s worktree, or act on a creation/operation recovery entry. Creating, migrating and recycling need approval under the ask policy. It never deletes a branch, touches another task\'s worktree or changes permissions.',
    parameters: Type.Object({
      action: Type.Union(['worktrees.create', 'worktrees.migrate', 'worktrees.manage', 'worktrees.recycle', 'worktrees.recovery', 'worktrees.creationRecovery'].map(value => Type.Literal(value))),
      directoryId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      worktreeId: Type.Optional(Type.String({ format: 'uuid' })),
      operation: Type.Optional(Type.Union(['archive', 'restore', 'usage', 'cleanup'].map(value => Type.Literal(value)))),
      startPoint: Type.Optional(Type.String({ minLength: 1, maxLength: 3000 })),
      destination: Type.Optional(Type.Union(['local', 'worktree'].map(value => Type.Literal(value)))),
      recoveryId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      retry: Type.Optional(Type.Boolean()), open: Type.Optional(Type.Boolean()),
      requestId: Type.Optional(Type.String({ format: 'uuid' })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(manageWorktreesToolSchema.parse(args), signal ?? AbortSignal.timeout(120000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function manageFilesTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_files', label: '管理文件与搜索',
    description: 'Work with the current task\'s files and editor the way the workbench does: list a folder, read a file, save a file with the SHA256 version from a read (the write is rejected if the version moved), open a file in the editor, reveal it in the OS file manager, run a text/content search, or cancel a search. Writing a file goes through the same version check the editor uses, so it can never silently overwrite someone else\'s change. It never touches files outside the project directories and never changes permissions.',
    parameters: Type.Object({
      action: Type.Union(['files.list', 'files.read', 'files.write', 'files.open', 'files.reveal', 'files.search', 'files.searchCancel'].map(value => Type.Literal(value))),
      path: Type.Optional(Type.String({ maxLength: 4000 })),
      directoryId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      content: Type.Optional(Type.String({ maxLength: 1000000 })),
      version: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
      query: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
      cursor: Type.Optional(Type.String({ format: 'uuid' })),
      requestId: Type.Optional(Type.String({ format: 'uuid' })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(manageFilesToolSchema.parse(args), signal ?? AbortSignal.timeout(30000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function manageCommentsTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_comments', label: '管理代码批注',
    description: 'List the code comments attached to files in this task, add one anchored to a line range with the file version you read, remove one, or move the window to it. Adding a comment reuses the editor\'s own anchoring and version check, so a stale version is refused instead of landing on the wrong lines. It never edits file content and never changes permissions.',
    parameters: Type.Object({
      action: Type.Union(['comments.list', 'comments.add', 'comments.remove', 'comments.locate'].map(value => Type.Literal(value))),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
      directoryId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      version: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
      body: Type.Optional(Type.String({ minLength: 1, maxLength: 10000 })),
      line: Type.Optional(Type.Integer({ minimum: 1 })), endLine: Type.Optional(Type.Integer({ minimum: 1 })),
      commentId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(manageCommentsToolSchema.parse(args), signal ?? AbortSignal.timeout(20000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function manageWindowsTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_windows', label: '管理窗口',
    description: 'Open a Pi Desktop window (task or quick chat), minimize/maximize/close the window this chat lives in, retry registering the global shortcut, or reveal a path inside the project worktree. Closing needs approval under the ask policy because it hides the chat; nothing here changes permissions or registers new shortcuts.',
    parameters: Type.Object({
      action: Type.Union(['windows.open', 'windows.minimize', 'windows.maximize', 'windows.close', 'windows.retryShortcut', 'windows.revealWorktreePath'].map(value => Type.Literal(value))),
      kind: Type.Optional(Type.Union(['task', 'quick'].map(value => Type.Literal(value)))),
      threadId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      projectId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      directoryId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
      reveal: Type.Optional(Type.Boolean()),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(manageWindowsToolSchema.parse(args), signal ?? AbortSignal.timeout(30000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function managePreviewTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_preview', label: '管理预览与工件',
    description: 'Drive the artifact preview the way the user does: open a local URL, refresh or close the running preview, open an artifact file as a preview, read its status, stop its server, capture a screenshot, or read/remove/attach an existing preview annotation. Network access for a preview origin is a user decision and is not available here.',
    parameters: Type.Object({
      action: Type.Union(['previews.open', 'previews.close', 'previews.refresh', 'artifacts.open', 'artifacts.close', 'artifacts.status', 'artifacts.stop', 'artifacts.capture', 'artifacts.annotation'].map(value => Type.Literal(value))),
      url: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
      directoryId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
      previewId: Type.Optional(Type.String({ format: 'uuid' })),
      annotationId: Type.Optional(Type.String({ format: 'uuid' })),
      operation: Type.Optional(Type.Union(['read', 'remove', 'attach'].map(value => Type.Literal(value)))),
      requestId: Type.Optional(Type.String({ format: 'uuid' })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(managePreviewToolSchema.parse(args), signal ?? AbortSignal.timeout(60000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function manageTerminalTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_terminal', label: '管理集成终端',
    description: 'Open a Pi Desktop terminal for the current task, rename one, or close one; read output with read_terminal. Typing into a terminal is deliberately unavailable: use the sandboxed command tool, which cannot bypass the task\'s policy. Closing needs approval under the ask policy because it can interrupt a running command.',
    parameters: Type.Object({
      action: Type.Union(['terminal.open', 'terminal.rename', 'terminal.close', 'terminal.resize'].map(value => Type.Literal(value))),
      profileId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      terminalId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      title: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      cols: Type.Optional(Type.Integer({ minimum: 2, maximum: 1000 })),
      rows: Type.Optional(Type.Integer({ minimum: 2, maximum: 1000 })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(manageTerminalToolSchema.parse(args), signal ?? AbortSignal.timeout(30000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}
