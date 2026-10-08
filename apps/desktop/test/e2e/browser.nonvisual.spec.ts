import { createServer, type Server } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Bootstrap, DesktopEvent, Thread } from '../../src/shared/contracts.ts';
import type { BrowserWindow, KeyboardInputEvent } from 'electron';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import { translate } from '../../src/shared/localization.ts';

type BrowserEvent = Extract<DesktopEvent, { type: 'browser' }>;
declare global { interface Window { __browserEvents: BrowserEvent[]; } }
let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
let server: Server;
let site: string;
let clipboard: string;
let finishSlow: (() => void) | undefined;
const evidence = resolve('../../.artifacts/browser-tool-tabs');

test.beforeAll(async () => {
  if (process.env.PI_DESKTOP_CAPTURE === '1') await mkdir(evidence, { recursive: true });
  development = await startDevelopmentSource();
  server = createServer((request, response) => {
    if (request.url === '/slow') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.write('<title>慢速页面</title>');
      finishSlow = () => { response.end('<p>delayed delayed</p>'); finishSlow = undefined; };
      return;
    }
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/a' }); response.end(); return; }
    const title = request.url === '/b' ? '第二页' : request.url === '/after' ? '导航后' : '第一页';
    const body = request.url === '/b' ? 'second second second' : request.url === '/after' ? 'needle' : 'needle needle 中文查找 中文查找';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<title>' + title + '</title><p>' + body + '</p><input id="native-input"><a href="/after">next</a>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test website');
  site = 'http://127.0.0.1:' + address.port;
});
test.afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await development?.server.close();
});
test.beforeEach(async () => {
  fixture = await acceptanceApp(development.url);
  clipboard = await fixture.app.evaluate(({ clipboard }) => clipboard.readText());
  await fixture.page.evaluate(() => { window.__browserEvents = []; window.desktop.onEvent(event => { if (event.type === 'browser') window.__browserEvents.push(event); }); });
  await fixture.page.getByLabel('视图菜单').click();
  await fixture.page.getByRole('menuitem', { name: '切换浏览器预览', exact: true }).click();
});
test.afterEach(async () => {
  finishSlow?.();
  const errors = [...fixture.errors];
  await fixture.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), clipboard).catch(() => {});
  await fixture.close();
  expect(errors).toEqual([]);
});
const search = () => fixture.page.getByRole('search', { name: '网页查找' });
const query = () => search().getByRole('textbox');
const status = () => search().getByRole('status');
async function showFind() {
  if (await search().isVisible()) return;
  await fixture.page.getByLabel('浏览器操作', { exact: true }).click();
  await fixture.page.getByRole('menuitem', { name: '网页内查找', exact: true }).click();
  await expect(query()).toBeFocused();
}
async function open(path: string) {
  await fixture.page.getByLabel('预览地址').fill(site + path);
  await fixture.page.getByRole('button', { name: '打开', exact: true }).click();
  await expect.poll(() => fixture.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(item => item.getURL() === url && !item.isLoading())?.id ?? 0, site + path)).toBeGreaterThan(0);
  await showFind();
  return fixture.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(item => item.getURL() === url)!.id, site + path);
}
async function lastFind() {
  return fixture.page.evaluate(() => window.__browserEvents.at(-1)?.find);
}
async function nativeKey(id: number, input: Omit<KeyboardInputEvent, 'type'>) {
  await fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.focus(), id);
  await expect.poll(() => fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.isFocused(), id)).toBe(true);
  await fixture.app.evaluate(({ webContents }, data) => {
    const contents = webContents.fromId(data.id)!;
    contents.sendInputEvent({ ...data.input, type: 'keyDown' });
    contents.sendInputEvent({ ...data.input, type: 'keyUp' });
  }, { id, input });
}

