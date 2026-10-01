import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { SubtaskDefinition } from '../../src/shared/subtasks.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) {
  const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
} });
const definition: SubtaskDefinition = { title: '主代理委派', prompt: 'CHILD_READ_ONLY_INSPECTION', environment: 'local', startPoint: 'HEAD', policy: 'deny', includeContext: true };
const records = async () => (await fixture.snapshot()).data.subtasks;
const enable = () => fixture.invoke({ op: 'settings.patch', patch: { subtasksEnabled: true } });
const send = (text: string) => fixture.invoke({ op: 'thread.send', id: 't', text, attachments: [] });
const idle = () => expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === 't')?.status).toBe('idle');
async function create(patch: Partial<SubtaskDefinition> = {}) {
  const before = (await records()).length;
  const prompt = 'Delegate a bounded inspection to a child agent. ' + crypto.randomUUID();
  fixture.requestScopedTool('manage_subtasks', { action: 'subtasks.create', definition: { ...definition, ...patch } }, prompt);
  await send(prompt);
  await expect.poll(async () => (await records()).length, { timeout: 30000 }).toBe(before + 1);
  return (await records())[before];
}
const settled = (id: string) => expect.poll(async () => (await records()).find(item => item.id === id)?.status, { timeout: 30000 });

test('parent model owns delegation without a per-child dialog; children are observed in right tabs and persist after restart', async () => {
  await send('NO_DELEGATION_ENABLED'); await idle(); expect(fixture.calls[0].tools?.map(item => item.function.name)).not.toContain('manage_subtasks');
  await enable();
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => { throw new Error('UNEXPECTED_DELEGATION_DIALOG'); }; });
  const record = await create(); await settled(record.id).toBe('succeeded'); await idle();
  const data = (await fixture.snapshot()).data, child = data.threads.find(item => item.id === data.subtasks[0].childThreadId)!;
  expect(record.parentItemId).toBeTruthy(); expect(child.policy).toBe('deny');
  const childCall = fixture.calls.find(call => call.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('CHILD_READ_ONLY_INSPECTION')))!;
  expect(childCall.tools?.map(item => item.function.name)).not.toContain('manage_subtasks'); expect(childCall.tools?.map(item => item.function.name)).not.toContain('write');
  await expect(fixture.page.locator('.sidebar').getByText('主代理委派', { exact: true })).toHaveCount(0);
  await fixture.page.getByRole('textbox', { name: '向 Pi 发送消息', exact: true }).fill('保留父任务草稿');
  const process = fixture.page.locator('[data-disclosure="process:' + record.parentItemId + '"]');
  await expect(process.locator(':scope > .disclosure-header > button')).toHaveAttribute('aria-expanded', 'false');
  await process.locator(':scope > .disclosure-header > button').click();
  await expect(process.locator('.subagent-creation')).toHaveText('已创建 主代理委派');
  await fixture.page.locator('.turn-subagents').getByRole('button', { name: /主代理委派/ }).click();
  await expect(fixture.page.locator('.subagent-conversation:not([hidden])')).toContainText('验收回复完成');
  await expect(fixture.page.locator('.subagent-conversation input, .subagent-conversation textarea')).toHaveCount(0);
  const tab = (await fixture.snapshot()).data.ui.threads.t.activePanelTab; expect(tab).toBe('subtask:' + record.id);
  fixture.requestTool('open_in_pi', { kind: 'subtask', subtaskId: record.id }); await send('OPEN_CHILD_SESSION_FROM_HARNESS'); await idle();
  expect((await fixture.snapshot()).data.ui.threads.t.activePanelTab).toBe('subtask:' + record.id);
  const count = fixture.calls.length; await fixture.restart();
  expect(fixture.calls.length).toBe(count); expect((await fixture.snapshot()).data.ui.threads.t.activePanelTab).toBe(tab);
  await expect(fixture.page.getByRole('textbox', { name: '向 Pi 发送消息', exact: true })).toHaveValue('保留父任务草稿');
  await expect(fixture.page.locator('.subagent-conversation:not([hidden])')).toContainText('验收回复完成');
});

test('completed children cannot be edited, resumed, stopped, elevated or opened as normal windows through IPC', async () => {
  await enable(); const record = await create(); await settled(record.id).toBe('succeeded'); await idle(); const child = (await records())[0].childThreadId!;
  await expect(fixture.invoke({ op: 'thread.update', id: child, policy: 'full' })).rejects.toThrow(/主代理/);
  await expect(fixture.invoke({ op: 'thread.send', id: child, text: 'Override instructions', attachments: [] })).rejects.toThrow(/主代理/);
  await expect(fixture.invoke({ op: 'thread.resume', id: child })).rejects.toThrow(/主代理/);
  await expect(fixture.invoke({ op: 'thread.stop', id: child })).rejects.toThrow(/主代理/);
  await expect(fixture.invoke({ op: 'window.open', kind: 'task', threadId: child })).rejects.toThrow(/主代理/);
  await expect(fixture.invoke({ op: 'file.write', threadId: child, path: 'forbidden.txt', version: '', content: 'NO' })).rejects.toThrow(/主代理/);
  await expect(fixture.invoke({ op: 'subtask.create', parentThreadId: 't', requestId: crypto.randomUUID(), definition })).rejects.toThrow(/主代理/);
  await expect(fixture.invoke({ op: 'subtask.stop', parentThreadId: 't', id: record.id })).rejects.toThrow(/主代理/);
  await expect(fixture.invoke({ op: 'subtask.deliver', parentThreadId: 't', id: record.id })).rejects.toThrow(/主代理/);
  await expect(fixture.invoke({ op: 'automation.save', automation: { id: 'child-injection', name: 'Cannot redirect a child', projectId: 'p', targetThreadId: child, prompt: 'Overwrite its instructions', enabled: true, nextRunAt: Date.now() + 60000, intervalMinutes: 60 } })).rejects.toThrow(/不可用/);
  fixture.requestTool('manage_subtasks', { action: 'subtasks.read', id: record.id }); await send('Read the delegated result'); await idle();
  expect(JSON.stringify(fixture.calls.at(-1)?.messages)).toContain('验收回复完成');
});

