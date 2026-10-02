import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { defaultData, modelProviderSchema, providerModelSchema, threadSchema, uiThreadSchema } from '../src/shared/contracts.ts';
import { desktopToolSchema } from '../src/shared/worker-protocol.ts';
import { addHarnessDraftAttachments, appendHarnessDraft, harnessApprovals, harnessArtifacts, harnessContextCatalog, harnessContextReferences, harnessDraftAttachments, harnessDraftHistory, harnessDraftPreflight, harnessDraftState, harnessMessageContext, harnessMessageOptions, harnessQueueRevision, harnessQueuedMessages, harnessQuoteReference, harnessSnapshot, removeHarnessContext, removeHarnessDraftAttachment, replaceHarnessDraftText } from '../src/main/harness-tools.ts';
import { contentVersion } from '../src/main/composer.ts';
import { resolveHarnessFocus } from '../src/main/harness-focus.ts';
import { openDesktopView } from '../src/main/desktop-views.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

function fixture() {
  const data = defaultData();
  const thread = threadSchema.parse({ id: 't', projectId: 'p', cwd: 'E:/worktree', directoryId: 'p', title: 'Current', createdAt: 1, updatedAt: 1, modelId: 'model', thinking: 'off', policy: 'deny' });
  data.threads.push(thread, { ...thread, id: 'secret-thread', title: 'PRIVATE_OTHER_THREAD' });
  data.projects.push({ id: 'p', name: 'Project', path: 'E:/project', trusted: true, createdAt: 1, directories: [{ id: 'extra', name: 'Extra', path: 'E:/extra', trusted: false }] });
  data.settings.modelProviders.push(modelProviderSchema.parse({ id: 'model-provider', name: 'Model', kind: 'custom', namespace: 'desktop-model-provider', baseUrl: 'https://PRIVATE_CREDENTIAL_ENDPOINT.invalid' }));
  data.settings.models.push(providerModelSchema.parse({ id: 'model', provider: 'model-provider', name: 'Model', model: 'm', reasoning: false }));
  data.ui.threads.t = uiThreadSchema.parse({ draft: { text: 'PRIVATE_UNSENT_DRAFT', attachments: [] } });
  thread.queue = [{ text: 'PRIVATE_QUEUED_MESSAGE', attachments: [], kind: 'followUp' }];
  return { data, thread };
}

