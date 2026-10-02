import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Bootstrap } from '../../src/shared/contracts.ts';
import { harnessQueueRevision } from '../../src/main/harness-tools.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) {
  const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
} });
const send = (text: string) => fixture.invoke({ op: 'thread.send', id: 't', text, attachments: [] });
const idle = () => expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.status).toBe('idle');
const task = async () => (await fixture.snapshot()).data.subtasks[0];
async function delegate(parentPrompt: string, childPrompt: string) {
  await fixture.invoke({ op: 'settings.patch', patch: { subtasksEnabled: true } });
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  fixture.requestScopedTool('manage_subtasks', { action: 'subtasks.create', definition: {
    title: '协作检查', prompt: childPrompt, environment: 'local', startPoint: 'HEAD', policy: 'deny', includeContext: false,
  } }, parentPrompt);
  await send(parentPrompt);
}

test('harness inspection is a real read-only model tool and excludes unsent drafts', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'PRIVATE_DRAFT_SENTINEL', attachments: [] } } });
  fixture.requestTool('get_harness', { section: 'all' }); await send('Inspect the harness'); await idle();
  const tool = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'get_harness')!;
  expect(tool.state, tool.text).toBe('done'); expect(tool.text).toContain('availableTools'); expect(tool.text).toContain(fixture.project.replaceAll('\\', '\\\\'));
  expect(tool.text).not.toContain('PRIVATE_DRAFT_SENTINEL'); expect(tool.text).not.toContain('baseUrl');
  expect(fixture.calls[0].tools?.map(tool => tool.function.name)).toContain('get_harness');
  expect(fixture.calls[0].tools?.map(tool => tool.function.name)).not.toContain('ask_parent');
  expect((await fixture.snapshot()).approvals).toHaveLength(0);
});

test('list_pending_approvals returns only the current task approval projection', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  fixture.requestTool('list_pending_approvals', {}); await send('LIST_PENDING_APPROVALS'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'list_pending_approvals')!;
  expect(item.state, item.text).toBe('done');
  expect(JSON.parse(item.text)).toEqual({ version: 1, approvals: [], total: 0 });
  expect(fixture.calls[0].tools?.map(tool => tool.function.name)).toContain('list_pending_approvals');
  expect((await fixture.snapshot()).approvals).toHaveLength(0);
});

test('append_to_draft stages model notes without sending or dropping user state', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'USER_DRAFT', attachments: ['keep.txt'] }, contextReferences: [] } });
  fixture.requestTool('append_to_draft', { text: 'MODEL_NOTE' }); await send('APPEND_DRAFT_NOTE'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'append_to_draft')!;
  expect(item.state, item.text).toBe('done'); expect(JSON.parse(item.text)).toMatchObject({ version: 1, status: 'appended', attachmentsPreserved: 1 });
  expect((await fixture.snapshot()).data.ui.threads.t.draft).toEqual({ text: 'USER_DRAFT\\n\\nMODEL_NOTE', attachments: ['keep.txt'] });
  fixture.requestTool('append_to_draft', { text: 'MODEL_NOTE' }); await send('APPEND_DRAFT_RETRY'); await idle();
  const retry = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'append_to_draft')!;
  expect(JSON.parse(retry.text).status).toBe('already_present');
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('USER_DRAFT\\n\\nMODEL_NOTE');
  expect(fixture.calls[0].tools?.map(tool => tool.function.name)).toContain('append_to_draft');
});

test('add_context_to_draft validates and merges composer references without sending', async () => {
  await writeFile(join(fixture.project, 'context.md'), '# Harness context\\n');
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  fixture.requestTool('add_context_to_draft', { references: [{ kind: 'file', id: 'context.md', label: 'context.md', directoryId: 'p' }] }); await send('ADD_CONTEXT_REFERENCE'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'add_context_to_draft')!;
  expect(item.state, item.text).toBe('done'); expect(JSON.parse(item.text)).toMatchObject({ version: 1, status: 'added', added: 1, total: 1 });
  expect((await fixture.snapshot()).data.ui.threads.t.contextReferences).toEqual([{ kind: 'file', id: 'context.md', label: 'context.md', directoryId: 'p', version: expect.any(String) }]);
  fixture.requestTool('add_context_to_draft', { references: [{ kind: 'file', id: 'context.md', label: 'context.md', directoryId: 'p' }] }); await send('ADD_CONTEXT_REFERENCE_RETRY'); await idle();
  const retry = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'add_context_to_draft')!;
  expect(JSON.parse(retry.text).status).toBe('already_present');
  expect((await fixture.snapshot()).data.ui.threads.t.contextReferences).toHaveLength(1);
  fixture.requestTool('add_context_to_draft', { references: [{ kind: 'file', id: '../outside.md', label: 'outside.md', directoryId: 'p' }] }); await send('REJECT_OUTSIDE_CONTEXT'); await idle();
  const rejected = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'add_context_to_draft')!;
  expect(rejected.state).toBe('error'); expect(rejected.text).toContain('路径超出项目目录');
  expect((await fixture.snapshot()).data.ui.threads.t.contextReferences).toHaveLength(1);
  expect(fixture.calls[0].tools?.map(tool => tool.function.name)).toContain('add_context_to_draft');
});

