import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import type {} from './fixtures/memory-settings-harness.tsx';

let browser: Browser, page: Page, url: string, errors: string[];
test.setTimeout(30000);
test.beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-memory-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/memory-settings-harness.tsx', import.meta.url))], outfile: join(directory, 'harness.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="harness.css"><script src="harness.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href; browser = await chromium.launch();
});
test.beforeEach(async () => { errors = []; page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.getByRole('button', { name: '新增记忆', exact: true })).toBeVisible(); });
test.afterEach(async () => { await page.close(); expect(errors).toEqual([]); });
test.afterAll(async () => { await browser?.close(); });
test.afterAll(cleanupTemporaryDirectories);

test('memory saves dispatch once, preserve failed drafts and block leaving while writing', async () => {
  await page.getByRole('button', { name: '新增记忆', exact: true }).click();
  await page.getByLabel('记忆内容', { exact: true }).fill('需要保留的草稿');
  await page.evaluate(() => window.__memories.hold('memory.save', true));
  const save = page.getByRole('button', { name: '保存并确认记忆', exact: true });
  await save.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => page.evaluate(() => window.__memories.pending('memory.save').length), { timeout: 2000 }).toBe(1);
  await page.evaluate(() => window.__memories.leave());
  await expect(page.getByRole('alert')).toContainText('正在保存，请完成后再离开。');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__memories.left())).toBe(false);
  await page.evaluate(() => window.__memories.complete(window.__memories.pending('memory.save')[0].id, { error: 'MEMORY_SAVE_FAILED' }));
  await expect(page.getByRole('alert')).toContainText('MEMORY_SAVE_FAILED');
  await expect(page.getByLabel('记忆内容', { exact: true })).toHaveValue('需要保留的草稿');
  await save.click();
  await page.evaluate(() => window.__memories.complete(window.__memories.pending('memory.save')[0].id));
  await expect(page.locator('.memory-editor')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增记忆', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.__memories.snapshot().entries)).toHaveLength(1);
  await page.evaluate(() => window.__memories.leave());
  expect(await page.evaluate(() => window.__memories.left())).toBe(true);
});

test('an acknowledged memory save stays saved when the follow-up list fails and retry is read-only', async () => {
  await page.getByRole('button', { name: '新增记忆', exact: true }).click();
  await page.getByLabel('记忆内容', { exact: true }).fill('只保存一次');
  await page.evaluate(() => window.__memories.hold('memory.list', true));
  await page.getByRole('button', { name: '保存并确认记忆', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__memories.pending('memory.list').length)).toBeGreaterThan(0);
  await page.evaluate(() => { for (const item of window.__memories.pending('memory.list')) window.__memories.complete(item.id, { error: 'LIST_AFTER_SAVE_FAILED' }); });
  await expect(page.locator('.memory-editor')).toHaveCount(0, { timeout: 2000 });
  await expect(page.locator('.memory-entry')).toContainText('只保存一次');
  await expect(page.locator('.memory-settings').getByRole('status')).toContainText('记忆已保存');
  await expect(page.getByRole('alert')).toContainText('LIST_AFTER_SAVE_FAILED');
  const retry = page.getByRole('button', { name: '重试读取记忆', exact: true });
  await retry.focus(); await retry.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__memories.pending('memory.list').length)).toBe(1);
  await page.evaluate(() => window.__memories.complete(window.__memories.pending('memory.list')[0].id));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.__memories.calls().filter(item => item.op === 'memory.save'))).toHaveLength(1);
});