test('harness requests reject arbitrary thread selection, raw IPC and unrecognized actions', () => {
  assert(desktopToolSchema.safeParse({ action: 'harness.inspect', section: 'all' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.inspect', section: 'view' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.approvals' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.artifacts' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.draft', text: 'append this note' }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.draft', text: '' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.context', references: [{ kind: 'file', id: 'README.md', label: 'README.md' }] }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.context', references: [] }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.contextCatalog', query: 'read' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.messageOptions', query: 'error' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.messageRead', messageId: 'message-1', start: 0, end: 5 }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.messageRead', messageId: 'message-1', start: 5 }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.quote', messageId: 'message-1', start: 0, end: 5 }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.queue' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.queueChange', id: 'queue-1', revision: 0, change: 'edit', text: 'updated' }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.queueChange', id: 'queue-1', revision: 0, change: 'edit' }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.queueChange', id: 'queue-1', revision: 0, change: 'remove', text: 'unexpected' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.contextRemove', reference: { kind: 'file', id: 'README.md' } }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.contextRemove', reference: { kind: 'quote', id: 'message-1', quote: { start: 0, end: 5 } } }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.contextRemove', reference: { kind: 'quote', id: 'message-1' } }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.contextList' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.attachmentList' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.attachmentAdd', files: [{ path: 'image.png', directoryId: 'p' }], revision: 'b'.repeat(64) }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.attachmentAdd', files: [{ path: '../outside.png' }], revision: 'b'.repeat(64) }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.attachmentRemove', id: 'a'.repeat(64), revision: 'b'.repeat(64) }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.draftPreflight' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.draftSend', revision: 'b'.repeat(64), queue: 'followUp' }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.draftSend', revision: 'b'.repeat(64) }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.draftReplace', revision: 'b'.repeat(64), text: 'replacement' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.draftReplace', revision: 'b'.repeat(64), text: '' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.draftHistory' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.draftHistoryRestore', snapshotId: 'snapshot-1', revision: 'b'.repeat(64) }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.draftHistoryRestore', snapshotId: 'snapshot-1' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.queueClear', revision: 'b'.repeat(64) }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.queueClear' }).success);
  assert(desktopToolSchema.safeParse({ action: 'project.actions.list' }).success);
  assert(desktopToolSchema.safeParse({ action: 'project.actions.run', kind: 'initialization', command: 'npm run init' }).success);
  assert(desktopToolSchema.safeParse({ action: 'project.actions.run', kind: 'action', actionId: 'check', command: 'npm run check' }).success);
  assert(!desktopToolSchema.safeParse({ action: 'project.actions.run', kind: 'action', command: 'npm run check' }).success);
  assert(!desktopToolSchema.safeParse({ action: 'project.actions.run', kind: 'cleanup', actionId: 'check', command: 'npm run check' }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.inspect', threadId: 'someone-else' }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.inspect', op: 'settings.patch', policy: 'full' }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.execute' }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.focus', target: { kind: 'composer' } }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.focus', target: { kind: 'latest' } }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.focus', target: { kind: 'message', messageId: 'item' } }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.focus', target: { kind: 'approval' } }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.focus', target: { kind: 'plan', index: 0 } }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.focus', target: { kind: 'plan', index: -1 } }).success);
  assert(!desktopToolSchema.safeParse({ action: 'harness.focus', target: { kind: 'message', id: 'item' } }).success);
  assert(!desktopToolSchema.safeParse({ action: 'subtasks.ask', question: 'Question', parentThreadId: 'someone-else' }).success);
  assert(!desktopToolSchema.safeParse({ action: 'subtasks.reply', id: crypto.randomUUID(), questionId: crypto.randomUUID(), answer: 'Answer', policy: 'full' }).success);
});

test('context catalog stays metadata-only, queryable and bounded', () => {
  const catalog = {
    commands: [{ id: 'plan', enabled: true }, { id: 'review', enabled: false }],
    references: [{ kind: 'tool', id: 'read', label: 'read', description: 'Read files' }, { kind: 'skill', id: 'C:/skills/demo/SKILL.md', label: 'demo', description: 'Demo skill' }],
  } as const;
  const result = harnessContextCatalog(catalog, 'read', [{ kind: 'file', id: 'README.md', label: 'README.md', directoryId: 'p', description: 'Project README' }]);
  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.references, [{ kind: 'tool', id: 'read', label: 'read', description: 'Read files' }, { kind: 'file', id: 'README.md', label: 'README.md', directoryId: 'p', description: 'Project README' }]);
  assert(!JSON.stringify(result).includes('C:/skills/demo'));
});

test('message options expose only bounded user and assistant metadata', () => {
  const thread = threadSchema.parse({ id: 't', projectId: 'p', cwd: 'E:/worktree', title: 'Current', createdAt: 1, updatedAt: 1, modelId: 'model', thinking: 'off', policy: 'deny', items: [
    { id: 'u1', role: 'user', text: 'Please inspect README', timestamp: 1 },
    { id: 'tool1', role: 'tool', toolName: 'read', text: 'PRIVATE_TOOL_OUTPUT', timestamp: 2 },
    { id: 'a1', role: 'assistant', text: 'I will inspect README now.', timestamp: 3 },
  ] });
  const result = harnessMessageOptions(thread, 'read');
  assert.deepEqual(result.messages, [
    { id: 'u1', role: 'user', preview: 'Please inspect README', textLength: 21, quoteable: true },
    { id: 'a1', role: 'assistant', preview: 'I will inspect README now.', textLength: 26, quoteable: true },
  ]);
  assert(!JSON.stringify(result).includes('PRIVATE_TOOL_OUTPUT'));
});