test('remove_context_from_draft removes one exact reference without touching draft text', async () => {
  await writeFile(join(fixture.project, 'remove-context.md'), '# Remove me\n');
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'KEEP_DRAFT', attachments: [] } } });
  fixture.requestTool('add_context_to_draft', { references: [{ kind: 'file', id: 'remove-context.md', label: 'remove-context.md', directoryId: 'p' }] }); await send('ADD_CONTEXT_FOR_REMOVE'); await idle();
  expect((await fixture.snapshot()).data.ui.threads.t.contextReferences).toHaveLength(1);
  fixture.requestTool('remove_context_from_draft', { reference: { kind: 'file', id: 'remove-context.md', directoryId: 'p' } }); await send('REMOVE_CONTEXT'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'remove_context_from_draft')!;
  expect(item.state, item.text).toBe('done'); expect(JSON.parse(item.text)).toMatchObject({ version: 1, status: 'removed', removed: 1, total: 0 });
  expect((await fixture.snapshot()).data.ui.threads.t.contextReferences).toEqual([]);
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('KEEP_DRAFT');
  fixture.requestTool('remove_context_from_draft', { reference: { kind: 'file', id: 'remove-context.md', directoryId: 'p' } }); await send('REMOVE_CONTEXT_RETRY'); await idle();
  const retry = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'remove_context_from_draft')!;
  expect(JSON.parse(retry.text).status).toBe('not_found');
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('remove_context_from_draft');
});

test('list_context_options exposes picker metadata and matching project files only', async () => {
  await writeFile(join(fixture.project, 'context.md'), '# Harness context\\n');
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  fixture.requestTool('list_context_options', { query: 'context' }); await send('LIST_CONTEXT_OPTIONS'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'list_context_options')!;
  expect(item.state, item.text).toBe('done');
  const result = JSON.parse(item.text);
  expect(result).toMatchObject({ version: 1, query: 'context' });
  expect(result.references).toEqual(expect.arrayContaining([{ kind: 'file', id: 'context.md', label: 'context.md', directoryId: 'p', description: expect.stringContaining('context.md') }]));
  expect(item.text).not.toContain('# Harness context');
  expect(fixture.calls[0].tools?.map(tool => tool.function.name)).toContain('list_context_options');
});

test('list_message_options exposes scoped message metadata without tool output', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  fixture.requestTool('list_message_options', { query: 'LIST_MESSAGE_OPTIONS' }); await send('LIST_MESSAGE_OPTIONS'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'list_message_options')!;
  expect(item.state, item.text).toBe('done');
  const result = JSON.parse(item.text);
  expect(result).toMatchObject({ version: 1, query: 'LIST_MESSAGE_OPTIONS', total: 1 });
  expect(result.messages).toEqual([{ id: expect.any(String), role: 'user', preview: 'LIST_MESSAGE_OPTIONS', textLength: 20, quoteable: true }]);
  expect(item.text).not.toContain('PRIVATE_TOOL_OUTPUT');
  expect(fixture.calls[0].tools?.map(tool => tool.function.name)).toContain('list_message_options');
});

test('read_message_context returns an exact quote range with a stable version', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await send('SOURCE_MESSAGE'); await idle();
  const source = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.role === 'user' && item.text === 'SOURCE_MESSAGE')!;
  fixture.requestTool('read_message_context', { messageId: source.id, start: 0, end: 6 }); await send('READ_MESSAGE_CONTEXT'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'read_message_context')!;
  expect(item.state, item.text).toBe('done');
  const result = JSON.parse(item.text);
  expect(result).toMatchObject({ version: 1, message: { id: source.id, role: 'user', start: 0, end: 6, textLength: 14, content: 'SOURCE', truncated: false, version: expect.any(String) } });
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('read_message_context');
});