test('browser overflow retains the page image and restores the same live page after dismissal', async () => {
  const id = await open('/a');
  await fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.body.style.background="rgb(36, 96, 142)";document.querySelector("#native-input").value="keep me"'), id);
  await fixture.page.getByLabel('浏览器操作', { exact: true }).click();
  await expect(fixture.page.getByRole('menuitem', { name: '复制地址', exact: true })).toBeVisible();
  await expect(fixture.page.locator('.preview-snapshot')).toBeVisible();
  expect(await fixture.page.locator('.preview-snapshot').evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await fixture.page.locator('.preview-snapshot').evaluate(image => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const source = image as HTMLImageElement;
    context.drawImage(source, source.naturalWidth / 2, source.naturalHeight / 2, 1, 1, 0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  })).toEqual([36, 96, 142, 255]);
  if (process.env.PI_DESKTOP_CAPTURE === '1') await fixture.page.screenshot({ path: resolve(evidence, 'browser-menu.png'), clip: (await fixture.page.locator('.review-pane').boundingBox())! });
  await fixture.page.keyboard.press('Escape');
  await expect(fixture.page.locator('.preview-snapshot')).toBeHidden();
  await expect.poll(() => fixture.app.evaluate(({ BrowserWindow, webContents }, id) => BrowserWindow.getAllWindows().some(window => window.contentView.children.some(view => 'webContents' in view && view.webContents === webContents.fromId(id) && view.getVisible())), id)).toBe(true);
  expect(await fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#native-input").value'), id)).toBe('keep me');
});

test('native find reports ordinals, cycles both directions and rejects stale results and IME intermediates', async () => {
  const id = await open('/a');
  await query().fill('needle'); await expect(status()).toHaveText('第 1/2 处');
  const old = await lastFind();
  await search().getByRole('button', { name: '下一处' }).click(); await expect(status()).toHaveText('第 2/2 处');
  await query().press('Enter'); await expect(status()).toHaveText('第 1/2 处');
  await query().press('Shift+Enter'); await expect(status()).toHaveText('第 2/2 处');
  await search().getByRole('button', { name: '上一处' }).click(); await expect(status()).toHaveText('第 1/2 处');
  await query().fill('absent'); await expect(status()).toHaveText('没有匹配结果');
  await fixture.app.evaluate(({ webContents }, data) => {
    webContents.fromId(data.id)!.emit('found-in-page', {}, { requestId: data.requestId, matches: 999, activeMatchOrdinal: 999, finalUpdate: true, selectionArea: { x: 0, y: 0, width: 0, height: 0 } });
  }, { id, requestId: old!.requestId });
  await expect(status()).toHaveText('没有匹配结果');
  const before = await lastFind();
  await query().dispatchEvent('compositionstart');
  await query().fill('中文查找');
  await query().dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
  expect(await lastFind()).toEqual(before);
  await query().dispatchEvent('compositionend', { data: '中文查找' });
  await expect(status()).toHaveText('第 1/2 处');
  await query().press('Escape');
  await expect(query()).toHaveValue(''); await expect(status()).toBeEmpty();
  await expect(fixture.page.locator('.preview-panel')).toBeVisible();
  await expect.poll(() => fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.isFocused(), id)).toBe(true);
  expect(await lastFind()).toMatchObject({ text: '', matches: 0, active: 0 });
  await open('/b'); await query().fill('second'); await expect(status()).toHaveText('第 1/3 处');
  const previous = search().getByRole('button', { name: '上一处' });
  await previous.press('Enter'); await expect(status()).toHaveText('第 3/3 处');
  await expect(previous).toBeFocused();
  await previous.press('Space'); await expect(status()).toHaveText('第 2/3 处');
  await expect(previous).toBeFocused();
  await search().getByRole('button', { name: '下一处' }).press('Enter'); await expect(status()).toHaveText('第 3/3 处');
  await search().getByRole('button', { name: '清除查找' }).press('Enter');
  await expect(query()).toHaveValue(''); await expect(status()).toBeEmpty();
  await expect.poll(() => fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.isFocused(), id)).toBe(true);
  await query().fill('second'); await expect(status()).toHaveText('第 1/3 处');
  await previous.press('Escape'); await expect(query()).toHaveValue('');
  await expect.poll(() => fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.isFocused(), id)).toBe(true);
});

test('loading a new document defers the latest query until its content arrives', async () => {
  await open('/a');
  await query().fill('needle'); await expect(status()).toHaveText('第 1/2 处');
  await fixture.page.getByLabel('预览地址').fill(site + '/slow');
  await fixture.page.getByRole('button', { name: '打开', exact: true }).click();
  await expect.poll(() => !!finishSlow).toBe(true);
  await query().fill('obsolete'); await query().fill('delayed');
  await expect.poll(lastFind).toMatchObject({ text: 'delayed', requestId: 0, pending: true });
  await expect(status()).toHaveText('查找中…');
  finishSlow!();
  await expect(status()).toHaveText('第 1/2 处');
  await query().press('Enter'); await expect(status()).toHaveText('第 2/2 处');
});

