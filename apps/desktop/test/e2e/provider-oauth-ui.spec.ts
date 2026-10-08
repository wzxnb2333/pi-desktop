import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { cleanupTemporaryDirectories, mkdtemp } from './fixtures/temp-paths.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Browser, type Page, chromium, expect, test } from '@playwright/test';
import type { ProviderAuthStatus } from '../../src/shared/contracts.ts';
import type {} from './fixtures/provider-oauth-ui-harness.tsx';

let browser: Browser;
let page: Page;
let directory: string;
let url: string;
let errors: string[];

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-provider-oauth-ui-'));
  await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/provider-oauth-ui-harness.tsx', import.meta.url))],
    outfile: join(directory, 'harness.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent',
  });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="harness.css"><script src="harness.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});

test.beforeEach(async () => {
  errors = [];
  page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await expect(page.getByRole('group', { name: '认证方式', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.providerAuthUi.calls().some(call => call.op === 'provider.oauthStatus'))).toBe(true);
});

test.afterEach(async () => {
  await page.close();
  expect(errors).toEqual([]);
});
test.afterAll(async () => { await browser?.close(); });
test.afterAll(cleanupTemporaryDirectories);

const id = 'dual';
const op1 = '10000000-0000-4000-8000-000000000001';
const prompt1 = '20000000-0000-4000-8000-000000000001';
const prompt2 = '20000000-0000-4000-8000-000000000002';
const opStatus = (operationId: string, extra: Partial<ProviderAuthStatus> = {}): ProviderAuthStatus => ({
  id, connected: false, phase: 'logging_in', operationId, ...extra,
});
const promptStatus = (operationId: string, promptId: string, type: NonNullable<ProviderAuthStatus['prompt']>['type'], message: string, options?: { id: string; label: string }[]): ProviderAuthStatus => ({
  ...opStatus(operationId), prompt: { id: promptId, type, message, ...(options ? { options } : {}) },
});
const startLogin = async () => {
  const oauth = page.getByRole('radio', { name: 'Dual Account', exact: true });
  if (!(await oauth.isChecked())) await oauth.check();
  await page.getByRole('button', { name: '保存并登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消授权', exact: true })).toBeVisible();
  const start = await page.evaluate(() => window.providerAuthUi.startStatus());
  expect(start?.operationId).toBeTruthy();
  return start!.operationId!;
};
const emit = async (status: ProviderAuthStatus) => page.evaluate(next => window.providerAuthUi.emit(next), status);

test('provider capabilities preserve legacy auth and keep API Key drafts when switching modes', async () => {
  const old = await page.evaluate(() => window.providerAuthUi.providers().find(provider => provider.id === 'oauth-legacy'));
  expect(old?.authMethod).toBe('api_key');
  await page.getByRole('tab', { name: /Legacy OAuth/ }).click();
  const oauthRadio = page.getByRole('radio', { name: 'Orbit Account', exact: true });
  await expect(oauthRadio).not.toBeChecked();
  await expect(page.locator('#provider-oauth-legacy-key')).toHaveCount(0);
  await oauthRadio.check();
  await expect(oauthRadio).toBeChecked();
  expect(await page.evaluate(() => window.providerAuthUi.providers().find(provider => provider.id === 'oauth-legacy')?.authMethod)).toBe('oauth');

  await page.getByRole('tab', { name: /^Dual/ }).click();
  const key = page.locator('#provider-dual-key');
  await key.fill('keep-this-key');
  await page.getByRole('radio', { name: 'Dual Account', exact: true }).check();
  await expect(key).toHaveCount(0);
  await expect(page.getByText('此 OAuth 登录使用订阅账户。')).toBeVisible();
  await page.getByRole('radio', { name: 'API Key', exact: true }).check();
  await expect(key).toHaveValue('keep-this-key');

  await page.getByRole('button', { name: '添加提供商', exact: true }).click();
  await page.getByLabel('供应商', { exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'oauth-only', exact: true }).click();
  await page.getByRole('button', { name: '创建提供商', exact: true }).click();
  const created = await page.evaluate(() => window.providerAuthUi.providers().at(-1));
  expect(created).toMatchObject({ namespace: 'oauth-only', authMethod: 'oauth' });
  await expect(page.getByRole('radio', { name: 'Orbit Account', exact: true })).toBeChecked();
});