test('quote_message_to_draft adds a validated message quote without sending', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await send('SOURCE_QUOTE_MESSAGE'); await idle();
  const source = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.role === 'user' && item.text === 'SOURCE_QUOTE_MESSAGE')!;
  fixture.requestTool('quote_message_to_draft', { messageId: source.id, start: 0, end: 6 }); await send('QUOTE_MESSAGE'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'quote_message_to_draft')!;
  expect(item.state, item.text).toBe('done');
  expect(JSON.parse(item.text)).toMatchObject({ version: 1, status: 'added', added: 1, total: 1, reference: { kind: 'quote', id: source.id, start: 0, end: 6 } });
  expect((await fixture.snapshot()).data.ui.threads.t.contextReferences).toEqual([{ kind: 'quote', id: source.id, label: '引用消息', version: expect.any(String), quote: { start: 0, end: 6, text: 'SOURCE' } }]);
  expect(item.text).not.toContain('SOURCE_QUOTE_MESSAGE');
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('quote_message_to_draft');
});

test('list_draft_context returns bounded metadata without quote text', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: {
    draft: { text: 'KEEP_CONTEXT_DRAFT', attachments: [] },
    contextReferences: [
      { kind: 'file', id: 'README.md', label: 'README.md', directoryId: 'p', version: 'file-version' },
      { kind: 'quote', id: 'message-1', label: '引用消息', version: 'message-version', quote: { start: 2, end: 7, text: 'SECRET_QUOTE_TEXT' } },
    ],
  } });
  fixture.requestTool('list_draft_context', {}); await send('LIST_DRAFT_CONTEXT'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'list_draft_context')!;
  expect(item.state, item.text).toBe('done');
  expect(JSON.parse(item.text)).toEqual({
    version: 1,
    references: [
      { kind: 'file', id: 'README.md', label: 'README.md', directoryId: 'p', version: 'file-version' },
      { kind: 'quote', id: 'message-1', label: '引用消息', version: 'message-version', quote: { start: 2, end: 7, textLength: 17 } },
    ],
    total: 2,
    limited: false,
  });
  expect(item.text).not.toContain('SECRET_QUOTE_TEXT');
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('KEEP_CONTEXT_DRAFT');
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('list_draft_context');
});

test('list_draft_attachments returns safe metadata without absolute roots', async () => {
  await writeFile(join(fixture.project, 'attached.txt'), 'hello');
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'KEEP_ATTACHMENT_DRAFT', attachments: [join(fixture.project, 'attached.txt'), join(fixture.project, 'missing.txt')] } } });
  fixture.requestTool('list_draft_attachments', {}); await send('LIST_DRAFT_ATTACHMENTS'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'list_draft_attachments')!;
  expect(item.state, item.text).toBe('done');
  const result = JSON.parse(item.text);
  expect(result).toMatchObject({ version: 1, total: 2, limited: false, attachments: [
    { name: 'attached.txt', path: 'attached.txt', location: 'project', state: 'ready', size: 5 },
    { name: 'missing.txt', path: 'missing.txt', location: 'project', state: 'missing' },
  ] });
  expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(result.attachments[0].id).toMatch(/^[a-f0-9]{64}$/);
  expect(item.text).not.toContain(fixture.project);
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('KEEP_ATTACHMENT_DRAFT');
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('list_draft_attachments');
});

test('add_draft_attachments copies project files into the managed draft and keeps the source untouched', async () => {
  await writeFile(join(fixture.project, 'attach-from-project.txt'), 'project attachment');
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'KEEP_ATTACHMENT_DRAFT', attachments: [] } } });
  fixture.requestTool('list_draft_attachments', {}); await send('LIST_FOR_ADD'); await idle();
  const listed = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'list_draft_attachments')!;
  const metadata = JSON.parse(listed.text);
  fixture.requestTool('add_draft_attachments', { revision: metadata.revision, files: [{ path: 'attach-from-project.txt', directoryId: 'p' }] }); await send('ADD_DRAFT_ATTACHMENT'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'add_draft_attachments')!;
  expect(item.state, item.text).toBe('done');
  const result = JSON.parse(item.text);
  expect(result).toMatchObject({ version: 1, status: 'added', added: 1, total: 1, attachments: [{ name: 'attach-from-project.txt', state: 'ready', size: 18 }] });
  const stored = (await fixture.snapshot()).data.ui.threads.t.draft?.attachments ?? [];
  expect(stored).toHaveLength(1); expect(stored[0]).not.toContain(fixture.project); expect(stored[0]).toContain('attachments');
  await expect(access(join(fixture.project, 'attach-from-project.txt'))).resolves.toBeUndefined();
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('add_draft_attachments');
});