test('a real independent Worktree edits through its own policy and an ask child still needs dangerous-operation approval', async () => {
  await enable(); await fixture.invoke({ op: 'thread.update', id: 't', policy: 'full' });
  fixture.requestScopedTool('write', { path: 'child-only.txt', content: 'ISOLATED_CHILD_CHANGE' }, 'CHILD_WORKTREE_WRITE');
  const record = await create({ environment: 'worktree', policy: 'ask', startPoint: 'main', prompt: 'CHILD_WORKTREE_WRITE' });
  await expect.poll(async () => (await fixture.snapshot()).approvals.length).toBe(1);
  const state = await fixture.snapshot(), child = state.data.threads.find(item => item.id === state.data.subtasks[0].childThreadId)!;
  expect(child.cwd).not.toBe(fixture.project); expect(child.policy).toBe('ask');
  await expect(access(join(child.cwd, 'child-only.txt'))).rejects.toThrow();
  await expect(fixture.page.getByRole('region', { name: '任务摘要', exact: true }).getByText(/等待确认/)).toBeVisible();
  await fixture.invoke({ op: 'approval.reply', id: state.approvals[0].id, approved: true });
  await settled(record.id).toBe('succeeded'); await idle();
  expect(await readFile(join(child.cwd, 'child-only.txt'), 'utf8')).toBe('ISOLATED_CHILD_CHANGE'); await expect(access(join(fixture.project, 'child-only.txt'))).rejects.toThrow();
});

test('closing observation tabs does not stop children; stopping the parent cancels them and restart does not replay', async () => {
  await enable(); fixture.setMode('hold'); const record = await create(); await settled(record.id).toBe('running');
  await fixture.page.locator('.turn-subagents').getByRole('button', { name: /主代理委派/ }).click();
  await fixture.page.getByRole('tab', { name: '主代理委派', exact: true }).hover();
  await fixture.page.getByRole('button', { name: '关闭 主代理委派', exact: true }).click(); expect((await records())[0].status).toBe('running');
  await fixture.invoke({ op: 'thread.stop', id: 't' }); await settled(record.id).toBe('cancelled'); await idle();
  const count = fixture.calls.length; await fixture.restart(); expect(fixture.calls.length).toBe(count); expect((await records())[0].status).toBe('cancelled');
});

test('model-owned child stop and restart recovery retain ownership without permitting UI intervention', async () => {
  await enable(); fixture.holdFor(definition.prompt); const record = await create(); await settled(record.id).toBe('running'); await idle();
  fixture.requestScopedTool('manage_subtasks', { action: 'subtasks.stop', id: record.id }, 'Finish ownership inspection'); await send('Finish ownership inspection');
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.items.filter(item => item.role === 'tool').at(-1)?.args).toContain('subtasks.stop');
  await idle();
  const stopTool = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.items.filter(item => item.role === 'tool').at(-1);
  expect(stopTool?.args).toContain('subtasks.stop'); expect(stopTool?.state, stopTool?.text).not.toBe('error');
  await settled(record.id).toBe('cancelled');
  const interrupted = await create(); await settled(interrupted.id).toBe('running'); await idle();
  await expect.poll(async () => { const state = (await fixture.snapshot()).data; const childId = state.subtasks.find(record => record.id === interrupted.id)?.childThreadId; return state.threads.find(thread => thread.id === childId)?.items.some(item => item.role === 'assistant' && item.text.includes('验收流式内容')); }).toBe(true);
  const count = fixture.calls.length;
  await fixture.restart(); expect(fixture.calls.length).toBe(count); expect((await records()).find(item => item.id === interrupted.id)?.status).toBe('interrupted');
});

test('parent permission reductions cancel active child work and preserve bounded permissions', async () => {
  await enable(); fixture.holdFor(definition.prompt); const record = await create(); await settled(record.id).toBe('running'); await idle();
  // The parent may finish its turn first. Reducing its policy must still cancel active children.
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await settled(record.id).toBe('cancelled');
  fixture.setMode('reply'); fixture.requestTool('manage_subtasks', { action: 'subtasks.create', definition: { ...definition, environment: 'worktree', policy: 'auto' } }); await send('Try to exceed the parent policy'); await idle();
  expect(await records()).toHaveLength(1); expect(JSON.stringify(fixture.calls.at(-1)?.messages)).toContain('权限');
});

test('failed durable delegation leaves no dispatchable record and retry works after storage recovers', async () => {
  await enable(); fixture.setMode('hold'); await send('Wait to delegate until explicitly continued'); await expect.poll(() => fixture.calls.length).toBe(1);
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try {
    fixture.releaseTool('manage_subtasks', { action: 'subtasks.create', definition });
    await expect.poll(() => fixture.calls.length).toBeGreaterThan(1);
    expect(await records()).toHaveLength(0);
  } finally { await rm(blocked, { recursive: true, force: true }); fixture.release(); }
  await idle(); const record = await create(); await settled(record.id).toBe('succeeded');
});
