import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Browser, type Page, chromium, expect, test } from '@playwright/test';
import type { Settings } from '../../src/shared/contracts.ts';
import type {} from './fixtures/resources-harness.tsx';

let browser: Browser;
let page: Page;
let directory: string;
let url: string;
let errors: string[];
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-resource-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/resources-harness.tsx', import.meta.url))], outfile: join(directory, 'harness.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root" style="display:flex;height:100vh"></div><link rel="stylesheet" href="harness.css"><script src="harness.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1000, height: 640 } }); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(async () => { await page.close(); expect(errors).toEqual([]); });
test.afterAll(async () => { await browser?.close(); });
test.afterAll(cleanupTemporaryDirectories);
const row = (name: string) => page.locator('.resource-list .field-row').filter({ has: page.locator('.field-row-title').getByText(name, { exact: true }) });

test('resource details ignore late success and failures after another selection or closing', async () => {
  await page.goto(url);
  await page.evaluate(() => window.__resources.hold('resource.open', true));
  await row('Alpha').getByRole('button', { name: '详情', exact: true }).click();
  const first = await page.evaluate(() => window.__resources.pending('resource.open')[0].id);
  await row('Beta').getByRole('button', { name: '详情', exact: true }).click();
  await page.evaluate(() => window.__resources.complete(window.__resources.pending('resource.open').at(-1)!.id));
  await expect(page.getByRole('region', { name: '资源详情 Beta' })).toContainText('BETA_BODY');
  await page.evaluate(id => window.__resources.complete(id, { error: 'STALE_FAILURE' }), first);
  await expect(page.getByText('STALE_FAILURE')).toHaveCount(0);
  await row('Alpha').getByRole('button', { name: '详情', exact: true }).click();
  await expect(page.getByRole('region', { name: '资源详情 Alpha' })).toBeFocused();
  await page.getByRole('region', { name: '资源详情 Alpha' }).press('Escape');
  await expect(row('Alpha').getByRole('button', { name: '详情', exact: true })).toBeFocused();
  await page.evaluate(() => window.__resources.complete(window.__resources.pending('resource.open')[0].id));
  await expect(page.locator('#resource-detail')).toHaveCount(0);
});

test('resource details retry failures, keep keyboard focus and protect composition dismissal', async () => {
  await page.goto(url);
  await page.evaluate(() => window.__resources.hold('resource.open', true));
  const trigger = row('Alpha').getByRole('button', { name: '详情', exact: true });
  await trigger.click();
  await page.evaluate(() => window.__resources.complete(window.__resources.pending('resource.open')[0].id, { error: 'READ_FAILED' }));
  await expect(page.getByRole('alert')).toHaveText('READ_FAILED');
  await page.getByRole('button', { name: '重试读取' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: '资源详情 Alpha' })).toBeFocused();
  await page.evaluate(() => window.__resources.complete(window.__resources.pending('resource.open')[0].id));
  const detail = page.getByRole('region', { name: '资源详情 Alpha' });
  await expect(detail).toContainText('ALPHA_BODY');
  await detail.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
  await expect(detail).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('creation submits once and retains failed drafts; changes remain available during running tasks', async () => {
  await page.goto(url);
  await page.getByRole('button', { name: '创建 Skill', exact: true }).click();
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.locator('#skill-name')).toBeFocused();
  await expect(page.getByRole('status')).toContainText('请填写');
  await page.locator('#skill-name').fill('新资源');
  await page.locator('#skill-content').fill('DRAFT_BODY');
  await page.evaluate(() => window.__resources.hold('resource.create', true));
  await page.getByRole('button', { name: '创建', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => window.__resources.pending('resource.create').length)).toBe(1);
  await expect(page.locator('#skill-content')).toBeDisabled();
  await page.evaluate(() => window.__resources.complete(window.__resources.pending('resource.create')[0].id, { error: 'CREATE_FAILED' }));
  await expect(page.locator('#skill-content')).toHaveValue('DRAFT_BODY');
  await expect(page.getByRole('status')).toContainText('CREATE_FAILED');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.evaluate(() => window.__resources.complete(window.__resources.pending('resource.create')[0].id));
  await expect(page.getByRole('status')).toHaveText('已创建 新资源');
  await expect(page.getByRole('button', { name: '创建 Skill', exact: true })).toBeFocused();
  await expect(row('新资源')).toBeVisible();
  await page.evaluate(() => window.__resources.changeThread({ status: 'running' }));
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '导入', exact: true })).toBeEnabled();
  await page.getByLabel('启用 Alpha', { exact: true }).uncheck();
  await expect(page.getByLabel('启用 Alpha', { exact: true })).not.toBeChecked();
  expect(await page.evaluate(() => window.__resources.calls().filter(call => call.op === 'settings.patch').at(-1))).toMatchObject({ patch: { resources: [expect.objectContaining({ id: 'alpha', enabled: false }), expect.anything(), expect.anything(), expect.anything()] } });
  await expect(page.getByLabel('移除 Alpha', { exact: true })).toBeEnabled();
  await row('Alpha').getByRole('button', { name: '详情', exact: true }).click();
  await expect(page.getByRole('region', { name: '资源详情 Alpha' })).toContainText('ALPHA_BODY');
});

