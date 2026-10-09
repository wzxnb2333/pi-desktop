import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser } from '@playwright/test';
import { translate } from '../../src/shared/localization.ts';

let browser: Browser;
let directory = '';
let url = '';
const evidence = fileURLToPath(new URL('../../../../.artifacts/desktop-iteration-04/', import.meta.url));
const settingsEvidence = fileURLToPath(new URL('../../../../.artifacts/settings-ui-followup/', import.meta.url));
const captureEvidence = process.env.PI_DESKTOP_VISUAL_EVIDENCE === '1';
test.setTimeout(45000);
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-form-navigation-'));
  if (captureEvidence) { await mkdir(evidence, { recursive: true }); await mkdir(settingsEvidence, { recursive: true }); }
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/form-navigation-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); });
test.afterAll(cleanupTemporaryDirectories);

for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark']) {
  test(locale + ' ' + theme + ': unsaved settings keep credentials, language and keyboard focus until explicit discard', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
    const t = (text: '返回工作台' | '放弃未保存的修改？' | '通用' | '界面语言') => translate(locale, text);
    try {
      await page.goto(url + '?locale=' + locale + '&theme=' + theme);
      await page.locator('input[type=password]').fill('fixture-unsaved');
      await page.getByRole('button', { name: t('返回工作台'), exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveAccessibleName(t('放弃未保存的修改？'));
      await expect(dialog.getByRole('button', { name: translate(locale, '继续编辑'), exact: true })).toBeFocused();
      expect(await page.evaluate(() => window.formNavigationTest.ui().view)).toBe('settings');
      for (const [width, height] of [[1440, 940], [1280, 800], [1000, 700]]) {
        await page.setViewportSize({ width, height });
        expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
        if (captureEvidence) await page.screenshot({ path: join(evidence, 'unsaved-settings-' + locale + '-' + theme + '-' + width + '.png') });
      }
      await dialog.press('Escape');
      await expect(page.getByRole('button', { name: t('返回工作台'), exact: true })).toBeFocused();
      await expect(page.locator('input[type=password]')).toHaveValue('fixture-unsaved');
      await page.getByRole('button', { name: t('通用'), exact: true }).click();
      const other = locale === 'zh-CN' ? 'en-US' : 'zh-CN';
      await page.locator('#settings-locale').click();
    await page.getByRole('menuitemradio', { name: other === 'en-US' ? 'English' : '简体中文', exact: true }).click();
      await page.getByRole('button', { name: translate(other, '模型'), exact: true }).click();
      await expect(page.locator('input[type=password]')).toHaveValue('fixture-unsaved');
      await page.getByRole('button', { name: translate(other, '返回工作台'), exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: translate(other, '放弃修改'), exact: true }).click();
      await expect(page.locator('.settings-page')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => window.formNavigationTest.ui().view)).toBe('thread');
      expect(await page.evaluate(() => window.formNavigationTest.requests.filter(request => request.op === 'provider.key'))).toHaveLength(0);
    } finally { await page.close(); }
  });
}

