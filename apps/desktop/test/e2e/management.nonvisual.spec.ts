import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Automation } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); expect(errors).toEqual([]); } });

async function create(id: string) {
  await fixture.invoke({ op: 'automation.save', automation: { id, name: id, projectId: 'p', prompt: 'ORIGINAL_PROMPT_' + id, intervalMinutes: 60, enabled: false, nextRunAt: 0, lastRunAt: 123, lastThreadId: 'untrusted' } });
  return (await fixture.snapshot()).data.automations.find(job => job.id === id)!;
}
async function run(job: Automation, status = 'idle') {
  const previousId = job.lastThreadId;
  await fixture.invoke({ op: 'automation.run', id: job.id });
  await expect.poll(async () => (await fixture.snapshot()).data.automations.find(item => item.id === job.id)?.lastThreadId).toBeTruthy();
  if (previousId) await expect.poll(async () => (await fixture.snapshot()).data.automations.find(item => item.id === job.id)?.lastThreadId).not.toBe(previousId);
  const id = (await fixture.snapshot()).data.automations.find(item => item.id === job.id)!.lastThreadId!;
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === id)?.status).toBe(status);
  return id;
}

test('automation edits preserve authoritative runtime history across an active run and restart', async () => {
  const job = await create('状态验收');
  expect(job.lastThreadId).toBeUndefined(); expect(job.lastRunAt).toBeUndefined(); expect(job.nextRunAt).toBeGreaterThan(Date.now());
  fixture.setMode('hold');
  await fixture.invoke({ op: 'automation.run', id: job.id });
  await fixture.invoke({ op: 'automation.save', automation: { ...job, name: '更新计划', prompt: 'NEXT_PROMPT', lastThreadId: 'stale' } });
  await expect.poll(() => fixture.calls.length).toBe(1);
  const current = (await fixture.snapshot()).data.automations[0];
  expect(current.lastThreadId).not.toBe('stale');
  expect(current.lastThreadId).toBeTruthy();
  expect(JSON.stringify(fixture.calls[0].messages)).toContain('ORIGINAL_PROMPT_状态验收');
  expect(JSON.stringify(fixture.calls[0].messages)).not.toContain('NEXT_PROMPT');
  await fixture.invoke({ op: 'automation.save', automation: { ...job, name: '再次编辑', prompt: 'NEXT_PROMPT', nextRunAt: 1 } });
  expect((await fixture.snapshot()).data.automations[0]).toMatchObject({ lastThreadId: current.lastThreadId, lastRunAt: current.lastRunAt, nextRunAt: current.nextRunAt });
  await fixture.invoke({ op: 'automation.run', id: job.id });
  expect((await fixture.snapshot()).data.threads.filter(thread => thread.automationId === job.id)).toHaveLength(1);
  fixture.release();
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === current.lastThreadId)?.status).toBe('idle');
  await fixture.restart();
  expect((await fixture.snapshot()).data.automations[0]).toMatchObject({ name: '再次编辑', lastThreadId: current.lastThreadId, lastRunAt: current.lastRunAt, nextRunAt: current.nextRunAt });
  const newId = await run((await fixture.snapshot()).data.automations[0]);
  expect(newId).not.toBe(current.lastThreadId);
  expect(JSON.stringify(fixture.calls.at(-1)?.messages)).toContain('NEXT_PROMPT');
});

test('review actions reject active and approval-waiting tasks and new results return to pending', async () => {
  const extension = join(fixture.project, 'review-approval.mjs');
  await writeFile(extension, 'export default function(pi) { pi.on("session_start", async (_event, ctx) => { await ctx.ui.confirm("审阅保护确认", "确认后开始运行"); }); }');
  const settings = (await fixture.snapshot()).data.settings;
  await fixture.invoke({ op: 'settings.save', settings: { ...settings, resources: [{ id: 'review', name: 'review', kind: 'extension', path: extension, enabled: true }] } });
  const job = await create('审阅保护');
  fixture.setMode('hold');
  const id = await run(job, 'waiting');
  await expect(fixture.invoke({ op: 'thread.update', id, reviewed: true })).rejects.toThrow(/不能标记已审阅/);
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, activeThreadId: id, view: 'thread' } });
  await fixture.page.getByLabel('待审批操作').getByRole('button', { name: '允许这一次' }).click();
  await expect.poll(() => fixture.calls.length).toBe(1);
  await expect(fixture.invoke({ op: 'thread.update', id, reviewed: true })).rejects.toThrow(/不能标记已审阅/);
  fixture.release();
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === id)?.status).toBe('idle');
  await fixture.invoke({ op: 'thread.update', id, reviewed: true });
  fixture.setMode('hold');
  const followup = fixture.invoke({ op: 'thread.send', id, text: '继续检查', attachments: [] });
  // Automation overrides use a separate worker snapshot; the normal run loads extensions again.
  await expect(fixture.page.getByLabel('待审批操作')).toBeVisible();
  await fixture.page.getByLabel('待审批操作').getByRole('button', { name: '允许这一次' }).click();
  await followup;
  await expect.poll(() => fixture.calls.length).toBe(2);
  expect((await fixture.snapshot()).data.threads.find(item => item.id === id)?.reviewed).toBe(false);
  await fixture.invoke({ op: 'thread.stop', id });
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === id)?.status).toBe('idle');
  await fixture.invoke({ op: 'thread.update', id, deletedAt: Date.now() });
  await expect(fixture.invoke({ op: 'thread.update', id, reviewed: true })).rejects.toThrow(/回收站/);
});

test('inbox batch review persists, retries failed jobs and preserves results after deleting a schedule', async () => {
  const first = await run(await create('第一份结果'));
  const second = await run(await create('第二份结果'));
  await fixture.page.getByRole('button', { name: /^待审阅/ }).click();
  await fixture.page.getByRole('button', { name: '全选可审阅任务' }).click();
  await fixture.page.getByRole('button', { name: '批量标记已审阅' }).click();
  await expect(fixture.page.getByRole('status')).toHaveText('已标记 2 个任务');
  await fixture.restart();
  const data = (await fixture.snapshot()).data;
  expect(data.threads.filter(thread => [first, second].includes(thread.id)).every(thread => thread.reviewed)).toBe(true);
  await fixture.page.getByRole('group', { name: '审阅状态筛选' }).getByRole('button', { name: '已审阅', exact: true }).click();
  await expect(fixture.page.getByLabel('选择 自动化 · 第一份结果', { exact: true })).toBeDisabled();
  const failed = await create('失败后恢复');
  fixture.setMode('fail');
  const failedId = await run(failed, 'error');
  await fixture.page.getByRole('group', { name: '审阅状态筛选' }).getByRole('button', { name: '失败', exact: true }).click();
  fixture.setMode('reply');
  await fixture.page.getByRole('button', { name: '失败重试', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.automations.find(job => job.id === failed.id)?.lastThreadId).not.toBe(failedId);
  const recoveredId = (await fixture.snapshot()).data.automations.find(job => job.id === failed.id)!.lastThreadId!;
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === recoveredId)?.status).toBe('idle');
  await fixture.invoke({ op: 'automation.remove', id: failed.id });
  await expect(fixture.page.getByRole('button', { name: '失败重试', exact: true })).toBeDisabled();
  await expect(fixture.page.getByRole('button', { name: '失败重试', exact: true })).toHaveAttribute('title', /自动化已删除/);
  await fixture.page.getByRole('button', { name: '查看结果', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.ui.activeThreadId).toBe(failedId);
  expect((await fixture.snapshot()).data.threads.some(thread => thread.id === recoveredId)).toBe(true);
});
