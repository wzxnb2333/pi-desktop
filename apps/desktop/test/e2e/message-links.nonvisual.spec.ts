import { taskAction } from './fixtures/task-actions.ts';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

async function answer(markdown: string, id = 't') {
  fixture.setReply(markdown);
  const calls = fixture.calls.length;
  await fixture.invoke({ op: 'thread.send', id, text: '请给出引用链接', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBeGreaterThan(calls);
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === id)?.status).toBe('idle');
}

test('assistant file links support line columns, repeated keyboard navigation, dirty buffers and restart', async () => {
  const file = '中文 文件.txt';
  const rows = Array.from({ length: 60 }, (_, index) => '第' + (index + 1) + '行 内容');
  const content = rows.join('\n');
  await writeFile(join(fixture.project, file), rows.join('\r\n'));
  const absolute = encodeURI(join(fixture.project, file).replaceAll(String.fromCharCode(92), '/'));
  await answer('[绝对定位](<' + absolute + ':25:3>) [相对定位](<中文%20文件.txt#L2C2>) [URI 定位](<' + pathToFileURL(join(fixture.project, file)).href + '#L40>) [说明](README.md)');
  const page = fixture.page;
  const first = page.getByRole('button', { name: '绝对定位', exact: true });
  await first.focus(); await first.press('Enter');
  const editor = page.getByRole('textbox', { name: '文件内容 ' + file, exact: true });
  const offset = rows.slice(0, 24).join('\n').length + 1 + 2;
  await expect(editor).toHaveValue(content);
  await expect(editor).toBeFocused();
  await expect.poll(() => editor.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(offset);
  expect(await editor.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await editor.fill(content + '\n未保存内容');
  await page.getByRole('button', { name: '相对定位', exact: true }).click();
  await expect(editor).toHaveValue(content + '\n未保存内容');
  await expect.poll(() => editor.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(rows[0].length + 2);
  await editor.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(0, 0));
  await page.getByRole('button', { name: '相对定位', exact: true }).click();
  await expect.poll(() => editor.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(rows[0].length + 2);
  await page.getByRole('button', { name: '说明', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文件内容 README.md', exact: true })).toHaveValue('# Acceptance\n');
  await page.getByRole('button', { name: 'URI 定位', exact: true }).click();
  await expect(editor).toHaveValue(content + '\n未保存内容');
  await page.getByRole('button', { name: '保存 *', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  expect(await readFile(join(fixture.project, file), 'utf8')).toContain('\r\n未保存内容');
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: '独立草稿', attachments: [] }, folds: { unrelated: true } } });
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.fileLocation?.line).toBe(40);
  const location = (await fixture.snapshot()).data.ui.threads.t.fileLocation;
  await fixture.restart();
  const restored = fixture.page.getByRole('textbox', { name: '文件内容 ' + file, exact: true });
  await expect(restored).toHaveValue(content + '\n未保存内容');
  await expect.poll(() => restored.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(rows.slice(0, 39).join('\n').length + 1);
  expect((await fixture.snapshot()).data.ui.threads.t.fileLocation).toEqual(location);
  await fixture.page.getByRole('spinbutton', { name: '定位行号' }).fill('999999');
  await fixture.page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(fixture.page.getByRole('spinbutton', { name: '定位行号' })).toHaveValue('61');
});

test('unavailable links are not dead controls and file links retain the main-process path boundary', async () => {
  const outside = join(fixture.storage, 'outside');
  await mkdir(outside); await writeFile(join(outside, 'secret.txt'), 'MUST_NOT_READ');
  await symlink(outside, join(fixture.project, 'escape'), 'junction');
  await writeFile(join(fixture.project, 'binary.bin'), Buffer.from([0, 1, 2]));
  await answer('[脚本](javascript:alert%281%29) [数据](data:text/plain,hello) [越界](../outside/secret.txt) [失效文件](missing.txt#L5) [链接目录](escape/secret.txt#L2) [二进制](binary.bin#L2)');
  const page = fixture.page;
  for (const name of ['脚本', '数据', '越界']) { await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0); await expect(page.locator('.message.assistant').getByText(name, { exact: true })).toBeVisible(); }
  await page.getByRole('button', { name: '失效文件', exact: true }).click();
  await expect(page.locator('.files-workbench [role=alert]')).toBeVisible();
  await expect(page.locator('.file-editor')).toHaveCount(0);
  await page.getByRole('button', { name: '链接目录', exact: true }).click();
  await expect(page.locator('.files-workbench [role=alert]')).toBeVisible();
  await expect(page.getByText('MUST_NOT_READ', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '二进制', exact: true }).click();
  await expect(page.getByText('二进制文件，请在编辑器中打开。')).toBeVisible();
  await expect(page.locator('.file-editor')).toHaveCount(0);
  await expect(page.getByLabel('向 Pi 发送消息')).toBeVisible();
});

test('rapid conversation and summary links append native tabs without replacing the conversation or existing pages', async () => {
  await answer('[网页一](' + fixture.url + '/one) [网页二](' + fixture.url + '/two)');
  const page = fixture.page;
  await page.getByRole('button', { name: '网页一', exact: true }).click();
  await expect(page.getByLabel('预览地址')).toHaveValue(fixture.url + '/one');
  await expect(page.getByLabel('向 Pi 发送消息')).toBeVisible();
  await expect(page.locator('.message.assistant')).toBeVisible();
  await page.getByRole('button', { name: '网页二', exact: true }).evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
  await expect(page.locator('.browser-tabs [role=tab]')).toHaveCount(3);
  await expect(page.getByLabel('预览地址')).toHaveValue(fixture.url + '/two');
  await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible()).length)).toBe(1);
  if (!await page.locator('.task-summary').isVisible()) await page.getByRole('button', { name: '任务摘要', exact: true }).click();
  await page.locator('.task-summary').getByRole('button', { name: fixture.url + '/one', exact: true }).click();
  await expect(page.locator('.browser-tabs [role=tab]')).toHaveCount(4);
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.browserTabs?.filter(tab => tab.url === fixture.url + '/one').length).toBe(2);
  const tabs = (await fixture.snapshot()).data.ui.threads.t.browserTabs!;
  expect(tabs.filter(tab => tab.url === fixture.url + '/one')).toHaveLength(2);
  expect(new Set(tabs.map(tab => tab.id)).size).toBe(4);
  await expect.poll(() => fixture.app.evaluate(async ({ webContents }, url) => {
    const wc = webContents.getAllWebContents().find(item => item.getURL() === url);
    return wc ? wc.executeJavaScript('[typeof window.desktop,typeof require,typeof process]') : null;
  }, fixture.url + '/one')).toEqual(['undefined', 'undefined', 'undefined']);
  await page.getByLabel('隐藏浏览器').click();
  await fixture.restart();
  expect((await fixture.snapshot()).data.ui.threads.t.browserTabs).toHaveLength(4);
  expect(await fixture.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().filter(item => item.getURL().startsWith(url)).length, fixture.url)).toBe(0);
  await taskAction(fixture.page, '浏览器预览');
  await expect(fixture.page.locator('.browser-tabs [role=tab]')).toHaveCount(4);
});