test('message context returns exact bounded ranges and rejects tool messages', () => {
  const thread = threadSchema.parse({ id: 't', projectId: 'p', cwd: 'E:/worktree', title: 'Current', createdAt: 1, updatedAt: 1, modelId: 'model', thinking: 'off', policy: 'deny', items: [
    { id: 'u1', role: 'user', text: 'Please inspect README', timestamp: 1 },
    { id: 'tool1', role: 'tool', toolName: 'read', text: 'PRIVATE_TOOL_OUTPUT', timestamp: 2 },
  ] });
  const result = harnessMessageContext(thread, 'u1', 7, 14);
  assert.equal(result.message.content, 'inspect');
  assert.equal(result.message.start, 7); assert.equal(result.message.end, 14);
  assert.equal(result.message.version.length, 64);
  assert.throws(() => harnessMessageContext(thread, 'tool1', 0, 4), /不可引用/);
  assert.throws(() => harnessMessageContext(thread, 'u1', 0, 40001), /超出正文/);
});

test('quote reference preserves exact text and version without exposing other roles', () => {
  const thread = threadSchema.parse({ id: 't', projectId: 'p', cwd: 'E:/worktree', title: 'Current', createdAt: 1, updatedAt: 1, modelId: 'model', thinking: 'off', policy: 'deny', items: [
    { id: 'u1', role: 'user', text: 'Please inspect README', timestamp: 1 },
    { id: 'tool1', role: 'tool', toolName: 'read', text: 'PRIVATE_TOOL_OUTPUT', timestamp: 2 },
  ] });
  const reference = harnessQuoteReference(thread, 'u1', 7, 14);
  assert.deepEqual(reference.kind, 'quote'); assert.deepEqual(reference.id, 'u1'); assert.deepEqual(reference.label, '引用消息');
  assert.equal(reference.version?.length, 64); assert.deepEqual(reference.quote, { start: 7, end: 14, text: 'inspect' });
  assert.throws(() => harnessQuoteReference(thread, 'tool1', 0, 4), /不可引用/);
});

test('queued message projection is scoped and bounded', () => {
  const { thread } = fixture();
  thread.queue = [
    { id: 'queue-1', revision: 2, text: '  NEXT_STEP\nwith details  ', attachments: ['a.txt'], kind: 'steer', context: [{ kind: 'file', id: 'README.md', label: 'README.md' }] },
    { text: '', attachments: [], kind: 'followUp' },
  ];
  const result = harnessQueuedMessages(thread);
  assert.deepEqual(result, { version: 1, messages: [
    { id: 'queue-1', revision: 2, kind: 'steer', preview: 'NEXT_STEP with details', textLength: 26, attachments: 1, contextReferences: 1 },
    { revision: 0, kind: 'followUp', preview: '', textLength: 0, attachments: 0, contextReferences: 0 },
  ], total: 2, limited: false, revision: harnessQueueRevision(thread.queue) });
});

test('draft history projection exposes only restorable metadata', () => {
  const { thread } = fixture();
  thread.draftHistory = [{ id: 'snapshot-1', at: 42, text: 'PRIVATE_HISTORY_TEXT', attachments: ['E:/secret.txt'], context: [{ kind: 'file', id: 'secret.txt', label: 'secret.txt' }] }];
  const result = harnessDraftHistory(thread);
  assert.deepEqual(result, { version: 1, items: [{ id: 'snapshot-1', at: 42, textLength: 20, attachments: 1, contextReferences: 1 }], total: 1 });
  assert(!JSON.stringify(result).includes('PRIVATE_HISTORY_TEXT'));
  assert(!JSON.stringify(result).includes('E:/secret.txt'));
});