for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark']) {
  test(locale + ' ' + theme + ': grouped settings retain reference layout across categories and window sizes', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(url + '?locale=' + locale + '&theme=' + theme);
      await expect(page.locator('.settings-sidebar .settings-nav-group')).toHaveCount(3);
      await expect(page.locator('.settings-sidebar [data-category]')).toHaveCount(9);
      await expect(page.locator('.main > .toolbar')).toHaveCount(0);
      for (const [width, height] of [[1440, 940], [1280, 800], [1000, 700]]) {
        await page.setViewportSize({ width, height });
        for (const category of ['general', 'appearance', 'shortcuts', 'mcp', 'models', 'permissions', 'memories', 'voice', 'browser']) {
          const button = page.locator('.settings-sidebar [data-category=' + category + ']');
          await button.click();
          await expect(button).toHaveAttribute('aria-current', 'true');
          await expect(page.locator('.settings-page h1')).toHaveText(await button.innerText());
          await expect(page.locator('.settings-page')).toHaveJSProperty('scrollTop', 0);
          const card = page.locator('.settings-body .field-stack, .settings-body .shortcut-list, .settings-body .config-card').first();
          await expect(card).toHaveCSS('border-radius', '20px');
          await expect(card).toHaveCSS('background-color', theme === 'dark' ? 'rgb(35, 35, 35)' : 'rgb(255, 255, 255)');
          await expect(page.locator('.settings-sidebar .settings-search')).toHaveCSS('border-radius', '18px');
          expect((await page.locator('.settings-sidebar .settings-search').boundingBox())!.y).toBe(90);
          const bounds = (await page.locator('.settings-page h1').boundingBox())!;
          // Keep the reference typography; reduce the blank header space to 64px for the refactor.
          expect(bounds.y).toBeCloseTo(100, 0);
          const outside = await page.locator('.settings-page').evaluate(root => {
            const bounds = root.getBoundingClientRect();
            return [...root.querySelectorAll('input, select, button, textarea')].filter(node => {
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && (rect.left < bounds.left || rect.right > bounds.right);
            }).map(node => node.id || node.getAttribute('aria-label') || node.tagName);
          });
          expect(outside, category + ' ' + width).toEqual([]);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
          expect(await page.locator('.settings-body').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
          if (await page.locator('.settings-page').evaluate(node => node.scrollHeight > node.clientHeight)) {
            const footer = (await page.locator('.settings-footer').boundingBox())!;
            expect(footer.y).toBeGreaterThanOrEqual(0);
            expect(footer.y + footer.height).toBeLessThanOrEqual(height);
          }
          if (category === 'general') {
            await expect(page.locator('#settings-locale')).toHaveCSS('height', '28px');
            await expect(page.locator('#settings-notifications')).toHaveCSS('width', '32px');
            await expect(page.locator('#settings-notifications')).toHaveCSS('height', '20px');
          }
          if (category === 'appearance') await expect(page.locator('#settings-font-size')).toHaveCSS('width', '80px');
          if (captureEvidence) await page.screenshot({ path: join(settingsEvidence, category + '-' + theme + '-' + locale + '-' + width + '.png') });
          if (process.env.PI_SETTINGS_REFACTOR_EVIDENCE === '1' && locale === 'zh-CN' && (
            width === 1440 && theme === 'light' && ['models', 'appearance', 'general', 'mcp'].includes(category) ||
            width === 1000 && theme === 'dark' && category === 'models')) {
            const output = fileURLToPath(new URL('../../../../.artifacts/settings-refactor/', import.meta.url));
            await mkdir(output, { recursive: true });
            await page.screenshot({ path: join(output, category + '-' + theme + '-' + width + '.png') });
          }
        }
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

test('settings search, category navigation and language switching preserve every unsaved preference', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  try {
    await page.goto(url);
    await page.locator('input[type=password]').fill('fixture-navigation-key');
    const search = page.locator('.settings-sidebar .settings-search input');
    await search.fill('字号');
    await expect(page.locator('.settings-sidebar [data-category]')).toHaveCount(1);
    await page.locator('[data-category=appearance]').first().click();
    await page.locator('#settings-font-size').fill('16');
    await search.fill('不存在的设置');
    await expect(page.locator('.settings-nav-empty')).toHaveText('没有匹配的设置');
    await search.fill('');
    await page.locator('.settings-sidebar [data-category=general]').click();
    await page.locator('#settings-notifications').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#settings-notifications')).not.toBeChecked();
    await page.locator('#settings-locale').click();
    await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
    await expect(page.locator('.settings-page h1')).toHaveText('General');
    await search.fill('Theme');
    await expect(page.locator('.settings-sidebar [data-category]')).toHaveCount(1);
    await page.locator('.settings-sidebar [data-category=appearance]').click();
    await expect(page.locator('#settings-font-size')).toHaveValue('16');
    await search.fill('');
    await page.locator('.settings-sidebar [data-category=appearance]').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.settings-sidebar [data-category=shortcuts]')).toBeFocused();
    await page.getByLabel(translate('en-US', '新建任务') + translate('en-US', ' 快捷键'), { exact: true }).press('Control+Alt+n');
    await page.locator('.settings-sidebar [data-category=models]').click();
    await expect(page.locator('input[type=password]')).toHaveValue('fixture-navigation-key');
    await page.getByRole('button', { name: translate('en-US', '保存设置'), exact: true }).click();
    await expect(page.locator('.settings-footer [role=status]')).toHaveText(translate('en-US', '设置已保存'));
    const requests = await page.evaluate(() => window.formNavigationTest.requests);
    expect(requests.findLast(request => request.op === 'settings.patch')).toMatchObject({ patch: { fontSize: 16, notifications: false, shortcuts: { newThread: 'Ctrl+Alt+N' } } });
    expect(requests.filter(request => request.op === 'provider.key')).toEqual([{ op: 'provider.key', id: 'local-provider', key: 'fixture-navigation-key', base: expect.objectContaining({ id: 'local-provider', name: '本地模型', kind: 'builtin', namespace: 'openai' }) }]);
    expect(await page.evaluate(() => window.formNavigationTest.ui().locale)).toBe('en-US');
  } finally { await page.close(); }
});

test('custom model editor keeps long English connection values contained and exposes optional capabilities', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(url + '?locale=en-US&theme=dark');
    await page.getByRole('button', { name: translate('en-US', '添加提供商'), exact: true }).click();
    await page.getByRole('radio', { name: translate('en-US', '自定义接口'), exact: true }).check();
    await page.getByLabel('Base URL', { exact: true }).fill('https://gateway.example.invalid/team/development/v1');
    await page.getByRole('button', { name: translate('en-US', '创建提供商'), exact: true }).click();
    await page.getByRole('button', { name: translate('en-US', '添加模型'), exact: true }).click();
    await page.getByLabel(translate('en-US', '模型 ID'), { exact: true }).fill('workspace-model-with-a-long-service-identifier');
    await page.getByRole('button', { name: translate('en-US', '添加模型'), exact: true }).click();
    // Adding a custom model expands its editor; only collapse-to-open when it is still closed.
    const modelToggle = page.locator('.model-row-toggle').first();
    if (await modelToggle.getAttribute('aria-expanded') !== 'true') await modelToggle.click();
    await expect(page.locator('.model-key-status')).toHaveText(translate('en-US', '尚未设置密钥'));
    expect(await page.locator('.model-editor').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    if (process.env.PI_SETTINGS_REFACTOR_EVIDENCE === '1') {
      const output = fileURLToPath(new URL('../../../../.artifacts/settings-refactor/', import.meta.url));
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: join(output, 'models-custom-en-dark-1280.png') });
    }
    await expect(page.getByLabel(translate('en-US', '上下文窗口'), { exact: true })).toBeVisible();
    // A built-in connection keeps its optional endpoint override collapsed until asked for.
    await page.getByRole('tab', { name: '本地模型' }).click();
    await expect(page.locator('.connection-advanced')).not.toHaveAttribute('open', '');
    await page.getByRole('button', { name: translate('en-US', '通用'), exact: true }).click();
    await page.getByRole('button', { name: translate('en-US', '模型'), exact: true }).click();
    await page.getByRole('tab', { name: translate('en-US', '自定义提供商') }).click();
    await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue('https://gateway.example.invalid/team/development/v1');
  } finally { await page.close(); }
});

