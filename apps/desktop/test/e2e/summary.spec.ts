import { taskAction } from './fixtures/task-actions.ts';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Browser, type Page, chromium, expect, test } from '@playwright/test';
import type { Approval, DesktopData, DesktopRequest, GitStatus, Thread } from '../../src/shared/contracts.ts';

interface SummaryHarness {
  holdGit(value: boolean): void;
  git(value: GitStatus): void;
  pending(): { id: number; threadId: string }[];
  complete(id: number, value: GitStatus | string): void;
  patch(id: string, patch: Partial<Thread>): void;
  select(id: string): void;
  approvals(value: Approval[]): void;
  theme(value: 'light' | 'dark' | 'system'): void;
  snapshot(): DesktopData;
  calls(): DesktopRequest[];
}
declare global { interface Window { __summary: SummaryHarness; } }

const harness = String.raw`
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { defaultData, projectSchema, threadSchema, timelineSchema, bootstrapSchema } from '../../shared/contracts.ts';
import { applyUiPatch } from '../../shared/ui-patches.ts';
import { App } from './App.tsx';
import './styles/index.css';
const base = defaultData();
const steps = Array.from({ length: 18 }, (_, i) => ({ text: '当前计划步骤 ' + (i + 1) + '：检查真实内容', status: i < 6 ? 'completed' : i === 6 ? 'in_progress' : 'pending' }));
const item = (id, role, text) => timelineSchema.parse({ id, role, text, timestamp: 1, stopReason: role === 'assistant' ? 'stop' : undefined });
const makeThread = (id, title) => threadSchema.parse({ id, title, projectId: 'p', cwd: 'C:/project', modelId: '', thinking: 'off', policy: 'auto', createdAt: 1, updatedAt: 2, items: [item('first', 'user', '第一轮'), item('answer-1', 'assistant', '旧回答\n\n'.repeat(12)), item('second', 'user', '第二轮'), item('answer-2', 'assistant', '当前回答\n\n'.repeat(15)), item('third', 'user', '新的无计划轮次'), item('answer-3', 'assistant', '最新回答\n\n'.repeat(12))], plans: { second: steps, first: [{ text: '旧计划', status: 'completed' }] }, plan: [{ text: '不应采用的过期摘要', status: 'pending' }] });
let data = { ...base, settings: { ...base.settings, theme: 'light' }, projects: [projectSchema.parse({ id: 'p', name: '项目', path: 'C:/project', trusted: true, createdAt: 1 })], threads: [makeThread('t', '第一任务'), makeThread('other', '第二任务')], ui: { ...base.ui, activeThreadId: 't', threads: { t: { reviewTab: 'changes', terminalOpen: false, selectedPath: '', folds: { unrelated: true } }, other: { reviewTab: 'changes', terminalOpen: false, selectedPath: '', folds: {} } } } };
const listeners = new Set();
const calls = [];
const pending = new Map();
let held = false;
let sequence = 0;
let approvals = [];
let git = { branch: 'main', available: true, files: [] };
const broadcast = () => listeners.forEach(listener => listener({ type: 'state', data }));
window.desktop = {
  invoke: async request => {
    calls.push(request);
    if (request.op === 'bootstrap') return bootstrapSchema.parse({ data, approvals, terminals: [], version: 'summary-test' });
    if (request.op === 'git.status') return held ? new Promise((resolve, reject) => pending.set(++sequence, { request, resolve, reject })) : git;
    if (request.op === 'ui.update') { data = { ...data, ui: applyUiPatch(data.ui, { frame: request.ui }) }; broadcast(); return data.ui; }
    if (request.op === 'ui.threadPatch') { data = { ...data, ui: applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }) }; broadcast(); return data.ui; }
    if (request.op === 'thread.update') return data.threads.find(thread => thread.id === request.id);
    if (request.op === 'comment.list') return [];
    return null;
  },
  onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
};
window.__summary = {
  git: value => { git = value; window.dispatchEvent(new Event('focus')); },
  holdGit: value => held = value,
  pending: () => [...pending].map(([id, value]) => ({ id, threadId: value.request.threadId })),
  complete: (id, value) => { const item = pending.get(id); if (!item) throw new Error('No pending request'); pending.delete(id); typeof value === 'string' ? item.reject(new Error(value)) : item.resolve(value); },
  patch: (id, patch) => { data = { ...data, threads: data.threads.map(thread => thread.id === id ? { ...thread, ...patch } : thread) }; broadcast(); },
  select: id => { data = { ...data, ui: { ...data.ui, activeThreadId: id } }; broadcast(); },
  approvals: value => { approvals = value; listeners.forEach(listener => listener({ type: 'approvals', approvals })); },
  theme: theme => { data = { ...data, settings: { ...data.settings, theme } }; broadcast(); },
  snapshot: () => data,
  calls: () => calls,
};
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
`;
let browser: Browser;
let page: Page;
let directory: string;
let url: string;
let errors: string[];
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-summary-'));
  await build({ stdin: { contents: harness, resolveDir: fileURLToPath(new URL('../../src/renderer/src/', import.meta.url)), sourcefile: 'summary-harness.tsx', loader: 'tsx' }, outfile: join(directory, 'harness.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="harness.css"><script src="harness.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(async () => { await page.close(); expect(errors).toEqual([]); });
test.afterAll(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function refreshSummary() {
  await page.getByRole('button', { name: '摘要操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '刷新 Git', exact: true }).click();
}

for (const viewport of [{ width: 1000, height: 640 }, { width: 1280, height: 800 }, { width: 1440, height: 940 }]) {
  for (const theme of ['light', 'dark', 'system-light', 'system-dark']) {
    test('summary plan navigation keeps its real round and reading position: ' + theme + ' ' + viewport.width, async () => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme.endsWith('dark') ? 'dark' : 'light', reducedMotion: theme.startsWith('system') ? 'reduce' : 'no-preference' });
      await page.goto(url);
      await page.getByRole('button', { name: '查看全部', exact: true }).click();
      const summary = page.getByRole('region', { name: '任务摘要', exact: true });
      await expect(summary.getByRole('heading', { name: '计划 · 6/18' })).toBeVisible();
      const mode: 'light' | 'dark' | 'system' = theme === 'light' ? 'light' : theme === 'dark' ? 'dark' : 'system';
      await page.evaluate((mode: 'light' | 'dark' | 'system') => { window.__summary.theme(mode); window.__summary.patch('t', { artifacts: ['目录/'.repeat(15) + '超长文件名'.repeat(20) + '.txt'], sources: ['https://example.invalid/' + 'longpath'.repeat(30)] }); }, mode);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await expect(summary).not.toContainText('不应采用的过期摘要');
      await expect(summary).not.toContainText('旧计划');
      await expect(summary.locator('.status')).toBeVisible();
      expect(await summary.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0.5);
      const destination = page.locator('[data-turn-key="second"] [data-plan-step="9"]');
      const jump = summary.getByRole('button', { name: /^定位计划步骤 10：/ });
      await jump.focus(); await jump.press('Enter');
      await expect(destination).toBeFocused();
      expect(await destination.evaluate(element => {
        const scroller = element.closest('.disclosure-content')!;
        const step = element.getBoundingClientRect(); const viewport = scroller.getBoundingClientRect();
        return step.top >= viewport.top && step.bottom <= viewport.bottom;
      })).toBe(true);
      await expect(page.locator('[data-turn-key="second"] [data-disclosure^="plan:"] button')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('[data-turn-key="first"] [data-disclosure^="plan:"] button')).toHaveAttribute('aria-expanded', 'false');
      await expect.poll(() => destination.evaluate(element => {
        const root = element.closest('.timeline')!;
        const rect = element.getBoundingClientRect(); const viewport = root.getBoundingClientRect();
        return Math.abs(rect.top + rect.height / 2 - viewport.top - root.clientHeight / 2);
      })).toBeLessThanOrEqual(0.5);
      const state = await page.evaluate(() => window.__summary.snapshot());
      expect(state.ui.threads.t.folds).toMatchObject({ unrelated: true, 'plan:second': true });
      expect(state.ui.reviewOpen).toBe(false);
      if (viewport.width < 1100) expect(state.ui.summaryOpen).toBe(false);
      await expect.poll(() => page.evaluate(() => window.__summary.snapshot().ui.threads.t.scroll?.follow)).toBe(false);
      const top = await page.locator('.timeline').evaluate(node => node.scrollTop);
      await page.evaluate(() => { const thread = window.__summary.snapshot().threads[0]; window.__summary.patch('t', { items: thread.items.map(item => item.id === 'answer-3' ? { ...item, text: item.text + '\n新流式内容'.repeat(30) } : item) }); });
      expect(Math.abs(await page.locator('.timeline').evaluate(node => node.scrollTop) - top)).toBeLessThanOrEqual(0.5);
    });
  }
}

test('summary targets the selected approval by id, including duplicate tools and another task', async () => {
  await page.goto(url);
  await page.evaluate(() => window.__summary.approvals([
    { id: 'first-approval', threadId: 't', tool: 'bash', description: '第一项命令', kind: 'action' },
    { id: 'second-approval', threadId: 't', tool: 'bash', description: '第二项命令', kind: 'action' },
    { id: 'other-approval', threadId: 'other', tool: 'bash', description: '其他任务命令', kind: 'action' },
  ]));
  const summary = page.getByRole('region', { name: '任务摘要', exact: true });
  await expect(summary.getByRole('heading', { name: '待处理 · 2' })).toBeVisible();
  await summary.getByRole('button', { name: /第二项命令/ }).click();
  await expect(page.locator('[data-approval-id="second-approval"]')).toBeFocused();
  await expect(summary).not.toContainText('其他任务命令');
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-approval-id="second-approval"]').getByRole('button', { name: '拒绝', exact: true })).toBeFocused();
});

test('summary Git loading and retries isolate stale success and errors across selections', async () => {
  await page.goto(url);
  const summary = page.getByRole('region', { name: '任务摘要', exact: true });
  await expect(summary.getByRole('region', { name: '项目文件变更' })).toHaveCount(0);
  await page.evaluate(() => window.__summary.holdGit(true));
  await refreshSummary();
  await expect(summary.getByRole('status')).toHaveText('正在读取 Git 变更…');
  await refreshSummary();
  await expect.poll(() => page.evaluate(() => window.__summary.pending().length)).toBe(2);
  await page.evaluate(() => { const pending = window.__summary.pending(); window.__summary.complete(pending[1].id, 'SUMMARY_GIT_ERROR'); window.__summary.complete(pending[0].id, { available: true, branch: 'old', files: [{ path: 'OLD.txt', staged: false, status: 'M' }] }); });
  await expect(summary.getByRole('alert')).toContainText('SUMMARY_GIT_ERROR');
  await expect(summary).not.toContainText('OLD.txt');
  await page.getByRole('button', { name: '重试读取变更', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__summary.pending().length)).toBe(1);
  await page.evaluate(() => window.__summary.select('other'));
  await expect(summary).toHaveAttribute('data-thread-id', 'other');
  await summary.getByRole('button', { name: '查看全部', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__summary.pending().some(item => item.threadId === 'other'))).toBe(true);
  await page.evaluate(() => { for (const request of window.__summary.pending()) window.__summary.complete(request.id, request.threadId === 't' ? 'OLD_TASK_ERROR' : { available: true, branch: 'main', files: [{ path: 'NEW.txt', status: 'M', staged: false }] }); });
  // The summary does not list files; the branch row is what proves the fresh read landed here.
  await expect(summary.getByRole('button', { name: /查看项目变更：main，1 个文件/ })).toBeVisible();
  await expect(page.getByText('OLD_TASK_ERROR')).toHaveCount(0);
  await expect(summary.getByRole('alert')).toHaveCount(0);
});

test('plan navigation is cancelled by new user input and cannot steal focus after switching tasks', async () => {
  await page.goto(url);
  await page.getByRole('button', { name: '查看全部', exact: true }).click();
  const jump = page.getByRole('button', { name: /^定位计划步骤 10：/ });
  await jump.evaluate((button: HTMLButtonElement) => button.click());
  await page.locator('.timeline').dispatchEvent('wheel', { deltaY: -20 });
  await page.getByLabel('向 Pi 发送消息').focus();
  await expect(page.locator('[data-disclosure="plan:second"]')).toHaveAttribute('data-phase', 'expanded');
  await expect.poll(() => page.locator('.disclosure-motion').evaluateAll(elements => elements.some(element => element.getAnimations().some(animation => animation.playState === 'running')))).toBe(false);
  await expect(page.getByLabel('向 Pi 发送消息')).toBeFocused();
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('.summary-step')].find(button => button.getAttribute('aria-label')?.startsWith('定位计划步骤 11：'))!;
    button.click(); window.__summary.select('other');
  });
  await expect(page.getByRole('region', { name: '任务摘要', exact: true })).toHaveAttribute('data-thread-id', 'other');
  await expect(page.locator('[data-disclosure="plan:second"] button')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-plan-step]')).toHaveCount(0);
});