test('context removal matches only the stable reference identity', () => {
  const references = [
    { kind: 'file' as const, id: 'README.md', label: 'README.md', directoryId: 'p' },
    { kind: 'quote' as const, id: 'message-1', label: '引用消息', version: 'v1', quote: { start: 0, end: 5, text: 'Hello' } },
  ];
  const removed = removeHarnessContext(references, { kind: 'quote', id: 'message-1', quote: { start: 0, end: 5 } });
  assert.deepEqual(removed, { status: 'removed', removed: 1, references: [references[0]] });
  assert.deepEqual(removeHarnessContext(removed.references, { kind: 'quote', id: 'message-1', quote: { start: 0, end: 5 } }), { status: 'not_found', removed: 0, references: [references[0]] });
});

test('draft context projection returns metadata without quote text', () => {
  const result = harnessContextReferences([
    { kind: 'file', id: 'README.md', label: 'README.md', directoryId: 'p', version: 'file-version' },
    { kind: 'quote', id: 'message-1', label: '引用消息', version: 'message-version', quote: { start: 2, end: 7, text: 'SECRET_QUOTE_TEXT' } },
  ]);
  assert.deepEqual(result, { version: 1, references: [
    { kind: 'file', id: 'README.md', label: 'README.md', directoryId: 'p', version: 'file-version' },
    { kind: 'quote', id: 'message-1', label: '引用消息', version: 'message-version', quote: { start: 2, end: 7, textLength: 17 } },
  ], total: 2, limited: false });
  assert(!JSON.stringify(result).includes('SECRET_QUOTE_TEXT'));
});

test('draft attachment projection hides roots and reports bounded file metadata', async () => {
  const root = await mkdtemp('harness-attachments-');
  await writeFile(join(root, 'note.txt'), 'hello');
  const paths = [join(root, 'note.txt'), join(root, 'missing.bin')];
  const result = await harnessDraftAttachments(root, paths);
  assert.deepEqual(result, {
    version: 1,
    revision: contentVersion(JSON.stringify(paths.map(path => path.replaceAll('\\', '/')))),
    attachments: [
      { id: contentVersion(paths[0].replaceAll('\\', '/')), name: 'note.txt', path: 'note.txt', location: 'project', state: 'ready', size: 5 },
      { id: contentVersion(paths[1].replaceAll('\\', '/')), name: 'missing.bin', path: 'missing.bin', location: 'project', state: 'missing' },
    ],
    total: 2,
    limited: false,
  });
  assert(!JSON.stringify(result).includes(root));
});

test('draft attachment removal uses opaque identity and revision control', () => {
  const current = ['E:/project/a.txt', 'E:/project/b.txt'];
  const revision = contentVersion(JSON.stringify(current));
  const result = removeHarnessDraftAttachment(current, contentVersion('E:/project/a.txt'), revision);
  assert.deepEqual(result, { status: 'removed', removed: 1, attachments: ['E:/project/b.txt'], revision: contentVersion(JSON.stringify(['E:/project/b.txt'])) });
  assert.throws(() => removeHarnessDraftAttachment(current, contentVersion('E:/project/a.txt'), '0'.repeat(64)), /草稿附件已变化/);
});

test('draft attachment addition uses optimistic revision and preserves existing paths', () => {
  const current = ['E:/managed/a.png'];
  const revision = contentVersion(JSON.stringify(current));
  const result = addHarnessDraftAttachments(current, ['E:/managed/b.png'], revision);
  assert.deepEqual(result, { status: 'added', added: 1, attachments: ['E:/managed/a.png', 'E:/managed/b.png'], revision: contentVersion(JSON.stringify(['E:/managed/a.png', 'E:/managed/b.png'])) });
  assert.deepEqual(addHarnessDraftAttachments(result.attachments, [], result.revision), { status: 'already_present', added: 0, attachments: result.attachments, revision: result.revision });
  assert.throws(() => addHarnessDraftAttachments(current, ['E:/managed/b.png'], '0'.repeat(64)), /草稿附件已变化/);
  const full = Array.from({ length: 10 }, (_, index) => 'E:/managed/' + index + '.png');
  assert.throws(() => addHarnessDraftAttachments(full, ['E:/managed/overflow.png'], contentVersion(JSON.stringify(full))), /最多保留/);
});