test('pending settings saves block navigation; failures keep the draft and successful retry releases the guard', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await page.getByLabel('显示名称', { exact: true }).fill('正在保存的模型');
    await page.evaluate(() => { window.formNavigationTest.holdSave = true; });
    await page.getByRole('button', { name: '保存设置' }).click();
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('正在保存，请完成后再离开。');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.formNavigationTest.ui().view)).toBe('settings');
    await page.evaluate(() => window.formNavigationTest.finish('SAVE_FAILED'));
    await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('正在保存的模型');
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '继续编辑', exact: true }).click();
    await page.getByRole('button', { name: '保存设置' }).click();
    await page.evaluate(() => window.formNavigationTest.finish());
    await expect(page.locator('.settings-footer [role=status]')).toHaveText('设置已保存');
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await expect(page.locator('.settings-page')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { await page.close(); }
});

test('automation navigation preserves the form through cancellation and pending saves', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url + '?view=automations');
    await page.getByRole('button', { name: '新建自动化', exact: true }).click();
    await page.locator('#automation-name').fill('检查项目');
    await page.locator('#automation-prompt').fill('未提交的计划描述');
    await page.locator('.primary-nav').getByRole('button', { name: '待审阅', exact: true }).click();
    await page.getByRole('dialog').press('Escape');
    await expect(page.locator('#automation-prompt')).toHaveValue('未提交的计划描述');
    await page.evaluate(() => { window.formNavigationTest.holdSave = true; });
    await page.getByRole('button', { name: '创建自动化', exact: true }).click();
    await page.locator('.sidebar-new-task .new-thread').click();
    await expect(page.getByRole('alert')).toHaveText('正在保存，请完成后再离开。');
    expect(await page.evaluate(() => window.formNavigationTest.requests.filter(request => request.op === 'thread.create'))).toHaveLength(0);
    await page.locator('.primary-nav').getByRole('button', { name: '待审阅', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('正在保存，请完成后再离开。');
    await page.evaluate(() => window.formNavigationTest.finish());
    await expect(page.locator('#automation-editor')).toHaveCount(0);
    await page.locator('.primary-nav').getByRole('button', { name: '待审阅', exact: true }).click();
    await expect(page.locator('.automations-page')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { await page.close(); }
});

test('MCP secrets and a collapsed Skill form remain protected when navigating away', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await page.getByRole('button', { name: 'MCP', exact: true }).click();
    await page.locator('#mcp-m-secret').fill('{"TOKEN":"fixture"}');
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
    await page.locator('.primary-nav').getByRole('button', { name: 'Skills 与扩展', exact: true }).click();
    await page.getByRole('button', { name: '创建 Skill', exact: true }).click();
    await page.locator('#skill-name').fill('尚未保存的 Skill');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.locator('.primary-nav').getByRole('button', { name: '自动化', exact: true }).click();
    await page.getByRole('dialog').press('Escape');
    await page.getByRole('button', { name: '创建 Skill', exact: true }).click();
    await expect(page.locator('#skill-name')).toHaveValue('尚未保存的 Skill');
    await page.locator('.primary-nav').getByRole('button', { name: '自动化', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.locator('.automations-page')).toBeVisible();
    expect(await page.evaluate(() => window.formNavigationTest.requests.filter(request => request.op === 'resource.create' || request.op === 'mcp.secret'))).toHaveLength(0);
  } finally { await page.close(); }
});