test('remove_draft_attachment removes only the selected draft entry', async () => {
  await writeFile(join(fixture.project, 'remove-attached.txt'), 'hello');
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'KEEP_ATTACHMENT_DRAFT', attachments: [join(fixture.project, 'remove-attached.txt')] } } });
  fixture.requestTool('list_draft_attachments', {}); await send('LIST_ATTACHMENT_FOR_REMOVE'); await idle();
  const listed = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'list_draft_attachments')!;
  const metadata = JSON.parse(listed.text);
  fixture.requestTool('remove_draft_attachment', { id: metadata.attachments[0].id, revision: metadata.revision }); await send('REMOVE_DRAFT_ATTACHMENT'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'remove_draft_attachment')!;
  expect(item.state, item.text).toBe('done');
  expect(JSON.parse(item.text)).toMatchObject({ version: 1, status: 'removed', removed: 1, total: 0, attachments: [] });
  expect((await fixture.snapshot()).data.ui.threads.t.draft).toEqual({ text: 'KEEP_ATTACHMENT_DRAFT', attachments: [] });
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('remove_draft_attachment');
});

test('send_draft queues the unchanged main draft and clears it after acceptance', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'QUEUED_FROM_HARNESS', attachments: [] }, contextReferences: [] } });
  fixture.requestTool('get_draft_state', {}); await send('READ_DRAFT_STATE_FOR_SEND'); await idle();
  const stateItem = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'get_draft_state')!;
  const state = JSON.parse(stateItem.text);
  fixture.requestTool('send_draft', { revision: state.revision, queue: 'followUp' }); await send('SEND_DRAFT_FROM_HARNESS'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'send_draft')!;
  expect(item.state, item.text).toBe('done');
  expect(JSON.parse(item.text)).toMatchObject({ version: 1, status: 'accepted', queue: 'followUp', cleared: true });
  expect((await fixture.snapshot()).data.ui.threads.t.draft).toEqual({ text: '', attachments: [] });
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('send_draft');
});

test('replace_draft_text updates only text after a stable revision', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'ORIGINAL_DRAFT', attachments: ['E:/project/keep.txt'] }, contextReferences: [] } });
  fixture.requestTool('get_draft_state', {}); await send('READ_DRAFT_STATE_FOR_REPLACE'); await idle();
  const stateItem = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'get_draft_state')!;
  const state = JSON.parse(stateItem.text);
  fixture.requestTool('replace_draft_text', { revision: state.revision, text: 'REPLACED_DRAFT' }); await send('REPLACE_DRAFT_FROM_HARNESS'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'replace_draft_text')!;
  expect(item.state, item.text).toBe('done');
  expect(JSON.parse(item.text)).toMatchObject({ version: 1, status: 'replaced', textLength: 14, attachmentsPreserved: 1, contextReferencesPreserved: 0 });
  expect((await fixture.snapshot()).data.ui.threads.t.draft).toEqual({ text: 'REPLACED_DRAFT', attachments: ['E:/project/keep.txt'] });
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('replace_draft_text');
});

test('draft history lists metadata and restores a selected snapshot after revision check', async () => {
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'ACTIVE_DRAFT_HISTORY', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'HISTORIC_DRAFT', attachments: [] }, contextReferences: [] } });
  await fixture.invoke({ op: 'composer.history', threadId: 't', action: 'save' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'CURRENT_DRAFT', attachments: [] }, contextReferences: [] } });
  fixture.requestTool('list_draft_history', {}); fixture.releaseTool('list_draft_history', {});
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'list_draft_history')?.state).toBe('done');
  const listed = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'list_draft_history')!;
  const history = JSON.parse(listed.text);
  expect(history.items).toHaveLength(1); expect(history.items[0]).toMatchObject({ textLength: 14, attachments: 0, contextReferences: 0 });
  expect(listed.text).not.toContain('HISTORIC_DRAFT');
  fixture.requestTool('get_draft_state', {}); fixture.releaseTool('get_draft_state', {});
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'get_draft_state')?.state).toBe('done');
  const state = JSON.parse((await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'get_draft_state')!.text);
  fixture.requestTool('restore_draft_history', { snapshotId: history.items[0].id, revision: state.revision }); fixture.releaseTool('restore_draft_history', { snapshotId: history.items[0].id, revision: state.revision });
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'restore_draft_history')?.state).toBe('done');
  const restored = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'restore_draft_history')!;
  expect(restored.state, restored.text).toBe('done'); expect(JSON.parse(restored.text)).toMatchObject({ version: 1, status: expect.stringMatching(/^(restored|already_present)$/), snapshotId: history.items[0].id, textLength: 14 });
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('HISTORIC_DRAFT');
  fixture.release(); await idle();
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('restore_draft_history');
});