test('draft preflight projection exposes readiness without draft contents', () => {
  const result = harnessDraftPreflight({ text: 'PRIVATE_DRAFT', attachments: ['a.txt'] }, [{ kind: 'file', id: 'README.md', label: 'README.md' }], {
    issues: [{ target: 'a.txt', message: '附件不存在' }, { target: 'README.md', message: '引用已过期' }],
    estimatedTokens: 42, contextWindow: 8192, images: 0,
  });
  assert.deepEqual(result, {
    version: 1, valid: false,
    issues: [{ target: 'a.txt', message: '附件不存在' }, { target: 'README.md', message: '引用已过期' }],
    estimatedTokens: 42, contextWindow: 8192, images: 0, textLength: 13, attachments: 1, contextReferences: 1,
  });
  assert(!JSON.stringify(result).includes('PRIVATE_DRAFT'));
});

test('draft state projection exposes an opaque revision without draft contents', () => {
  const result = harnessDraftState({ text: 'PRIVATE_DRAFT', attachments: ['E:/project/a.txt'] }, [{ kind: 'quote', id: 'message-1', label: '引用消息', quote: { start: 1, end: 4, text: 'PRIVATE_QUOTE' } }]);
  assert.equal(result.version, 1);
  assert.equal(result.hasText, true);
  assert.equal(result.textLength, 13);
  assert.equal(result.attachments, 1);
  assert.equal(result.contextReferences, 1);
  assert.match(result.revision, /^[a-f0-9]{64}$/);
  assert(!JSON.stringify(result).includes('PRIVATE_DRAFT'));
  assert(!JSON.stringify(result).includes('PRIVATE_QUOTE'));
});

test('harness draft appends without replacing user state and is idempotent for retries', () => {
  const initial = { text: 'USER_DRAFT', attachments: ['file.txt'] };
  const appended = appendHarnessDraft(initial, 'MODEL_NOTE');
  assert.deepEqual(appended, { status: 'appended', draft: { text: 'USER_DRAFT\\n\\nMODEL_NOTE', attachments: ['file.txt'] } });
  assert.deepEqual(appendHarnessDraft(appended.draft, 'MODEL_NOTE'), { status: 'already_present', draft: appended.draft });
  assert.deepEqual(appendHarnessDraft(undefined, ' MODEL_NOTE '), { status: 'appended', draft: { text: 'MODEL_NOTE', attachments: [] } });
  assert.throws(() => appendHarnessDraft({ text: 'x'.repeat(999999), attachments: [] }, 'y'), /草稿过长/);
});

test('harness draft replacement uses caller revision and preserves attachments', () => {
  const replaced = replaceHarnessDraftText({ text: 'USER_DRAFT', attachments: ['file.txt'] }, 'MODEL_REPLACEMENT');
  assert.deepEqual(replaced, { status: 'replaced', draft: { text: 'MODEL_REPLACEMENT', attachments: ['file.txt'] } });
  assert.deepEqual(replaceHarnessDraftText(replaced.draft, 'MODEL_REPLACEMENT'), { status: 'already_present', draft: replaced.draft });
  assert.deepEqual(replaceHarnessDraftText(replaced.draft, ''), { status: 'cleared', draft: { text: '', attachments: ['file.txt'] } });
  assert.deepEqual(replaceHarnessDraftText({ text: '', attachments: [] }, ''), { status: 'already_empty', draft: { text: '', attachments: [] } });
  assert.throws(() => replaceHarnessDraftText({ text: '', attachments: [] }, 'x'.repeat(1000001)), /草稿过长/);
});