test('memory refresh ignores stale snapshots and failures after a newer revision', async () => {
  await page.goto(url + '?hold-list=1');
  await expect.poll(() => page.evaluate(() => window.__memories.pending('memory.list').length)).toBe(2);
  const old = await page.evaluate(() => window.__memories.pending('memory.list').map(item => item.id));
  await page.evaluate(() => window.__memories.changeSnapshot({ revision: 2, entries: [{ id: crypto.randomUUID(), revision: 2, scope: { kind: 'user' }, text: '最新记忆', status: 'approved', enabled: true, source: { kind: 'manual', messageIds: [], createdAt: 1 }, createdAt: 1, updatedAt: 2 }] }));
  await expect.poll(() => page.evaluate(() => window.__memories.pending('memory.list').length)).toBe(3);
  await page.evaluate(() => window.__memories.complete(window.__memories.pending('memory.list').at(-1)!.id));
  await expect(page.locator('.memory-entry')).toContainText('最新记忆');
  await page.evaluate(ids => { window.__memories.complete(ids[0], { error: 'STALE_MEMORY_READ' }); window.__memories.complete(ids[1], { value: { revision: 0, entries: [] } }); }, old);
  await expect(page.locator('.memory-entry')).toContainText('最新记忆', { timeout: 2000 });
  await expect(page.getByText('STALE_MEMORY_READ', { exact: false })).toHaveCount(0);
});

test('memory generation keeps the active job cancellable when a newer attempt fails', async () => {
  const runningId = await page.evaluate(() => {
    const id = crypto.randomUUID();
    window.__memories.operations([{ id, threadId: 't', directoryId: 'user', kind: 'memory.generate', status: 'running', stage: '正在准备记忆来源', startedAt: 1 }, { id: crypto.randomUUID(), threadId: 't', directoryId: 'user', kind: 'memory.generate', status: 'failed', stage: '提取', startedAt: 2, endedAt: 3, error: 'ALREADY_GENERATING' }]);
    window.__memories.hold('operation.cancel', true); return id;
  });
  const cancel = page.getByRole('button', { name: '取消记忆生成', exact: true });
  await expect(cancel).toBeVisible({ timeout: 2000 });
  await expect(page.getByText('正在准备记忆来源', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__memories.locale('en-US', 'dark')); await expect(page.getByText('Preparing memory sources', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__memories.locale('zh-CN', 'light'));
  await cancel.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => page.evaluate(() => window.__memories.pending('operation.cancel').length)).toBe(1);
  expect(await page.evaluate(() => window.__memories.pending('operation.cancel')[0].request)).toMatchObject({ threadId: 't', requestId: runningId });
  await page.evaluate(() => window.__memories.complete(window.__memories.pending('operation.cancel')[0].id, { error: 'CANCEL_MEMORY_FAILED' }));
  await expect(page.getByRole('alert')).toContainText('CANCEL_MEMORY_FAILED');
  await cancel.click();
  await page.evaluate(() => window.__memories.complete(window.__memories.pending('operation.cancel')[0].id));
  await expect(cancel).toHaveCount(0);
});

test('concurrent memory edits keep the draft until the user accepts the latest version', async () => {
  await page.evaluate(() => window.__memories.changeSnapshot({ revision: 1, entries: [{ id: crypto.randomUUID(), revision: 1, scope: { kind: 'user' }, text: '原始内容', status: 'approved', enabled: true, source: { kind: 'manual', messageIds: [], createdAt: 1 }, createdAt: 1, updatedAt: 1 }] }));
  await page.getByRole('button', { name: '编辑或确认', exact: true }).click();
  await page.getByLabel('记忆内容', { exact: true }).fill('本窗口未保存草稿');
  await page.evaluate(() => { const value = window.__memories.snapshot(); window.__memories.changeSnapshot({ revision: 2, entries: value.entries.map(item => ({ ...item, revision: 2, text: '另一窗口的新内容' })) }); });
  const editor = page.locator('.memory-editor');
  await expect(editor.getByRole('alert')).toContainText('当前草稿已保留');
  await expect(page.getByLabel('记忆内容', { exact: true })).toHaveValue('本窗口未保存草稿');
  await expect(page.getByRole('button', { name: '保存并确认记忆', exact: true })).toBeDisabled();
  await page.evaluate(() => window.__memories.active(false));
  await expect(page.locator('.memory-settings')).toBeHidden();
  await page.evaluate(() => window.__memories.active(true));
  await expect(page.locator('.memory-settings')).toBeVisible();
  await expect(page.getByLabel('记忆内容', { exact: true })).toHaveValue('本窗口未保存草稿');
  const reload = editor.getByRole('button', { name: '加载最新记忆', exact: true });
  await reload.click();
  const dialog = page.getByRole('dialog', { name: '加载最新记忆？', exact: true });
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await dialog.press('Escape');
  await expect(page.getByLabel('记忆内容', { exact: true })).toHaveValue('本窗口未保存草稿');
  await reload.click(); await dialog.getByRole('button', { name: '加载最新记忆', exact: true }).click();
  await expect(page.getByLabel('记忆内容', { exact: true })).toHaveValue('另一窗口的新内容');
  await page.getByLabel('记忆内容', { exact: true }).fill('基于最新内容继续编辑');
  await page.getByRole('button', { name: '保存并确认记忆', exact: true }).click();
  await expect(page.locator('.memory-editor')).toHaveCount(0);
  expect(await page.evaluate(() => window.__memories.calls().filter(item => item.op === 'memory.save'))).toMatchObject([{ revision: 2, text: '基于最新内容继续编辑' }]);
});

test('memory list retry is serialized and hidden-page replies cannot replace the visible state', async () => {
  await page.evaluate(() => window.__memories.hold('memory.list', true));
  const refresh = page.getByRole('button', { name: '刷新', exact: true });
  await refresh.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => page.evaluate(() => window.__memories.pending('memory.list').length)).toBe(1);
  await page.evaluate(() => window.__memories.complete(window.__memories.pending('memory.list')[0].id, { value: null }));
  await expect(page.getByRole('alert')).toHaveText('记忆列表返回的数据格式无效，请重试读取。');
  await page.getByRole('button', { name: '重试读取记忆', exact: true }).click();
  const old = await page.evaluate(() => window.__memories.pending('memory.list')[0].id);
  await page.evaluate(() => window.__memories.active(false));
  await expect(page.locator('.memory-settings')).toBeHidden();
  await page.evaluate(() => window.__memories.active(true));
  await expect(page.locator('.memory-settings')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__memories.pending('memory.list').length)).toBe(2);
  await page.evaluate(() => window.__memories.complete(window.__memories.pending('memory.list').at(-1)!.id));
  await page.evaluate(id => window.__memories.complete(id, { error: 'OLD_HIDDEN_PAGE_FAILURE' }), old);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('没有匹配的记忆', { exact: true })).toBeVisible();
});