test('source inspection isolates stale responses, retries failures and avoids streaming refresh loops', async () => {
  await page.goto(url + '?hold-check');
  await expect.poll(() => page.evaluate(() => window.__resources.pending('resource.inspect').length)).toBeGreaterThan(0);
  const initial = await page.evaluate(() => window.__resources.pending('resource.inspect').map(item => item.id));
  await page.evaluate(() => window.__resources.changeResources([{ id: 'new', name: 'New', path: 'C:/shared/new/SKILL.md', kind: 'skill', enabled: true }]));
  await expect.poll(() => page.evaluate(() => window.__resources.pending('resource.inspect').at(-1)!.id)).toBeGreaterThan(initial.at(-1)!);
  await page.evaluate(() => window.__resources.complete(window.__resources.pending('resource.inspect').at(-1)!.id));
  await page.evaluate(ids => { for (const id of ids) window.__resources.complete(id, { error: 'OLD_INSPECTION_ERROR' }); }, initial);
  await expect(page.getByRole('region', { name: '资源源文件检查' })).toContainText('0 条诊断');
  await expect(page.getByText('OLD_INSPECTION_ERROR')).toHaveCount(0);
  const before = await page.evaluate(() => window.__resources.calls().filter(call => call.op === 'resource.inspect').length);
  await page.evaluate(() => { for (let n = 0; n < 20; n++) window.__resources.changeThread({ updatedAt: n + 10 }); });
  expect(await page.evaluate(() => window.__resources.calls().filter(call => call.op === 'resource.inspect').length)).toBe(before);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__resources.pending('resource.inspect').length)).toBe(1);
  await page.evaluate(() => window.__resources.complete(window.__resources.pending('resource.inspect')[0].id, { error: 'CHECK_FAILED' }));
  await expect(page.getByRole('alert')).toContainText('CHECK_FAILED');
  await page.getByRole('button', { name: '重试检查' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: '资源源文件检查' })).toBeFocused();
  await page.evaluate(() => window.__resources.complete(window.__resources.pending('resource.inspect')[0].id));
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('stale resource toggles cannot report success or change a replacement source', async () => {
  for (const replaced of [false, true]) {
    await page.goto(url);
    await expect(row('Alpha')).toBeVisible();
    await page.evaluate(() => window.__resources.hold('bootstrap', true));
    await page.getByLabel('启用 Alpha', { exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__resources.pending('bootstrap').length)).toBe(1);
    await page.evaluate(replaced => {
      window.__resources.changeResources(replaced ? [{ id: 'alpha', name: '替换来源', kind: 'skill', path: 'C:/shared/replaced/SKILL.md', enabled: true }] : []);
      window.__resources.complete(window.__resources.pending('bootstrap')[0].id);
    }, replaced);
    await expect(page.getByRole('status')).toContainText('资源不存在');
    expect(await page.evaluate(() => window.__resources.calls().filter(item => item.op === 'settings.patch'))).toHaveLength(0);
    if (replaced) await expect(page.getByLabel('启用 替换来源', { exact: true })).toBeChecked();
    await page.evaluate(() => window.__resources.locale('en-US'));
    await expect(page.getByRole('status')).toContainText('Resource not found');
  }
});

test('reimport enables the current resource without restoring metadata captured before the picker closed', async () => {
  await page.goto(url);
  await page.evaluate(() => window.__resources.hold('resource.pick', true));
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '导入 SKILL.md' }).click();
  await page.evaluate(() => {
    const old = { id: 'alpha', name: 'Alpha', kind: 'skill' as const, path: 'C:/shared/alpha/SKILL.md', enabled: true };
    window.__resources.changeResources([{ ...old, name: '其他窗口重命名', enabled: false }]);
    window.__resources.complete(window.__resources.pending('resource.pick')[0].id, { value: old });
  });
  await expect(page.getByLabel('启用 其他窗口重命名', { exact: true })).toBeChecked();
  expect(await page.evaluate(() => window.__resources.calls().filter(item => item.op === 'settings.patch').at(-1))).toMatchObject({ patch: { resources: [expect.objectContaining({ id: 'alpha', name: '其他窗口重命名', enabled: true })] } });
});

