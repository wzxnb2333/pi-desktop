import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Browser, type Page, chromium, expect, test } from '@playwright/test';
import type { DesktopRequest } from '../../src/shared/contracts.ts';

declare global {
  interface Window {
    __settingsRequests: DesktopRequest[];
    __failProviderKey: string;
  }
}

/*
 * The settings frame, driven in a real browser against the real component.
 *
 * Same isolated-harness pattern as `primitives.spec.ts`: esbuild bundles the component plus the real
 * `styles/index.css` into a temp directory, plain Chromium opens it, and the app's own `invoke` is
 * replaced by a stub. That is what lets the geometry be measured in the cascade it actually ships in
 * without launching Electron, and it keeps the assertions independent of whichever task is running.
 *
 * The harness is a string rather than a file under `test/e2e/fixtures` so this spec owns its own mount
 * point: `esbuild` resolves the relative imports through `stdin.resolveDir`.
 */
const harness = `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  defaultData,
  type DesktopData,
  type DesktopRequest,
  type Settings as SettingsType,
  settingsSchema,
  threadSchema,
} from '../../../src/shared/contracts.ts';
import { Settings } from '../../../src/renderer/src/Settings.tsx';
import { applySettingsPatch } from '../../../src/shared/settings-updates.ts';
import { setLocale } from '../../../src/shared/localization.ts';
import '../../../src/renderer/src/styles/index.css';

const base: DesktopData = {
  ...defaultData(),
  projects: [{ id: 'project', name: '示例项目', path: 'C:/work/示例', trusted: false, createdAt: 0 }],
  settings: settingsSchema.parse({
    providerId: 'model-1',
    providers: [
      { id: 'model-1', name: '测试模型', provider: 'openai', model: 'gpt-4.1', baseUrl: '', hasKey: true },
    ],
    resources: [],
    mcpServers: [],
  }),
};
const scenario = new URLSearchParams(location.search).get('scenario');
base.ui.locale = new URLSearchParams(location.search).get('locale') === 'en-US' ? 'en-US' : 'zh-CN';
setLocale(base.ui.locale);
if (scenario === 'override') base.settings.providers[0].baseUrl = 'http://localhost:9876/v1';
if (scenario === 'missing') base.settings.providers[0].model = 'deepseek-flash';
if (scenario === 'keys') base.settings.providers.push({ ...base.settings.providers[0], id: 'model-2', name: '第二模型', hasKey: false });
if (scenario === 'many') for (let index = 2; index <= 16; index++) base.settings.providers.push({ ...base.settings.providers[0], id: 'model-' + index, name: '模型 ' + index, hasKey: false });
if (scenario === 'empty') { base.settings.providers = []; base.settings.providerId = ''; }
window.__settingsRequests = [];
window.__failProviderKey = '';
const catalog = [
  { id: 'openai', models: [
    { id: 'gpt-4.1', name: 'GPT 4.1', api: 'openai-responses', reasoning: false, thinkingLevels: ['off'], contextWindow: 128000, maxTokens: 8192 },
    { id: 'gpt-4.1-mini', name: 'GPT 4.1 mini', api: 'openai-responses', reasoning: false, thinkingLevels: ['off'], contextWindow: 128000, maxTokens: 8192 },
  ] },
  { id: 'opencode-go', models: [
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek Flash', api: 'openai-completions', reasoning: true, thinkingLevels: ['low', 'high'], contextWindow: 256000, maxTokens: 16384 },
  ] },
];
let catalogAttempts = 0;
const busyThread = threadSchema.parse({
  id: 'busy',
  projectId: 'project',
  title: '运行中的任务',
  cwd: 'C:/work/示例',
  providerId: 'model-1',
  thinking: 'medium',
  policy: 'ask',
  status: 'running',
  createdAt: 0,
  updatedAt: 0,
});

function Harness() {
  const [ops, setOps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SettingsType | null>(null);
  const [generation, setGeneration] = useState(0);
  const data: DesktopData = { ...base, settings: saved ?? base.settings, threads: busy ? [busyThread] : [] };
  const invoke = async (request: DesktopRequest): Promise<unknown> => {
    if (request.op === 'models.catalog') {
      if (scenario === 'catalog-error' || (scenario === 'catalog-retry' && catalogAttempts++ === 0)) throw new Error('fixture catalog failure');
      return catalog;
    }
    window.__settingsRequests.push(request);
    if (request.op === 'window.shortcut') return { requested: '', registered: '', error: '' };
    if (request.op === 'provider.key' && request.id === window.__failProviderKey) {
      window.__failProviderKey = '';
      throw new Error('KEY_SAVE_FAILED');
    }
    setOps((prev) => [...prev, request.op]);
    if (request.op === 'settings.patch') {
      const next = applySettingsPatch(data.settings, request.patch, request.base);
      setSaved(next);
      return next;
    }
    return null;
  };
  return (
    <>
      <button type="button" data-testid="busy" onClick={() => setBusy((prev) => !prev)}>
        让一个任务运行中
      </button>
      <p data-testid="ops">{ops.join(' ')}</p>
      <pre hidden data-testid="saved">{JSON.stringify(saved)}</pre>
      <button type="button" data-testid="remount" onClick={() => setGeneration((value) => value + 1)}>重新载入设置</button>
      <Settings key={generation} data={data} invoke={invoke} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
`;
const html = [
  '<!doctype html><meta charset="utf-8">',
  '<body><div id="root"></div>',
  '<link rel="stylesheet" href="./harness.css">',
  '<script src="./harness.js"></script>',
].join('');