test('preflight_draft reports current draft readiness without changing it', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'KEEP_PREFLIGHT_DRAFT', attachments: [] }, contextReferences: [] } });
  fixture.requestTool('preflight_draft', {}); await send('PREFLIGHT_DRAFT'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'preflight_draft')!;
  expect(item.state, item.text).toBe('done');
  const result = JSON.parse(item.text);
  expect(result).toMatchObject({ version: 1, valid: true, issues: [], estimatedTokens: 10, images: 0, textLength: 20, attachments: 0, contextReferences: 0 });
  expect(result.contextWindow).toBeGreaterThan(0);
  expect(item.text).not.toContain('KEEP_PREFLIGHT_DRAFT');
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('KEEP_PREFLIGHT_DRAFT');
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('preflight_draft');
});

test('get_draft_state returns a stable content-free revision', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'KEEP_DRAFT_STATE', attachments: [] }, contextReferences: [] } });
  fixture.requestTool('get_draft_state', {}); await send('DRAFT_STATE_ONE'); await idle();
  const firstItem = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'get_draft_state')!;
  expect(firstItem.state, firstItem.text).toBe('done');
  const first = JSON.parse(firstItem.text);
  expect(first).toMatchObject({ version: 1, hasText: true, textLength: 16, attachments: 0, contextReferences: 0 });
  expect(first.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(firstItem.text).not.toContain('KEEP_DRAFT_STATE');
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'CHANGED_DRAFT_STATE', attachments: [] } } });
  fixture.requestTool('get_draft_state', {}); await send('DRAFT_STATE_TWO'); await idle();
  const items = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.filter(item => item.toolName === 'get_draft_state');
  expect(items).toHaveLength(2);
  const second = JSON.parse(items[1].text);
  expect(second.revision).not.toBe(first.revision);
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('get_draft_state');
});

test('list_queued_messages exposes bounded queue metadata without changing the queue', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  fixture.requestTool('list_queued_messages', {}); await send('LIST_QUEUE_INITIAL'); await idle();
  const initial = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'list_queued_messages')!;
  expect(initial.state, initial.text).toBe('done');
  expect(JSON.parse(initial.text)).toMatchObject({ version: 1, messages: [], total: 0, limited: false, revision: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect((await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.queue ?? []).toEqual([]);
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('list_queued_messages');
});

test('manage_queued_message edits a current queue entry with revision control', async () => {
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'ACTIVE_QUEUE_EDIT', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'pending original', attachments: [], queue: 'followUp' });
  const queued = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.queue![0];
  fixture.releaseTool('manage_queued_message', { id: queued.id, revision: queued.revision ?? 0, change: 'edit', text: 'pending edited' });
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.queue?.[0]?.text).toBe('pending edited');
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'manage_queued_message')!;
  expect(item.state, item.text).toBe('done');
  expect(JSON.parse(item.text)).toMatchObject({ version: 1, status: 'changed', id: queued.id, change: 'edit', total: 1, queue: [{ id: queued.id, revision: 1, kind: 'followUp', preview: 'pending edited' }] });
  fixture.release(); await idle();
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('manage_queued_message');
});

test('clear_queued_messages rejects a stale queue revision after processing starts', async () => {
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'ACTIVE_QUEUE_CLEAR', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'queued one', attachments: [], queue: 'followUp' });
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'queued two', attachments: [], queue: 'steer' });
  const current = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!;
  const revision = harnessQueueRevision(current.queue ?? []);
  expect(revision).toMatch(/^[a-f0-9]{64}$/);
  fixture.requestTool('clear_queued_messages', { revision });
  fixture.releaseTool('clear_queued_messages', { revision });
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'clear_queued_messages')?.state).toBe('error');
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'clear_queued_messages')!;
  expect(item.text).toContain('排队消息已变化');
  expect((await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.queue ?? []).toEqual([]);
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text ?? '').toContain('queued one');
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text ?? '').toContain('queued two');
  fixture.release(); await idle();
  expect(fixture.calls.at(-1)?.tools?.map(tool => tool.function.name)).toContain('clear_queued_messages');
});