test('cancelled back navigation keeps its history position and discard permits forward restoration', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url + '?view=thread');
    await page.getByRole('button', { name: '工作区菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    await page.getByLabel('显示名称', { exact: true }).fill('保留设置');
    const back = page.getByRole('button', { name: '后退', exact: true });
    const forward = page.getByRole('button', { name: '前进', exact: true });
    await back.click();
    await page.getByRole('dialog').press('Escape');
    await expect(back).toBeEnabled();
    await expect(forward).toBeDisabled();
    await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('保留设置');
    await back.click();
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.locator('.settings-page')).toHaveCount(0);
    await expect(forward).toBeEnabled();
    await forward.click();
    await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('本地模型');
    await expect(forward).toBeDisabled();
  } finally { await page.close(); }
});

test('cancelling a project navigation preserves both the active task and the automation target', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url + '?view=automations');
    await page.getByRole('button', { name: '新建自动化', exact: true }).click();
    await page.locator('#automation-name').fill('保留项目');
    await expect(page.locator('#automation-project')).toContainText('表单测试');
    await page.getByRole('button', { name: '另一个项目', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => window.formNavigationTest.ui().activeThreadId)).toBe('t');
    await page.getByRole('dialog').press('Escape');
    await expect(page.locator('#automation-project')).toContainText('表单测试');
    await expect(page.locator('#automation-name')).toHaveValue('保留项目');
    await page.getByRole('button', { name: '另一个项目', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.locator('.automations-page')).toHaveCount(0);
    // A project without conversations lands on a prepared chat, so the composer is the first step.
    await expect.poll(() => page.evaluate(() => window.formNavigationTest.ui().activeThreadId)).not.toBe('');
    await expect(page.locator('.composer-input')).toBeVisible();
    await expect(page.locator('.project-row.current .project-name')).toContainText('另一个项目');
  } finally { await page.close(); }
});

test('new tasks are created only after the user accepts leaving a dirty form', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url + '?view=automations');
    await page.getByRole('button', { name: '新建自动化', exact: true }).click();
    await page.locator('#automation-name').fill('保留新计划');
    const create = page.locator('.sidebar-new-task .new-thread');
    await create.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => window.formNavigationTest.requests.filter(request => request.op === 'thread.create'))).toHaveLength(0);
    await page.getByRole('dialog').press('Escape');
    await expect(page.locator('#automation-name')).toHaveValue('保留新计划');
    await create.click();
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.locator('.automations-page')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.formNavigationTest.requests.filter(request => request.op === 'thread.create'))).toHaveLength(1);
  } finally { await page.close(); }
});

test('cancelling task navigation leaves read status unchanged and confirmation marks the selected task once', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url + '?view=automations');
    await page.getByRole('button', { name: '新建自动化', exact: true }).click();
    await page.locator('#automation-name').fill('仍在编辑');
    const task = page.locator('.thread-main').filter({ hasText: '已有任务' });
    await task.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => window.formNavigationTest.requests.filter(request => request.op === 'thread.update'))).toHaveLength(0);
    await page.getByRole('dialog').press('Escape');
    await expect(page.locator('#automation-name')).toHaveValue('仍在编辑');
    await task.click();
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.locator('.automations-page')).toHaveCount(0);
    expect(await page.evaluate(() => window.formNavigationTest.requests.filter(request => request.op === 'thread.update'))).toEqual([
      expect.objectContaining({ op: 'thread.update', id: 't', readAt: expect.any(Number) }),
    ]);
  } finally { await page.close(); }
});