test('pending approval projection is scoped, bounded and excludes thread ownership', () => {
  const approvals = harnessApprovals([
    { id: 'approval-1', threadId: 't', tool: 'write', description: 'write this file', kind: 'action', review: { risk: 'high', reason: '可能覆盖现有内容', model: 'reviewer' }, options: ['允许', '拒绝'] },
    { id: 'approval-2', threadId: 'other', tool: 'shell', description: 'PRIVATE_OTHER_APPROVAL', kind: 'confirm' },
  ], 't');
  assert.equal(approvals.total, 1);
  assert.deepEqual(approvals.approvals, [{ id: 'approval-1', tool: 'write', kind: 'action', description: 'write this file', review: { risk: 'high', reason: '可能覆盖现有内容' }, options: ['允许', '拒绝'] }]);
  assert(!JSON.stringify(approvals).includes('threadId'));
  assert(!JSON.stringify(approvals).includes('PRIVATE_OTHER_APPROVAL'));
});

test('desktop view requests accept scoped files and panels but reject execution and foreign navigation', () => {
  assert(desktopToolSchema.safeParse({ action: 'harness.open', target: { kind: 'file', path: 'src/main.ts', line: 4, column: 2 } }).success);
  for (const kind of ['changes', 'review', 'files', 'subtasks', 'summary', 'terminal']) assert(desktopToolSchema.safeParse({ action: 'harness.open', target: { kind } }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.open', target: { kind: 'files', directoryId: 'extra' } }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.open', target: { kind: 'browser' } }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.open', target: { kind: 'browser', tabId: 'browser-1' } }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.open', target: { kind: 'sidechat' } }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.open', target: { kind: 'sidechat', sidechatId: 'sidechat-1' } }).success);
  assert(desktopToolSchema.safeParse({ action: 'harness.open', target: { kind: 'subtask', subtaskId: crypto.randomUUID() } }).success);
  for (const target of [
    { kind: 'file' }, { kind: 'file', path: 'a.ts', line: 0 }, { kind: 'file', path: 'a.ts', column: 2 }, { kind: 'files', path: 'a.ts' },
    { kind: 'file', path: 'a.ts', threadId: 'stranger' }, { kind: 'summary', path: 'a.ts' },
    { kind: 'terminal', command: 'remove-item *' }, { kind: 'browser', url: 'https://example.com' }, { kind: 'browser', tabId: '' }, { kind: 'sidechat', path: 'draft.md' }, { kind: 'subtask' },
  ]) assert(!desktopToolSchema.safeParse({ action: 'harness.open', target }).success);
});

test('artifact view is limited to the current task artifacts and opens the files preview', async () => {
  const root = await mkdtemp('pi-harness-artifact-view-');
  await writeFile(join(root, 'preview.html'), '<h1>Preview</h1>');
  await writeFile(join(root, 'notes.txt'), 'not an artifact');
  const data = defaultData();
  const thread = threadSchema.parse({ id: 't', projectId: 'p', cwd: root, title: 'Current', createdAt: 1, updatedAt: 1, modelId: 'model', thinking: 'off', policy: 'deny', artifacts: ['preview.html'] });
  data.ui.view = 'thread'; data.ui.activeThreadId = 't'; data.ui.threads.t = uiThreadSchema.parse({});
  const runtime = {
    context: () => ({ windowId: 1, thread, ui: data.ui }),
    directory: () => ({ id: 'p', path: root }),
    sidechat: () => undefined,
    subtask: () => false,
    publish: (_windowId: number, patch: Record<string, unknown>, frame: Record<string, unknown>) => {
      data.ui.threads.t = uiThreadSchema.parse({ ...data.ui.threads.t, ...patch });
      Object.assign(data.ui, frame);
    },
  };
  const opened = await openDesktopView(runtime, { kind: 'artifact', path: 'preview.html' }, new AbortController().signal);
  assert.deepEqual(opened, { status: 'opened', kind: 'artifact', directoryId: 'p', path: 'preview.html' });
  assert.equal(data.ui.reviewOpen, true); assert.equal(data.ui.threads.t.reviewTab, 'file');
  assert.equal(data.ui.threads.t.selectedPath, 'preview.html'); assert.deepEqual(data.ui.threads.t.openFiles, ['preview.html']);
  await assert.rejects(openDesktopView(runtime, { kind: 'artifact', path: 'notes.txt' }, new AbortController().signal), /只能打开当前任务产物/);
  await assert.rejects(openDesktopView(runtime, { kind: 'artifact', path: '../preview.html' }, new AbortController().signal), /路径超出项目目录/);
});