let browser: Browser;
let pageUrl = '';
let page: Page;

test.beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-settings-'));
  await build({
    stdin: {
      contents: harness,
      // Resolves the harness's relative imports against the repo, like the fixture files do.
      resolveDir: fileURLToPath(new URL('./fixtures', import.meta.url)),
      sourcefile: 'settings-harness.tsx',
      loader: 'tsx',
    },
    outfile: join(dir, 'harness.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  await writeFile(join(dir, 'index.html'), html);
  browser = await chromium.launch();
  pageUrl = pathToFileURL(join(dir, 'index.html')).href;
});

// A fresh context per test so the draft state cannot leak from one save into the next.
test.beforeEach(async () => {
  page = await browser.newPage();
  await page.goto(pageUrl);
});

test.afterEach(async () => {
  await page.close();
});

test.afterAll(async () => {
  await browser?.close();
});
test.afterAll(cleanupTemporaryDirectories);

const heading = () => page.locator('.settings-page h1');
const status = () => page.locator('.settings-footer').getByRole('status');
const levelNames: Record<string, string> = { off: '关闭思考', minimal: '极低', low: '低', medium: '中等', high: '高', xhigh: '极高', max: '最高' };
/**
 * Rows are found by their title span rather than `getByLabel`: a row's accessible name also carries
 * its helper text, so only the controls the shared spec drives have an exact name (主题, 显示名称).
 */
const rowFor = (title: string) =>
  page.locator('.field-row').filter({ has: page.locator('.field-row-title', { hasText: new RegExp(`^${title}$`) }) });

test('the settings page opens on the model category with a labelled row per field', async () => {
  await expect(heading()).toBeVisible();
  await expect(page.getByRole('button', { name: '通用', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '测试模型' })).toHaveAttribute('aria-selected', 'true');
  await expect(rowFor('显示名称')).toHaveCSS('min-height', '60px');
  await expect(rowFor('上下文窗口')).toHaveCSS('min-height', '60px');
  await expect(rowFor('上下文窗口').locator('input')).toHaveCount(0);
  await expect(page.getByLabel('供应商', { exact: true })).toHaveRole('combobox');
  await expect(page.getByLabel('Base URL', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('API 协议', { exact: true })).toHaveCount(0);
  await expect(rowFor('默认模型')).toHaveCSS('min-height', '60px');
});

test('provider key drafts stay with their model and all pending keys save from another category', async () => {
  await page.goto(pageUrl + '?scenario=keys');
  await page.locator('input[type=password]').fill('fixture-first');
  await page.getByRole('tab', { name: '第二模型', exact: true }).click();
  await expect(page.locator('input[type=password]')).toHaveValue('');
  await page.locator('input[type=password]').fill('fixture-second');
  await page.getByRole('tab', { name: '测试模型', exact: true }).click();
  await expect(page.locator('input[type=password]')).toHaveValue('fixture-first');
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  const requests = await page.evaluate(() => window.__settingsRequests);
  expect(requests.filter(request => request.op === 'provider.key')).toMatchObject([
    { op: 'provider.key', id: 'model-1', key: 'fixture-first', base: { id: 'model-1', name: '测试模型', provider: 'openai', model: 'gpt-4.1', baseUrl: '' } },
    { op: 'provider.key', id: 'model-2', key: 'fixture-second', base: { id: 'model-2', name: '第二模型', provider: 'openai', model: 'gpt-4.1', baseUrl: '' } },
  ]);
  expect(JSON.stringify(requests.filter(request => request.op === 'settings.patch'))).not.toContain('fixture-');
  await page.getByRole('button', { name: '模型', exact: true }).click();
  for (const name of ['测试模型', '第二模型']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.locator('input[type=password]')).toHaveValue('');
    await expect(page.locator('input[type=password]')).toHaveAttribute('placeholder', '已加密保存；留空保持不变');
  }
});

test('model collection searches without losing drafts and supports vertical keyboard selection', async () => {
  await page.goto(pageUrl + '?scenario=many');
  await page.locator('input[type=password]').fill('retained-draft');
  const search = page.getByLabel('搜索名称、供应商或模型 ID');
  await search.fill('模型 16');
  const item = page.getByRole('tab', { name: '模型 16', exact: true });
  await expect(item).toHaveAttribute('tabindex', '0');
  await expect(item).toHaveAttribute('aria-selected', 'false');
  await item.click();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('模型 16');
  await search.fill('');
  await item.press('Home');
  await expect(page.getByRole('tab', { name: '测试模型', exact: true })).toBeFocused();
  await expect(page.locator('input[type=password]')).toHaveValue('retained-draft');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: '模型 2', exact: true })).toBeFocused();
  await search.fill('no-matching-provider');
  await expect(page.getByText('没有匹配的模型', { exact: true })).toBeVisible();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('模型 2');
  await page.getByRole('button', { name: '清除搜索' }).click();
  await search.fill('openai');
  await expect(page.getByRole('tab')).toHaveCount(16);
  expect(await page.locator('.model-tabs').evaluate(node => node.clientHeight < node.scrollHeight)).toBe(true);
});