test('queries stay with their native tab through navigation, tasks, panel hide and renderer reload', async () => {
  await open('/a'); await query().fill('needle'); await expect(status()).toHaveText('第 1/2 处');
  await fixture.page.getByRole('button', { name: '新标签', exact: true }).click();
  await expect(query()).toHaveValue('');
  await open('/b'); await query().fill('second'); await expect(status()).toHaveText('第 1/3 处');
  await fixture.page.getByRole('tab', { name: '第一页', exact: true }).click();
  await expect(query()).toHaveValue('needle'); await expect(status()).toHaveText('第 1/2 处');
  await open('/after'); await expect(status()).toHaveText('第 1/1 处');
  await fixture.page.locator('.preview-toolbar').getByLabel('后退', { exact: true }).click();
  await expect(fixture.page.getByLabel('预览地址')).toHaveValue(site + '/a');
  await expect(status()).toHaveText('第 1/2 处');
  await fixture.page.getByLabel('刷新预览').click(); await expect(status()).toHaveText('第 1/2 处');
  await fixture.page.getByLabel('隐藏浏览器').click();
  await fixture.page.getByLabel('视图菜单').click();
  await fixture.page.getByRole('menuitem', { name: '切换浏览器预览', exact: true }).click();
  await expect(query()).toHaveValue('needle'); await expect(status()).toHaveText('第 1/2 处');
  await query().fill(''); await expect(status()).toBeEmpty();
  await expect.poll(lastFind).toMatchObject({ text: '', pending: false });
  await query().fill('needle'); await expect(status()).toHaveText('第 1/2 处');
  const second = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  await fixture.page.locator('.thread-main').filter({ hasText: second.title }).click();
  await fixture.page.getByLabel('视图菜单').click();
  await fixture.page.getByRole('menuitem', { name: '切换浏览器预览', exact: true }).click();
  await expect(query()).toBeHidden();
  await open('/b'); await query().fill('missing'); await expect(status()).toHaveText('没有匹配结果');
  await fixture.page.locator('.thread-main').filter({ hasText: '验收任务' }).click();
  await expect(query()).toHaveValue('needle'); await expect(status()).toHaveText('第 1/2 处');
  await fixture.page.reload();
  await expect(query()).toHaveValue('needle'); await expect(status()).toHaveText('第 1/2 处');
  await fixture.restart();
  await expect(fixture.page.locator('.browser-tabs [role=tab]')).toHaveCount(2);
  await showFind();
  await expect(query()).toHaveValue('');
  expect(fixture.calls).toHaveLength(0);
});

test('address validation is local, drafts survive tab navigation and copying uses the loaded page', async () => {
  const page = fixture.page;
  const address = page.getByLabel('预览地址');
  await address.fill('javascript:alert(1)'); await address.press('Enter');
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.browser-error')).toContainText('HTTP');
  expect((await fixture.snapshot()).data.ui.threads.t.browserTabs ?? []).toEqual([]);
  expect(await fixture.app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(wc => wc.getType() === 'window').length)).toBe(1);
  await address.fill('  ' + site.replace('http://', '') + '/redirect  '); await address.press('Enter');
  await expect(page.getByRole('tab', { name: '第一页', exact: true })).toBeVisible();
  await expect(address).toHaveValue(site + '/a');
  const id = await fixture.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)!.id, site + '/a');
  await address.fill('example.invalid/未提交');
  await fixture.app.evaluate(({ webContents }, id) => { void webContents.fromId(id)!.executeJavaScript('location.href="/after"').catch(() => {}); }, id);
  await expect(page.getByRole('tab', { name: '导航后', exact: true })).toBeVisible();
  await expect(address).toHaveValue('example.invalid/未提交');
  await page.getByLabel('浏览器操作', { exact: true }).click();
  await page.getByRole('menuitem', { name: '复制地址', exact: true }).click();
  await expect.poll(() => fixture.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(site + '/after');
  await page.getByRole('button', { name: '新标签', exact: true }).click(); await address.fill('example.invalid/第二份');
  await page.getByRole('tab', { name: '导航后', exact: true }).click();
  await expect(address).toHaveValue('example.invalid/未提交');
  await address.press('Escape'); await expect(address).toHaveValue(site + '/after');
  await expect(page.locator('.preview-panel')).toBeVisible();
  await page.getByRole('tab', { name: '新标签', exact: true }).click(); await expect(address).toHaveValue('example.invalid/第二份');
  await address.fill(site + '/b'); await address.dispatchEvent('compositionstart');
  await page.locator('.preview-toolbar').dispatchEvent('submit');
  expect((await fixture.snapshot()).data.ui.threads.t.browserTabs!.at(-1)!.url).toBe('');
  await address.dispatchEvent('compositionend'); await address.press('Enter');
  await expect(page.getByRole('tab', { name: '第二页', exact: true })).toBeVisible();
});

