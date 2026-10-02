import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { TemporaryDirectories } from '../fixtures/temporary-directories.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Browser, type Page, chromium, expect, test } from '@playwright/test';
import type { DesktopRequest, GitStatus } from '../../src/shared/contracts.ts';

interface Pending { id: number; request: DesktopRequest; }
interface GitHarness {
  show(open: boolean): void;
  select(threadId: string, directoryId?: string): void;
  cleanConflicts(): void;
  appearance(locale: 'zh-CN' | 'en-US', theme: 'light' | 'dark'): void;
  hold(op: string, enabled: boolean): void;
  failNext(op: string, message: string): void;
  pending(op: string): Pending[];
  complete(id: number, result?: unknown, error?: string): void;
  calls(): DesktopRequest[];
}
declare global { interface Window { __git: GitHarness; } }

const harness = String.raw`
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { defaultData, projectSchema, threadSchema, bootstrapSchema } from '../../../../shared/contracts.ts';
import { applyUiPatch } from '../../../../shared/ui-patches.ts';
import { AppProvider, useApp } from '../../state/app.tsx';
import { usePanelActions } from '../../hooks/use-panel-actions.ts';
import { ReviewPanel } from './review-panel.tsx';
import '../../styles/index.css';
const base = defaultData();
let data = { ...base, projects: [projectSchema.parse({ id: 'p', name: '项目', path: 'C:/project', trusted: true, createdAt: 0, directories: [{ id: 'extra', name: '附加目录', path: 'C:/extra', trusted: true }] })], threads: ['t', 'other'].map(id => threadSchema.parse({ id, projectId: 'p', title: '任务 ' + id, cwd: 'C:/project', createdAt: 0, updatedAt: 0, modelId: '', thinking: 'off', policy: 'auto' })), ui: { ...base.ui, activeThreadId: 't', reviewOpen: true } };
const status = { available: true, branch: 'main', files: [{ path: 'a.txt', status: 'UU', staged: true }, { path: 'b.txt', status: 'UU', staged: true }, { path: 'plain.txt', status: ' M', staged: false }] };
const inspection = { branches: ['main'], remoteBranches: [{ ref: 'origin/feature/topic', remote: 'origin', name: 'feature/topic' }], remotes: ['origin'], upstream: '', operation: '', commits: [{ id: 'aaaaaaa', subject: '旧提交', author: '作者', date: '2026-09-26' }, { id: 'bbbbbbb', subject: '新提交', author: '作者', date: '2026-09-26' }], worktrees: [] };
const patch = (name, content = name) => ['diff --git a/' + name + ' b/' + name, '--- a/' + name, '+++ b/' + name, '@@ -1 +1 @@', '-old', '+' + content].join('\n') + '\n';
const listeners = new Set();
const calls = [];
const held = new Set();
const failures = new Map();
const pending = new Map();
let sequence = 0;
const result = (request) => {
  if (request.op === 'bootstrap') return bootstrapSchema.parse({ data, approvals: [], terminals: [], version: 'git-test' });
  if (request.op === 'git.status') return { ...status };
  if (request.op === 'git.inspect') return inspection;
  if (request.op === 'git.diff') return patch(request.path, request.path + '-' + request.mode);
  if (request.op === 'git.show') return patch(request.ref);
  if (request.op === 'git.conflict') return { base: 'base ' + request.path, ours: 'ours ' + request.path, theirs: 'theirs ' + request.path };
  if (request.op === 'git.action') return '操作成功';
  if (request.op === 'git.hunkVersion') return 'current-version';
  if (request.op === 'git.hunkRevert') return { id: 'recovery' };
  if (request.op === 'git.recoveries') return { records: [], errors: [] };
  if (request.op === 'file.read') return { path: request.path, kind: 'text', content: request.path + '-all\n', version: 'current-version', truncated: false };
  if (request.op === 'pr.status') return { available: true, authenticated: true, message: '' };
  if (request.op === 'pr.start') {
    const read = request.action === 'view';
    data.operations.push({ id: request.requestId, threadId: request.threadId, directoryId: 'p', kind: 'pr.' + request.action, status: read ? 'succeeded' : 'running', stage: read ? '正在读取 PR' : '正在创建 PR', startedAt: Date.now(),
      result: read ? { number: 12, title: 'Keep original title', body: 'ORIGINAL_BODY', url: 'https://github.com/test/project/pull/12', state: 'OPEN', isDraft: true, baseRefName: 'main', headRefName: 'feature', comments: [{ body: 'ORIGINAL_COMMENT', createdAt: '2026-09-27', author: { login: 'reviewer' } }], reviews: [] } : undefined });
    listeners.forEach(listener => listener({ type: 'state', data: structuredClone(data) }));
    return data.operations.at(-1);
  }
  if (request.op === 'operation.cancel') {
    data.operations.find(item => item.id === request.requestId).status = 'cancelled';
    listeners.forEach(listener => listener({ type: 'state', data: structuredClone(data) })); return null;
  }
  if (request.op === 'ui.threadPatch') data = { ...data, ui: applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }) };
  if (request.op === 'ui.update') data = { ...data, ui: applyUiPatch(data.ui, { frame: request.ui }) };
  if (request.op.startsWith('ui.')) { listeners.forEach(listener => listener({ type: 'state', data })); return data.ui; }
  return null;
};
window.desktop = {
  invoke: async (request) => {
    calls.push(request);
    if (failures.has(request.op)) { const error = failures.get(request.op); failures.delete(request.op); throw new Error(error); }
    if (held.has(request.op)) return new Promise((resolve, reject) => pending.set(++sequence, { request, resolve, reject }));
    return result(request);
  },
  onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
};
window.__git = {
  show: (open) => { data.ui.reviewOpen = open; listeners.forEach(listener => listener({ type: 'state', data: structuredClone(data) })); },
  select: (id, directoryId = 'p') => { data.ui = applyUiPatch(data.ui, { frame: { activeThreadId: id } }); data.ui = applyUiPatch(data.ui, { threadId: id, thread: { directoryId } }); listeners.forEach(listener => listener({ type: 'state', data: structuredClone(data) })); },
  cleanConflicts: () => { status.files = status.files.map(file => ({ ...file, status: ' M' })); },
  appearance: (locale, theme) => { data.ui.locale = locale; data.settings.theme = theme; listeners.forEach(listener => listener({ type: 'state', data: structuredClone(data) })); },
  hold: (op, enabled) => enabled ? held.add(op) : held.delete(op),
  failNext: (op, message) => failures.set(op, message),
  pending: (op) => [...pending].filter(([, item]) => item.request.op === op).map(([id, item]) => ({ id, request: item.request })),
  complete: (id, value, error) => { const item = pending.get(id); if (!item) throw new Error('Missing request'); pending.delete(id); error ? item.reject(new Error(error)) : item.resolve(value === undefined ? result(item.request) : value); },
  calls: () => calls,
};
function Harness() { const { reviewOpen, error } = useApp(); const actions = usePanelActions(); return <>{reviewOpen && <ReviewPanel width={390} actions={actions} />}<output data-testid="global-error">{error}</output></>; }
createRoot(document.getElementById('root')).render(<StrictMode><AppProvider><Harness /></AppProvider></StrictMode>);
`;