test('unsaved OAuth drafts skip status reads and failed saves cannot start login', async () => {
  await page.getByRole('button', { name: '添加提供商', exact: true }).click();
  await page.getByLabel('供应商', { exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'oauth-only', exact: true }).click();
  await page.getByRole('button', { name: '创建提供商', exact: true }).click();
  const created = (await page.evaluate(() => window.providerAuthUi.providers().at(-1)))!;
  const login = page.getByRole('button', { name: '保存并登录', exact: true });
  await expect(login).toBeEnabled();
  await expect(page.locator('.provider-auth-status')).toContainText('未连接');
  expect(await page.evaluate(id => window.providerAuthUi.calls().filter(call => call.op === 'provider.oauthStatus' && call.id === id), created.id)).toEqual([]);
  await page.evaluate(() => { window.providerAuthUi.persistResult(false); window.providerAuthUi.clearTimeline(); });
  await login.click();
  await expect(login).toBeEnabled();
  expect(await page.evaluate(() => window.providerAuthUi.order())).toEqual(['persist']);
  await page.evaluate(() => { window.providerAuthUi.persistResult(true); window.providerAuthUi.holdStart(true); });
  await login.click();
  await expect.poll(() => page.evaluate(() => window.providerAuthUi.calls().filter(call => call.op === 'provider.oauthStart').length)).toBe(1);
  await page.evaluate(() => window.providerAuthUi.releaseStart());
  await expect(page.getByRole('button', { name: '取消授权', exact: true })).toBeEnabled();
  const calls = await page.evaluate(() => window.providerAuthUi.calls());
  expect(calls.filter(call => call.op === 'provider.oauthStatus')).toEqual([{ op: 'provider.oauthStatus', id: created.id }]);
  await page.getByRole('button', { name: '取消授权', exact: true }).click();
  await expect(login).toBeEnabled();
});

