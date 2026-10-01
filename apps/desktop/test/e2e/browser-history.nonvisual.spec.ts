import { access, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type RequestListener, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import type { BrowserHistoryPage } from '../../src/shared/browser-history.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
let server: Server; let site = ''; let second: Server; let other = ''; let assets = 0;
test.beforeAll(async () => {
  development = await startDevelopmentSource();
  const handler: RequestListener = (request, response) => {
    if (request.url === '/asset.js') { assets++; response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public,max-age=86400' }); response.end('window.assetLoaded=true;'); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('<title>' + (request.url === '/old' ? '很早的页面' : '中文历史页面') + '</title><p>history fixture</p><script src="/asset.js"></script>');
  };
  server = createServer(handler); second = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); await new Promise<void>(resolve => second.listen(0, '127.0.0.2', resolve));
  const address = server.address(), next = second.address(); if (!address || typeof address === 'string' || !next || typeof next === 'string') throw new Error('Missing test addresses');
  site = 'http://127.0.0.1:' + address.port; other = 'http://127.0.0.2:' + next.port;
});
test.afterAll(async () => { for (const item of [server, second]) { item?.closeAllConnections(); if (item) await new Promise<void>(resolve => item.close(() => resolve())); } await development?.server.close(); });
test.beforeEach(async () => { assets = 0; fixture = await acceptanceApp(development.url); await fixture.page.getByLabel('视图菜单').click(); await fixture.page.getByRole('menuitem', { name: '切换浏览器预览', exact: true }).click(); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });
const history = (query = '') => fixture.invoke({ op: 'browser.history', query, offset: 0, limit: 100 }) as Promise<BrowserHistoryPage>;
async function menu(name: string) { await fixture.page.getByLabel('浏览器操作', { exact: true }).click(); await fixture.page.getByRole('menuitem', { name, exact: true }).click(); }
async function script(origin: string, code: string) { return fixture.app.evaluate(({ webContents }, value) => webContents.getAllWebContents().find(item => item.getURL().startsWith(value.origin))!.executeJavaScript(value.code), { origin, code }); }

test('dialog checkboxes use compact neutral marks and retain label, keyboard and contrast support', async () => {
  await menu('清除浏览数据');
  const panel = fixture.page.getByRole('dialog', { name: '浏览历史', exact: true });
  const checkbox = panel.getByLabel('网站 Cookie 和存储');
  for (const theme of ['light', 'dark']) {
    await fixture.page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await checkbox.uncheck();
    await expect(checkbox).toHaveCSS('appearance', 'none');
    await expect(checkbox).toHaveCSS('width', '14px');
    await expect(checkbox).toHaveCSS('height', '14px');
    await expect(checkbox).toHaveCSS('border-radius', '4px');
    await expect(checkbox).toHaveCSS('padding', '0px');
    expect(await checkbox.evaluate(element => getComputedStyle(element, '::before').visibility)).toBe('hidden');
    await checkbox.locator('..').click();
    await expect(checkbox).toBeChecked();
    const colors = await checkbox.evaluate(element => ({ mark: getComputedStyle(element).backgroundColor, text: getComputedStyle(element).getPropertyValue('--text').trim(), visible: getComputedStyle(element, '::before').visibility }));
    expect(colors.mark).toBe(colors.text);
    expect(colors.visible).toBe('visible');
    await checkbox.focus();
    await fixture.page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeFocused();
    await expect(checkbox).toHaveCSS('outline-style', 'solid');
    await checkbox.blur();
    if (process.env.PI_UI_EVIDENCE === '1') {
      const evidence = fileURLToPath(new URL('../../../../.artifacts/selection-ui/', import.meta.url));
      await mkdir(evidence, { recursive: true });
      await panel.locator('.browser-data-settings').screenshot({ path: join(evidence, 'checkboxes-' + theme + '.png') });
    }
  }
  await fixture.page.emulateMedia({ forcedColors: 'active' });
  await expect(checkbox).toHaveCSS('appearance', 'auto');
  expect(await checkbox.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none');
  await checkbox.check();
  await expect(checkbox).toBeChecked();
});

test('real history search, keyboard address suggestions and IME survive application restart', async () => {
  await fixture.invoke({ op: 'browser.open', threadId: 't', tabId: 'first', url: site + '/old' });
  await fixture.invoke({ op: 'browser.open', threadId: 't', tabId: 'second', url: site + '/recent' });
  await expect.poll(async () => (await history('中文历史页面')).total).toBe(1);
  await menu('浏览历史'); let panel = fixture.page.getByRole('dialog', { name: '浏览历史', exact: true });
  await panel.getByLabel('搜索浏览历史').fill('很早'); await expect(panel.locator('li')).toHaveCount(1); await expect(panel.locator('li')).toContainText('/old');
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  const address = fixture.page.getByLabel('预览地址'); await address.fill('很早'); await expect(fixture.page.getByRole('listbox', { name: '浏览历史建议' })).toBeVisible();
  await address.press('ArrowDown'); await expect(address).toHaveAttribute('aria-activedescendant', /-0$/); await address.press('Enter'); await expect(address).toHaveValue(site + '/old');
  await address.dispatchEvent('compositionstart'); await address.fill('中文'); await address.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
  await expect(fixture.page.getByRole('listbox', { name: '浏览历史建议' })).toBeHidden(); await expect(address).toHaveValue('中文');
  await address.dispatchEvent('compositionend'); await expect(fixture.page.getByRole('listbox', { name: '浏览历史建议' })).toBeVisible(); await address.press('Escape'); await expect(address).toHaveValue(site + '/old');
  await fixture.restart(); expect((await history('中文')).total).toBeGreaterThan(0); await menu('浏览历史'); panel = fixture.page.getByRole('dialog', { name: '浏览历史', exact: true });
  await expect(panel.locator('li')).not.toHaveCount(0);
  const json = JSON.parse(await readFile(join(fixture.storage, 'browser-history.json'), 'utf8')); expect(json.version).toBe(1); expect(json.entries.some((item: { title: string }) => item.title === '中文历史页面')).toBe(true);
});

test('time-scoped history and site data cleanup preserves older unrelated sites and clears actual cache', async () => {
  const now = Date.now(); await fixture.app.evaluate(_electron => { Date.now = () => new Date().getTime() - 9 * 86400000; });
  await fixture.invoke({ op: 'browser.open', threadId: 't', tabId: 'old', url: site + '/old' }); await script(site, 'localStorage.setItem("keep","old");document.cookie="keep=old;path=/"');
  await fixture.app.evaluate(_electron => { Date.now = () => new Date().getTime(); });
  await fixture.invoke({ op: 'browser.open', threadId: 't', tabId: 'recent', url: other + '/recent' }); await script(other, 'localStorage.setItem("remove","new");document.cookie="remove=new;path=/"');
  expect((await history('old')).entries[0].visitedAt).toBeLessThan(now - 8 * 86400000);
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
  const rejected = crypto.randomUUID(); await fixture.invoke({ op: 'browser.clear', requestId: rejected, options: { range: 'day', history: true, siteData: true, cache: true } });
  await expect.poll(async () => (await fixture.snapshot()).data.operations.find(item => item.id === rejected)?.result).toEqual({ cancelled: true }); expect(await script(other, 'localStorage.getItem("remove")')).toBe('new');
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await menu('清除浏览数据'); const panel = fixture.page.getByRole('dialog', { name: '浏览历史', exact: true });
  await panel.getByLabel('清理时间范围').selectOption('day'); await panel.getByLabel('网站 Cookie 和存储').check(); await panel.getByLabel('全部浏览器缓存').check();
  await panel.getByRole('button', { name: '清除选定数据', exact: true }).click(); await expect(panel.getByText('浏览数据已清理', { exact: true })).toBeVisible();
  expect((await history('recent')).total).toBe(0); expect((await history('old')).total).toBe(1);
  expect(await script(site, '({local:localStorage.getItem("keep"),cookie:document.cookie})')).toEqual({ local: 'old', cookie: 'keep=old' });
  expect(await script(other, '({local:localStorage.getItem("remove"),cookie:document.cookie})')).toEqual({ local: null, cookie: '' });
  const backup = JSON.parse(await readFile(join(fixture.storage, 'browser-history.json.bak'), 'utf8')); expect(backup.entries.some((item: { url: string }) => item.url.endsWith('/recent'))).toBe(false);
  const before = assets; await fixture.invoke({ op: 'browser.action', threadId: 't', tabId: 'recent', action: 'reload' }); await expect.poll(() => assets).toBeGreaterThan(before);
});

test('history disk failure keeps visits visible and retries after partial site cleanup and restart', async () => {
  await fixture.invoke({ op: 'browser.open', threadId: 't', tabId: 'recent', url: other + '/recent' });
  await script(other, 'localStorage.setItem("clear-me","value")');
  const path = join(fixture.storage, 'browser-history.json');
  await expect.poll(async () => { try { return JSON.parse(await readFile(path, 'utf8')).entries.length; } catch { return 0; } }).toBe(1);
  const originalId = (await history('recent')).entries[0].id;
  await fixture.app.evaluate(({ dialog }, path) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    const fs = process.getBuiltinModule('node:fs/promises'), { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      if (String(to) === path) { fs.rename = rename; syncBuiltinESMExports(); throw new Error('HISTORY_DISK_FAILURE'); }
      return rename(from, to);
    };
    syncBuiltinESMExports();
  }, path);
  await menu('清除浏览数据'); let panel = fixture.page.getByRole('dialog', { name: '浏览历史', exact: true });
  await panel.getByLabel('清理时间范围').selectOption('all'); await panel.getByLabel('网站 Cookie 和存储').check();
  await panel.getByRole('button', { name: '清除选定数据', exact: true }).click();
  await expect(panel.getByRole('alert').filter({ hasText: 'HISTORY_DISK_FAILURE' }).first()).toBeVisible();
  await expect(panel.getByText('清理失败前已完成的部分不会撤销；可重试所选操作。', { exact: true })).toBeVisible();
  expect((await history('recent')).total).toBe(1); await expect(panel.locator('li')).toHaveCount(1);
  expect(await script(other, 'localStorage.getItem("clear-me")')).toBe(null);
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' } });
  panel = fixture.page.getByRole('dialog', { name: 'Browsing history', exact: true });
  await expect(panel.getByText('Data already cleared before the failure cannot be restored. You can retry the selected actions.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('alert').filter({ hasText: 'Could not save browsing history' })).toBeVisible();
  await fixture.restart(); expect((await history('recent')).entries.some(item => item.id === originalId)).toBe(true);
  await fixture.invoke({ op: 'browser.open', threadId: 't', tabId: 'recent', url: other + '/recent' });
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await fixture.page.getByLabel('Browser actions', { exact: true }).click(); await fixture.page.getByRole('menuitem', { name: 'Clear browsing data', exact: true }).click();
  panel = fixture.page.getByRole('dialog', { name: 'Browsing history', exact: true });
  await panel.getByLabel('Time range to clear').selectOption('all'); await panel.getByRole('button', { name: 'Clear selected data', exact: true }).click();
  await expect(panel.getByText('Browsing data cleared', { exact: true })).toBeVisible();
  expect((await history()).total).toBe(0);
  for (const file of [path, path + '.bak']) expect(JSON.parse(await readFile(file, 'utf8')).entries).toEqual([]);
  await fixture.invoke({ op: 'browser.tab', threadId: 't', tabId: 'recent', action: 'close' });
  await fixture.restart(); expect((await history()).total).toBe(0);
});