let browser: Browser;
let page: Page;
let directory: string;
let url: string;
let errors: string[];
const owned = new TemporaryDirectories();
test.beforeAll(async () => {
  directory = await owned.create(join(tmpdir(), 'pi-git-panel-'));
  await build({ stdin: { contents: harness, resolveDir: fileURLToPath(new URL('../../src/renderer/src/components/panels/', import.meta.url)), sourcefile: 'git-harness.tsx', loader: 'tsx' }, outfile: join(directory, 'harness.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="harness.css"><script src="harness.js"></script>');
  browser = await chromium.launch();
  url = pathToFileURL(join(directory, 'index.html')).href;
});
test.beforeEach(async () => {
  errors = [];
  page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  await page.clock.install();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await expect(page.getByRole('region', { name: 'Git 工作台' })).toBeVisible();
  // Complete the real panel's initial 200 ms tool-refresh timer before delaying later requests.
  await page.clock.runFor(250);
  await expect(page.getByText('正在读取仓库信息…', { exact: true })).toHaveCount(0);
});
test.afterEach(async () => { await page.close(); expect(errors).toEqual([]); });
test.afterAll(async () => { try { await browser?.close(); } finally { await owned.cleanup(); } });
const pending = (op: string) => page.evaluate(op => window.__git.pending(op), op);
const hold = (op: string, enabled = true) => page.evaluate(([op, enabled]) => window.__git.hold(op, enabled), [op, enabled] as [string, boolean]);
const fail = (op: string) => page.evaluate(op => window.__git.failNext(op, 'READ_FAILED'), op);
const complete = (id: number, value?: unknown, error?: string) => page.evaluate(({ id, value, error }) => window.__git.complete(id, value, error), { id, value, error });

test('PR controls are explicit, show context, create both modes and expose cancellation without a Git push', async () => {
  await page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  expect((await page.evaluate(() => window.__git.calls())).some(call => call.op.startsWith('pr.'))).toBe(false);
  await page.getByText('拉取请求', { exact: true }).click();
  await page.getByRole('button', { name: '检查 GitHub CLI' }).click();
  await expect(page.getByText('GitHub CLI 已就绪')).toBeVisible();
  await page.getByLabel('PR 编号、链接或分支').fill('12');
  await page.getByRole('button', { name: '读取 PR 上下文' }).click();
  await expect(page.getByRole('article', { name: 'PR 上下文' })).toContainText('ORIGINAL_COMMENT');
  await page.getByRole('button', { name: '在浏览器打开 PR' }).click();
  await page.getByText('创建 PR', { exact: true }).click();
  await page.getByLabel('PR 标题', { exact: true }).fill('标题');
  await page.getByLabel('PR 基准分支', { exact: true }).fill('main');
  await page.getByLabel('PR 说明', { exact: true }).fill('中文说明\n第二段');
  await page.getByRole('button', { name: '创建草稿 PR' }).click();
  await expect(page.getByRole('button', { name: '取消 PR 操作' })).toBeVisible();
  await page.getByRole('button', { name: '取消 PR 操作' }).click();
  await page.getByLabel('草稿 PR', { exact: true }).uncheck();
  await page.getByRole('button', { name: '创建普通 PR' }).click();
  await page.getByRole('button', { name: '取消 PR 操作' }).click();
  const calls = await page.evaluate(() => window.__git.calls());
  const creates = calls.filter((call): call is Extract<DesktopRequest, { op: 'pr.start' }> => call.op === 'pr.start' && call.action === 'create');
  expect(creates.map(call => call.draft)).toEqual([true, false]); expect(creates[0].body).toBe('中文说明\n第二段');
  expect(calls.some(call => call.op === 'git.action')).toBe(false);
  expect(calls.some(call => call.op === 'external.open' && call.url.endsWith('/12'))).toBe(true);
});

test('Git history discards late selections, retries reads and restores keyboard focus', async () => {
  await page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  await page.getByText('提交历史', { exact: true }).click();
  await hold('git.show');
  await page.getByRole('button', { name: /aaaaaaa 旧提交/ }).click();
  await expect.poll(() => pending('git.show')).toHaveLength(1);
  const [old] = await pending('git.show');
  await page.getByRole('button', { name: /bbbbbbb 新提交/ }).click();
  await expect.poll(() => pending('git.show')).toHaveLength(2);
  const latest = (await pending('git.show')).at(-1)!;
  await complete(latest.id);
  const detail = page.getByRole('region', { name: '提交差异 新提交' });
  await expect(detail.locator('.diff')).toContainText('+bbbbbbb');
  await complete(old.id, undefined, 'OLD_ERROR');
  await expect(detail.locator('.diff')).toContainText('+bbbbbbb');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭提交差异' }).click();
  await expect(page.getByRole('button', { name: /bbbbbbb 新提交/ })).toBeFocused();
  await hold('git.show', false);
  await fail('git.show');
  await page.keyboard.press('Enter');
  await expect(detail.getByRole('alert')).toContainText('READ_FAILED');
  await detail.getByRole('button', { name: '重试提交差异' }).click();
  await expect(detail.locator('.diff')).toContainText('+bbbbbbb');
});

test('Git file and conflict reads stay attached to the selected path and range', async () => {
  await hold('git.conflict');
  await page.getByRole('button', { name: '查看冲突 a.txt' }).click();
  await expect.poll(() => pending('git.conflict')).toHaveLength(1);
  const [old] = await pending('git.conflict');
  await page.getByRole('button', { name: '查看冲突 b.txt' }).click();
  await expect.poll(() => pending('git.conflict')).toHaveLength(2);
  await complete((await pending('git.conflict')).at(-1)!.id);
  await complete(old.id);
  const conflict = page.getByRole('region', { name: '冲突版本 b.txt' });
  await conflict.getByText('当前版本', { exact: true }).click();
  await expect(conflict.locator('pre').filter({ hasText: 'ours b.txt' })).toBeVisible();
  await expect(conflict).not.toContainText('ours a.txt');
  await hold('git.diff');
  await page.locator('.git-file-row > button:first-child').filter({ hasText: 'plain.txt' }).click();
  await expect(conflict).toHaveCount(0);
  await expect.poll(() => pending('git.diff')).toHaveLength(1);
  const [all] = await pending('git.diff');
  await page.getByLabel('差异范围').click();
  await page.locator('.menu-item[data-value="staged"]').click();
  await expect.poll(() => pending('git.diff')).toHaveLength(2);
  await complete((await pending('git.diff')).at(-1)!.id);
  await complete(all.id);
  await expect(page.locator('.diff')).toContainText('+plain.txt-staged');
  await expect(page.locator('.diff')).not.toContainText('+plain.txt-all');
});

test('Git inspection, diff and conflict failures have independent retry controls', async () => {
  await fail('git.inspect');
  await page.getByLabel('刷新 Git', { exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('仓库信息读取失败');
  await page.getByRole('button', { name: '重试仓库信息' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await fail('git.diff');
  await page.locator('.git-file-row > button:first-child').filter({ hasText: 'a.txt' }).click();
  await expect(page.getByRole('alert')).toContainText('文件差异读取失败');
  await page.getByRole('button', { name: '重试文件差异' }).click();
  await expect(page.locator('.diff')).toContainText('+a.txt-all');
  await fail('git.conflict');
  await page.getByRole('button', { name: '查看冲突 a.txt' }).click();
  await expect(page.getByRole('alert')).toContainText('冲突版本读取失败');
  await page.getByRole('button', { name: '重试冲突版本' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '标记已解决' })).toBeEnabled();
});

test('Git status refresh ignores superseded responses and surfaces recovery', async () => {
  await hold('git.status');
  await page.getByLabel('刷新 Git', { exact: true }).click();
  await page.getByLabel('刷新 Git', { exact: true }).click();
  await expect.poll(async () => (await pending('git.status')).length).toBeGreaterThanOrEqual(2);
  const requests = await pending('git.status');
  const latest = requests.at(-1)!;
  const status: GitStatus = { available: true, branch: 'latest-branch', files: [] };
  await complete(latest.id, status);
  for (const request of requests.slice(0, -1)) await complete(request.id, { available: false, branch: '', files: [], error: 'OLD_ERROR' });
  await expect(page.locator('.branch-row')).toContainText('latest-branch');
  await expect(page.getByText('OLD_ERROR')).toHaveCount(0);
  await hold('git.status', false);
  await fail('git.status');
  await page.getByLabel('刷新 Git', { exact: true }).click();
  await expect(page.getByRole('button', { name: '重试 Git 状态' })).toBeVisible();
  await page.getByRole('button', { name: '重试 Git 状态' }).click();
  await expect(page.locator('.branch-row')).toContainText('main');
});

test('remote tracking and upstream use the selected remote reference and separate local name', async () => {
  await page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  await page.getByText('分支与远端', { exact: true }).click();
  await page.getByLabel('远端分支', { exact: true }).click();
  await page.locator('.menu-item[data-value="origin/feature/topic"]').click();
  await page.getByLabel('分支名称', { exact: true }).fill('local-topic');
  await page.getByRole('button', { name: '从远端创建跟踪分支' }).click();
  await expect.poll(() => page.evaluate(() => window.__git.calls().filter(request => request.op === 'git.action'))).toEqual([expect.objectContaining({ action: 'branchTrack', value: 'local-topic', startPoint: 'origin/feature/topic' })]);
  await page.getByRole('button', { name: '设置上游', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__git.calls().filter(request => request.op === 'git.action').at(-1))).toMatchObject({ action: 'upstream', value: 'origin/feature/topic' });
  await fail('git.action');
  await page.getByRole('button', { name: '创建并切换', exact: true }).click();
  await expect(page.locator('.git-feedback')).toContainText('READ_FAILED');
  await expect(page.locator('.git-feedback')).not.toContainText('认证');
  await expect(page.getByRole('button', { name: '创建并切换', exact: true })).toBeEnabled();
});

test('Review filters live files, preserves the selected diff and exposes Git controls from the header', async () => {
  const search = page.getByRole('searchbox', { name: '筛选变更文件' });
  await search.fill('PLAIN');
  await expect(page.locator('.git-file-row')).toHaveCount(1);
  await page.locator('.git-file-row > button:first-child').click();
  await expect(page.locator('.diff')).toContainText('+plain.txt-all');
  await search.fill('missing');
  await expect(page.getByText('没有匹配的文件', { exact: true })).toBeVisible();
  await expect(page.locator('.diff')).toContainText('+plain.txt-all');
  await page.getByRole('button', { name: '隐藏文件列表', exact: true }).click();
  await expect(search).toHaveCount(0);
  await page.getByRole('button', { name: '显示文件列表', exact: true }).click();
  await expect(search).toHaveValue('missing');
  await search.fill('');
  await expect(page.locator('.git-file-row')).toHaveCount(3);
  const controls = page.getByRole('button', { name: 'Git 操作', exact: true });
  await expect(controls).toHaveAttribute('aria-expanded', 'false');
  await controls.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('提交信息')).toBeVisible();
  await page.getByLabel('提交信息').fill('草稿提交');
  await controls.click();
  await expect(page.getByLabel('提交信息')).toBeHidden();
  await controls.click();
  await expect(page.getByLabel('提交信息')).toHaveValue('草稿提交');
  await page.getByRole('button', { name: '并排视图', exact: true }).click();
  await expect(page.locator('.split-diff')).toBeVisible();
  await page.getByRole('button', { name: '统一视图', exact: true }).click();
  await expect(page.locator('.diff.unified')).toBeVisible();
});

test('Git actions remain pending after hiding the panel and errors stay with their source task', async () => {
  await hold('git.action');
  await page.getByRole('button', { name: '暂存 plain.txt', exact: true }).click();
  await expect.poll(() => pending('git.action')).toHaveLength(1);
  const [job] = await pending('git.action');
  await page.getByRole('button', { name: '关闭辅助栏', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Git 工作台' })).toHaveCount(0);
  await page.evaluate(() => window.__git.show(true));
  await expect(page.getByRole('button', { name: '暂存 plain.txt', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '取消 Git 操作', exact: true })).toBeVisible();
  await page.evaluate(() => window.__git.select('other'));
  await expect(page.getByRole('button', { name: '暂存 plain.txt', exact: true })).toBeEnabled();
  await complete(job.id, undefined, 'ORIGIN_ONLY_FAILURE');
  await expect(page.locator('.git-feedback')).toHaveCount(0);
  await expect(page.getByTestId('global-error')).toBeEmpty();
  await page.evaluate(() => window.__git.select('t'));
  await expect(page.locator('.git-feedback')).toContainText('ORIGIN_ONLY_FAILURE');
  await expect(page.getByRole('button', { name: '暂存 plain.txt', exact: true })).toBeEnabled();
  await hold('git.action', false);
  await page.getByRole('button', { name: '暂存 plain.txt', exact: true }).click();
  await expect(page.locator('.git-feedback')).toContainText('操作成功');
});

test('Git cancellation is deduplicated, retryable and stays with the original directory until the command finishes', async () => {
  await hold('git.action'); await hold('git.cancel');
  await page.getByRole('button', { name: '暂存 plain.txt', exact: true }).click();
  const [action] = await pending('git.action');
  const cancel = page.getByRole('button', { name: '取消 Git 操作', exact: true });
  await cancel.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => pending('git.cancel')).toHaveLength(1);
  await expect(cancel).toBeDisabled();
  const [first] = await pending('git.cancel');
  expect(first.request).toMatchObject({ threadId: 't', directoryId: 'p', requestId: (action.request as Extract<DesktopRequest, { op: 'git.action' }>).requestId });
  await complete(first.id, undefined, 'CANCEL_FAILED');
  await expect(cancel).toBeEnabled();
  await expect(page.locator('.git-feedback')).toContainText('CANCEL_FAILED');
  await cancel.click();
  await expect.poll(() => pending('git.cancel')).toHaveLength(1);
  await complete((await pending('git.cancel'))[0].id);
  await expect(page.getByRole('button', { name: '暂存 plain.txt', exact: true })).toBeDisabled();
  await page.evaluate(() => window.__git.select('t', 'extra'));
  await expect(page.getByRole('button', { name: '暂存 plain.txt', exact: true })).toBeEnabled();
  await expect(cancel).toHaveCount(0);
  await complete(action.id, undefined, 'COMMAND_CANCELLED');
  await expect(page.locator('.git-feedback')).toHaveCount(0);
  await page.evaluate(() => window.__git.select('t'));
  await expect(page.locator('.git-feedback')).toContainText('COMMAND_CANCELLED');
  await expect(page.getByRole('button', { name: '暂存 plain.txt', exact: true })).toBeEnabled();
});

test('commit completion preserves text and selections edited during the request and across task switches', async () => {
  await page.evaluate(() => window.__git.cleanConflicts());
  await page.getByLabel('刷新 Git', { exact: true }).click();
  await page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  await page.getByRole('textbox', { name: '提交信息', exact: true }).fill('本次提交');
  await page.getByRole('checkbox', { name: '提交 a.txt', exact: true }).check();
  await hold('git.action');
  await page.getByRole('button', { name: '提交所选暂存文件', exact: true }).click();
  const [job] = await pending('git.action');
  expect(job.request).toMatchObject({ action: 'commitStaged', value: '本次提交', paths: ['a.txt'], directoryId: 'p' });
  await page.getByRole('textbox', { name: '提交信息', exact: true }).fill('下一次提交的草稿');
  await page.getByRole('checkbox', { name: '提交 b.txt', exact: true }).check();
  await page.evaluate(() => window.__git.select('other'));
  await page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '提交信息', exact: true })).toHaveValue('');
  await complete(job.id);
  await page.evaluate(() => window.__git.select('t'));
  await expect(page.getByRole('textbox', { name: '提交信息', exact: true })).toHaveValue('下一次提交的草稿');
  await expect(page.getByRole('checkbox', { name: '提交 a.txt', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: '提交 b.txt', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '提交所选暂存文件', exact: true }).click();
  const [next] = await pending('git.action');
  expect(next.request).toMatchObject({ value: '下一次提交的草稿', paths: ['b.txt'] });
  await complete(next.id, undefined, 'COMMIT_REJECTED');
  await expect(page.getByRole('textbox', { name: '提交信息', exact: true })).toHaveValue('下一次提交的草稿');
  await expect(page.getByRole('checkbox', { name: '提交 b.txt', exact: true })).toBeChecked();
});

test('hunk preflight reserves one action and a directory change or cancellation cannot apply its late result', async () => {
  await page.evaluate(() => window.__git.cleanConflicts());
  await page.getByLabel('刷新 Git', { exact: true }).click();
  await page.locator('.git-file-row > button:first-child').filter({ hasText: 'plain.txt' }).click();
  await hold('git.hunkVersion');
  const revert = page.getByRole('button', { name: '撤销此差异块', exact: true });
  await revert.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => pending('git.hunkVersion')).toHaveLength(1);
  await expect(revert).toBeDisabled();
  const [old] = await pending('git.hunkVersion');
  await page.evaluate(() => window.__git.select('t', 'extra'));
  await expect(page.locator('.git-file-row')).toHaveCount(3);
  await complete(old.id);
  expect((await page.evaluate(() => window.__git.calls())).filter(call => call.op === 'git.hunkRevert')).toHaveLength(0);
  await page.evaluate(() => window.__git.select('t'));
  await expect(revert).toBeEnabled();
  await revert.click();
  const [cancelled] = await pending('git.hunkVersion');
  await page.getByRole('button', { name: '取消 Git 操作', exact: true }).click();
  await expect(revert).toBeEnabled();
  await complete(cancelled.id);
  expect((await page.evaluate(() => window.__git.calls())).filter(call => call.op === 'git.hunkRevert' || call.op === 'git.cancel')).toHaveLength(0);
  await hold('git.hunkVersion', false); await hold('git.hunkRevert');
  await revert.click();
  await expect.poll(() => pending('git.hunkRevert')).toHaveLength(1);
  const [applied] = await pending('git.hunkRevert');
  expect(applied.request).toMatchObject({ directoryId: 'p', path: 'plain.txt', version: 'current-version' });
  await page.getByRole('button', { name: '关闭辅助栏', exact: true }).click();
  await page.evaluate(() => window.__git.show(true));
  await expect(revert).toBeDisabled();
  await complete(applied.id);
  await expect(page.getByText('差异块恢复记录', { exact: true })).toBeVisible();
  await expect(revert).toBeEnabled();
});

test('late comment reads cannot open on another file and saving preserves newly edited comments', async () => {
  await page.locator('.git-file-row > button:first-child').filter({ hasText: 'plain.txt' }).click();
  await hold('file.read');
  await page.getByRole('button', { name: '评论第 1 行', exact: true }).click();
  const [old] = await pending('file.read');
  await page.locator('.git-file-row > button:first-child').filter({ hasText: 'a.txt' }).click();
  await expect(page.locator('.diff')).toContainText('+a.txt-all');
  await complete(old.id);
  await expect(page.getByRole('button', { name: '保存评论', exact: true })).toHaveCount(0);
  await hold('file.read', false);
  await page.getByRole('button', { name: '评论第 1 行', exact: true }).click();
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: '保存评论', exact: true }) });
  await form.getByRole('textbox').fill('先保存的评论');
  await fail('comment.add');
  await form.getByRole('button', { name: '保存评论', exact: true }).click();
  await expect(form.getByRole('textbox')).toHaveValue('先保存的评论');
  await expect(page.locator('.git-feedback')).toContainText('READ_FAILED');
  await hold('comment.add');
  await form.getByRole('button', { name: '保存评论', exact: true }).click();
  const [saving] = await pending('comment.add');
  await form.getByRole('textbox').fill('保存期间继续输入');
  await page.getByRole('button', { name: '关闭辅助栏', exact: true }).click();
  await page.evaluate(() => window.__git.show(true));
  await expect(form.getByRole('textbox')).toHaveValue('保存期间继续输入');
  await expect(form.getByRole('button', { name: '保存评论', exact: true })).toBeDisabled();
  await complete(saving.id);
  await expect(form.getByRole('textbox')).toHaveValue('保存期间继续输入');
  await expect(form.getByRole('button', { name: '保存评论', exact: true })).toBeEnabled();
  await hold('comment.add', false);
  await form.getByRole('button', { name: '保存评论', exact: true }).click();
  await expect(form).toHaveCount(0);
});