test('browser find shortcuts save through settings and controls fit all three workbench widths', async () => {
  await open('/a');
  const page = fixture.page;
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: '键盘快捷键', exact: true }).click();
  const next = page.getByLabel('网页查找：下一处 快捷键', { exact: true });
  await next.press('Control+n');
  await expect(page.getByRole('alert')).toContainText('使用相同快捷键');
  expect((await fixture.snapshot()).data.threads).toHaveLength(1);
  await next.press('F3');
  await page.getByLabel('网页查找：上一处 快捷键', { exact: true }).press('Shift+F3');
  await page.getByLabel('网页查找：清除并返回网页 快捷键', { exact: true }).press('F4');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.settings.shortcuts?.browserFindNext).toBe('F3');
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await query().fill('needle'); await expect(status()).toHaveText('第 1/2 处');
  await query().press('Enter'); await expect(status()).toHaveText('第 1/2 处');
  await query().press('F3'); await expect(status()).toHaveText('第 2/2 处');
  await query().press('Shift+F3'); await expect(status()).toHaveText('第 1/2 处');
  for (const [width, height] of [[1000, 640], [1280, 800], [1440, 940]]) {
    await fixture.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
    await expect.poll(() => search().evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await expect(search().getByRole('button', { name: '下一处' })).toBeVisible();
    await expect.poll(() => page.locator('.preview-surface').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(80);
  }
  await query().press('F4'); await expect(query()).toHaveValue('');
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings.shortcuts).toMatchObject({ browserFindNext: 'F3', browserFindPrevious: 'Shift+F3', browserFindExit: 'F4' });
  await showFind();
  await query().fill('needle'); await expect(status()).toHaveText('第 1/2 处');
  await query().press('F3'); await expect(status()).toHaveText('第 2/2 处');
});

test('browser pages move to the task window without sharing another window visibility or losing persisted tabs', async () => {
  const id = await open('/a');
  const opened = fixture.app.waitForEvent('window');
  await fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' });
  const task = await opened;
  await task.locator('.desktop').waitFor();
  await task.evaluate(async () => {
    const boot = await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap;
    await window.desktop.invoke({ op: 'ui.update', ui: { ...boot.data.ui, reviewOpen: true } });
  });
  await expect(task.getByLabel('预览地址')).toHaveValue(site + '/a');
  const owner = await (await fixture.app.browserWindow(task)).evaluate((window: BrowserWindow) => window.id);
  await expect.poll(() => fixture.app.evaluate(({ BrowserWindow, webContents }, info) => {
    const wc = webContents.fromId(info.id);
    return BrowserWindow.fromId(info.owner)!.contentView.children.some(view => 'webContents' in view && view.webContents === wc);
  }, { owner, id })).toBe(true);
  await fixture.invoke({ op: 'preview.close' });
  expect(await fixture.app.evaluate(({ BrowserWindow, webContents }, info) => {
    const wc = webContents.fromId(info.id);
    return BrowserWindow.fromId(info.owner)!.contentView.children.find(view => 'webContents' in view && view.webContents === wc)?.getVisible();
  }, { owner, id })).toBe(true);
  await expect(fixture.invoke({ op: 'browser.open', threadId: 't', tabId: (await fixture.snapshot()).data.ui.threads.t.activeBrowserTab!, url: site + '/b' })).rejects.toThrow(/另一个窗口/);
  await (await fixture.app.browserWindow(task)).evaluate((window: BrowserWindow) => window.close());
  expect((await fixture.snapshot()).data.ui.threads.t.browserTabs).toHaveLength(1);
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, activeThreadId: 't', reviewOpen: true } });
  await expect(fixture.page.getByLabel('预览地址')).toHaveValue(site + '/a');
  await expect.poll(() => fixture.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().filter(wc => wc.getURL() === url && !wc.isLoading()).length, site + '/a')).toBe(1);
});