test('deleted memories stay removed when refresh fails and old snapshots arrive later', async () => {
  await page.evaluate(() => window.__memories.changeSnapshot({ revision: 1, entries: [{ id: crypto.randomUUID(), revision: 1, scope: { kind: 'user' }, text: '将要删除的记忆', status: 'approved', enabled: true, source: { kind: 'manual', messageIds: [], createdAt: 1 }, createdAt: 1, updatedAt: 1 }] }));
  await expect(page.locator('.memory-entry')).toContainText('将要删除的记忆');
  const old = await page.evaluate(() => { window.__memories.hold('memory.list', true); return window.__memories.snapshot(); });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  const oldRequest = await page.evaluate(() => window.__memories.pending('memory.list')[0].id);
  await page.getByRole('button', { name: '删除这条记忆', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除这条记忆？', exact: true });
  await dialog.getByRole('button', { name: '删除', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__memories.snapshot().entries.length)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__memories.pending('memory.list').length)).toBeGreaterThan(1);
  await page.evaluate(id => { for (const item of window.__memories.pending('memory.list')) if (item.id !== id) window.__memories.complete(item.id, { error: 'LIST_AFTER_DELETE_FAILED' }); }, oldRequest);
  await page.evaluate(({ id, value }) => window.__memories.complete(id, { value }), { id: oldRequest, value: old });
  await expect(page.locator('.memory-entry')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('LIST_AFTER_DELETE_FAILED');
  await page.getByRole('button', { name: '重试读取记忆', exact: true }).click();
  await page.evaluate(() => window.__memories.complete(window.__memories.pending('memory.list')[0].id));
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.__memories.calls().filter(item => item.op === 'memory.delete'))).toHaveLength(1);
});

