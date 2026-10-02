import { access, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
const evidence = resolve('../../.artifacts/final-ui');
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async ({}, info) => { fixture = await acceptanceApp(info.title.includes('file://') ? '' : development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });

test('final bilingual theme and size matrix keeps settings, menus, summary and compact composer inside the window', async () => {
  await fixture.invoke({ op: 'thread.send', id: 't', text: '检查本地开发工作台', attachments: [] }); await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  const capture = process.env.PI_DESKTOP_FINAL_EVIDENCE === '1'; if (capture) await mkdir(evidence, { recursive: true });
  for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['dark', 'light'] as const) for (const size of [[1440, 940], [1000, 700], [1280, 800]]) {
    const state = (await fixture.snapshot()).data.ui; await fixture.invoke({ op: 'ui.update', ui: { ...state, locale, view: 'thread', sidebarWidth: 240, reviewOpen: false, summaryOpen: true } }); await fixture.invoke({ op: 'settings.patch', patch: { theme } });
    await fixture.app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setContentSize(value[0], value[1]), size);
    await expect(fixture.page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(fixture.page.locator('html')).toHaveAttribute('lang', locale);
    if (locale === 'en-US') {
      await expect(fixture.page.locator('.sidebar').getByRole('button', { name: /^New chat/ })).toHaveCount(1);
      await expect(fixture.page.locator('.sidebar').getByRole('button', { name: 'New chat', exact: true })).toBeVisible();
    }
    await expect(fixture.page.locator('.sidebar')).toHaveCSS('width', '240px');
    await expect.poll(() => fixture.page.evaluate(() => [innerWidth, innerHeight])).toEqual(size);
    await expect(fixture.page.locator('.summary-branch')).toBeVisible();
    await expect(fixture.page.locator('.task-summary [aria-busy=true]')).toHaveCount(0);
    await expect(fixture.page.locator('.voice-controls')).toHaveCount(0);
    await expect(fixture.page.locator('.composer-actions button')).toHaveCount(4);
    expect(await fixture.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const controls = fixture.page.locator('.composer-actions');
    expect(await controls.evaluate(node => [...node.querySelectorAll('button')].every(button => { const rect = button.getBoundingClientRect(); return !rect.width || rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight; }))).toBe(true);
    if (capture && size[0] === 1440 && (theme === 'dark') === (locale === 'zh-CN')) await fixture.page.screenshot({ path: join(evidence, 'conversation-' + theme + '-' + locale + '.png') });
    const next = (await fixture.snapshot()).data.ui; await fixture.invoke({ op: 'ui.update', ui: { ...next, view: 'settings' } });
    for (const category of ['general', 'appearance', 'voice', 'memories']) {
      await fixture.page.locator('.settings-sidebar [data-category=' + category + ']').click();
      expect(await fixture.page.locator('.settings-body').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      const footer = await fixture.page.locator('.settings-footer').boundingBox(); expect(footer!.y + footer!.height).toBeLessThanOrEqual(size[1]);
      if (capture && category === 'general' && (size[0] === 1440 && (theme === 'dark') === (locale === 'zh-CN') || size[0] === 1000 && (theme === 'light') === (locale === 'zh-CN'))) await fixture.page.screenshot({ path: join(evidence, 'settings-' + theme + '-' + locale + '-' + size[0] + '.png') });
    }
  }
});

test('file:// development build loads local PDF assets and inline input suggestions without a dev server', async () => {
  expect(fixture.page.url().startsWith('file:')).toBe(true);
  const encoded = await fixture.app.evaluate(async ({ BrowserWindow }) => { const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } }); try { await window.loadURL('data:text/html,<h1>Offline PDF proof</h1>'); return (await window.webContents.printToPDF({})).toString('base64'); } finally { window.destroy(); } });
  await writeFile(join(fixture.project, 'offline.pdf'), Buffer.from(encoded, 'base64'));
  const ui = (await fixture.snapshot()).data.ui; await fixture.invoke({ op: 'ui.update', ui: { ...ui, reviewOpen: true } }); await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { reviewTab: 'file', activePanelTab: 'file:offline.pdf', selectedPath: 'offline.pdf', openFiles: ['offline.pdf'] } });
  await expect(fixture.page.getByRole('button', { name: '标注此页', exact: true })).toBeEnabled();
  expect(await fixture.page.getByLabel('PDF 当前页面').evaluate((node: HTMLCanvasElement) => node.width)).toBeGreaterThan(100);
  await expect(fixture.page.locator('.voice-controls')).toHaveCount(0);
  await fixture.page.getByLabel('向 Pi 发送消息').fill('@README');
  await fixture.page.getByRole('option', { name: 'README.md 验收项目 / README.md', exact: true }).click();
  await expect(fixture.page.locator('.composer-context .attachment')).toHaveCount(1);
  await fixture.page.getByLabel('向 Pi 发送消息').fill('/plan');
  await fixture.page.getByRole('option', { name: '开启计划模式 /plan', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].planMode).toBe(true);
  expect(fixture.calls).toHaveLength(0);
});

test('compact composer menus remain anchored and preserve the draft in the native window', async () => {
  const directory = resolve('../../.artifacts/composer-compact');
  const capture = process.env.PI_DESKTOP_COMPOSER_EVIDENCE === '1';
  if (capture) await mkdir(directory, { recursive: true });
  const ui = (await fixture.snapshot()).data.ui;
  await fixture.invoke({ op: 'ui.update', ui: { ...ui, sidebarWidth: 240, reviewOpen: false, summaryOpen: false } });
  const models = (await fixture.snapshot()).data.settings.models.map(model => ({ ...model, reasoning: true }));
  await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark', models } });
  await fixture.invoke({ op: 'thread.update', id: 't', thinking: 'high' });
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700));
  const input = fixture.page.getByLabel('向 Pi 发送消息');
  await expect(input).toBeVisible();
  await expect(fixture.page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(fixture.page.getByLabel('模型与能力', { exact: true })).toHaveText('验收模型高');
  await fixture.page.evaluate(() => document.fonts.ready);
  if (capture) await fixture.page.screenshot({ path: join(directory, 'composer-dark.png'), animations: 'disabled' });
  await input.fill('/');
  await expect(fixture.page.getByRole('option', { name: '开启计划模式 /plan', exact: true })).toBeVisible();
  const popup = (await fixture.page.locator('.composer-suggestions').boundingBox())!;
  const composer = (await fixture.page.locator('.composer').boundingBox())!;
  expect(popup.y).toBeGreaterThanOrEqual(6); expect(popup.y + popup.height).toBeLessThanOrEqual(composer.y);
  if (capture) await fixture.page.screenshot({ path: join(directory, 'slash-menu-dark.png'), animations: 'disabled' });
  await input.press('Escape'); await input.fill('保留未发送草稿');
  await fixture.page.getByLabel('模型与能力', { exact: true }).click();
  await expect(fixture.page.getByRole('slider', { name: '思考级别', exact: true })).toBeEnabled();
  if (capture) await fixture.page.screenshot({ path: join(directory, 'model-effort-dark.png'), animations: 'disabled' });
  await fixture.page.getByRole('button', { name: '模型', exact: true }).click();
  await expect(fixture.page.getByRole('menuitemradio')).toHaveCount(1);
  await fixture.page.keyboard.press('Escape'); await expect(input).toHaveValue('保留未发送草稿');
});
