import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Browser, type Page, chromium, expect, test } from '@playwright/test';
import type { Automation, DesktopRequest, Thread } from '../../src/shared/contracts.ts';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';

interface ManagementHarness {
  hold(op: string, enabled: boolean): void;
  pending(): { id: number; request: DesktopRequest }[];
  complete(id: number, error?: string): void;
  changeThread(id: string, patch: Partial<Thread>): void;
  changeAutomation(id: string, patch: Partial<Automation> | null): void;
  locale(value: 'zh-CN' | 'en-US'): void;
  calls(): DesktopRequest[];
}
declare global { interface Window { __management: ManagementHarness; } }

const harness = String.raw`
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { defaultData, projectSchema, threadSchema, bootstrapSchema } from '../../../../shared/contracts.ts';
import { assertAutomationBase } from '../../../../shared/automation-configuration.ts';
import { AppProvider } from '../../state/app.tsx';
import { InboxPage } from './inbox.tsx';
import { AutomationsPage } from './automations.tsx';
import '../../styles/index.css';
const base = defaultData();
const job = { id: 'job', name: '日报', projectId: 'p', prompt: '检查', intervalMinutes: 60, enabled: false, nextRunAt: 9000 };
const thread = (id, status, extra = {}) => threadSchema.parse({ id, title: id, projectId: 'p', cwd: 'C:/project', modelId: '', thinking: 'off', policy: 'auto', createdAt: 1, updatedAt: 2, automationId: 'job', status, ...extra });
let data = { ...base, projects: [projectSchema.parse({ id: 'p', name: '项目', path: 'C:/project', trusted: true, createdAt: 1 })], automations: [job], threads: [thread('completed', 'idle'), thread('failed', 'error'), thread('waiting', 'waiting', { automationId: 'other' }), thread('reviewed', 'idle', { reviewed: true }), thread('deleted', 'idle', { deletedAt: 3 })], ui: { ...base.ui, activeThreadId: 'completed' } };
const listeners = new Set();
const calls = [];
const held = new Set();
const pending = new Map();
let sequence = 0;
const broadcast = () => listeners.forEach(listener => listener({ type: 'state', data }));
const changeThread = (id, patch) => { data = { ...data, threads: data.threads.map(thread => thread.id === id ? { ...thread, ...patch } : thread) }; broadcast(); };
const result = (request) => {
  if (request.op === 'bootstrap') return bootstrapSchema.parse({ data, approvals: [], terminals: [], version: 'management-test' });
  if (request.op === 'thread.update') { changeThread(request.id, { reviewed: request.reviewed }); return data.threads.find(thread => thread.id === request.id); }
  if (request.op === 'automation.save') { const existing = data.automations.find(job => job.id === request.automation.id); assertAutomationBase(existing, request.base); data = { ...data, automations: existing ? data.automations.map(job => job.id === request.automation.id ? request.automation : job) : [...data.automations, request.automation] }; broadcast(); }
  if (request.op === 'automation.remove') { assertAutomationBase(data.automations.find(job => job.id === request.id), request.base); data = { ...data, automations: data.automations.filter(job => job.id !== request.id) }; broadcast(); }
  return null;
};
window.desktop = {
  invoke: async request => { calls.push(request); if (held.has(request.op)) return new Promise((resolve, reject) => pending.set(++sequence, { request, resolve, reject })); return result(request); },
  onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
};
window.__management = {
  hold: (op, enabled) => enabled ? held.add(op) : held.delete(op),
  pending: () => [...pending].map(([id, item]) => ({ id, request: item.request })),
  complete: (id, error) => { const item = pending.get(id); if (!item) throw new Error('Missing pending operation'); pending.delete(id); error ? item.reject(new Error(error)) : item.resolve(result(item.request)); },
  changeThread, calls: () => calls,
  changeAutomation: (id, patch) => { data = { ...data, automations: patch === null ? data.automations.filter(job => job.id !== id) : data.automations.map(job => job.id === id ? { ...job, ...patch } : job) }; broadcast(); },
  locale: locale => { data = { ...data, ui: { ...data.ui, locale } }; broadcast(); },
};
createRoot(document.getElementById('root')).render(<StrictMode><AppProvider>{location.search.includes('automation') ? <AutomationsPage /> : <InboxPage />}</AppProvider></StrictMode>);
`;
let browser: Browser;
let page: Page;
let directory: string;
let url: string;
let errors: string[];
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-management-'));
  await build({ stdin: { contents: harness, resolveDir: fileURLToPath(new URL('../../src/renderer/src/components/management/', import.meta.url)), sourcefile: 'management-harness.tsx', loader: 'tsx' }, outfile: join(directory, 'harness.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="harness.css"><script src="harness.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1000, height: 640 } }); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(async () => { await page.close(); expect(errors).toEqual([]); });
test.afterAll(async () => { await browser?.close(); });
test.afterAll(cleanupTemporaryDirectories);

test('review selection is scoped to the visible filter and drops tasks that become active', async () => {
  await page.goto(url);
  await page.getByLabel('选择 completed', { exact: true }).check();
  await page.getByRole('group', { name: '审阅状态筛选' }).getByRole('button', { name: '已审阅', exact: true }).click();
  await expect(page.getByRole('button', { name: '批量标记已审阅' })).toBeDisabled();
  await expect(page.getByLabel('选择 reviewed', { exact: true })).toBeDisabled();
  await page.getByRole('group', { name: '审阅状态筛选' }).getByRole('button', { name: '全部', exact: true }).click();
  await page.getByRole('button', { name: '全选可审阅任务' }).click();
  await expect(page.getByText('4 个任务 · 已选择 2 个')).toBeVisible();
  await page.evaluate(() => window.__management.changeThread('completed', { status: 'running' }));
  await expect(page.getByLabel('选择 completed', { exact: true })).not.toBeChecked();
  await expect(page.getByText('4 个任务 · 已选择 1 个')).toBeVisible();
  await page.getByRole('button', { name: '批量标记已审阅' }).click();
  const requests = await page.evaluate(() => window.__management.calls().filter(request => request.op === 'thread.update'));
  expect(requests).toEqual([{ op: 'thread.update', id: 'failed', reviewed: true }]);
  await page.getByRole('group', { name: '审阅状态筛选' }).getByRole('button', { name: '运行中', exact: true }).click();
  await expect(page.getByLabel('选择 waiting', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('选择 completed', { exact: true })).toBeDisabled();
});

test('batch review preserves partial failures and retries only unfinished visible tasks', async () => {
  await page.goto(url);
  await page.evaluate(() => window.__management.hold('thread.update', true));
  await page.getByRole('button', { name: '全选可审阅任务' }).click();
  await page.getByRole('button', { name: '批量标记已审阅' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => window.__management.pending().length)).toBe(2);
  for (const button of await page.getByRole('group', { name: '审阅状态筛选' }).getByRole('button').all()) await expect(button).toBeDisabled();
  await page.evaluate(() => {
    for (const entry of window.__management.pending()) window.__management.complete(entry.id, entry.request.op === 'thread.update' && entry.request.id === 'failed' ? 'REVIEW_SAVE_FAILED' : undefined);
  });
  await expect(page.getByRole('status')).toHaveText('已标记 1 个任务，1 个未完成');
  await expect(page.getByRole('alert')).toContainText('failed：REVIEW_SAVE_FAILED');
  await expect(page.getByLabel('选择 failed', { exact: true })).toBeChecked();
  await page.evaluate(() => window.__management.hold('thread.update', false));
  await page.getByRole('button', { name: '批量标记已审阅' }).click();
  await expect(page.getByRole('status')).toHaveText('已标记 1 个任务');
  expect(await page.evaluate(() => window.__management.calls().filter(request => request.op === 'thread.update').map(request => request.id))).toEqual(['completed', 'failed', 'failed']);
});

test('automation form validates fields, serializes submits and retains the draft after a failed save', async () => {
  await page.goto(url + '?automation');
  await page.getByRole('button', { name: '新建自动化', exact: true }).click();
  await page.getByRole('button', { name: '创建自动化' }).click();
  await expect(page.locator('#automation-name')).toBeFocused();
  await expect(page.locator('#automation-name')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#automation-name').fill('新日报');
  await page.locator('#automation-prompt').fill('检查更改');
  await page.locator('#automation-interval').fill('1.5');
  await page.getByRole('button', { name: '创建自动化' }).click();
  await expect(page.locator('#automation-interval')).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('整数分钟');
  await page.locator('#automation-mode').selectOption('daily');
  await page.locator('#automation-timezone').fill('Invalid/Zone');
  await page.getByRole('button', { name: '创建自动化' }).click();
  await expect(page.locator('#automation-timezone')).toBeFocused();
  await page.locator('#automation-timezone').fill('Asia/Shanghai');
  await page.evaluate(() => window.__management.hold('automation.save', true));
  await page.getByRole('button', { name: '创建自动化' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => window.__management.pending().length)).toBe(1);
  await expect(page.locator('#automation-name')).toBeDisabled();
  await page.evaluate(() => window.__management.complete(window.__management.pending()[0].id, 'AUTOMATION_SAVE_FAILED'));
  await expect(page.getByRole('status')).toHaveAttribute('data-error', 'true');
  await expect(page.locator('#automation-name')).toHaveValue('新日报');
  await page.getByRole('button', { name: '创建自动化' }).click();
  await page.evaluate(() => window.__management.complete(window.__management.pending()[0].id));
  await expect(page.getByRole('status')).toHaveText('已创建 新日报');
  await expect(page.locator('#automation-editor')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新建自动化', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '新建自动化', exact: true }).click();
  await expect(page.locator('#automation-name')).toHaveValue('');
  expect(await page.evaluate(() => window.__management.calls().filter(request => request.op === 'automation.save').length)).toBe(2);
});

test('reopening the same automation editor preserves input and switching requires an explicit discard', async () => {
  await page.goto(url + '?automation');
  await page.getByRole('button', { name: '新建自动化', exact: true }).click();
  await page.locator('#automation-name').fill('未完成的计划');
  await page.locator('#automation-prompt').fill('保留输入');
  await page.getByRole('button', { name: '新建自动化', exact: true }).click();
  await expect(page.locator('#automation-name')).toHaveValue('未完成的计划');
  await expect(page.locator('#automation-name')).toBeFocused();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('尚未保存');
  await page.getByRole('dialog').press('Escape');
  await expect(page.locator('#automation-prompt')).toHaveValue('保留输入');
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.locator('#automation-name')).toHaveValue('日报');
  await expect(page.locator('#automation-name')).toBeFocused();
  await page.locator('#automation-prompt').fill('修改中的已有计划');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.locator('#automation-prompt')).toHaveValue('修改中的已有计划');
  await page.getByRole('button', { name: '新建自动化', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.locator('#automation-prompt')).toHaveValue('修改中的已有计划');
  expect(await page.evaluate(() => window.__management.calls().filter(request => request.op === 'automation.save'))).toEqual([]);
});

test('automation history and deletion support keyboard dismissal and focus restoration', async () => {
  await page.goto(url + '?automation');
  await page.getByRole('button', { name: '运行历史' }).click();
  await expect(page.getByRole('region', { name: '日报运行历史' })).toBeVisible();
  await expect(page.getByRole('button', { name: '运行历史' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('删除 日报').click();
  await page.getByRole('dialog').press('Escape');
  await expect(page.getByLabel('删除 日报')).toBeFocused();
  expect(await page.evaluate(() => window.__management.calls().filter(request => request.op === 'automation.remove').length)).toBe(0);
  await page.getByLabel('删除 日报').click();
  await page.getByRole('dialog').getByRole('button', { name: '删除自动化', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已删除计划，历史结果保留');
  await expect(page.getByLabel('删除 日报')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新建自动化', exact: true })).toBeFocused();
});

test('deleting the automation being edited closes its form without leaving a phantom new draft', async () => {
  await page.goto(url + '?automation');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#automation-name').fill('删除前的修改');
  await page.getByLabel('删除 日报').click();
  await page.getByRole('dialog').getByRole('button', { name: '删除自动化', exact: true }).click();
  await expect(page.locator('#automation-editor')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新建自动化', exact: true })).toBeFocused();
});

test('management search combines with status filters and scopes review selection', async () => {
  await page.goto(url);
  await page.getByRole('button', { name: '全选可审阅任务' }).click();
  await page.getByLabel('搜索待审阅任务').fill('FAILED');
  await expect(page.getByLabel('选择 completed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('1 个任务 · 已选择 1 个')).toBeVisible();
  await page.getByRole('button', { name: '批量标记已审阅' }).click();
  expect(await page.evaluate(() => window.__management.calls().filter(request => request.op === 'thread.update').map(request => request.id))).toEqual(['failed']);
  await page.getByRole('group', { name: '审阅状态筛选' }).getByRole('button', { name: '已审阅', exact: true }).click();
  await expect(page.getByLabel('选择 failed', { exact: true })).toBeDisabled();
  await page.getByLabel('搜索待审阅任务').fill('missing');
  await expect(page.getByRole('heading', { name: '没有匹配的任务' })).toBeVisible();
  await page.getByLabel('搜索待审阅任务').clear();
  await expect(page.getByLabel('选择 reviewed', { exact: true })).toBeVisible();
});

test('automation list filters real schedules and returns focus after cancelling an edit', async () => {
  await page.goto(url + '?automation');
  await expect(page.locator('#automation-editor')).toHaveCount(0);
  await page.getByRole('group', { name: '自动化状态' }).getByRole('button', { name: '已启用', exact: true }).click();
  await expect(page.getByRole('heading', { name: '没有匹配的自动化' })).toBeVisible();
  await page.getByRole('group', { name: '自动化状态' }).getByRole('button', { name: '已暂停', exact: true }).click();
  await page.getByLabel('搜索自动化').fill('missing');
  await expect(page.getByLabel('删除 日报')).toHaveCount(0);
  await page.getByLabel('搜索自动化').fill('项目');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.locator('#automation-name')).toHaveValue('日报');
  await expect(page.locator('#automation-name')).toBeFocused();
  await page.locator('#automation-name').fill('未保存的编辑');
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: '新建自动化', exact: true })).toBeFocused();
  await expect(page.locator('#automation-editor')).toHaveCount(0);
  await expect(page.getByLabel('删除 日报')).toBeVisible();
  expect(await page.evaluate(() => window.__management.calls().filter(request => request.op === 'automation.save'))).toEqual([]);
});

test('concurrent automation changes preserve the draft until loading the latest version is confirmed', async () => {
  await page.goto(url + '?automation'); await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#automation-prompt').fill('本窗口草稿');
  await page.evaluate(() => window.__management.changeAutomation('job', { prompt: '另一窗口的配置' }));
  await expect(page.getByRole('alert')).toContainText('当前草稿已保留', { timeout: 2000 });
  await expect(page.getByRole('button', { name: '保存自动化', exact: true })).toBeDisabled();
  await page.evaluate(() => window.__management.locale('en-US'));
  await expect(page.getByRole('alert')).toContainText('Your draft has been kept');
  await expect(page.getByRole('button', { name: 'Save automation', exact: true })).toBeDisabled();
  for (const size of [{ width: 1000, height: 700 }, { width: 1280, height: 800 }, { width: 1440, height: 940 }]) {
    await page.setViewportSize(size);
    expect(await page.locator('#automation-editor').evaluate(element => element.scrollWidth <= element.clientWidth + 1 && element.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
  }
  await expect(page.locator('#automation-prompt')).toHaveValue('本窗口草稿');
  await page.evaluate(() => window.__management.locale('zh-CN'));
  const load = page.getByRole('button', { name: '加载最新自动化', exact: true }); await load.click();
  const dialog = page.getByRole('dialog', { name: '加载最新自动化？', exact: true });
  await expect(dialog.getByRole('button', { name: '继续编辑', exact: true })).toBeFocused();
  await dialog.press('Escape'); await expect(page.locator('#automation-prompt')).toHaveValue('本窗口草稿');
  await load.click(); await dialog.getByRole('button', { name: '加载最新自动化', exact: true }).click();
  await expect(page.locator('#automation-prompt')).toHaveValue('另一窗口的配置');
  await expect(page.locator('#automation-name')).toBeFocused();
  await page.locator('#automation-prompt').fill('基于新配置继续');
  await page.getByRole('button', { name: '保存自动化', exact: true }).click();
  await expect(page.locator('#automation-editor')).toHaveCount(0);
  expect(await page.evaluate(() => window.__management.calls().filter(request => request.op === 'automation.save'))).toMatchObject([{ base: { prompt: '另一窗口的配置' }, automation: { prompt: '基于新配置继续' } }]);
});

test('deleted automation drafts require explicit creation of a new schedule', async () => {
  await page.goto(url + '?automation'); await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#automation-prompt').fill('删除后保留的草稿');
  await page.evaluate(() => window.__management.changeAutomation('job', null));
  await expect(page.getByRole('alert')).toContainText('当前草稿已保留', { timeout: 2000 });
  await expect(page.getByRole('button', { name: '保存自动化', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '另存为新自动化', exact: true }).click();
  await expect(page.locator('#automation-prompt')).toHaveValue('删除后保留的草稿');
  expect(await page.evaluate(() => window.__management.calls().filter(request => request.op === 'automation.save'))).toHaveLength(0);
  await page.getByRole('button', { name: '创建自动化', exact: true }).click();
  await expect(page.locator('#automation-editor')).toHaveCount(0);
  const request = await page.evaluate(() => window.__management.calls().find(request => request.op === 'automation.save'));
  expect(request).toMatchObject({ base: null, automation: { prompt: '删除后保留的草稿' } });
  if (request?.op !== 'automation.save') throw new Error('Missing save');
  expect(request.automation.id).not.toBe('job');
});

test('automation runtime progress and an explicit toggle preserve the current editable draft', async () => {
  await page.goto(url + '?automation'); await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#automation-prompt').fill('仍在编辑');
  await page.evaluate(() => window.__management.changeAutomation('job', { nextRunAt: 10000, lastRunAt: 5000, lastThreadId: 'completed' }));
  await expect(page.getByRole('button', { name: '保存自动化', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '启用', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.locator('#automation-prompt')).toHaveValue('仍在编辑');
  await page.getByRole('button', { name: '保存自动化', exact: true }).click();
  await expect(page.locator('#automation-editor')).toHaveCount(0);
  expect(await page.evaluate(() => window.__management.calls().filter(request => request.op === 'automation.save').at(-1))).toMatchObject({ base: { enabled: true }, automation: { enabled: true, prompt: '仍在编辑' } });
});

test('automation delete confirmation cannot remove a plan changed while the dialog is open', async () => {
  await page.goto(url + '?automation'); await page.getByLabel('删除 日报').click();
  await page.evaluate(() => window.__management.changeAutomation('job', { name: '其他窗口更新的日报' }));
  await page.getByRole('dialog').getByRole('button', { name: '删除自动化', exact: true }).click();
  await expect(page.locator('.form-feedback[data-error]')).toContainText('自动化已被修改或删除', { timeout: 2000 });
  await expect(page.getByLabel('删除 其他窗口更新的日报')).toBeVisible();
  await page.getByLabel('删除 其他窗口更新的日报').click();
  await page.getByRole('dialog').getByRole('button', { name: '删除自动化', exact: true }).click();
  await expect(page.getByRole('button', { name: '新建自动化', exact: true })).toBeFocused();
  await expect(page.getByLabel('删除 其他窗口更新的日报')).toHaveCount(0);
});
