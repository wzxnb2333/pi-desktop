import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Automation, AutomationRun } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });
async function runs() { return (await fixture.snapshot()).data.automationRuns; }
async function save(patch: Partial<Automation> = {}) {
  const job: Automation = { id: crypto.randomUUID(), name: '唤醒验收', projectId: 'p', targetThreadId: 't', prompt: 'WAKE_PROMPT', intervalMinutes: 60, enabled: false, nextRunAt: 0, ...patch };
  await fixture.invoke({ op: 'automation.save', automation: job }); return (await fixture.snapshot()).data.automations.find(item => item.id === job.id)!;
}
async function send(text: string) { await fixture.invoke({ op: 'thread.send', id: 't', text, attachments: [] }); }

test('existing-chat wakeups queue once and use isolated model permissions while keeping drafts', async () => {
  const snapshot = await fixture.snapshot(); await fixture.invoke({ op: 'settings.patch', patch: { models: [...snapshot.data.settings.models, { ...snapshot.data.settings.models[0], id: 'alternate', name: '备用模型', model: 'alternate-model' }] } });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: '保留的未发送草稿', attachments: [] } } });
  await fixture.page.getByRole('button', { name: '自动化', exact: true }).click(); await fixture.page.getByRole('button', { name: '新建自动化', exact: true }).click();
  await fixture.page.getByLabel('名称', { exact: true }).fill('已有聊天唤醒'); await fixture.page.getByLabel('执行位置').selectOption('thread'); await fixture.page.getByLabel('目标聊天').selectOption('t');
  await fixture.page.getByLabel('运行模型').selectOption('alternate');
  expect(await fixture.page.getByLabel('运行权限').locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['', 'ask', 'auto', 'full']);
  await fixture.page.getByLabel('运行权限').selectOption('ask'); await fixture.page.getByLabel('任务描述', { exact: true }).fill('SCHEDULED_ORIGINAL');
  await fixture.page.getByRole('button', { name: '创建自动化', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.automations.length).toBe(1); const job = (await fixture.snapshot()).data.automations[0];
  expect(job.execution?.policy).toBe('ask');
  // Read-only is an internal ceiling, not a fourth public mode. Exercise saved read-only configuration through IPC.
  await fixture.invoke({ op: 'automation.save', base: job, automation: { ...job, execution: { ...job.execution!, policy: 'deny' } } });
  fixture.setMode('hold'); await send('NORMAL_FIRST'); await expect.poll(() => fixture.calls.length).toBe(1);
  const first = await fixture.invoke({ op: 'automation.run', id: job.id }) as AutomationRun;
  const duplicate = await fixture.invoke({ op: 'automation.run', id: job.id }) as AutomationRun; expect(duplicate.id).toBe(first.id); expect((await runs())[0].status).toBe('queued');
  await fixture.invoke({ op: 'automation.save', automation: { ...job, prompt: 'FUTURE_ONLY', execution: { modelId: 'local', policy: 'auto', environment: 'local', startPoint: 'HEAD' } } });
  fixture.requestTool('write', { path: 'forbidden-automation.txt', content: 'must not appear' }); fixture.release();
  await expect.poll(async () => (await runs())[0].status).toBe('succeeded');
  expect(fixture.calls[0].model).toBe('acceptance'); expect(fixture.calls.slice(1).every(call => call.model === 'alternate-model')).toBe(true);
  expect(JSON.stringify(fixture.calls[1].messages)).toContain('SCHEDULED_ORIGINAL'); expect(JSON.stringify(fixture.calls[1].messages)).not.toContain('FUTURE_ONLY');
  await expect(access(join(fixture.project, 'forbidden-automation.txt'))).rejects.toThrow();
  const after = await fixture.snapshot(); expect(after.data.threads).toHaveLength(1); expect(after.data.threads[0]).toMatchObject({ modelId: 'local', policy: 'auto' }); expect(after.data.ui.threads.t.draft?.text).toBe('保留的未发送草稿');
  const before = fixture.calls.length; await send('NORMAL_AFTER'); await expect.poll(() => fixture.calls.length).toBe(before + 1); expect(fixture.calls.at(-1)?.model).toBe('acceptance');
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle'); await fixture.restart(); expect((await runs())[0]).toMatchObject({ id: first.id, status: 'succeeded', threadId: 't' });
  await fixture.page.getByRole('button', { name: '运行历史', exact: true }).click(); await expect(fixture.page.getByText('运行成功', { exact: true })).toBeVisible();
});