test('artifact listing normalizes paths and reports only bounded preview metadata', async () => {
  const root = await mkdtemp('pi-harness-artifact-list-');
  await writeFile(join(root, 'preview.html'), '<h1>Preview</h1>');
  await writeFile(join(root, 'notes.txt'), 'not a preview');
  const thread = threadSchema.parse({ id: 't', projectId: 'p', cwd: root, title: 'Current', createdAt: 1, updatedAt: 1, modelId: 'model', thinking: 'off', policy: 'deny', artifacts: [join(root, 'preview.html'), 'notes.txt', 'missing.pdf'] });
  const listing = await harnessArtifacts(thread, root);
  assert.deepEqual(listing, {
    version: 1,
    artifacts: [
      { path: 'preview.html', kind: 'html', state: 'ready', size: 16 },
      { path: 'notes.txt', kind: 'unknown', state: 'invalid' },
      { path: 'missing.pdf', kind: 'unknown', state: 'missing' },
    ],
    total: 3,
  });
  assert(!JSON.stringify(listing).includes(root));
});

test('harness snapshot exposes scoped state without settings, drafts or other chats', () => {
  const { data, thread } = fixture();
  const snapshot = harnessSnapshot(data, thread, thread, 'all');
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.session?.id, 't'); assert.equal(snapshot.session?.queuedMessages, 1);
  assert.equal(snapshot.workspace?.directories[0].path, 'E:/worktree');
  assert.equal(snapshot.workspace?.directories.length, 2);
  assert(!serialized.includes('PRIVATE_')); assert(!serialized.includes('apiKey')); assert(!serialized.includes('settings'));
  assert.equal(snapshot.permissions?.readOnly, true);
  assert.equal(snapshot.view?.appView, 'thread');
  assert.equal(snapshot.view?.activeThreadId, '');
});

test('harness view lists owned sidechat ids without exposing their transcript', () => {
  const { data, thread } = fixture();
  data.threads.push(threadSchema.parse({ ...thread, id: 'side-1', title: '侧聊', sidechat: {
    parentThreadId: 't', parentTitle: 'Current', anchorItemId: 'item-1', capturedAt: 1, temporary: true, context: 'PRIVATE_SIDECHAT_CONTEXT',
  } }));
  data.ui.threads.t = uiThreadSchema.parse({ sidechatId: 'side-1' });
  const snapshot = harnessSnapshot(data, thread, thread, 'view');
  assert.equal(snapshot.view?.sidechatId, 'side-1');
  assert.deepEqual(snapshot.view?.sidechats, [{ id: 'side-1', status: 'idle', updatedAt: 1 }]);
  assert(!JSON.stringify(snapshot).includes('PRIVATE_SIDECHAT_CONTEXT'));
});

test('terminal inspection accepts bounded reads but rejects input, foreign threads and invalid waits', () => {
  const terminalId = crypto.randomUUID();
  assert(desktopToolSchema.safeParse({ action: 'terminal.inspect' }).success);
  assert(desktopToolSchema.safeParse({ action: 'terminal.inspect', terminalId, cursor: 'cursor', maxChars: 1024, timeoutMs: 1000 }).success);
  for (const values of [{ threadId: 'foreign' }, { command: 'echo injected' }, { terminalId, input: 'yes' },
    { cursor: 'cursor' }, { timeoutMs: 1000 }, { terminalId, timeoutMs: 1000 }, { terminalId, maxChars: 20001 },
    { terminalId, timeoutMs: 30001 }, { terminalId: '../other' }]) {
    assert(!desktopToolSchema.safeParse({ action: 'terminal.inspect', ...values }).success);
  }
});

