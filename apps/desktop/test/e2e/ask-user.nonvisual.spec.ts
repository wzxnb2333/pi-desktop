import { access } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

/**
 * The model asks the user with one-click options without being in plan mode. The question travels through the
 * ordinary approval card, so the answer comes back as this call's tool result and never as an invented one.
 */
let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) {
  const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
} });
const send = (text: string) => fixture.invoke({ op: 'thread.send', id: 't', text, attachments: [] });
const idle = () => expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === 't')?.status).toBe('idle');
const lastReply = async () => (await fixture.snapshot()).data.threads.find(item => item.id === 't')?.items.filter(item => item.role === 'tool').at(-1)?.text ?? '';

test('outside plan mode the model offers options and the chosen one comes back as the tool result', async () => {
  const thread = (await fixture.snapshot()).data.threads.find(item => item.id === 't')!;
  expect(thread.planMode ?? false).toBe(false);
  fixture.requestTool('ask_user', { question: '这次用哪个方案？', options: ['方案 A', '方案 B'] });
  await send('不确定时先问用户');
  const card = fixture.page.getByLabel('待审批操作');
  await expect(card).toContainText('这次用哪个方案？');
  await expect(card).toContainText('方案 A');
  await fixture.page.getByLabel('选择回复').click();
  await fixture.page.locator('.menu-item[data-value="方案 B"]').click();
  await fixture.page.getByRole('button', { name: '允许这一次' }).click();
  await idle();
  expect(await lastReply()).toContain('方案 B');
});

test('without options the card asks for a typed answer and returns it verbatim', async () => {
  fixture.requestTool('ask_user', { question: '项目名称叫什么？' });
  await send('问一下命名');
  const card = fixture.page.getByLabel('待审批操作');
  await expect(card).toContainText('项目名称叫什么？');
  await fixture.page.getByLabel('回复内容').fill('验收项目');
  await fixture.page.getByRole('button', { name: '允许这一次' }).click();
  await idle();
  expect(await lastReply()).toContain('验收项目');
});

test('a declined question tells the model the user did not answer', async () => {
  fixture.requestTool('ask_user', { question: '要不要重写整个模块？', options: ['重写', '只改这一处'] });
  await send('问一下改造范围');
  await expect(fixture.page.getByLabel('待审批操作')).toContainText('要不要重写整个模块？');
  await fixture.page.getByRole('button', { name: '拒绝', exact: true }).click();
  await idle();
  const reply = await lastReply();
  expect(reply).toContain('did not answer');
  expect(reply).not.toContain('重写');
});

test('a value outside the offered options is rejected by the approval reply itself', async () => {
  fixture.requestTool('ask_user', { question: '选哪个？', options: ['甲', '乙'] });
  await send('问一下选项');
  await expect(fixture.page.getByLabel('待审批操作')).toBeVisible();
  const approval = (await fixture.snapshot()).approvals[0];
  await expect(fixture.invoke({ op: 'approval.reply', id: approval.id, approved: true, value: '丙' })).rejects.toThrow(/有效选项/);
  await fixture.invoke({ op: 'approval.reply', id: approval.id, approved: true, value: '乙' });
  await idle();
  expect(await lastReply()).toContain('乙');
});

test('plan mode still offers the question tool', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', planMode: true });
  await send('先探查再决定'); await idle();
  expect(fixture.calls.at(-1)?.tools?.map(item => item.function.name)).toContain('ask_user');
  await fixture.invoke({ op: 'thread.update', id: 't', planMode: false });
});