test('clear confirmation cannot silently include memories added after it opened', async () => {
  await page.evaluate(() => window.__memories.changeSnapshot({ revision: 1, entries: [{ id: crypto.randomUUID(), revision: 1, scope: { kind: 'user' }, text: '原有记忆', status: 'approved', enabled: true, source: { kind: 'manual', messageIds: [], createdAt: 1 }, createdAt: 1, updatedAt: 1 }] }));
  await expect(page.locator('.memory-entry')).toHaveCount(1); await page.getByRole('button', { name: '清除全部记忆', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '清除所有用户与项目记忆？', exact: true });
  await page.evaluate(() => { const before = window.__memories.snapshot(); window.__memories.changeSnapshot({ revision: 2, entries: [...before.entries, { ...before.entries[0], id: crypto.randomUUID(), text: '新加入的记忆' }] }); });
  await expect(page.locator('.memory-entry')).toHaveCount(2);
  await dialog.getByRole('button', { name: '删除', exact: true }).click();
  expect(await page.evaluate(() => window.__memories.snapshot().entries)).toHaveLength(2);
  await expect(dialog.getByRole('alert')).toContainText('记忆已被修改或删除');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '清除全部记忆', exact: true }).click(); await dialog.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.locator('.memory-entry')).toHaveCount(0);
});

test('memory deletion retains its confirmation after failure and retries once with live translations', async () => {
  await page.evaluate(() => window.__memories.changeSnapshot({ revision: 1, entries: [{ id: crypto.randomUUID(), revision: 1, scope: { kind: 'user' }, text: '保留原内容', status: 'approved', enabled: true, source: { kind: 'manual', messageIds: [], createdAt: 1 }, createdAt: 1, updatedAt: 1 }] }));
  await page.getByRole('button', { name: '删除这条记忆', exact: true }).click(); const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.evaluate(() => window.__memories.hold('memory.delete', true));
  await dialog.getByRole('button', { name: '删除', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => window.__memories.pending('memory.delete').length)).toBe(1);
  await expect(dialog).toHaveAttribute('aria-busy', 'true'); await dialog.press('Escape'); await expect(dialog).toBeVisible();
  await page.evaluate(() => window.__memories.complete(window.__memories.pending('memory.delete')[0].id, { error: '记忆保存失败，原状态未改变' }));
  await expect(dialog.getByRole('alert')).toHaveText('记忆保存失败，原状态未改变'); await expect(page.locator('.memory-entry')).toHaveCount(1);
  for (const locale of ['en-US', 'zh-CN'] as const) for (const theme of ['light', 'dark'] as const) for (const [width, height] of [[1000, 700], [1280, 800], [1440, 940]]) {
    await page.setViewportSize({ width, height }); await page.evaluate(({ locale, theme }) => window.__memories.locale(locale, theme), { locale, theme });
    await expect(dialog.getByRole('alert')).toHaveText(locale === 'en-US' ? 'Memory could not be saved. The previous state is unchanged.' : '记忆保存失败，原状态未改变');
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
  }
  await dialog.getByRole('button', { name: '删除', exact: true }).click(); await page.evaluate(() => window.__memories.complete(window.__memories.pending('memory.delete')[0].id));
  await expect(dialog).toHaveCount(0); await expect(page.locator('.memory-entry')).toHaveCount(0);
  expect(await page.evaluate(() => window.__memories.calls().filter(item => item.op === 'memory.delete').length)).toBe(2);
});
