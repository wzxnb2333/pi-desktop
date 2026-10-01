import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Thread } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); expect(errors).toEqual([]); } });
async function send(text: string) {
  const count = fixture.calls.length;
  await fixture.invoke({ op: 'thread.send', id: 't', text, attachments: [] });
  await expect.poll(() => fixture.calls.length).toBeGreaterThan(count);
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.status).toBe('idle');
}
async function search(query: string) {
  await fixture.page.keyboard.press('Control+f');
  const input = fixture.page.getByRole('combobox', { name: '当前对话查找' });
  await expect(input).toBeFocused();
  await input.fill(query);
  return input;
}

for (const reduced of [false, true]) test('conversation search reveals nested output, exact occurrences and thinking with reduced motion=' + reduced, async () => {
  const page = fixture.page;
  await fixture.app.evaluate(({ BrowserWindow }, reduced) => BrowserWindow.getAllWindows()[0].setSize(reduced ? 1000 : 1280, reduced ? 640 : 800), reduced);
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference', colorScheme: reduced ? 'dark' : 'light' });
  if (reduced) { const data = (await fixture.snapshot()).data; await fixture.invoke({ op: 'settings.save', settings: { ...data.settings, theme: 'system' } }); }
  await writeFile(join(fixture.project, 'README.md'), '首个 Needle_TOKEN\n' + '普通输出行\n'.repeat(90) + '最后 Needle_TOKEN\n');
  fixture.setReasoning(true);
  fixture.requestTool('read', { path: 'README.md' });
  await send('读取现有文件');
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { folds: { 'unrelated:choice': false } } });
  const process = page.locator('[data-disclosure^="process:"] > .disclosure-header > button');
  await expect(process).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.tool-output')).toHaveCount(0);
  const input = await search('needle_token');
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(2);
  await expect(page.getByRole('status').filter({ hasText: '共 2 处' })).toBeVisible();
  await input.press('ArrowDown');
  await expect(page.getByRole('dialog').getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  const output = page.locator('.tool-output[data-search-active]');
  await expect(output).toBeFocused();
  await expect(process).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => page.evaluate(() => { const range = CSS.highlights.get('conversation-find')?.values().next().value; return range instanceof Range ? { text: range.toString(), offset: range.startOffset } : null; })).toEqual({ text: 'Needle_TOKEN', offset: ('首个 Needle_TOKEN\n' + '普通输出行\n'.repeat(90) + '最后 ').length });
  const visible = await output.evaluate(element => {
    const range = CSS.highlights.get('conversation-find')!.values().next().value as Range;
    const rect = range.getBoundingClientRect();
    const timeline = document.querySelector('.timeline')!.getBoundingClientRect();
    const output = element.getBoundingClientRect();
    return rect.top >= Math.max(timeline.top, output.top) - 0.5 && rect.bottom <= Math.min(timeline.bottom, output.bottom) + 0.5;
  });
  expect(visible).toBe(true);
  const folds = (await fixture.snapshot()).data.ui.threads.t.folds;
  expect(folds['unrelated:choice']).toBe(false);
  expect(Object.keys(folds).filter(key => key.startsWith('raw:')).every(key => folds[key])).toBe(true);
  await fixture.restart();
  expect((await fixture.snapshot()).data.ui.threads.t.folds).toEqual(folds);
  await search('先读取实际文件');
  await fixture.page.getByRole('dialog').getByRole('option').first().click();
  await expect(fixture.page.locator('.thinking-preview[data-search-active]')).toBeFocused();
  const argsInput = await search('README.md');
  await expect(fixture.page.getByRole('dialog').getByRole('option')).toHaveCount(1);
  await argsInput.press('Enter');
  await expect(fixture.page.locator('.tool-args[data-search-active]')).toBeFocused();
});

test('search keyboard selection respects composition, empty results, literal queries and focus restoration', async () => {
  await send('检查 [a+b].* 与中文输入');
  const page = fixture.page;
  const composer = page.getByLabel('向 Pi 发送消息');
  await composer.focus();
  const input = await search('   ');
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(0);
  await input.press('Enter');
  await expect(page.getByRole('dialog', { name: '查找当前对话' })).toBeVisible();
  await input.fill('没有这样的结果');
  await expect(page.getByText('没有匹配结果')).toBeVisible();
  await input.fill('[a+b].*');
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1);
  for (const key of ['ArrowDown', 'Enter', 'Escape']) await input.dispatchEvent('keydown', { key, isComposing: true, bubbles: true });
  await expect(input).toBeFocused();
  await expect(page.getByRole('dialog').getByRole('option')).toHaveAttribute('aria-selected', 'true');
  await input.press('Escape');
  await expect(composer).toBeFocused();
  const next = await search('[a+b].*');
  await next.press('Enter');
  await expect(page.locator('.message.user .markdown[data-search-active]')).toBeFocused();
  const settings = (await fixture.snapshot()).data.settings;
  await fixture.invoke({ op: 'settings.save', settings: { ...settings, theme: 'dark' } });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => { const range = CSS.highlights.get('conversation-find')?.values().next().value; return range instanceof Range ? range.toString() : ''; })).toBe('[a+b].*');
});