test('children see their own workspace and cannot discover sibling directories or parent drafts', () => {
  const { data, thread } = fixture(); thread.subtaskId = crypto.randomUUID();
  const snapshot = harnessSnapshot(data, thread, thread, 'all');
  assert.equal(snapshot.workspace?.directories.length, 1);
  assert.equal(snapshot.workspace?.directories[0].path, 'E:/worktree');
  assert.equal(snapshot.session?.role, 'child');
  assert(!JSON.stringify(snapshot).includes('E:/extra'));
});

test('operation tools validate separate scoped read, wait and cancellation actions', () => {
  const operationId = crypto.randomUUID();
  for (const request of [{ action: 'operations.list' }, { action: 'operations.read', operationId },
    { action: 'operations.wait', operationId, cursor: 'cursor', timeoutMs: 500 }, { action: 'operations.cancel', operationId }]) {
    assert(desktopToolSchema.safeParse(request).success);
  }
  for (const request of [{ action: 'operations.list', threadId: 'foreign' }, { action: 'operations.read' },
    { action: 'operations.cancel', operationId, force: true }, { action: 'operations.read', operationId, command: 'echo injected' },
    { action: 'operations.wait', operationId, timeoutMs: 30001 }, { action: 'operations.start', kind: 'pr.create' }]) {
    assert(!desktopToolSchema.safeParse(request).success);
  }
});

test('harness reports the stricter captured and current policy and only requested sections', () => {
  const { data, thread } = fixture(), captured = structuredClone(thread);
  thread.policy = 'full';
  const snapshot = harnessSnapshot(data, thread, captured, 'session');
  assert.equal(snapshot.permissions?.readOnly, true);
  assert.equal(snapshot.workspace, undefined); assert.equal(snapshot.operations, undefined);
});

test('focus resolution maps safe model targets to current timeline elements only', () => {
  const { thread } = fixture();
  thread.items.push(
    { id: 'user-1', role: 'user', text: 'Inspect', thinking: '', state: 'done', timestamp: 2 },
    { id: 'assistant-1', role: 'assistant', text: 'Done', thinking: '', state: 'done', stopReason: 'stop', timestamp: 3 },
  );
  thread.plan = [{ text: '检查入口', status: 'in_progress' }, { text: '运行验证', status: 'pending' }];
  assert.deepEqual(resolveHarnessFocus(thread, [], { kind: 'composer' }), { status: 'focused', target: { kind: 'composer' } });
  assert.deepEqual(resolveHarnessFocus(thread, [], { kind: 'latest' }), { status: 'focused', target: { kind: 'message', id: 'assistant-1' } });
  assert.deepEqual(resolveHarnessFocus(thread, [], { kind: 'message', messageId: 'user-1' }), { status: 'focused', target: { kind: 'message', id: 'user-1' } });
  assert.deepEqual(resolveHarnessFocus(thread, [], { kind: 'message', messageId: 'missing' }), { status: 'not_focused', reason: 'message_missing' });
  assert.deepEqual(resolveHarnessFocus(thread, [], { kind: 'plan', index: 1 }), { status: 'focused', target: { kind: 'plan', turnKey: 'user-1', index: 1, text: '运行验证' } });
  assert.deepEqual(resolveHarnessFocus(thread, [], { kind: 'plan', index: 3 }), { status: 'not_focused', reason: 'plan_step_missing' });
  assert.deepEqual(resolveHarnessFocus(thread, [], { kind: 'approval' }), { status: 'not_focused', reason: 'approval_missing' });
  assert.deepEqual(resolveHarnessFocus(thread, [{ id: 'approval-1', threadId: 't', tool: 'write', description: 'write', kind: 'action' }], { kind: 'approval' }), { status: 'focused', target: { kind: 'approval', id: 'approval-1' } });
});