test('recovery record reads can retry independently and restoring cannot repeat after panel reopen', async () => {
  await page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  await fail('git.recoveries');
  await page.getByText('差异块恢复记录', { exact: true }).click();
  await expect(page.locator('.git-read-error')).toContainText('READ_FAILED');
  await hold('git.recoveries');
  await page.getByRole('button', { name: '重试差异块恢复记录', exact: true }).click();
  const [read] = await pending('git.recoveries');
  const record = { id: 'recovery', cwd: 'C:/project', path: 'plain.txt', originalVersion: 'before', revertedVersion: 'after', state: 'applied', createdAt: 1 };
  await complete(read.id, { records: [record], errors: [] });
  await hold('git.hunkRestore');
  const restore = page.getByRole('button', { name: '恢复撤销前版本', exact: true });
  await restore.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => pending('git.hunkRestore')).toHaveLength(1);
  const [job] = await pending('git.hunkRestore');
  await page.getByRole('button', { name: '关闭辅助栏', exact: true }).click();
  await page.evaluate(() => window.__git.show(true));
  await expect.poll(async () => (await pending('git.recoveries')).length).toBeGreaterThan(0);
  const reads = await pending('git.recoveries');
  await complete(reads.at(-1)!.id, { records: [record], errors: [] });
  for (const old of reads.slice(0, -1)) await complete(old.id, { records: [], errors: [] });
  await expect(restore).toBeDisabled();
  await hold('git.recoveries', false); await complete(job.id);
  await expect(restore).toHaveCount(0);
  await expect(page.getByTestId('global-error')).toBeEmpty();
});