test('child asks and receives a parent answer through real worker IPC without user intervention', async () => {
  fixture.holdFor('PARENT_QUESTION_FLOW');
  fixture.requestScopedTool('ask_parent', { question: 'Which entry should I inspect?', timeoutMs: 30000 }, 'CHILD_QUESTION_FLOW');
  await delegate('PARENT_QUESTION_FLOW', 'CHILD_QUESTION_FLOW');
  await expect.poll(async () => (await task())?.questions?.[0]?.status, { timeout: 30000 }).toBe('pending');
  const record = await task(), question = record.questions![0];
  expect(record.status).toBe('running'); expect((await fixture.snapshot()).approvals).toHaveLength(0);
  const childCall = fixture.calls.find(call => call.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('CHILD_QUESTION_FLOW')))!;
  expect(childCall.tools?.map(tool => tool.function.name)).toContain('ask_parent');
  expect(childCall.tools?.map(tool => tool.function.name)).not.toContain('manage_subtasks');
  expect(childCall.tools?.map(tool => tool.function.name)).not.toContain('open_in_pi');
  expect(childCall.tools?.map(tool => tool.function.name)).not.toContain('read_terminal');
  expect(childCall.tools?.map(tool => tool.function.name)).not.toContain('manage_operations');
  fixture.requestScopedTool('manage_subtasks', { action: 'subtasks.reply', id: record.id, questionId: question.id, answer: 'INSPECT_README_ONLY' }, 'PARENT_QUESTION_FLOW');
  fixture.release();
  await expect.poll(async () => (await task()).status, { timeout: 30000 }).toBe('succeeded'); await idle();
  expect((await task()).questions?.[0]).toMatchObject({ status: 'answered', answer: 'INSPECT_README_ONLY' });
  expect(fixture.calls.some(call => call.messages.some(message => message.role === 'tool' && JSON.stringify(message.content).includes('INSPECT_README_ONLY')))).toBe(true);
  expect((await fixture.snapshot()).data.threads.filter(thread => thread.subtaskId).every(thread => thread.policy === 'deny')).toBe(true);
  const process = fixture.page.locator('[data-disclosure="process:' + record.parentItemId + '"]');
  await process.locator(':scope > .disclosure-header > button').click();
  await fixture.page.locator('.turn-subagents').getByRole('button', { name: /协作检查/ }).click();
  await fixture.page.locator('.subagent-conversation:not([hidden]) [data-subtask-question] summary').click();
  await expect(fixture.page.locator('.subagent-conversation:not([hidden]) [data-subtask-question]')).toContainText('INSPECT_README_ONLY');
  await expect(fixture.page.locator('.subagent-conversation input, .subagent-conversation textarea')).toHaveCount(0);
  const count = fixture.calls.length; await fixture.restart();
  expect(fixture.calls.length).toBe(count); expect((await task()).questions?.[0]?.answer).toBe('INSPECT_README_ONLY');
});

test('stopping a parent cancels a pending child question and restart cannot replay it', async () => {
  fixture.holdFor('PARENT_STOP_QUESTION');
  fixture.requestScopedTool('ask_parent', { question: 'WAITING_FOR_PARENT', timeoutMs: 120000 }, 'CHILD_STOP_QUESTION');
  await delegate('PARENT_STOP_QUESTION', 'CHILD_STOP_QUESTION');
  await expect.poll(async () => (await task())?.questions?.[0]?.status, { timeout: 30000 }).toBe('pending');
  await fixture.invoke({ op: 'thread.stop', id: 't' });
  await expect.poll(async () => (await task()).status).toBe('cancelled'); await idle();
  expect((await task()).questions?.[0]?.status).toBe('cancelled');
  const count = fixture.calls.length; await fixture.restart();
  expect(fixture.calls.length).toBe(count); expect((await task()).questions?.[0]?.status).toBe('cancelled');
});

test('a parent can cancel a real cursor wait after new delegation is disabled', async () => {
  await fixture.invoke({ op: 'settings.patch', patch: { subtasksEnabled: true } });
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  fixture.requestTool('manage_subtasks', { action: 'subtasks.wait' });
  await send('WAIT_INITIAL_SNAPSHOT'); await idle();
  const initial = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'manage_subtasks')!;
  expect(initial.state, initial.text).toBe('done');
  const snapshot: { cursor: string; tasks: unknown[] } = JSON.parse(initial.text);
  expect(snapshot.cursor).toMatch(/^[a-f0-9]{64}$/); expect(snapshot.tasks).toEqual([]);
  fixture.requestTool('manage_subtasks', { action: 'subtasks.wait', cursor: snapshot.cursor, timeoutMs: 120000 });
  await send('WAIT_FOR_SUBTASK_CHANGE');
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'manage_subtasks')?.state).toBe('running');
  await fixture.invoke({ op: 'settings.patch', patch: { subtasksEnabled: false } });
  await fixture.invoke({ op: 'thread.stop', id: 't' }); await idle();
  expect((await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.filter(item => item.toolName === 'manage_subtasks' && item.state === 'running')).toEqual([]);
});