test('queued wakeups survive restart and uncertain in-flight work is not repeated', async () => {
  const job = await save(); fixture.setMode('hold'); await send('NORMAL_HELD'); await expect.poll(() => fixture.calls.length).toBe(1);
  await fixture.invoke({ op: 'automation.run', id: job.id }); expect((await runs())[0].status).toBe('queued');
  await fixture.restart(); await expect.poll(() => fixture.calls.length).toBe(2); expect((await runs())[0].status).toBe('running');
  await fixture.restart(); expect((await runs())[0].status).toBe('interrupted'); expect(fixture.calls.length).toBe(2);
  await fixture.invoke({ op: 'automation.run', id: job.id }); await expect.poll(() => fixture.calls.length).toBe(3);
  const current = (await runs()).at(-1)!; await fixture.invoke({ op: 'automation.cancel', runId: current.id }); expect((await runs()).at(-1)?.status).toBe('cancelled');
  expect((await runs()).filter(run => run.status === 'interrupted')).toHaveLength(1);
  fixture.setMode('reply'); await fixture.invoke({ op: 'automation.run', id: job.id }); await expect.poll(async () => (await runs()).at(-1)?.status).toBe('succeeded'); expect(fixture.calls.length).toBe(4);
  await fixture.invoke({ op: 'automation.remove', id: job.id }); expect((await runs()).length).toBe(3); await fixture.restart(); expect((await runs()).length).toBe(3); expect((await fixture.snapshot()).data.automations).toHaveLength(0);
});

test('worktree automation waits for real initialization and keeps failure recovery records', async () => {
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await fixture.invoke({ op: 'project.environment', projectId: 'p', base: { shell: 'powershell', initialization: '', cleanup: '', actions: [] }, environment: { shell: 'powershell', initialization: "Start-Sleep -Milliseconds 600; Set-Content -LiteralPath init.txt -Value ready", cleanup: '', actions: [] } });
  const job = await save({ targetThreadId: undefined, execution: { environment: 'worktree', startPoint: 'main', policy: 'auto', modelId: 'local' } });
  fixture.requestTool('read', { path: 'init.txt' }); await fixture.invoke({ op: 'automation.run', id: job.id }); await expect.poll(async () => (await runs())[0].status, { timeout: 45000 }).toBe('succeeded');
  const record = (await runs())[0], thread = (await fixture.snapshot()).data.threads.find(item => item.id === record.threadId)!;
  expect(thread.cwd).not.toBe(fixture.project); expect(thread.worktreeBranch).toBeTruthy(); expect(await readFile(join(thread.cwd, 'init.txt'), 'utf8')).toContain('ready');
  expect(JSON.stringify(fixture.calls.at(-1)?.messages)).toContain('ready'); await expect(access(join(fixture.project, 'init.txt'))).rejects.toThrow();
  expect((await fixture.snapshot()).data.operations.find(item => item.threadId === thread.id && item.kind === 'environment.initialization')?.status).toBe('succeeded');
  await fixture.invoke({ op: 'automation.save', automation: { ...job, execution: { ...job.execution!, startPoint: 'missing-ref' } } });
  await fixture.invoke({ op: 'automation.run', id: job.id }); await expect.poll(async () => (await runs()).at(-1)?.status).toBe('failed'); expect((await runs()).at(-1)?.error).toBeTruthy();
  await fixture.restart(); expect((await runs())[0].threadId).toBe(thread.id); expect((await runs()).at(-1)?.status).toBe('failed');
});