test('model deletion confirms, selects the remaining model and preserves a valid default', async () => {
  await page.goto(pageUrl + '?scenario=keys');
  await page.locator('input[type=password]').fill('discard-with-removed-model');
  await page.getByRole('button', { name: '删除模型', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await dialog.press('Escape');
  await expect(page.locator('input[type=password]')).toHaveValue('discard-with-removed-model');
  await page.getByRole('button', { name: '删除模型', exact: true }).click();
  await dialog.getByRole('button', { name: '删除模型', exact: true }).click();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('第二模型');
  await expect(page.getByRole('button', { name: '当前默认', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  const saved = JSON.parse(await page.getByTestId('saved').textContent() ?? '{}');
  expect(saved.providerId).toBe('model-2');
  expect(saved.providers.map((provider: { id: string }) => provider.id)).toEqual(['model-2']);
  expect(await page.evaluate(() => window.__settingsRequests.filter(request => request.op === 'provider.key'))).toHaveLength(0);
  await page.getByRole('button', { name: '删除模型', exact: true }).click();
  await dialog.getByRole('button', { name: '删除模型', exact: true }).click();
  await expect(page.getByRole('heading', { name: '还没有模型' })).toBeVisible();
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('新模型');
});

test('invalid hidden model opens its editor without dropping other settings drafts', async () => {
  await page.goto(pageUrl + '?scenario=keys');
  await page.getByLabel('显示名称', { exact: true }).fill('');
  await page.getByRole('tab', { name: '第二模型', exact: true }).click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.locator('#settings-follow-up').selectOption('steer');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(heading()).toHaveText('模型');
  await expect(page.getByLabel('显示名称', { exact: true })).toBeFocused();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.model-editor [role=alert]')).toBeVisible();
  await page.getByLabel('显示名称', { exact: true }).fill('修复后的模型');
  await expect(page.locator('.model-editor [role=alert]')).toHaveCount(0);
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await expect(page.locator('#settings-follow-up')).toHaveValue('steer');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
});

test('settings groups distinguish draft changes, immediate preferences and local appearance preview', async () => {
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await expect(page.getByRole('region', { name: '界面与输入', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '通知与运行', exact: true })).toBeVisible();
  await page.locator('#settings-send-shortcut').selectOption('ctrl-enter');
  await expect(page.getByText('Ctrl + Enter 发送，Enter 换行', { exact: true })).toBeVisible();
  await expect(page.locator('.settings-save-hint')).toHaveText('有未保存的更改');
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.locator('#settings-theme').selectOption('dark');
  await expect(page.locator('.appearance-preview')).toHaveCSS('background-color', 'rgb(35, 35, 35)');
  await page.locator('#settings-code-font-size').fill('18');
  await page.locator('#settings-accentColor').fill('#123abc');
  await expect(page.locator('.appearance-preview code')).toHaveCSS('font-size', '18px');
  await expect(page.locator('.appearance-preview code')).toHaveCSS('color', 'rgb(18, 58, 188)');
  expect(await page.evaluate(() => window.__settingsRequests.filter(request => request.op === 'settings.patch'))).toHaveLength(0);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
});

test('compact model picker preserves drafts without consuming the editor viewport', async () => {
  // The isolated Settings harness has a smaller internal nav than the 240px app sidebar.
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(pageUrl + '?scenario=keys');
  const picker = page.locator('#settings-model-selection');
  await expect(picker).toBeVisible();
  await expect(page.locator('.model-tabs')).toBeHidden();
  await page.locator('input[type=password]').fill('compact-first-key');
  await picker.selectOption('model-2');
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('第二模型');
  await page.locator('input[type=password]').fill('compact-second-key');
  await picker.selectOption('model-1');
  await expect(page.locator('input[type=password]')).toHaveValue('compact-first-key');
  expect((await page.locator('.model-collection').boundingBox())!.height).toBeLessThan(90);
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('新模型');
  await page.getByRole('radio', { name: '自定义接口', exact: true }).check();
  await expect(page.getByLabel('Base URL', { exact: true })).toBeVisible();
  expect(await page.locator('.model-editor').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
});

test('failed key saves retain only unfinished credentials for a targeted retry', async () => {
  await page.goto(pageUrl + '?scenario=keys');
  await page.locator('input[type=password]').fill('fixture-first');
  await page.getByRole('tab', { name: '第二模型', exact: true }).click();
  await page.locator('input[type=password]').fill('fixture-second');
  await page.evaluate(() => { window.__failProviderKey = 'model-2'; });
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('KEY_SAVE_FAILED');
  await expect(page.locator('input[type=password]')).toHaveValue('fixture-second');
  await page.getByRole('tab', { name: '测试模型', exact: true }).click();
  await expect(page.locator('input[type=password]')).toHaveValue('');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  expect(await page.evaluate(() => window.__settingsRequests.filter(request => request.op === 'provider.key').map(request => request.id))).toEqual(['model-1', 'model-2', 'model-2']);
});

test('the category nav swaps one panel and keeps every control where it is', async () => {
  await expect(page.locator('.settings-nav button')).toHaveCount(8);
  await expect(page.getByRole('button', { name: '模型', exact: true })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await expect(rowFor('显示名称')).toHaveCount(0);
  const theme = page.getByLabel('主题', { exact: true });
  // A native <select>: the shared desktop spec drives it with selectOption, and the Menu primitive
  // would turn it into a button.
  await expect(theme).toHaveRole('combobox');
  await expect(rowFor('主题')).toHaveCSS('min-height', '60px');
  await theme.selectOption('dark');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByTestId('ops')).toHaveText('settings.patch');
  await page.getByRole('button', { name: '审批与信任', exact: true }).click();
  await expect(page.getByLabel('默认审批', { exact: true })).toHaveRole('combobox');
  await expect(page.getByRole('button', { name: '信任项目' })).toBeVisible();
});

test('keyboard overrides persist, reject conflicts and restore defaults', async () => {
  await page.getByRole('button', { name: '键盘快捷键', exact: true }).click();
  const control = page.getByLabel('新建任务 快捷键', { exact: true });
  await expect(control).toHaveValue('Ctrl+N');
  await control.press('Control+k');
  await expect(page.getByRole('alert')).toContainText('使用相同快捷键');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByTestId('ops')).toHaveText('');
  await control.press('Control+Alt+n');
  expect(await page.evaluate(() => window.__settingsRequests.filter(request => request.op === 'window.shortcut'))).toHaveLength(1);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  expect(JSON.parse(await page.getByTestId('saved').textContent() ?? '{}').shortcuts.newThread).toBe('Ctrl+Alt+N');
  await page.getByTestId('remount').click();
  await page.getByRole('button', { name: '键盘快捷键', exact: true }).click();
  await expect(control).toHaveValue('Ctrl+Alt+N');
  await control.press('Tab');
  await expect(page.getByLabel('搜索任务 快捷键', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: '恢复默认快捷键' }).click();
  await expect(control).toHaveValue('Ctrl+N');
});

test('shortcuts can be found by command text or a captured combination', async () => {
  await page.getByRole('button', { name: '键盘快捷键', exact: true }).click();
  const search = page.getByLabel('搜索命令或快捷键');
  await search.fill('新建任务');
  await expect(page.locator('.shortcut-list li')).toHaveCount(1);
  await search.press('Control+Shift+p');
  await expect(search).toHaveValue('Ctrl+Shift+P');
  await expect(page.locator('.shortcut-list li')).toHaveCount(1);
  await expect(page.getByLabel('命令面板 快捷键', { exact: true })).toBeVisible();
  await search.fill('not-a-command');
  await expect(page.getByText('没有匹配的快捷键', { exact: true })).toBeVisible();
});

test('appearance fonts and colors persist and reset without clearing model configuration', async () => {
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.locator('#settings-uiFontFamily').fill('Microsoft YaHei UI');
  await page.locator('#settings-codeFontFamily').fill('Consolas');
  await page.locator('#settings-code-font-size').fill('18');
  await page.locator('#settings-accentColor').fill('#123abc');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  await page.getByTestId('remount').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await expect(page.locator('#settings-code-font-size')).toHaveValue('18');
  await expect(page.locator('#settings-accentColor')).toHaveValue('#123abc');
  await page.getByRole('button', { name: '恢复默认外观' }).click();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  const saved = JSON.parse(await page.getByTestId('saved').textContent() ?? '{}');
  expect(saved).toMatchObject({ theme: 'system', codeFontSize: 12, uiFontFamily: '', codeFontFamily: '', accentColor: '', providerId: 'model-1' });
  expect(saved.providers).toHaveLength(1);
});

test('settings stay editable while a task runs and explain when runtime changes apply', async () => {
  await expect(page.getByText('偏好保存后立即生效', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  await expect(status()).not.toHaveAttribute('data-error', 'true');
  await page.getByTestId('busy').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.locator('#settings-follow-up').selectOption('steer');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  await expect(status()).not.toHaveAttribute('data-error', 'true');
  expect(JSON.parse(await page.getByTestId('saved').textContent() ?? '{}').followUpMode).toBe('steer');
  await page.getByTestId('remount').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await expect(page.locator('#settings-follow-up')).toHaveValue('steer');
});

test('built-in provider changes select a matching model and save no endpoint override', async () => {
  await page.getByLabel('供应商', { exact: true }).selectOption('opencode-go');
  await expect(page.getByLabel('内置模型', { exact: true })).toHaveValue('deepseek-v4.1-flash');
  await expect(page.getByRole('group', { name: '允许的思考程度' }).getByRole('checkbox')).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: '低', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '高', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '最高', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  const saved = JSON.parse(await page.getByTestId('saved').textContent() ?? '{}');
  expect(saved.providers[0]).toMatchObject({ provider: 'opencode-go', model: 'deepseek-v4.1-flash', custom: false, baseUrl: '', api: 'openai-completions', contextWindow: 256000 });
});

test('custom mode has no provider input, keeps independent drafts, and survives settings remount', async () => {
  await page.getByRole('radio', { name: '自定义接口', exact: true }).check();
  await expect(page.getByLabel('供应商', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('供应商 ID', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('内置模型', { exact: true })).toHaveCount(0);
  await page.getByLabel('Base URL', { exact: true }).fill('http://127.0.0.1:9876/v1');
  await page.getByLabel('模型 ID', { exact: true }).fill('deepseek-flash');
  await page.getByLabel('API 协议', { exact: true }).selectOption('openai-completions');
  await page.getByLabel('显示名称', { exact: true }).fill('本地接口');
  await page.getByRole('radio', { name: '内置供应商', exact: true }).check();
  await expect(page.getByLabel('内置模型', { exact: true })).toHaveValue('gpt-4.1');
  await page.getByLabel('供应商', { exact: true }).selectOption('opencode-go');
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('button', { name: '模型', exact: true }).click();
  await page.getByRole('radio', { name: '自定义接口', exact: true }).check();
  await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue('http://127.0.0.1:9876/v1');
  await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('deepseek-flash');
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('本地接口');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  const saved = JSON.parse(await page.getByTestId('saved').textContent() ?? '{}');
  expect(saved.providers[0]).toMatchObject({ id: 'model-1', provider: 'desktop-model-1', model: 'deepseek-flash', custom: true, baseUrl: 'http://127.0.0.1:9876/v1', hasKey: true });
  await page.getByTestId('remount').click();
  await expect(page.getByRole('radio', { name: '自定义接口', exact: true })).toBeChecked();
  await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue('http://127.0.0.1:9876/v1');
});

test('missing and invalid custom URLs prevent a save and numeric capabilities are validated', async () => {
  await page.getByRole('radio', { name: '自定义接口', exact: true }).check();
  await page.getByLabel('模型 ID', { exact: true }).fill('deepseek-flash');
  for (const url of ['', 'api.example.com', 'file:///tmp/model']) {
    await page.getByLabel('Base URL', { exact: true }).fill(url);
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(status()).toContainText('Base URL');
    await expect(page.getByTestId('ops')).toHaveText('');
  }
  await page.getByLabel('Base URL', { exact: true }).fill('http://localhost:9876/v1');
  await page.locator('.connection-advanced summary').click();
  await page.getByLabel('最大输出 Token', { exact: true }).fill('0');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toContainText('最大输出 Token');
  await expect(page.getByTestId('ops')).toHaveText('');
});

test('legacy endpoint overrides retain their original semantics until explicit conversion', async () => {
  await page.goto(pageUrl + '?scenario=override');
  await expect(page.getByRole('radio', { name: '自定义接口', exact: true })).toBeChecked();
  await expect(page.getByLabel('供应商', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('API 协议', { exact: true })).toHaveCount(0);
  await expect(page.getByText('此配置保留了旧版端点覆盖', { exact: false })).toBeVisible();
  await page.getByLabel('Base URL', { exact: true }).fill('');
  await expect(page.getByRole('radio', { name: '自定义接口', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toContainText('Base URL');
  await expect(page.getByTestId('ops')).toHaveText('');
  await page.getByLabel('Base URL', { exact: true }).fill('http://localhost:9876/v1');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  expect(JSON.parse(await page.getByTestId('saved').textContent() ?? '{}').providers[0]).toMatchObject({ provider: 'openai', custom: false, baseUrl: 'http://localhost:9876/v1' });
  await page.getByRole('button', { name: '转换为自定义模型' }).click();
  await expect(page.getByLabel('API 协议', { exact: true })).toHaveValue('openai-responses');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  expect(JSON.parse(await page.getByTestId('saved').textContent() ?? '{}').providers[0]).toMatchObject({ custom: true, baseUrl: 'http://localhost:9876/v1', provider: 'desktop-model-1', api: 'openai-responses', reasoning: false });
});

test('unlisted models are identified without silently changing the configured model', async () => {
  await page.goto(pageUrl + '?scenario=missing');
  await expect(page.getByRole('alert')).toContainText('当前模型不在内置目录中');
  await expect(page.getByLabel('内置模型', { exact: true })).toHaveValue('deepseek-flash');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toContainText('当前模型不在该供应商');
  await expect(page.getByTestId('ops')).toHaveText('');
});

test('catalog failures support retry and do not block a custom connection', async () => {
  await page.goto(pageUrl + '?scenario=catalog-retry');
  await expect(page.getByRole('alert')).toContainText('加载失败');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.locator('#model-config-error')).toContainText('内置模型目录尚未加载');
  await page.getByRole('button', { name: '重新加载目录' }).click();
  await expect(page.getByLabel('供应商', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  await expect(page.locator('#model-config-error')).toHaveCount(0);
  await page.goto(pageUrl + '?scenario=catalog-error');
  await expect(page.getByRole('alert')).toContainText('加载失败');
  await page.getByRole('radio', { name: '自定义接口', exact: true }).check();
  await page.getByLabel('Base URL', { exact: true }).fill('http://localhost:9876/v1');
  await page.getByLabel('模型 ID', { exact: true }).fill('local-model');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
});

test('catalog failures do not block unrelated preferences and unsaved model edits still require validation', async () => {
  test.setTimeout(30000);
  await page.goto(pageUrl + '?scenario=catalog-error');
  await expect(page.getByRole('alert')).toContainText('加载失败');
  await page.getByTestId('busy').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByLabel('主题', { exact: true }).selectOption('dark');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存', { timeout: 3000 });
  expect(await page.evaluate(() => window.__settingsRequests.filter(request => request.op === 'settings.patch'))).toEqual([
    { op: 'settings.patch', patch: { theme: 'dark' }, base: { theme: 'system' } },
  ]);
  await page.getByTestId('remount').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await expect(page.getByLabel('主题', { exact: true })).toHaveValue('dark');
  await page.getByRole('button', { name: '模型', exact: true }).click();
  await page.getByLabel('显示名称', { exact: true }).fill('未保存的模型修改');
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.locator('#settings-follow-up').selectOption('steer');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toContainText('内置模型目录尚未加载');
  expect(await page.evaluate(() => window.__settingsRequests.filter(request => request.op === 'settings.patch'))).toHaveLength(1);
  await expect(heading()).toHaveText('模型');
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('未保存的模型修改');
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await expect(page.locator('#settings-follow-up')).toHaveValue('steer');
});

test('mode selection supports native keyboard navigation and removes hidden controls from focus', async () => {
  const builtin = page.getByRole('radio', { name: '内置供应商', exact: true });
  const custom = page.getByRole('radio', { name: '自定义接口', exact: true });
  await builtin.focus();
  await page.keyboard.press('ArrowRight');
  await expect(custom).toBeChecked();
  await expect(custom).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('API 协议', { exact: true })).toBeFocused();
  await custom.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(builtin).toBeChecked();
  await expect(page.getByLabel('Base URL', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('供应商', { exact: true })).toBeFocused();
});

test('allowed thinking levels support keyboard changes, validation, mode drafts and remount', async () => {
  await page.getByRole('radio', { name: '自定义接口', exact: true }).check();
  await page.getByLabel('Base URL', { exact: true }).fill('http://localhost:9876/v1');
  await page.getByLabel('模型 ID', { exact: true }).fill('reasoner');
  await page.locator('.connection-advanced summary').click();
  await page.getByRole('checkbox', { name: /^支持思考/ }).check();
  const levels = ['low', 'high', 'xhigh', 'max'];
  for (const level of levels) await expect(page.getByRole('checkbox', { name: levelNames[level], exact: true })).toBeChecked();
  const maximum = page.getByRole('checkbox', { name: '最高', exact: true });
  await maximum.focus();
  await page.keyboard.press('Space');
  await expect(maximum).not.toBeChecked();
  await expect(maximum).toBeFocused();
  for (const level of ['low', 'high', 'xhigh']) await page.getByRole('checkbox', { name: levelNames[level], exact: true }).uncheck();
  await expect(page.getByRole('alert')).toContainText('至少选择一个');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toContainText('至少选择一个');
  await expect(page.getByTestId('ops')).toHaveText('');
  for (const level of levels) await page.getByRole('checkbox', { name: levelNames[level], exact: true }).check();
  await page.getByRole('radio', { name: '内置供应商', exact: true }).check();
  await page.getByRole('radio', { name: '自定义接口', exact: true }).check();
  for (const level of levels) await expect(page.getByRole('checkbox', { name: levelNames[level], exact: true })).toBeChecked();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(status()).toHaveText('设置已保存');
  const saved = JSON.parse(await page.getByTestId('saved').textContent() ?? '{}');
  expect(saved.providers[0].thinkingLevels).toEqual(levels);
  await page.getByTestId('remount').click();
  for (const level of levels) await expect(page.getByRole('checkbox', { name: levelNames[level], exact: true })).toBeChecked();
});

for (const locale of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark']) {
  test('reasoning choices stay compact, localized and keyboard accessible: ' + locale + ' ' + theme, async () => {
    await page.goto(pageUrl + '?locale=' + locale);
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.getByRole('radio', { name: locale === 'zh-CN' ? '自定义接口' : 'Custom endpoint', exact: true }).check();
    await page.locator('.connection-advanced summary').click();
    const toggle = page.getByRole('checkbox', { name: locale === 'zh-CN' ? /^支持思考/ : /^Supports reasoning/ });
    await toggle.check();
    await expect(toggle).toHaveCSS('width', '32px');
    await expect(toggle).toHaveCSS('height', '20px');
    const group = page.locator('.thinking-levels');
    const names = locale === 'zh-CN' ? Object.values(levelNames) : ['Off', 'Minimal', 'Low', 'Medium', 'High', 'Extra high', 'Maximum'];
    await expect(group.locator('.thinking-level-option > span')).toHaveText(names);
    const maximum = group.getByRole('checkbox', { name: names[6], exact: true });
    await maximum.focus();
    await page.keyboard.press('Space');
    await expect(maximum).not.toBeChecked();
    await expect(maximum).toBeFocused();
    await expect(maximum.locator('..').locator('span')).toHaveCSS('outline-style', 'solid');
    await expect(maximum.locator('..').locator('svg')).toHaveCSS('visibility', 'hidden');
    await page.keyboard.press('Space');
    await expect(maximum).toBeChecked();
    await expect(maximum.locator('..').locator('svg')).toHaveCSS('visibility', 'visible');
    await maximum.blur();
    for (const [width, height] of [[1000, 700], [1280, 800], [1440, 940]]) {
      await page.setViewportSize({ width, height });
      const sizes = await group.evaluate(root => {
        const bounds = root.getBoundingClientRect();
        return [...root.querySelectorAll('.thinking-level-option > span')].map(item => {
          const rect = item.getBoundingClientRect();
          return { left: rect.left - bounds.left, right: bounds.right - rect.right, height: rect.height, font: getComputedStyle(item).fontSize, icon: item.querySelector('svg')!.getBoundingClientRect().width };
        });
      });
      for (const size of sizes) {
        expect(size.left).toBeGreaterThanOrEqual(0);
        expect(size.right).toBeGreaterThanOrEqual(0);
        expect(size.height).toBe(32);
        expect(size.font).toBe('13px');
        expect(size.icon).toBe(14);
      }
      if (process.env.PI_UI_EVIDENCE === '1' && width === 1000) {
        const evidence = fileURLToPath(new URL('../../../../.artifacts/selection-ui/', import.meta.url));
        await mkdir(evidence, { recursive: true });
        await group.screenshot({ path: join(evidence, 'reasoning-' + locale + '-' + theme + '.png') });
      }
    }
  });
}

test('both connection forms stay within their columns across themes and window sizes', async () => {
  for (const [width, height] of [[1000, 640], [1280, 800], [1440, 940]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark', 'system-light', 'system-dark']) {
      await page.emulateMedia({ colorScheme: theme.endsWith('dark') ? 'dark' : 'light' });
      await page.evaluate((value) => { document.documentElement.dataset.theme = value.startsWith('system-') ? 'system' : value; }, theme);
      for (const mode of ['内置供应商', '自定义接口']) {
        await page.getByRole('radio', { name: mode, exact: true }).check();
        if (mode === '自定义接口') {
          await page.locator('.connection-advanced summary').click();
          await page.getByRole('checkbox', { name: /^支持思考/ }).check();
        }
        const geometry = await page.locator('.model-connection').evaluate((root) => {
          const bounds = root.getBoundingClientRect();
          return {
            overflow: root.scrollWidth - root.clientWidth,
            outside: [...root.querySelectorAll('input, select, .connection-mode')].filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.width > 0 && (rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5);
            }).length,
            cards: [...root.querySelectorAll('.connection-mode')].map((element) => ({
              width: element.getBoundingClientRect().width,
              selected: element.getAttribute('data-selected'),
              background: getComputedStyle(element).backgroundColor,
            })),
          };
        });
        expect(geometry.overflow, theme + ' ' + width + ' ' + mode).toBeLessThanOrEqual(1);
        expect(geometry.outside, theme + ' ' + width + ' ' + mode).toBe(0);
        expect(Math.abs(geometry.cards[0].width - geometry.cards[1].width)).toBeLessThanOrEqual(0.5);
        expect(geometry.cards.filter((card) => card.selected === 'true')).toHaveLength(1);
        expect(geometry.cards[0].background).not.toBe(geometry.cards[1].background);
      }
    }
  }
});