test('a model opens a scoped file at a code location and preserves drafts and editor buffers', async () => {
  await writeFile(join(fixture.project, 'entry.ts'), 'first\nsecond\nthird\n');
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'UNSENT_VIEW_DRAFT', attachments: [] } } });
  fixture.requestTool('open_in_pi', { kind: 'file', path: 'entry.ts', line: 2, column: 3 });
  await send('OPEN_CODE_LOCATION'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'open_in_pi')!;
  expect(item?.state, item?.text).toBe('done');
  const editor = fixture.page.getByRole('textbox', { name: '文件内容 entry.ts' });
  await expect(editor).toBeVisible(); await expect(editor).toBeFocused();
  expect(await editor.evaluate((node: HTMLTextAreaElement) => node.selectionStart)).toBe(8);
  await editor.fill('UNSAVED_EDITOR_BUFFER');
  fixture.requestTool('open_in_pi', { kind: 'summary' }); await send('SHOW_INDEPENDENT_SUMMARY'); await idle();
  await expect(editor).toHaveValue('UNSAVED_EDITOR_BUFFER');
  const view = (await fixture.snapshot()).data.ui;
  expect(view.summaryOpen).toBe(true); expect(view.reviewOpen).toBe(true);
  expect(view.threads.t.draft?.text).toBe('UNSENT_VIEW_DRAFT');
  expect(view.threads.t.openFiles).toContain('entry.ts');
  await editor.fill('first\nsecond\nthird\n');
  await expect(fixture.page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await fixture.restart();
  await expect(fixture.page.getByRole('textbox', { name: '文件内容 entry.ts' })).toBeVisible();
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('UNSENT_VIEW_DRAFT');
});

test('a model opens a known HTML artifact in the isolated files preview', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'full' });
  fixture.requestScopedTool('write', { path: 'preview.html', content: '<h1>Harness artifact</h1>' }, 'CREATE_KNOWN_ARTIFACT');
  await send('CREATE_KNOWN_ARTIFACT'); await idle();
  expect((await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.artifacts.some(path => path.endsWith('preview.html'))).toBe(true);
  fixture.requestTool('list_artifacts', {}); await send('LIST_KNOWN_ARTIFACTS'); await idle();
  const listing = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'list_artifacts')!;
  expect(listing.state, listing.text).toBe('done'); expect(JSON.parse(listing.text).artifacts).toEqual([{ path: 'preview.html', kind: 'html', state: 'ready', size: 25 }]);
  expect(fixture.calls[fixture.calls.length - 1].tools?.map(tool => tool.function.name)).toContain('list_artifacts');
  fixture.requestTool('open_in_pi', { kind: 'artifact', path: 'preview.html' });
  await send('OPEN_KNOWN_ARTIFACT'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'open_in_pi')!;
  expect(item.state, item.text).toBe('done'); expect(JSON.parse(item.text)).toMatchObject({ status: 'opened', kind: 'artifact', path: 'preview.html' });
  const view = (await fixture.snapshot()).data.ui;
  expect(view.reviewOpen).toBe(true); expect(view.threads.t.reviewTab).toBe('file'); expect(view.threads.t.selectedPath).toBe('preview.html');
  await expect(fixture.page.locator('.artifact-preview')).toBeVisible();
});

test('desktop view tools target the task window without starting reviews or taking over settings', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' });
  const target = fixture.app.windows().find(page => page !== fixture.page)!;
  await fixture.invoke({ op: 'ui.update', ui: (await fixture.snapshot()).data.ui, frame: { view: 'settings', reviewOpen: false } });
  for (const kind of ['review', 'changes', 'files', 'subtasks']) {
    fixture.requestTool('open_in_pi', { kind });
    await target.evaluate(async text => { await window.desktop.invoke({ op: 'thread.send', id: 't', text, attachments: [] }); }, 'SHOW_PANEL_' + kind);
    await idle();
    const opened = await target.evaluate(async () => (await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap).data.ui);
    expect(opened.reviewOpen).toBe(true); expect(opened.threads.t.reviewTab).toBe(kind);
    const main = (await fixture.snapshot()).data;
    expect(main.ui.view).toBe('settings'); expect(main.ui.reviewOpen).toBe(false);
    expect(main.threads.filter(thread => thread.review)).toHaveLength(0); expect(main.subtasks).toHaveLength(0);
  }
  await target.evaluate(async () => { const boot = await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap;
    await window.desktop.invoke({ op: 'ui.update', ui: boot.data.ui, frame: { view: 'settings' } }); });
  fixture.requestTool('open_in_pi', { kind: 'summary' });
  await target.evaluate(async () => { await window.desktop.invoke({ op: 'thread.send', id: 't', text: 'DO_NOT_REPLACE_SETTINGS', attachments: [] }); });
  await idle();
  const last = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'open_in_pi')!;
  expect(JSON.parse(last.text)).toEqual({ status: 'not_opened', reason: 'view_inactive' });
  expect(await target.evaluate(async () => (await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap).data.ui.view)).toBe('settings');
});