test('agent automation tools use the real scheduler and enforce current task permissions', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'ask' });
  const configuration = { name: '工具计划', prompt: 'TOOL_WAKE', destination: 'current', intervalMinutes: 60, enabled: false };
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
  fixture.requestTool('manage_automations', { action: 'automations.save', configuration }); await send('Create the requested schedule');
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle'); expect((await fixture.snapshot()).data.automations).toHaveLength(0);
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  fixture.requestTool('manage_automations', { action: 'automations.save', configuration }); await send('Confirm the requested schedule');
  await expect.poll(async () => (await fixture.snapshot()).data.automations.length).toBe(1); await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  const job = (await fixture.snapshot()).data.automations[0]; expect(job.targetThreadId).toBe('t'); expect(job.execution?.policy).toBe('ask');
  fixture.requestTool('manage_automations', { action: 'automations.run', id: job.id }); await send('Run the saved schedule');
  await expect.poll(async () => (await runs())[0]?.status).toBe('succeeded'); expect((await runs())[0].threadId).toBe('t');
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' }); fixture.requestTool('manage_automations', { action: 'automations.remove', id: job.id }); await send('Read-only cannot remove');
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle'); expect((await fixture.snapshot()).data.automations).toHaveLength(1);
  fixture.requestTool('manage_automations', { action: 'automations.list' }); await send('List saved schedules'); await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect(JSON.stringify(fixture.calls.at(-1)?.messages)).toContain('工具计划');
});

test('real timer coalesces missed occurrences and the bilingual editor preserves its layout and draft', async () => {
  const job = await save({ enabled: true, intervalMinutes: 1 });
  await fixture.app.evaluate(() => { const now = Date.now; Date.now = () => now() + 8 * 60000; });
  await expect.poll(async () => (await runs())[0]?.status, { timeout: 20000 }).toBe('succeeded');
  expect(await runs()).toHaveLength(1); expect(fixture.calls).toHaveLength(1);
  expect((await fixture.snapshot()).data.automations[0].nextRunAt).toBeGreaterThan(Date.now() + 8 * 60000);
  await fixture.invoke({ op: 'automation.save', automation: { ...job, enabled: false } });
  await fixture.restart();
  await fixture.page.getByRole('button', { name: /^自动化/ }).click();
  await fixture.page.getByRole('button', { name: '编辑', exact: true }).click();
  await fixture.page.getByLabel('任务描述', { exact: true }).fill('保留自动化草稿');
  const editor = fixture.page.locator('#automation-editor');
  for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'] as const) for (const size of [[1440, 940], [1000, 700], [1280, 800]]) {
    const snapshot = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...snapshot.data.ui, locale } });
    await fixture.invoke({ op: 'settings.patch', patch: { theme } });
    await fixture.app.evaluate(({ BrowserWindow }, dimensions) => BrowserWindow.getAllWindows()[0].setContentSize(dimensions[0], dimensions[1]), size);
    await expect.poll(() => editor.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
  }
  await expect(editor.locator('textarea')).toHaveValue('保留自动化草稿');
  await editor.getByRole('button', { name: 'Save automation', exact: true }).click();
  await fixture.restart(); expect((await fixture.snapshot()).data.automations[0].prompt).toBe('保留自动化草稿');
  expect(fixture.calls).toHaveLength(1);
});