test('file links preserve independent task locations and restore them after task switches', async () => {
  await writeFile(join(fixture.project, 'lines.txt'), 'one\ntwo\nthree\nfour');
  await answer('[第一任务位置](lines.txt:3:2)');
  await fixture.page.getByRole('button', { name: '第一任务位置', exact: true }).click();
  await expect(fixture.page.getByLabel('定位行号')).toHaveValue('3');
  const firstLocation = (await fixture.snapshot()).data.ui.threads.t.fileLocation;
  const other = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  await fixture.page.locator('.thread-main').filter({ hasText: other.title }).click();
  await answer('[第二任务位置](lines.txt#L2)', other.id);
  await fixture.page.getByRole('button', { name: '第二任务位置', exact: true }).click();
  await expect(fixture.page.getByLabel('定位行号')).toHaveValue('2');
  await fixture.page.locator('.thread-main').filter({ hasText: '验收任务' }).click();
  await expect(fixture.page.getByLabel('定位行号')).toHaveValue('3');
  await expect.poll(() => fixture.page.getByLabel('文件内容 lines.txt', { exact: true }).evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(9);
  const ui = (await fixture.snapshot()).data.ui;
  expect(ui.threads.t.fileLocation).toEqual(firstLocation);
  expect(ui.threads[other.id].fileLocation?.line).toBe(2);
});

test('modified link activation keeps external browser and editor actions available without internal tab side effects', async () => {
  await answer('[系统网页](' + fixture.url + '/external) [外部文件](README.md:1)');
  await fixture.app.evaluate(({ shell }) => {
    const state = globalThis as typeof globalThis & { linkActions: string[] };
    state.linkActions = [];
    shell.openExternal = async url => { state.linkActions.push('web:' + url); };
    shell.openPath = async path => { state.linkActions.push('file:' + path); return ''; };
  });
  await fixture.page.getByRole('button', { name: '系统网页', exact: true }).click({ modifiers: ['Control'] });
  await fixture.page.getByRole('button', { name: '外部文件', exact: true }).click({ modifiers: ['Control'] });
  await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { linkActions: string[] }).linkActions)).toEqual(['web:' + fixture.url + '/external', 'file:' + join(fixture.project, 'README.md')]);
  const ui = (await fixture.snapshot()).data.ui.threads.t;
  expect(ui?.browserTabs ?? []).toHaveLength(0);
  expect(ui?.selectedPath ?? '').toBe('');
});