test('OAuth disables endpoint overrides and persists settings before login starts', async () => {
  await page.evaluate(() => window.providerAuthUi.changeProvider('dual', { baseUrl: 'https://gateway.example/v1' }));
  await page.getByRole('radio', { name: 'Dual Account', exact: true }).check();
  await page.getByText('端点覆盖', { exact: true }).click();
  await expect(page.getByLabel('Base URL', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存并登录', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '清空 Base URL', exact: true }).click();
  await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue('');

  await page.evaluate(() => window.providerAuthUi.persistResult(false));
  await page.getByRole('button', { name: '保存并登录', exact: true }).click();
  expect((await page.evaluate(() => window.providerAuthUi.calls())).filter(call => call.op === 'provider.oauthStart')).toHaveLength(0);
  await page.evaluate(() => window.providerAuthUi.persistResult(true));
  await page.evaluate(() => window.providerAuthUi.clearTimeline());
  await startLogin();
  expect(await page.evaluate(() => window.providerAuthUi.order())).toEqual(['persist', 'provider.oauthStart']);
});

test('device code and browser fallback keep a selectable authorization link', async () => {
  await page.getByRole('radio', { name: 'Dual Account', exact: true }).check();
  await page.evaluate(status => window.providerAuthUi.queueStart(status), {
    id, connected: false, phase: 'logging_in', operationId: op1,
    link: 'https://auth.example/device?user_code=ABCD', userCode: 'ABCD-EFGH', instructions: 'Enter this code in the browser.',
  } satisfies ProviderAuthStatus);
  await page.getByRole('button', { name: '保存并登录', exact: true }).click();
  await expect(page.locator('.provider-auth-code')).toHaveText('ABCD-EFGH');
  const link = page.getByLabel('授权链接', { exact: true });
  await expect(link).toHaveValue('https://auth.example/device?user_code=ABCD');
  await expect(link).toHaveAttribute('readonly', '');
  await expect(link).toHaveAttribute('type', 'text');
  await expect(link).toHaveAttribute('inputmode', 'url');
  await link.focus();
  expect(await link.evaluate(element => [(element as HTMLInputElement).selectionStart, (element as HTMLInputElement).selectionEnd]))
    .toEqual([0, 'https://auth.example/device?user_code=ABCD'.length]);
  await page.evaluate(() => window.providerAuthUi.openResult(false));
  await page.getByRole('button', { name: '在浏览器中打开', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法自动打开浏览器');
  expect(await page.evaluate(() => window.providerAuthUi.calls().at(-1))).toMatchObject({ op: 'provider.oauthOpen', id, operationId: op1 });
});

test('manual code, secret, select and empty text prompts submit the exact operation and prompt ids', async () => {
  const operationId = await startLogin();
  const cases = [
    { promptId: prompt1, type: 'manual_code' as const, message: 'Enter device code', value: '123-456' },
    { promptId: prompt2, type: 'secret' as const, message: 'One-time password', value: 'secure-value' },
    { promptId: '20000000-0000-4000-8000-000000000003', type: 'select' as const, message: 'Choose account', value: 'personal' },
    { promptId: '20000000-0000-4000-8000-000000000004', type: 'text' as const, message: 'GitHub Enterprise URL (blank for github.com)', value: '' },
  ];
  for (const [index, item] of cases.entries()) {
    await emit(promptStatus(operationId, item.promptId, item.type, item.message, item.type === 'select'
      ? [{ id: 'personal', label: 'Personal account' }, { id: 'work', label: 'Work account' }] : undefined));
    if (item.type === 'select') {
      const selector = page.getByRole('button', { name: item.message, exact: true });
      await expect(selector).toBeFocused();
      await selector.click();
      await page.getByRole('menuitemradio', { name: 'Personal account', exact: true }).click();
    } else {
      const input = page.getByLabel(item.message, { exact: true });
      await expect(input).toBeFocused();
      if (item.type === 'text') {
        await expect(input).not.toHaveAttribute('required');
        await expect(page.getByRole('button', { name: '提交', exact: true })).toBeEnabled();
      } else {
        await expect(input).toHaveAttribute('required', '');
        await input.fill(item.value);
      }
      if (item.type === 'secret') await expect(input).toHaveAttribute('type', 'password');
    }
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await expect(page.getByLabel(item.message, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '取消授权', exact: true })).toBeFocused();
    expect(await page.evaluate(() => window.providerAuthUi.calls().filter(call => call.op === 'provider.oauthAnswer').at(-1))).toMatchObject({
      op: 'provider.oauthAnswer', id, operationId, promptId: item.promptId, value: item.value,
    });
    if (index < cases.length - 1) await page.evaluate(() => window.providerAuthUi.clearTimeline());
  }
});

test('cancel and rapid repeated clicks bind one operation and restore keyboard focus', async () => {
  const operationId = await startLogin();
  const cancel = page.getByRole('button', { name: '取消授权', exact: true });
  await cancel.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(cancel).toHaveCount(0);
  const login = page.getByRole('button', { name: '保存并登录', exact: true });
  await expect(login).toBeFocused();
  expect((await page.evaluate(() => window.providerAuthUi.calls())).filter(call => call.op === 'provider.oauthCancel')).toHaveLength(1);
  expect(await page.evaluate(() => window.providerAuthUi.calls().filter(call => call.op === 'provider.oauthCancel').at(0))).toMatchObject({ id, operationId });

  await page.evaluate(() => { window.providerAuthUi.holdStart(true); window.providerAuthUi.clearTimeline(); });
  await login.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => page.evaluate(() => window.providerAuthUi.calls().filter(call => call.op === 'provider.oauthStart').length)).toBe(1);
  await page.evaluate(() => window.providerAuthUi.releaseStart());
  await expect(page.getByRole('button', { name: '取消授权', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.providerAuthUi.order())).toEqual(['persist', 'provider.oauthStart']);
});

test('late start response cannot replace a prompt event; stale prompts and coarse events expire old operation forms', async () => {
  await page.getByRole('radio', { name: 'Dual Account', exact: true }).check();
  await page.evaluate(() => window.providerAuthUi.holdStart(true));
  await page.getByRole('button', { name: '保存并登录', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.providerAuthUi.calls().filter(call => call.op === 'provider.oauthStart').length)).toBe(1);
  await emit({ ...promptStatus(op1, prompt1, 'manual_code', 'Current device code'), link: 'https://auth.example/current' });
  await page.evaluate(status => window.providerAuthUi.releaseStart(status), { id, connected: false, phase: 'logging_in', operationId: op1 } satisfies ProviderAuthStatus);
  const input = page.getByLabel('Current device code', { exact: true });
  await expect(input).toBeFocused();
  await emit(promptStatus('30000000-0000-4000-8000-000000000001', prompt2, 'text', 'Stale prompt'));
  await expect(input).toBeVisible();
  await expect(page.getByLabel('Stale prompt', { exact: true })).toHaveCount(0);

  await page.evaluate(() => window.providerAuthUi.holdAnswer(true));
  await input.fill('old-code');
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.providerAuthUi.calls().filter(call => call.op === 'provider.oauthAnswer').length)).toBe(1);
  await emit(promptStatus(op1, prompt2, 'secret', 'New one-time password'));
  await page.evaluate(status => window.providerAuthUi.releaseAnswer(status), { id, connected: false, phase: 'logging_in', operationId: op1 } satisfies ProviderAuthStatus);
  await expect(page.getByLabel('New one-time password', { exact: true })).toBeFocused();

  await emit({ id, connected: true, phase: 'idle' });
  await expect(page.locator('.provider-auth-status')).toContainText('已连接');
  await emit({ id, connected: false, phase: 'error', operationId: op1, error: 'late stale terminal event' });
  await expect(page.locator('.provider-auth-status')).toContainText('已连接');
  await expect(page.getByLabel('授权链接', { exact: true })).toHaveCount(0);
});

test('identity changes re-read status and discard the old form and busy operation', async () => {
  const operationId = await startLogin();
  await emit(opStatus(operationId, { prompt: { id: prompt1, type: 'secret', message: 'Old secret prompt' } }));
  await expect(page.getByLabel('Old secret prompt', { exact: true })).toBeVisible();
  await emit({ id, connected: false, phase: 'logging_in' });
  await expect(page.getByRole('button', { name: '取消授权', exact: true })).toBeDisabled();
  await page.evaluate(({ id: providerId, phase }) => {
    window.providerAuthUi.status({ id: providerId, connected: false, phase });
    window.providerAuthUi.clearTimeline();
    window.providerAuthUi.changeProvider('dual', { namespace: 'oauth-only', authMethod: 'oauth' });
  }, { id, phase: 'idle' as const });
  await expect(page.getByLabel('Old secret prompt', { exact: true })).toHaveCount(0);
  await expect(page.locator('.provider-auth-status')).toContainText('未连接');
  await expect(page.getByRole('button', { name: '取消授权', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.providerAuthUi.calls().filter(call => call.op === 'provider.oauthStatus'))).toHaveLength(1);
  await expect(page.getByRole('radio', { name: 'Orbit Account', exact: true })).toBeChecked();
});

test('a failed status retry keeps the last connected status visible', async () => {
  await page.goto(url + '?holdStatus');
  await page.getByRole('radio', { name: 'Dual Account', exact: true }).check();
  await expect.poll(() => page.evaluate(providerId => window.providerAuthUi.calls().some(call => call.op === 'provider.oauthStatus' && call.id === providerId), id)).toBe(true);
  await emit({ id, connected: true, phase: 'idle' });
  await page.evaluate(providerId => window.providerAuthUi.releaseStatus(providerId, 'STATUS_READ_FAILED'), id);
  await expect(page.locator('.provider-auth-status')).toContainText('已连接');
  await expect(page.getByRole('button', { name: '重试读取授权状态', exact: true })).toBeVisible();
  await page.evaluate(() => { window.providerAuthUi.holdStatus(false); window.providerAuthUi.statusFailure('STATUS_READ_FAILED'); });
  await page.getByRole('button', { name: '重试读取授权状态', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('STATUS_READ_FAILED');
  await expect(page.locator('.provider-auth-status')).toContainText('已连接');
});