test('invalid inspections give concise localized feedback and retry clicks issue one request', async () => {
  await page.goto(url + '?hold-check');
  await expect(row('Alpha')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__resources.pending('resource.inspect').length)).toBeGreaterThan(0);
  await page.evaluate(() => { for (const item of window.__resources.pending('resource.inspect')) window.__resources.complete(item.id, { value: {} }); });
  await expect(page.getByRole('alert')).toHaveText('源文件检查失败：资源内容格式无效');
  const reads = await page.evaluate(() => window.__resources.calls().filter(item => item.op === 'resource.inspect').length);
  await page.evaluate(() => window.__resources.locale('en-US'));
  await expect(page.getByRole('alert')).toHaveText('Source check failed: Invalid resource content');
  expect(await page.evaluate(() => window.__resources.calls().filter(item => item.op === 'resource.inspect').length)).toBe(reads);
  await page.getByRole('button', { name: 'Retry checks', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  expect(await page.evaluate(() => window.__resources.pending('resource.inspect').length)).toBe(1);
  await page.evaluate(() => window.__resources.complete(window.__resources.pending('resource.inspect')[0].id));
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('resource patch conflicts preserve the current resource and the collapsed creation draft for retry', async () => {
  await page.goto(url);
  await page.getByRole('button', { name: '创建 Skill', exact: true }).click();
  await page.locator('#skill-name').fill('仍在编辑');
  await page.locator('#skill-content').fill('UNSAVED_SKILL_DRAFT');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => window.__resources.hold('settings.patch', true));
  await page.getByLabel('启用 Alpha', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__resources.pending('settings.patch').length)).toBe(1);
  await page.evaluate(() => window.__resources.complete(window.__resources.pending('settings.patch')[0].id, { error: '设置已在其他位置修改，当前草稿已保留。请重新打开设置后重试。' }));
  await expect(page.getByLabel('启用 Alpha', { exact: true })).toBeChecked();
  await page.evaluate(() => window.__resources.locale('en-US'));
  await expect(page.getByRole('status')).toContainText('Settings changed elsewhere');
  await page.getByRole('button', { name: 'Create skill', exact: true }).click();
  await expect(page.locator('#skill-name')).toHaveValue('仍在编辑');
  await expect(page.locator('#skill-content')).toHaveValue('UNSAVED_SKILL_DRAFT');
  await page.getByLabel('Enable Alpha', { exact: true }).click();
  await page.evaluate(() => window.__resources.complete(window.__resources.pending('settings.patch')[0].id));
  await expect(page.getByLabel('Enable Alpha', { exact: true })).not.toBeChecked();
  await expect(page.locator('#skill-content')).toHaveValue('UNSAVED_SKILL_DRAFT');
});

test('resource search, long source paths and details stay usable across themes and window sizes', async () => {
  await page.goto(url);
  const path = 'C:/' + '很长的来源目录/'.repeat(40) + 'SKILL.md';
  await page.evaluate(path => window.__resources.changeResources([{ id: 'long', name: '长路径资源', kind: 'skill', path, enabled: true }]), path);
  await expect(page.getByText('描述 long', { exact: true })).toBeVisible();
  await page.getByLabel('搜索 Skills 与扩展').fill('描述 long');
  await expect(row('长路径资源')).toBeVisible();
  await page.getByLabel('搜索 Skills 与扩展').fill('没有的名称');
  await expect(page.getByText('没有匹配的资源')).toBeVisible();
  await page.getByLabel('搜索 Skills 与扩展').fill('');
  await row('长路径资源').getByRole('button', { name: '详情', exact: true }).click();
  for (const theme of ['light', 'dark', 'system-light', 'system-dark']) {
    await page.emulateMedia({ colorScheme: theme.endsWith('dark') ? 'dark' : 'light' });
    await page.evaluate(value => window.__resources.theme(value), (theme.startsWith('system') ? 'system' : theme) as Settings['theme']);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.startsWith('system') ? 'system' : theme);
    for (const [width, height] of [[1000, 640], [1280, 800], [1440, 940]]) {
      await page.setViewportSize({ width, height });
      const geometry = await page.locator('.skills-page').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
      expect(geometry.scroll - geometry.width).toBeLessThanOrEqual(0.5);
      await expect(row('长路径资源').getByRole('button', { name: '打开文件位置', exact: true })).toBeVisible();
    }
  }
  const history = page.getByRole('region', { name: '任务资源加载记录' });
  await history.locator('summary').click();
  await expect(history).toContainText('RUNTIME_EXTENSION_FAILURE');
  await history.getByRole('button', { name: '打开任务' }).click();
  await expect.poll(() => page.evaluate(() => window.__resources.calls().some(call => call.op === 'ui.update' && call.ui.view === 'thread' && call.ui.activeThreadId === 't'))).toBe(true);
});