test('streaming prose does not poll Git or replace the summary plan and cleared plans stay hidden', async () => {
  await page.goto(url);
  const summary = page.getByRole('region', { name: '任务摘要', exact: true });
  await expect(summary.getByRole('heading', { name: '计划 · 6/18' })).toBeVisible();
  await page.clock.install();
  const before = await page.evaluate(() => window.__summary.calls().filter(call => call.op === 'git.status').length);
  await page.evaluate(() => { for (let i = 0; i < 20; i++) { const thread = window.__summary.snapshot().threads[0]; window.__summary.patch('t', { items: thread.items.map(item => item.id === 'answer-3' ? { ...item, text: item.text + '内容' } : item) }); } });
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => window.__summary.calls().filter(call => call.op === 'git.status').length)).toBe(before);
  await page.evaluate(() => { const thread = window.__summary.snapshot().threads[0]; window.__summary.patch('t', { plans: { ...thread.plans, second: [] } }); });
  await expect(summary.getByRole('region', { name: '任务计划' })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test('summary stays a compact independent card with optional review: ' + theme, async () => {
    await page.setViewportSize({ width: 1440, height: 940 });
    await page.goto(url);
    await page.evaluate(theme => {
      window.__summary.theme(theme);
      window.__summary.patch('t', { title: '调整桌面工作台', plans: {}, plan: [], mcp: [{ id: '项目工具', state: 'connected', tools: [] }] });
      window.__summary.git({ available: true, branch: 'feature/desktop-workspace', stats: { added: 128, removed: 24 }, files: Array.from({ length: 5531 }, (_, i) => ({ path: 'example-' + i + '.txt', status: '??', staged: false })) });
    }, theme);
    const summary = page.getByRole('region', { name: '任务摘要', exact: true });
    await expect(summary.getByRole('button', { name: /查看项目变更/ })).toContainText('+128');
    await expect(page.getByRole('tablist', { name: '任务标签', exact: true })).toHaveCount(0);
    await expect(page.locator('.review-pane')).toHaveCount(0);
    await expect(summary).not.toContainText('??');
    // Source rows are a left-aligned list: `.btn` centers its content, which the rows must opt out of.
    const source = summary.locator('.summary-source').first();
    const sourceBox = (await source.boundingBox())!, iconBox = (await source.locator('svg').first().boundingBox())!;
    expect(iconBox.x - sourceBox.x).toBeCloseTo(2, 0);
    const box = (await summary.boundingBox())!;
    const toolbar = (await page.locator('.toolbar').boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(302);
    expect(box.height).toBeLessThan(300);
    expect(box.y - toolbar.y - toolbar.height).toBeCloseTo(16, 0);
    expect(1440 - box.x - box.width).toBeCloseTo(16, 0);
    await expect(page.locator('.main')).toHaveCSS('border-left-width', '1px');
    await expect(page.locator('.main')).toHaveCSS('border-left-style', 'solid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
    if (process.env.PI_DESKTOP_VISUAL_EVIDENCE === '1') {
      const artifacts = fileURLToPath(new URL('../../../../.artifacts/desktop-ui-fixes/', import.meta.url));
      await mkdir(artifacts, { recursive: true });
      await page.screenshot({ path: join(artifacts, 'summary-' + theme + '.png') });
    }
    await page.getByLabel('向 Pi 发送消息').fill('保留原有草稿');
    const before = await page.evaluate(() => window.__summary.calls().filter(call => call.op === 'thread.send').length);
    await summary.getByRole('button', { name: '建议审查改动' }).click();
    await expect(page.getByLabel('向 Pi 发送消息')).toHaveValue('保留原有草稿');
    expect(await page.evaluate(() => window.__summary.calls().filter(call => call.op === 'thread.send').length)).toBe(before);
    expect(await page.evaluate(() => window.__summary.calls().filter(call => call.op === 'review.start').length)).toBe(0);
    await expect(page.getByRole('region', { name: '只读审查', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭辅助栏', exact: true }).click();
    await summary.getByRole('button', { name: '查看全部', exact: true }).click();
    // Expanding no longer repeats the changed files: the branch row is the single entry point.
    await expect(summary.locator('.summary-file')).toHaveCount(0);
    await expect(summary.getByRole('button', { name: /查看项目变更/ })).toBeVisible();
    await taskAction(page, '查看变更');
    await page.getByRole('tab', { name: /^变更/ }).click();
    await expect(page.getByRole('tab', { name: /^变更/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: '摘要', exact: true })).toHaveCount(0);
    await expect(page.locator('.git-file-row').first()).toContainText('未跟踪');
    await page.getByRole('button', { name: '关闭辅助栏', exact: true }).click();
    await expect(summary).toBeVisible();
    await page.getByRole('button', { name: '任务摘要', exact: true }).click();
    await expect(summary).toHaveCount(0);
    expect(await page.evaluate(() => window.__summary.snapshot().ui.summaryOpen)).toBe(false);
    await page.getByRole('button', { name: '任务摘要', exact: true }).click();
    await expect(summary).toBeVisible();
  });
}

test('an empty new task does not open changes or summary, and summary can be opened explicitly', async () => {
  await page.goto(url);
  await page.evaluate(() => window.__summary.patch('t', { items: [], plans: {}, plan: [] }));
  await expect(page.locator('.task-tabs, .review-pane, .task-summary-rail')).toHaveCount(0);
  await page.getByLabel('视图菜单', { exact: true }).click();
  await page.getByRole('menuitem', { name: '任务摘要', exact: true }).click();
  await expect(page.getByRole('region', { name: '任务摘要', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '建议审查改动' })).toHaveCount(0);
  await page.getByRole('button', { name: '摘要操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '隐藏摘要', exact: true }).click();
  await expect(page.locator('.task-summary-rail')).toHaveCount(0);
});

test('compact toolbar keeps secondary actions in a keyboard-accessible menu', async () => {
  await page.goto(url);
  await expect(page.locator('.toolbar-actions button')).toHaveCount(4);
  for (const name of ['项目目录', 'Worktree 管理', '在独立窗口打开', '集成终端', '查看子智能体'])
    await expect(page.locator('.toolbar-actions').getByRole('button', { name, exact: true })).toHaveCount(0);
  const more = page.getByRole('button', { name: '工作台更多操作', exact: true });
  for (const [name, title] of [['项目目录', '项目目录'], ['Worktree 管理', 'Worktree 管理'], ['设置持续目标', '持续目标']]) {
    await more.click();
    await page.getByRole('menuitem', { name, exact: true }).click();
    await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(more).toBeFocused();
  }
  // The subtask entry switches the auxiliary pane instead of opening a dialog of its own.
  await more.click();
  await page.getByRole('menuitem', { name: '查看子智能体', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.review-pane')).toBeVisible();
  await expect(page.locator('.review-pane [role="tab"][aria-selected="true"]')).toContainText('子智能体');
  await more.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '在独立窗口打开', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
});

test('summary and tool pane stay independent across narrow and wide layouts', async () => {
  await page.goto(url);
  await page.getByLabel('向 Pi 发送消息').fill('并排和浮层切换保留草稿');
  await page.getByRole('button', { name: '辅助栏', exact: true }).click();
  const summary = page.locator('.task-summary-rail');
  const pane = page.locator('.review-pane');
  for (const theme of ['light', 'dark'] as const) for (const locale of ['zh-CN', 'en-US'] as const) {
    await page.evaluate(async ({ theme, locale }) => {
      window.__summary.theme(theme);
      const ui = window.__summary.snapshot().ui;
      await window.desktop.invoke({ op: 'ui.update', ui: { ...ui, locale, sidebarWidth: 275, reviewWidth: 390 } });
    }, { theme, locale });
    for (const width of [1920, 1440, 1280, 1000]) {
      await page.setViewportSize({ width, height: width >= 1440 ? 940 : 700 });
      await expect(summary).toBeVisible(); await expect(pane).toBeVisible();
      if (width === 1920) await expect(page.locator('.conversation-layout')).not.toHaveClass(/summary-overlay/);
      else await expect(page.locator('.conversation-layout')).toHaveClass(/summary-overlay/);
      await expect.poll(async () => (await page.locator('.conversation').boundingBox())!.width).toBeGreaterThanOrEqual(560);
      if (width === 1000) await expect(page.locator('.conversation-layout')).toHaveClass(/auxiliary-overlay/);
      const card = (await summary.boundingBox())!, tool = (await pane.boundingBox())!, middle = (await page.locator('.conversation').boundingBox())!;
      expect(card.x + card.width).toBeLessThanOrEqual(tool.x);
      expect(middle.width).toBeGreaterThanOrEqual(560);
      if (width === 1000) expect(tool.y + tool.height).toBeLessThanOrEqual((await page.locator('.composer').boundingBox())!.y);
      expect(await page.locator('.toolbar-actions').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      if (process.env.PI_DESKTOP_CAPTURE === '1' && locale === 'zh-CN' && theme === 'light' && [1440, 1000].includes(width)) {
        const evidence = fileURLToPath(new URL('../../../../.artifacts/toolbar-summary/', import.meta.url));
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: join(evidence, 'coexist-' + width + '.png') });
      }
    }
  }
  await page.evaluate(async () => { const ui = window.__summary.snapshot().ui; await window.desktop.invoke({ op: 'ui.update', ui: { ...ui, locale: 'zh-CN', sidebarWidth: 520, reviewWidth: 760 } }); });
  await expect(page.locator('.conversation-layout')).toHaveClass(/summary-stacked/);
  await expect.poll(async () => {
    const card = (await summary.boundingBox())!, tool = (await pane.boundingBox())!;
    return card.y + card.height <= tool.y;
  }).toBe(true);
  const stackedPane = (await pane.boundingBox())!, input = (await page.locator('.composer').boundingBox())!;
  expect(stackedPane.y + stackedPane.height).toBeLessThanOrEqual(input.y);
  expect(stackedPane.height).toBeGreaterThan(100);
  await page.getByRole('button', { name: '任务摘要', exact: true }).click();
  await expect(summary).toHaveCount(0); await expect(pane).toBeVisible();
  await page.getByLabel('视图菜单', { exact: true }).click();
  await page.getByRole('menuitem', { name: '任务摘要', exact: true }).click();
  await expect(summary).toBeVisible(); await expect(pane).toBeVisible();
  await page.getByRole('button', { name: '辅助栏', exact: true }).click();
  await expect(pane).toHaveCount(0); await expect(summary).toBeVisible();
  await expect(page.getByLabel('向 Pi 发送消息')).toHaveValue('并排和浮层切换保留草稿');
});