test('empty browser has one tab row and keeps utility controls in the menu', async () => {
  const page = fixture.page;
  await expect(page.locator('.review-tabs')).toHaveCount(0);
  await expect(page.locator('.browser-tabs')).toHaveCount(1);
  await expect(search()).toBeHidden();
  await expect(page.locator('.browser-actions')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '新标签', exact: true })).toHaveAttribute('aria-selected', 'true');
  const pane = await page.locator('.review-pane').boundingBox();
  const tabs = await page.locator('.workspace-tab-header').boundingBox();
  const address = await page.locator('.preview-toolbar').boundingBox();
  const content = await page.locator('.preview-surface').boundingBox();
  expect(tabs!.y).toBe(pane!.y);
  expect(tabs!.height).toBe(46);
  expect(address!.y).toBe(tabs!.y + tabs!.height);
  expect(content!.y).toBe(address!.y + 40);
  await expect(page.locator('.tool-launcher button')).toHaveText(['审查', '终端', '侧聊', '文件', '子智能体']);
  await page.locator('.tool-launcher').getByRole('button', { name: '文件', exact: true }).click();
  await expect(page.locator('.files-navigator')).toBeVisible();
});

test('each tab closes on hover or middle click without changing an unrelated selection', async () => {
  const page = fixture.page;
  await open('/a');
  await page.getByRole('button', { name: '新标签', exact: true }).click(); await open('/b');
  await page.getByRole('button', { name: '新标签', exact: true }).click(); await open('/after');
  const second = page.locator('.workspace-tabs .tab-item').filter({ has: page.getByRole('tab', { name: '第二页', exact: true }) });
  await page.locator('.composer-input').click();
  await expect(second.locator('.tab-close')).toHaveCSS('opacity', '0');
  await second.hover(); await expect(second.locator('.tab-close')).toHaveCSS('opacity', '1');
  await second.getByRole('button', { name: '关闭 第二页', exact: true }).click();
  await expect(page.getByRole('tab', { name: '第二页', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '导航后', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '导航后', exact: true }).click({ button: 'middle' });
  await expect(page.getByRole('tab', { name: '第一页', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('预览地址')).toHaveValue(site + '/a');
  await page.getByRole('tab', { name: '第一页', exact: true }).click({ button: 'middle' });
  await expect(page.locator('.tool-launcher')).toBeVisible();
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.browserTabs).toEqual([]);
  await page.getByLabel('浏览器操作', { exact: true }).click();
  await page.getByRole('menuitem', { name: '恢复关闭标签', exact: true }).click();
  await expect(page.getByRole('tab', { name: '第一页', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('预览地址')).toHaveValue(site + '/a');
});

test('tool tabs share the browser strip, preserve native pages and terminals and restore their order', async () => {
  const page = fixture.page;
  const id = await open('/a');
  await fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#native-input").value="same page"'), id);
  for (const name of ['文件', '终端', '审查', '侧聊']) {
    await page.getByRole('button', { name: '新标签', exact: true }).click();
    await page.locator('.tool-launcher').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.workspace-tabs').getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    if (name === '终端') {
      await page.getByLabel('新建终端', { exact: true }).click();
      await expect(page.locator('.terminal-panel [data-terminal-id]')).toBeVisible();
    }
  }
  await expect(page.locator('.workspace-tabs [role=tab]')).toHaveText(['第一页', '文件', '终端', '审查', '侧聊']);
  expect(fixture.calls).toHaveLength(0);
  expect((await fixture.snapshot()).data.ui.threads.t.browserTabs).toHaveLength(1);
  const terminals = (await fixture.snapshot()).terminals;
  expect(terminals).toHaveLength(1);
  await page.locator('.workspace-tabs').getByRole('tab', { name: '终端', exact: true }).click({ button: 'middle' });
  expect((await fixture.snapshot()).terminals[0].id).toBe(terminals[0].id);
  await expect(page.locator('.workspace-tabs').getByRole('tab', { name: '侧聊', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '第一页', exact: true }).click();
  await expect(page.getByLabel('预览地址')).toHaveValue(site + '/a');
  expect(await fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#native-input").value'), id)).toBe('same page');
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await fixture.restart();
  await expect(fixture.page.locator('.workspace-tabs [role=tab]')).toHaveText(['第一页', '文件', '审查', '侧聊']);
  await expect(fixture.page.getByRole('tab', { name: '文件', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(fixture.page.locator('.files-navigator')).toBeVisible();
});

test('launcher and mixed tab controls fit both themes and languages at supported sizes', async () => {
  const page = fixture.page;
  for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'] as const) {
    await fixture.invoke({ op: 'settings.patch', patch: { theme } });
    const state = await fixture.snapshot();
    await fixture.invoke({ op: 'ui.update', ui: { ...state.data.ui, locale } });
    for (const [width, height] of [[1000, 700], [1280, 800], [1440, 940]]) {
      await fixture.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
      await expect(page.locator('.tool-launcher button')).toHaveText((['审查', '终端', '侧聊', '文件', '子智能体'] as const).map(name => translate(locale, name)));
      await expect(page.locator('.tool-launcher button').first()).toHaveCSS('justify-content', 'flex-start');
      await expect.poll(() => page.locator('.workspace-tab-header').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      await expect.poll(() => page.locator('.tool-launcher').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator('.workspace-tab-actions button').first()).toBeInViewport();
      await expect(page.locator('.preview-toolbar input')).toBeInViewport();
      if (process.env.PI_DESKTOP_CAPTURE === '1' && width === 1440 && (theme === 'light') === (locale === 'zh-CN'))
        await page.locator('.review-pane').screenshot({ path: resolve(evidence, 'launcher-' + theme + '-' + locale + '.png') });
    }
  }
});

test('main-process sidechat creation can leave a terminal tab without stealing navigation back', async () => {
  await fixture.page.locator('.tool-launcher').getByRole('button', { name: '终端', exact: true }).click();
  await expect(fixture.page.locator('.terminal-panel')).toBeVisible();
  await fixture.invoke({ op: 'sidechat.create', threadId: 't' });
  await expect(fixture.page.locator('.sidechat-panel')).toBeVisible();
  await expect(fixture.page.locator('.workspace-tabs').getByRole('tab', { name: '侧聊', exact: true })).toHaveAttribute('aria-selected', 'true');
  await fixture.page.locator('.workspace-tabs').getByRole('tab', { name: '终端', exact: true }).click();
  await expect(fixture.page.locator('.terminal-panel')).toBeVisible();
  expect(fixture.calls).toHaveLength(0);
});

test('summary stacks above a narrow native browser without covering the page or composer', async () => {
  const id = await open('/a');
  await fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#native-input").value="still here"'), id);
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700));
  const ui = (await fixture.snapshot()).data.ui;
  await fixture.invoke({ op: 'ui.update', ui: { ...ui, summaryOpen: true, sidebarWidth: 520, reviewWidth: 760 } });
  await expect(fixture.page.locator('.conversation-layout')).toHaveClass(/summary-stacked/);
  await expect.poll(async () => {
    const summary = (await fixture.page.locator('.task-summary-rail').boundingBox())!;
    const pane = (await fixture.page.locator('.review-pane').boundingBox())!;
    const composer = (await fixture.page.locator('.composer').boundingBox())!;
    return summary.y + summary.height <= pane.y && pane.y + pane.height <= composer.y;
  }).toBe(true);
  await expect.poll(() => fixture.app.evaluate(({ BrowserWindow, webContents }, id) => BrowserWindow.getAllWindows()[0].contentView.children.some(view => 'webContents' in view && view.webContents === webContents.fromId(id) && view.getVisible()), id)).toBe(true);
  await fixture.page.getByRole('button', { name: '任务摘要', exact: true }).click();
  await expect(fixture.page.locator('.task-summary-rail')).toHaveCount(0);
  await expect(fixture.page.locator('.review-pane')).toBeVisible();
  expect(await fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#native-input").value'), id)).toBe('still here');
  await fixture.restart();
  expect((await fixture.snapshot()).data.ui.summaryOpen).toBe(false);
  expect((await fixture.snapshot()).data.ui.reviewOpen).toBe(true);
  await expect(fixture.page.locator('.review-pane')).toBeVisible();
});

test('panel commands open, cycle and close tabs with focus recovery and preserve the composer draft', async () => {
  const page = fixture.page;
  const tabs = page.locator('.workspace-tabs');
  await page.getByLabel('隐藏浏览器').click();
  const composer = page.locator('.composer-input');
  await composer.fill('还没发送的中文草稿');
  await composer.dispatchEvent('keydown', { key: 't', ctrlKey: true, isComposing: true, keyCode: 229 });
  await composer.dispatchEvent('keydown', { key: 't', ctrlKey: true, repeat: true });
  await expect(page.locator('.review-pane')).toHaveCount(0);
  await composer.press('Control+t');
  await expect(page.getByLabel('预览地址')).toBeFocused();
  await page.keyboard.press('Control+Shift+g');
  await expect(tabs.getByRole('tab', { name: '审查', exact: true })).toBeFocused();
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.browserTabs).toEqual([]);
  expect(fixture.calls).toHaveLength(0);
  await page.keyboard.press('Control+t');
  await expect(page.getByLabel('预览地址')).toBeFocused();
  await page.keyboard.press('Control+Shift+Tab');
  await expect(tabs.getByRole('tab', { name: '审查', exact: true })).toBeFocused();
  await page.keyboard.press('Control+Tab');
  await expect(tabs.getByRole('tab', { name: '新标签', exact: true })).toBeFocused();
  await page.keyboard.press('Control+w');
  await expect(tabs.getByRole('tab', { name: '审查', exact: true })).toBeFocused();
  await page.keyboard.press('Control+w');
  await expect(tabs.getByRole('tab', { name: '新标签', exact: true })).toBeFocused();
  await composer.click();
  await page.keyboard.press('Control+Shift+p');
  await page.getByRole('combobox', { name: '搜索命令或最近任务' }).fill('打开浏览器标签');
  await page.getByRole('option', { name: /打开浏览器标签/ }).click();
  await expect(page.getByLabel('预览地址')).toBeFocused();
  await tabs.getByRole('button', { name: '关闭 新标签', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(tabs.getByRole('tab', { name: '新标签', exact: true })).toBeFocused();
  await expect(composer).toHaveValue('还没发送的中文草稿');
  expect(fixture.calls).toHaveLength(0);
});

test('panel commands from native pages use settings immediately and keep page state and restart preferences', async () => {
  const id = await open('/a');
  const page = fixture.page;
  await fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#native-input").value="keep native input"'), id);
  await query().press('Escape');
  await nativeKey(id, { keyCode: 'T', modifiers: ['control'] });
  await expect(page.getByLabel('预览地址')).toBeFocused();
  await expect(page.locator('.workspace-tabs [role=tab]')).toHaveCount(2);
  await page.keyboard.press('Control+Shift+Tab');
  await expect(page.getByRole('tab', { name: '第一页', exact: true })).toBeFocused();
  await nativeKey(id, { keyCode: 'G', modifiers: ['control', 'shift'] });
  await expect(page.getByRole('tab', { name: '审查', exact: true })).toBeFocused();
  expect(fixture.calls).toHaveLength(0);
  await page.getByRole('tab', { name: '第一页', exact: true }).click();
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: '键盘快捷键', exact: true }).click();
  const binding = page.getByLabel('打开浏览器标签 快捷键', { exact: true });
  await binding.press('Control+n');
  await expect(page.getByRole('alert')).toContainText('使用相同快捷键');
  await binding.press('F6');
  await page.getByLabel('辅助栏：关闭当前标签 快捷键', { exact: true }).press('F7');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.settings.shortcuts?.openBrowser).toBe('F6');
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await nativeKey(id, { keyCode: 'F6' });
  await expect(page.getByLabel('预览地址')).toBeFocused();
  await expect(page.locator('.workspace-tabs [role=tab]')).toHaveCount(4);
  await page.getByRole('tab', { name: '第一页', exact: true }).click();
  expect(await fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#native-input").value'), id)).toBe('keep native input');
  await nativeKey(id, { keyCode: 'F7' });
  await expect(page.getByRole('tab', { name: '第一页', exact: true })).toHaveCount(0);
  await expect(page.locator('.workspace-tabs [role=tab][aria-selected=true]')).toBeFocused();
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings.shortcuts).toMatchObject({ openBrowser: 'F6', closePanelTab: 'F7' });
  const ui = (await fixture.snapshot()).data.ui;
  await fixture.invoke({ op: 'ui.update', ui: { ...ui, locale: 'en-US' } });
  await expect(fixture.page.locator('html')).toHaveAttribute('lang', 'en-US');
  await fixture.page.locator('.composer-input').press('Control+Shift+p');
  await fixture.page.getByRole('dialog').getByRole('combobox').fill('Open browser tab');
  await expect(fixture.page.getByRole('option', { name: /Open browser tab.*F6/ })).toBeVisible();
});

test('whole sidebar motion keeps native browser bounds aligned and preserves the live page', async () => {
  const id = await open('/a');
  const page = fixture.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#native-input").value="sidebar motion"'), id);
  await page.clock.install();
  for (const width of [1000, 1440]) {
    await fixture.app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width);
    for (const open of [false, true]) {
      await page.getByRole('button', { name: '切换侧栏', exact: true }).evaluate((element: HTMLButtonElement) => element.click());
      await page.clock.runFor(32);
      const intermediate = await page.locator('.workspace-sidebar').evaluate(element => {
        const animation = element.getAnimations().find(animation => animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(frame => 'width' in frame));
        if (!animation?.effect) throw new Error('Missing sidebar width transition in Electron');
        animation.pause();
        animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
        return element.getBoundingClientRect().width;
      });
      expect(intermediate).toBeGreaterThan(0);
      expect(intermediate).toBeLessThan(275);
      for (const finish of [false, true]) {
        if (finish) {
          await page.locator('.workspace-sidebar').evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
          await page.clock.runFor(300);
          await expect(page.locator('.workspace-sidebar')).toHaveAttribute('data-open', String(open));
          await expect(page.locator('.workspace-sidebar')).toHaveCSS('width', open ? '275px' : '0px');
        }
        const bounds = await page.locator('.preview-surface').evaluate(element => {
          const box = element.getBoundingClientRect();
          return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
        });
        await expect.poll(() => fixture.app.evaluate(({ BrowserWindow, webContents }, id) => {
          const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => 'webContents' in view && view.webContents === webContents.fromId(id));
          return view?.getVisible() ? view.getBounds() : undefined;
        }, id)).toEqual(bounds);
      }
    }
  }
  expect(await fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#native-input").value'), id)).toBe('sidebar motion');
});

test('panel commands stay in the owning task window and ignore native IME and covered pages', async () => {
  const id = await open('/a');
  await query().press('Escape');
  expect(await fixture.app.evaluate(({ webContents }, id) => {
    let prevented = false;
    webContents.fromId(id)!.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', key: 't', control: true, shift: false, alt: false, meta: false, isComposing: true, isAutoRepeat: false });
    return prevented;
  }, id)).toBe(false);
  await fixture.page.getByLabel('浏览器操作', { exact: true }).click();
  await expect(fixture.page.locator('.preview-snapshot')).toBeVisible();
  expect(await fixture.app.evaluate(({ webContents }, id) => {
    let prevented = false;
    webContents.fromId(id)!.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', key: 'w', control: true, shift: false, alt: false, meta: false, isComposing: false, isAutoRepeat: false });
    return prevented;
  }, id)).toBe(false);
  await fixture.page.keyboard.press('Escape');
  const opened = fixture.app.waitForEvent('window');
  await fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' });
  const task = await opened;
  await task.locator('.desktop').waitFor();
  await task.evaluate(async () => {
    const boot = await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap;
    await window.desktop.invoke({ op: 'ui.update', ui: { ...boot.data.ui, reviewOpen: true } });
  });
  await expect(task.getByLabel('预览地址')).toHaveValue(site + '/a');
  const main = await fixture.snapshot();
  await nativeKey(id, { keyCode: 'T', modifiers: ['control'] });
  await expect(task.getByLabel('预览地址')).toBeFocused();
  await expect(task.locator('.workspace-tabs [role=tab]')).toHaveCount(2);
  const next = await fixture.snapshot();
  expect(next.data.ui.activeThreadId).toBe(main.data.ui.activeThreadId);
  expect(next.data.threads).toHaveLength(main.data.threads.length);
  expect(next.data.ui.threads.t.browserTabs).toHaveLength(2);
  await (await fixture.app.browserWindow(task)).evaluate((window: BrowserWindow) => window.close());
});