for (const theme of ['light', 'dark'] as const) test('recovery history keeps valid actions alongside damaged and interrupted records: ' + theme, async () => {
  await page.evaluate(theme => window.__git.appearance('zh-CN', theme), theme);
  await hold('git.recoveries');
  await page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  await page.getByText('差异块恢复记录', { exact: true }).click();
  const record = { id: 'valid', cwd: 'C:/project', path: 'plain.txt', originalVersion: 'before', revertedVersion: 'after', state: 'applied', createdAt: 1 };
  const result = { records: [record, { ...record, id: 'prepared', path: '未执行.txt', state: 'unapplied' }, { ...record, id: 'changed', path: '外部编辑.txt', error: '文件已被其他程序修改，未覆盖当前版本' }, { ...record, id: 'restored', path: '恢复完成.txt', state: 'restored' }, { ...record, id: 'receipt', path: '确认状态.txt', state: 'restored', receiptPending: true }], errors: [{ id: 'broken', message: 'BROKEN_RECORD_JSON' }] };
  await expect.poll(async () => (await pending('git.recoveries')).length).toBeGreaterThan(0);
  for (const read of await pending('git.recoveries')) await complete(read.id, result);
  await expect(page.getByRole('alert').filter({ hasText: '部分恢复记录无法读取' })).toBeVisible();
  await expect(page.getByRole('button', { name: '未执行撤销', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '已恢复', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '完成恢复记录', exact: true })).toBeEnabled();
  const ready = page.getByRole('button', { name: '恢复撤销前版本', exact: true }).filter({ visible: true });
  await expect(ready).toHaveCount(2); await expect(ready.first()).toBeEnabled(); await expect(ready.last()).toBeDisabled();
  await page.evaluate(theme => window.__git.appearance('en-US', theme), theme);
  await expect(page.getByRole('alert').filter({ hasText: 'Some recovery records could not be read' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Another program changed the file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revert not applied', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Complete recovery record', exact: true })).toBeEnabled();
  await page.getByText('broken', { exact: true }).click();
  await expect(page.getByText('BROKEN_RECORD_JSON', { exact: true })).toBeVisible();
  for (const width of [1000, 1280, 1440]) {
    await page.setViewportSize({ width, height: width === 1000 ? 700 : width === 1280 ? 800 : 940 });
    expect(await page.locator('.review-pane').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await page.getByRole('button', { name: 'Refresh recovery history', exact: true }).click();
  const [retry] = await pending('git.recoveries');
  await complete(retry.id, { records: [record], errors: [] });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore version before revert', exact: true }).click();
  expect((await page.evaluate(() => window.__git.calls())).filter(call => call.op === 'git.hunkRestore')).toEqual([expect.objectContaining({ recoveryId: 'valid', directoryId: 'p' })]);
});

for (const theme of ['light', 'dark'] as const) for (const width of [1000, 1280, 1440]) test('Git pending status keeps drafts while switching language: ' + theme + ' ' + width, async () => {
  await page.setViewportSize({ width, height: width === 1000 ? 700 : width === 1280 ? 800 : 940 });
  await page.evaluate(theme => window.__git.appearance('zh-CN', theme), theme);
  await page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  await page.getByRole('textbox', { name: '提交信息', exact: true }).fill('保留原文');
  await hold('git.action'); await page.getByRole('button', { name: '暂存 plain.txt', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '正在执行' })).toBeVisible();
  await page.evaluate(theme => window.__git.appearance('en-US', theme), theme);
  await expect(page.getByRole('status').filter({ hasText: 'Running' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Commit message', exact: true })).toHaveValue('保留原文');
  await expect(page.getByRole('button', { name: 'Cancel Git operation', exact: true })).toBeVisible();
  expect(await page.locator('.review-pane').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await complete((await pending('git.action'))[0].id);
});

test('a Git status read failure does not hide cancellation of an already running command', async () => {
  await hold('git.action');
  await page.getByRole('button', { name: '暂存 plain.txt', exact: true }).click();
  const [job] = await pending('git.action');
  await fail('git.status'); await page.getByLabel('刷新 Git', { exact: true }).click();
  await expect(page.getByRole('button', { name: '重试 Git 状态', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消 Git 操作', exact: true }).click();
  expect((await page.evaluate(() => window.__git.calls())).filter(call => call.op === 'git.cancel')).toHaveLength(1);
  await complete(job.id, undefined, 'CANCELLED');
  await expect(page.getByRole('region', { name: 'Git 工作台' })).toBeVisible();
  await expect(page.locator('.git-feedback')).toContainText('CANCELLED');
  await expect(page.getByRole('button', { name: '取消 Git 操作', exact: true })).toHaveCount(0);
});

test('reopening the same Git file restores the selected hunk after its diff finishes loading', async () => {
  const patch = ['diff --git a/plain.txt b/plain.txt', '--- a/plain.txt', '+++ b/plain.txt', '@@ -1 +1 @@', '-first', '+FIRST_HUNK', '@@ -20 +20 @@', '-second', '+SECOND_HUNK', ''].join('\n');
  await hold('git.diff');
  await page.locator('.git-file-row > button:first-child').filter({ hasText: 'plain.txt' }).click();
  await expect.poll(async () => (await pending('git.diff')).length).toBeGreaterThan(0);
  for (const read of await pending('git.diff')) await complete(read.id, patch);
  await page.getByRole('button', { name: '下一块', exact: true }).click();
  await expect(page.locator('.diff')).toContainText('SECOND_HUNK');
  await page.getByRole('button', { name: '关闭辅助栏', exact: true }).click();
  await page.evaluate(() => window.__git.show(true));
  await expect.poll(async () => (await pending('git.diff')).length).toBeGreaterThan(0);
  for (const read of await pending('git.diff')) await complete(read.id, patch);
  await expect(page.locator('.diff')).toContainText('SECOND_HUNK');
  await expect(page.getByRole('button', { name: '下一块', exact: true })).toBeDisabled();
  await page.getByLabel('差异范围', { exact: true }).click();
  await page.locator('.menu-item[data-value="unstaged"]').click();
  await expect.poll(async () => (await pending('git.diff')).length).toBeGreaterThan(0);
  for (const read of await pending('git.diff')) await complete(read.id, patch);
  await expect(page.locator('.diff')).toContainText('FIRST_HUNK');
});
