import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { await fixture.close(); await expect(access(fixture.storage)).rejects.toThrow(); } });
const idle = () => expect.poll(async () => (await fixture.snapshot()).data.threads[0].status, { timeout: 30000 }).toBe('idle');
async function command(text: string, value: string) {
  fixture.requestTool('powershell', { command: value });
  await fixture.invoke({ op: 'thread.send', id: 't', text, attachments: [] });
}

test('independent low-risk approval runs the exact native sandbox command without user approval', async () => {
  const value = "Set-Content -LiteralPath 'review-safe.txt' -Value $env:PI_SANDBOX";
  await command('创建沙箱验收文件', value); await idle();
  expect(await readFile(join(fixture.project, 'review-safe.txt'), 'utf8')).toContain('appcontainer');
  expect((await fixture.snapshot()).approvals).toEqual([]);
  expect(fixture.reviews).toHaveLength(1);
  expect(fixture.reviews[0].tools).toBeUndefined();
  expect(fixture.reviews[0].messages.map(message => message.role)).toEqual(['system', 'user']);
  expect(JSON.parse(String(fixture.reviews[0].messages[1].content))).toMatchObject({ tool: 'powershell', arguments: { command: value }, cwd: fixture.project, userRequest: '创建沙箱验收文件' });
  expect(fixture.errors).toEqual([]);
});

test('independent high-risk verdict asks each time and only manual approval permits deletion', async () => {
  const path = join(fixture.project, 'review-existing.txt'); await writeFile(path, 'preserve');
  fixture.setReview('high');
  // Exercise approval with an exact filesystem call, independently of PowerShell drive handling.
  const value = "[IO.File]::Delete('review-existing.txt')";
  await command('检查删除操作', value);
  const card = fixture.page.getByLabel('待审批操作', { exact: true });
  await expect(card.locator('[data-approval-review=high]')).toContainText('此操作可能删除现有文件。');
  await expect(card.locator('pre')).toContainText(value);
  expect(await readFile(path, 'utf8')).toBe('preserve');
  await card.getByRole('button', { name: '拒绝', exact: true }).click(); await idle();
  expect(await readFile(path, 'utf8')).toBe('preserve');
  await command('再次检查删除操作', value);
  await expect(card).toBeVisible();
  expect(fixture.reviews).toHaveLength(2);
  await card.getByRole('button', { name: '允许这一次', exact: true }).click(); await idle();
  const lastTool = (await fixture.snapshot()).data.threads[0].items.findLast(item => item.role === 'tool');
  expect(lastTool?.state, JSON.stringify(lastTool)).toBe('done');
  await expect(access(path)).rejects.toThrow();
  expect(fixture.errors).toEqual([]);
});

for (const mode of ['uncertain', 'invalid', 'fail'] as const) test('independent review ' + mode + ' falls back to user approval without executing', async () => {
  fixture.setReview(mode);
  await command('写入测试文件', "Set-Content 'review-blocked.txt' 'unexpected'");
  const card = fixture.page.getByLabel('待审批操作', { exact: true });
  await expect(card.locator('[data-approval-review=uncertain]')).toBeVisible();
  await expect(access(join(fixture.project, 'review-blocked.txt'))).rejects.toThrow();
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' }, frame: { locale: 'en-US' } });
  await expect(fixture.page.locator('[data-approval-review]')).toContainText('Independent review could not confirm safety');
  await fixture.page.getByRole('button', { name: 'Deny', exact: true }).click(); await idle();
  await expect(access(join(fixture.project, 'review-blocked.txt'))).rejects.toThrow();
  expect(fixture.errors).toEqual([]);
});

test('independent review can be stopped and late approval cannot execute, then another turn works', async () => {
  fixture.setReview('hold');
  await command('等待独立审查', "Set-Content 'review-cancelled.txt' 'unexpected'");
  await expect.poll(() => fixture.reviews.length).toBe(1);
  const started = Date.now();
  await fixture.invoke({ op: 'thread.stop', id: 't' });
  expect(Date.now() - started).toBeLessThan(10000);
  fixture.releaseReviews();
  await expect(access(join(fixture.project, 'review-cancelled.txt'))).rejects.toThrow();
  expect((await fixture.snapshot()).approvals).toEqual([]);
  fixture.setReview('low');
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].roundSnapshots?.at(-1)?.state).not.toBe('running');
  await idle();
  await command('停止后重新执行', "Set-Content 'review-resumed.txt' 'resumed'"); await idle();
  expect(await readFile(join(fixture.project, 'review-resumed.txt'), 'utf8')).toContain('resumed');
  expect(fixture.errors).toEqual([]);
});

test('independent review timeout requires manual approval and keeps the command unexecuted', async () => {
  fixture.setReview('hold');
  await command('检查超时回退', "Set-Content 'review-timeout.txt' 'unexpected'");
  await expect.poll(() => fixture.reviews.length).toBe(1);
  await expect(fixture.page.locator('[data-approval-review]')).toContainText('独立审查超时，需要你手动批准。', { timeout: 40000 });
  await expect(access(join(fixture.project, 'review-timeout.txt'))).rejects.toThrow();
  await fixture.page.getByRole('button', { name: '拒绝', exact: true }).click(); await idle();
  expect(fixture.errors).toEqual([]);
});
