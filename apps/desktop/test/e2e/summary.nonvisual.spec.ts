import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); expect(errors).toEqual([]); } });

async function send(text: string) {
  const before = fixture.calls.length;
  await fixture.invoke({ op: 'thread.send', id: 't', text, attachments: [] });
  await expect.poll(() => fixture.calls.length).toBeGreaterThan(before);
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.status).toBe('idle');
}

async function expandSummary() {
  const summary = fixture.page.getByRole('region', { name: '任务摘要', exact: true });
  if (!await summary.isVisible()) await fixture.page.getByRole('button', { name: '任务摘要', exact: true }).click();
  const expand = summary.getByRole('button', { name: '查看全部', exact: true });
  if (await expand.isVisible()) await expand.click();
}

test('summary navigates real round plans and restores the chosen fold and reading anchor after restart', async () => {
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  fixture.setReply('用于验证阅读定位的真实回复。\n\n'.repeat(30));
  fixture.requestTool('update_plan', { steps: [{ text: '旧轮次计划', status: 'completed' }] });
  await send('建立旧轮次');
  const steps = Array.from({ length: 16 }, (_, index) => ({ text: '本轮真实步骤 ' + (index + 1), status: index < 3 ? 'completed' : index === 3 ? 'in_progress' : 'pending' }));
  fixture.requestTool('update_plan', { steps });
  await send('建立当前轮次');
  const owner = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.role === 'user')!.id;
  await send('无新计划的后续轮次');
  await expandSummary();
  await expect(fixture.page.getByRole('region', { name: '任务计划', exact: true })).toContainText('本轮真实步骤 10');
  await expect(fixture.page.getByRole('region', { name: '任务计划', exact: true })).not.toContainText('旧轮次计划');
  await fixture.page.getByRole('button', { name: /^定位计划步骤 10：/ }).click();
  const target = fixture.page.locator('[data-plan-step="9"]').filter({ hasText: '本轮真实步骤 10' });
  await expect(target).toBeFocused();
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.folds?.['plan:' + owner]).toBe(true);
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.scroll?.follow).toBe(false);
  const saved = (await fixture.snapshot()).data.ui.threads.t.scroll!;
  const top = await fixture.page.locator('.timeline').evaluate(element => element.scrollTop);
  await fixture.page.reload();
  await expect(fixture.page.locator('[data-plan-step="9"]').filter({ hasText: '本轮真实步骤 10' })).toBeVisible();
  await expect.poll(() => fixture.page.locator('.timeline').evaluate(element => element.scrollTop)).toBeCloseTo(top, 0);
  await fixture.restart();
  await expect.poll(() => fixture.page.locator('.timeline').evaluate(element => element.scrollTop)).toBeCloseTo(top, 0);
  expect((await fixture.snapshot()).data.ui.threads.t.scroll).toEqual(saved);
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 640));
  await expect(fixture.page.locator('.conversation-layout')).toHaveClass(/summary-overlay/);
  await fixture.page.getByRole('button', { name: /^定位计划步骤 4：/ }).click();
  await expect(fixture.page.locator('[data-plan-step="3"]').filter({ hasText: '本轮真实步骤 4' })).toBeFocused();
  await expect(fixture.page.getByLabel('任务辅助栏')).toHaveCount(0);
  expect((await fixture.snapshot()).data.ui.reviewWidth).toBeGreaterThan(0);
});

test('summary approval opens the actual control and completed edits refresh real changes and artifacts', async () => {
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'ask' });
  fixture.requestTool('edit', { path: 'README.md', oldText: '# Acceptance', newText: '# Summary approved' });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '从摘要确认修改', attachments: [] });
  await expect.poll(async () => {
    const snapshot = await fixture.snapshot(), thread = snapshot.data.threads.find(item => item.id === 't');
    return { approvals: snapshot.approvals.length, calls: fixture.calls.length, status: thread?.status, error: thread?.error, tools: thread?.items.filter(item => item.role === 'tool') };
  }).toMatchObject({ approvals: 1 });
  await expandSummary();
  const waiting = fixture.page.getByRole('region', { name: '待处理审批', exact: true });
  await waiting.getByRole('button').click();
  const approval = fixture.page.getByLabel('待审批操作', { exact: true });
  await expect(approval).toBeFocused();
  await fixture.page.keyboard.press('Tab');
  await expect(approval.getByRole('button', { name: '拒绝', exact: true })).toBeFocused();
  await fixture.page.keyboard.press('Tab');
  await fixture.page.keyboard.press('Enter');
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.status).toBe('idle');
  await expect(waiting).toHaveCount(0);
  const summary = fixture.page.getByRole('region', { name: '任务摘要', exact: true });
  await expect(summary.getByRole('region', { name: '项目文件变更', exact: true })).toContainText('README.md');
  expect(await readFile(join(fixture.project, 'README.md'), 'utf8')).toBe('# Summary approved\n');
  await summary.getByRole('region', { name: '项目文件变更', exact: true }).getByRole('button', { name: /README.md/ }).click();
  await expect(fixture.page.getByRole('tab', { name: /^变更/ })).toHaveAttribute('aria-selected', 'true');
  await expect(fixture.page.getByRole('region', { name: 'Git 工作台', exact: true })).toContainText('+# Summary approved');
  await expandSummary();
  await expect(summary.getByRole('region', { name: '任务产物', exact: true })).toContainText('README.md');
  await summary.getByRole('region', { name: '任务产物', exact: true }).getByRole('button', { name: /README.md/ }).click();
  const editor = fixture.page.getByRole('textbox', { name: '文件内容 README.md', exact: true });
  await expect(editor).toHaveValue('# Summary approved\n');
  await expect(fixture.page.getByRole('tablist', { name: '打开的文件', exact: true }).getByRole('tab')).toHaveCount(1);
  await editor.fill('# Summary approved\n未保存缓冲');
  await expandSummary();
  await summary.getByRole('region', { name: '任务产物', exact: true }).getByRole('button', { name: /README.md/ }).click();
  await expect(editor).toHaveValue('# Summary approved\n未保存缓冲');
  await expect(editor).toBeFocused();
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'auto' });
  const special = '结果#v1%说明.txt';
  fixture.requestTool('write', { path: special, content: '真实产物内容' });
  await send('创建含特殊字符的产物');
  await expandSummary();
  await summary.getByRole('region', { name: '任务产物', exact: true }).getByRole('button', { name: new RegExp(special.replace('.', '\\.')) }).click();
  await expect(fixture.page.getByRole('textbox', { name: '文件内容 ' + special, exact: true })).toHaveValue('真实产物内容');
  await expect(fixture.page.getByRole('tablist', { name: '打开的文件', exact: true }).getByRole('tab')).toHaveCount(2);
  await fixture.page.getByRole('tablist', { name: '打开的文件', exact: true }).getByRole('tab', { name: 'README.md *', exact: true }).click();
  await expect(editor).toHaveValue('# Summary approved\n未保存缓冲');
  await editor.fill('# Summary approved\n');
  await expect(fixture.page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
});