test('desktop view tool reveals the existing terminal and browser tabs without creating resources', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  fixture.requestTool('open_in_pi', { kind: 'terminal' }); await send('SHOW_TERMINAL_SURFACE'); await idle();
  let state = (await fixture.snapshot()).data;
  expect(state.ui.reviewOpen).toBe(true); expect(state.ui.threads.t.reviewTab).toBe('terminal'); expect(state.ui.threads.t.terminalOpen).toBe(true);
  await fixture.invoke({ op: 'browser.tab', threadId: 't', action: 'new' });
  const tabId = (await fixture.snapshot()).data.ui.threads.t.activeBrowserTab!;
  fixture.requestTool('open_in_pi', { kind: 'browser', tabId }); await send('SHOW_BROWSER_SURFACE'); await idle();
  state = (await fixture.snapshot()).data;
  expect(state.ui.reviewOpen).toBe(true); expect(state.ui.threads.t.reviewTab).toBe('browser'); expect(state.ui.threads.t.activeBrowserTab).toBe(tabId);
});

test('desktop view tool reveals an existing sidechat without creating a new one', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  const sidechat = await fixture.invoke({ op: 'sidechat.create', threadId: 't' }) as { id: string };
  fixture.requestTool('open_in_pi', { kind: 'sidechat', sidechatId: sidechat.id }); await send('SHOW_SIDECHAT_SURFACE'); await idle();
  const state = (await fixture.snapshot()).data;
  expect(state.ui.reviewOpen).toBe(true); expect(state.ui.threads.t.reviewTab).toBe('sidechat');
  expect(state.ui.threads.t.activePanelTab).toBe('tool:sidechat'); expect(state.ui.threads.t.sidechatId).toBe(sidechat.id);
  expect(state.threads.filter(thread => thread.sidechat?.parentThreadId === 't')).toHaveLength(1);
});

test('focus_in_pi focuses the composer without changing drafts or creating a surface', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'KEEP_FOCUS_DRAFT', attachments: [] } } });
  fixture.requestTool('focus_in_pi', { kind: 'composer' }); await send('FOCUS_COMPOSER'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'focus_in_pi')!;
  expect(item.state, item.text).toBe('done');
  await expect(fixture.page.locator('.composer-input:not([hidden])')).toBeFocused();
  const state = (await fixture.snapshot()).data;
  expect(state.ui.threads.t.draft?.text).toBe('KEEP_FOCUS_DRAFT');
  expect(state.ui.reviewOpen).toBe(false);
  expect(state.ui.threads.t.panelTabs ?? []).toHaveLength(0);
});

test('focus_in_pi focuses a selected message from the current chat', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await send('FOCUS_TARGET_MESSAGE'); await idle();
  const source = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.role === 'user' && item.text === 'FOCUS_TARGET_MESSAGE')!;
  fixture.requestTool('focus_in_pi', { kind: 'message', messageId: source.id }); await send('FOCUS_MESSAGE'); await idle();
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'focus_in_pi')!;
  expect(item.state, item.text).toBe('done');
  await expect(fixture.page.locator('[data-message-id="' + source.id + '"]')).toBeFocused();
});

test('desktop view path errors are recoverable and never open a file outside the project', async () => {
  await writeFile(join(fixture.storage, 'outside.txt'), 'PRIVATE_OUTSIDE_FILE');
  const previous = (await fixture.snapshot()).data.ui.threads.t;
  fixture.requestTool('open_in_pi', { kind: 'file', path: '../outside.txt' });
  await send('REJECT_OUTSIDE_VIEW'); await idle();
  const failed = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.find(item => item.toolName === 'open_in_pi')!;
  expect(failed.state).toBe('error'); expect(failed.text).toContain('路径超出项目目录');
  expect(failed.text).not.toContain('PRIVATE_OUTSIDE_FILE');
  expect((await fixture.snapshot()).data.ui.threads.t?.selectedPath ?? '').toBe(previous?.selectedPath ?? '');
  fixture.requestTool('open_in_pi', { kind: 'file', path: 'README.md' });
  await send('RETRY_VALID_VIEW'); await idle();
  await expect(fixture.page.getByRole('textbox', { name: '文件内容 README.md' })).toBeVisible();
  expect((await fixture.snapshot()).approvals).toHaveLength(0);
});