test('automation editor conflicts are enforced by the serialized IPC service and survive restart', async () => {
  const base = await save();
  await fixture.page.getByRole('button', { name: '自动化', exact: true }).click();
  await fixture.page.getByRole('button', { name: '编辑', exact: true }).click();
  await fixture.page.getByLabel('任务描述', { exact: true }).fill('保留本窗口草稿');
  await fixture.invoke({ op: 'automation.save', base, automation: { ...base, prompt: '另一入口的新配置' } });
  await expect(fixture.page.getByRole('alert')).toContainText('当前草稿已保留');
  await expect(fixture.page.getByLabel('任务描述', { exact: true })).toHaveValue('保留本窗口草稿');
  await expect(fixture.page.getByRole('button', { name: '保存自动化', exact: true })).toBeDisabled();
  await fixture.page.getByRole('button', { name: '加载最新自动化', exact: true }).click();
  await fixture.page.getByRole('dialog').getByRole('button', { name: '加载最新自动化', exact: true }).click();
  await fixture.page.getByLabel('任务描述', { exact: true }).fill('确认最新配置后保存');
  await fixture.page.getByRole('button', { name: '保存自动化', exact: true }).click();
  await expect(fixture.page.locator('#automation-editor')).toHaveCount(0);
  await fixture.restart();
  const current = (await fixture.snapshot()).data.automations[0]; expect(current.prompt).toBe('确认最新配置后保存');
  const edits = await Promise.allSettled([
    fixture.invoke({ op: 'automation.save', base: current, automation: { ...current, prompt: '并发编辑 A' } }),
    fixture.invoke({ op: 'automation.save', base: current, automation: { ...current, prompt: '并发编辑 B' } }),
  ]);
  expect(edits.filter(item => item.status === 'fulfilled')).toHaveLength(1); expect(edits.filter(item => item.status === 'rejected')).toHaveLength(1);
  await expect(fixture.invoke({ op: 'automation.remove', id: current.id, base: current })).rejects.toThrow(/自动化已被修改或删除/);
  const winner = (await fixture.snapshot()).data.automations[0];
  await fixture.invoke({ op: 'automation.remove', id: winner.id, base: winner });
  await expect(fixture.invoke({ op: 'automation.save', base: winner, automation: { ...winner, prompt: '不可复活旧计划' } })).rejects.toThrow(/自动化已被修改或删除/);
  await fixture.restart(); expect((await fixture.snapshot()).data.automations).toHaveLength(0); expect(fixture.calls).toHaveLength(0);
});

test('atomic automation queue retries never start a failed occurrence or leak it through other settings', async () => {
  const job = await save(), blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try { await expect(fixture.invoke({ op: 'automation.run', id: job.id })).rejects.toThrow(); expect(await runs()).toHaveLength(0); expect(fixture.calls).toHaveLength(0); }
  finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark' } });
  expect(JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')).automationRuns).toHaveLength(0);
  fixture.setMode('hold');
  const results = await Promise.all([fixture.invoke({ op: 'automation.run', id: job.id }), fixture.invoke({ op: 'automation.run', id: job.id })]) as AutomationRun[];
  expect(results[0].id).toBe(results[1].id); await expect.poll(() => fixture.calls.length).toBe(1); expect(await runs()).toHaveLength(1);
  const active = (await runs())[0]; expect(active.status).toBe('running');
  expect(JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')).automationRuns[0].status).toBe('running');
  fixture.release(); await expect.poll(async () => (await runs())[0].status).toBe('succeeded'); await fixture.restart(); expect((await runs())[0].id).toBe(active.id); expect((await runs())[0].status).toBe('succeeded'); expect(fixture.calls).toHaveLength(1);
});

test('automation completion storage failure keeps an interrupted record and permits a deliberate retry', async () => {
  const job = await save(); fixture.setMode('hold'); await fixture.invoke({ op: 'automation.run', id: job.id }); await expect.poll(() => fixture.calls.length).toBe(1);
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try { fixture.release(); await expect.poll(async () => (await runs())[0].status).toBe('interrupted'); expect(fixture.calls).toHaveLength(1); }
  finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark' } }); await fixture.restart(); expect((await runs())[0].status).toBe('interrupted'); expect(fixture.calls).toHaveLength(1);
  await fixture.page.getByRole('button', { name: /^自动化/ }).click(); await fixture.page.getByRole('button', { name: '运行历史', exact: true }).click();
  await expect(fixture.page.getByText('自动化保存失败，请检查存储后主动重试', { exact: true })).toBeVisible();
  await fixture.invoke({ op: 'automation.run', id: job.id }); await expect.poll(async () => (await runs()).at(-1)?.status).toBe('succeeded');
  expect(await runs()).toHaveLength(2); expect((await runs())[0].status).toBe('interrupted'); expect(fixture.calls).toHaveLength(2);
  await fixture.restart(); expect(await runs()).toHaveLength(2);
});
