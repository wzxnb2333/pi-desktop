import { access } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

/**
 * Native coverage for the model-facing desktop surface (H-40…H-67). Every case drives the real worker and
 * the real main process: a queued tool call runs through IPC, and the assertions read the persisted desktop
 * state, not a mock. The three boundaries that matter most are checked here: another chat's content is
 * readable but its unsent draft is not, a cross-session message waits for the user under the ask policy, and
 * the settings writer refuses the permission plane.
 */

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) {
  const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
} });

const thread = async (id: string) => (await fixture.snapshot()).data.threads.find(item => item.id === id)!;
const toolItem = async (name: string, index = 0) => (await fixture.snapshot()).data.threads.find(item => item.id === 't')!.items.filter(item => item.toolName === name)[index]!;
const turn = async (text: string) => {
  await fixture.invoke({ op: 'thread.send', id: 't', text, attachments: [] });
  await expect.poll(async () => (await thread('t')).status, { timeout: 20000 }).toBe('idle');
};
const idleThread = (id: string) => expect.poll(async () => (await thread(id)).status, { timeout: 20000 }).toBe('idle');

/** A second chat with real content plus an unsent draft the model must never see. */
async function siblingChat(title: string, message: string) {
  const projectId = (await fixture.snapshot()).data.projects[0].id;
  const created = await fixture.invoke({ op: 'thread.create', projectId, worktree: false }) as { id: string };
  await fixture.invoke({ op: 'thread.update', id: created.id, title });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: created.id, patch: { draft: { text: 'SIBLING_DRAFT_SENTINEL', attachments: [] } } });
  await fixture.invoke({ op: 'thread.send', id: created.id, text: message, attachments: [] });
  await idleThread(created.id);
  return created.id;
}

test('read_sessions lists and reads another chat through real IPC, and never its unsent draft', async () => {
  const sibling = await siblingChat('第二条任务', '另一个会话里在讨论计费逻辑');
  fixture.requestTool('read_sessions', { action: 'sessions.list' });
  await turn('列出工作区里的会话');
  const list = await toolItem('read_sessions');
  expect(list.state, list.text).toBe('done');
  expect(list.text).toContain(sibling);
  expect(list.text).toContain('第二条任务');
  expect(list.text).not.toContain('SIBLING_DRAFT_SENTINEL');

  fixture.requestTool('read_sessions', { action: 'sessions.read', threadId: sibling });
  await turn('读一下那个会话');
  const read = await toolItem('read_sessions', 1);
  expect(read.state, read.text).toBe('done');
  expect(read.text).toContain('另一个会话里在讨论计费逻辑');
  expect(read.text).not.toContain('SIBLING_DRAFT_SENTINEL');
  // The reading chat's own timeline is untouched by the tool, and no approval was needed for a read.
  expect((await fixture.snapshot()).approvals).toHaveLength(0);
  expect((await thread('t')).items.some(item => item.role === 'user' && item.text === '另一个会话里在讨论计费逻辑')).toBe(false);
});

test('sending into another chat waits for the user under the ask policy, and lands after approval', async () => {
  const sibling = await siblingChat('目标会话', '这里先有一条消息');
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'ask' });
  fixture.requestTool('send_to_session', { action: 'sessions.send', threadId: sibling, text: '来自另一个会话的消息', queue: 'followUp' });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '把结论发过去', attachments: [] });
  await expect.poll(async () => (await fixture.snapshot()).approvals.length, { timeout: 20000 }).toBe(1);
  const approval = (await fixture.snapshot()).approvals[0];
  expect(approval.tool).toBe('send_to_session');
  expect(approval.description).toContain('目标会话');
  // Nothing was delivered before the user answered.
  expect((await thread(sibling)).items.some(item => item.text === '来自另一个会话的消息')).toBe(false);

  await fixture.invoke({ op: 'approval.reply', id: approval.id, approved: true });
  await expect.poll(async () => (await thread(sibling)).items.some(item => item.text === '来自另一个会话的消息'), { timeout: 20000 }).toBe(true);
  await idleThread(sibling);
  expect((await fixture.snapshot()).approvals).toHaveLength(0);
});

test('settings.apply refuses the permission plane and still applies a whitelisted preference', async () => {
  const before = (await fixture.snapshot()).data.settings.policy;
  fixture.requestTool('manage_settings', { action: 'settings.apply', patch: { policy: 'full' } });
  await turn('把权限提高一点');
  const refused = await toolItem('manage_settings');
  expect(refused.state, refused.text).toBe('error');
  // The permission plane is not offered in the tool schema at all, so the harness refuses the arguments.\r\n  expect(refused.text).toMatch(/Validation failed for tool .manage_settings.|不允许修改 policy/);
  // Neither the default policy nor this chat's policy moved, and no approval was consumed by the attempt.
  expect((await fixture.snapshot()).data.settings.policy).toBe(before);
  expect((await thread('t')).policy).toBe('auto');
  expect((await fixture.snapshot()).approvals).toHaveLength(0);

  fixture.requestTool('manage_settings', { action: 'settings.apply', patch: { policy: 'full', theme: 'dark' } });
  await turn('顺便换个主题');
  const mixed = await toolItem('manage_settings', 1);
  expect(mixed.state, mixed.text).toBe('error');
  expect((await fixture.snapshot()).data.settings.theme).toBe('light');

  fixture.requestTool('manage_settings', { action: 'settings.apply', patch: { theme: 'dark' } });
  await turn('只换主题');
  const applied = await toolItem('manage_settings', 2);
  expect(applied.state, applied.text).toBe('done');
  expect((await fixture.snapshot()).data.settings.theme).toBe('dark');
});

test('manage_ui moves the workbench through the same view state the user sees', async () => {
  expect((await fixture.snapshot()).data.ui.summaryOpen ?? false).toBe(false);
  fixture.requestTool('manage_ui', { action: 'ui.summary', open: true });
  await turn('打开任务摘要');
  expect((await fixture.snapshot()).data.ui.summaryOpen).toBe(true);

  fixture.requestTool('manage_ui', { action: 'ui.openPanel', panel: 'files' });
  await turn('打开文件面板');
  const state = await fixture.snapshot();
  expect(state.data.ui.reviewOpen).toBe(true);
  expect(state.data.ui.threads['t']?.reviewTab).toBe('files');
  expect(state.data.ui.threads['t']?.panelTabs?.some((tab: { kind: string }) => tab.kind === 'files')).toBe(true);
  // View state only: no draft, message or approval churn.
  expect(state.approvals).toHaveLength(0);
});