test('edit differences can be found and opened without expanding raw arguments', async () => {
  fixture.requestTool('edit', { path: 'README.md', oldText: '# Acceptance', newText: '# Searchable_Diff' });
  await send('更新文档');
  const input = await search('Searchable_Diff');
  const diff = fixture.page.getByRole('dialog').getByRole('option').filter({ hasText: '· 差异' });
  await expect(diff).toHaveCount(1);
  await diff.click();
  await expect(fixture.page.locator('.activity-diff-lines[data-search-active]')).toBeFocused();
  const raw = fixture.page.locator('[data-disclosure^="raw:"] > .disclosure-header > button');
  await expect(raw).toHaveAttribute('aria-expanded', 'false');
  expect(await input.count()).toBe(0);
});

test('command palette navigates tasks, honors custom shortcuts and skips deleted closed tabs', async () => {
  const page = fixture.page;
  await fixture.invoke({ op: 'thread.update', id: 't', title: 'LOGIN Feature' });
  const other = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  await fixture.invoke({ op: 'thread.update', id: other.id, title: 'Second Task', deletedAt: Date.now() });
  const state = (await fixture.snapshot()).data;
  await fixture.invoke({ op: 'ui.update', ui: { ...state.ui, openThreads: [], closedThreads: ['t', other.id, 'missing'], activeThreadId: '' } });
  await page.getByLabel('文件菜单', { exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '重新打开任务', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.task-tabs [role=tab]')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+t');
  // Reopening uses the existing shortcut; navigation stays in the sidebar.
  await expect(page.locator('.thread-row.selected')).toContainText('LOGIN Feature');
  const reopened = (await fixture.snapshot()).data.ui;
  expect(reopened.closedThreads).toEqual([]);
  expect(reopened.openThreads).toEqual(['t']);
  expect(reopened.activeThreadId).toBe('t');
  await page.keyboard.press('Control+Shift+p');
  const command = page.getByRole('combobox', { name: '搜索命令或最近任务' });
  await expect(command).toBeFocused();
  const chats = page.getByRole('group', { name: '聊天记录', exact: true });
  const actions = page.getByRole('group', { name: '快捷操作', exact: true });
  await expect(chats.getByRole('option')).toHaveCount(1);
  await expect(chats.getByRole('option')).toContainText('LOGIN Feature');
  await expect(chats.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  await command.press('ArrowDown');
  await expect(actions.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await command.press('ArrowUp');
  await expect(chats.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('dialog').getByRole('option', { name: '隐藏浏览器' })).toHaveCount(0);
  await command.fill('login');
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1);
  await command.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.thread-row.selected')).toContainText('LOGIN Feature');
  await fixture.invoke({ op: 'settings.save', settings: { ...state.settings, shortcuts: { searchThreads: 'Ctrl+Alt+K', newThread: 'Ctrl+Alt+N' } } });
  // IPC persistence precedes the coalesced renderer state broadcast; wait for the real binding.
  await expect(page.locator('.new-thread .row-hint')).toHaveText('Ctrl Alt N');
  await page.keyboard.press('Control+,');
  await expect(page.locator('.settings-page')).toBeVisible();
  await page.keyboard.press('Control+Alt+k');
  const searchField = page.getByRole('combobox', { name: '搜索命令或最近任务', exact: true });
  await expect(searchField).toBeFocused();
  await searchField.fill('login');
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1);
  await searchField.press('Escape');
  await expect(page.locator('.settings-page')).toBeVisible();
  await page.keyboard.press('Control+Alt+k');
  await expect(searchField).toBeFocused();
  await expect(page.locator('.sidebar-search, [data-search-threads]')).toHaveCount(0);
  await fixture.restart();
  await fixture.page.keyboard.press('Control+Alt+k');
  await expect(fixture.page.getByRole('combobox', { name: '搜索命令或最近任务', exact: true })).toBeFocused();
});

test('unified task search finds collapsed project chats without changing sidebar preferences', async () => {
  fixture.setReasoning(true);
  await send('正常任务');
  await fixture.invoke({ op: 'thread.update', id: 't', title: 'COLLAPSED_CHAT' });
  const state = (await fixture.snapshot()).data;
  await fixture.invoke({ op: 'ui.update', ui: { ...state.ui, collapsedProjects: ['p'] } });
  const page = fixture.page;
  await expect(page.locator('.thread-main')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: '搜索命令或最近任务', exact: true });
  await input.fill('COLLAPSED_CHAT');
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1);
  await expect(page.locator('.thread-main')).toHaveCount(0);
  expect((await fixture.snapshot()).data.ui.collapsedProjects).toEqual(['p']);
  await input.press('Escape');
  await expect(page.locator('.thread-main')).toHaveCount(0);
});

test('large search results remain reachable through pages and keep global occurrence indexes', async () => {
  await send('PageNeedle '.repeat(205));
  const page = fixture.page;
  const input = await search('PageNeedle');
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(200);
  await page.getByRole('button', { name: '下一页结果' }).click();
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(5);
  await expect(page.getByRole('status').filter({ hasText: '共 205 处，显示 201–205' })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一页结果' })).toBeDisabled();
  await input.focus();
  await input.press('ArrowUp');
  await input.press('Enter');
  await expect(page.locator('.message.user .markdown[data-search-active]')).toBeFocused();
  await fixture.invoke({ op: 'thread.update', id: 't', pinned: true });
  await expect(page.locator('.thread-main').getByTitle('已置顶')).toBeVisible();
  expect(await page.evaluate(() => { const range = CSS.highlights.get('conversation-find')?.values().next().value; return range instanceof Range ? range.startOffset : -1; })).toBe('PageNeedle '.length * 204);
});

