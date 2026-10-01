import { expect, test } from '@playwright/test';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import type { MessageBoxOptions } from 'electron';

type NativeDialogRecord = Pick<MessageBoxOptions, 'message' | 'detail' | 'buttons' | 'defaultId' | 'cancelId'>;

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { const errors = [...fixture.errors]; await fixture.close(); expect(errors).toEqual([]); });

test('language switches immediately, preserves drafts and persists through a real application restart', async () => {
  await fixture.page.getByLabel('向 Pi 发送消息').fill('不要翻译这个草稿 / keep this draft');
  const ui = (await fixture.snapshot()).data.ui;
  await fixture.invoke({ op: 'ui.update', ui: { ...ui, view: 'settings' } });
  await fixture.page.locator('[data-category="general"]').click();
  await fixture.page.locator('#settings-locale').selectOption('en-US');
  await expect(fixture.page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(fixture.page.locator('[data-category="general"]')).toHaveText('General');
  await expect(fixture.page.getByRole('button', { name: 'Save settings', exact: true })).toBeVisible();
  await expect.poll(async () => (await fixture.snapshot()).data.ui.locale).toBe('en-US');
  await fixture.page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  await expect(fixture.page.locator('.composer-input')).toHaveValue('不要翻译这个草稿 / keep this draft');
  await fixture.restart();
  await expect(fixture.page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(fixture.page.locator('.composer-input')).toHaveValue('不要翻译这个草稿 / keep this draft');
  expect(fixture.calls).toHaveLength(0);
});

test('switching language during streaming keeps the same run and original conversation text', async () => {
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '原始中文消息', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await expect(fixture.page.locator('.timeline')).toContainText('验收流式内容。');
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' } });
  await expect(fixture.page.locator('html')).toHaveAttribute('lang', 'en-US');
  expect((await fixture.snapshot()).data.threads[0].status).toBe('running');
  expect(fixture.calls).toHaveLength(1);
  await expect(fixture.page.locator('.timeline')).toContainText('原始中文消息');
  await expect(fixture.page.locator('.timeline')).toContainText('验收流式内容。');
  fixture.release();
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  await expect(fixture.page.locator('.timeline')).toContainText('验收回复完成。');
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'zh-CN' } });
  await expect(fixture.page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  expect(fixture.calls).toHaveLength(1);
});

test('language switches preserve a non-following reading anchor and localize native dialogs', async () => {
  fixture.setReply('原文保持不变。\n\n'.repeat(40));
  for (let round = 0; round < 4; round++) {
    await fixture.invoke({ op: 'thread.send', id: 't', text: '阅读测试 ' + round, attachments: [] });
    await expect.poll(() => fixture.calls.length).toBe(round + 1);
    await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  }
  const timeline = fixture.page.locator('.timeline');
  await expect(timeline.locator('[data-turn-key]')).toHaveCount(4);
  const before = await timeline.evaluate(node => {
    const target = node.querySelectorAll<HTMLElement>('[data-turn-key]')[1];
    node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top + 20;
    node.dispatchEvent(new Event('scroll'));
    return { key: target.dataset.turnKey!, offset: target.getBoundingClientRect().top - node.getBoundingClientRect().top };
  });
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.scroll?.follow).toBe(false);
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' } });
  await expect(fixture.page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect.poll(() => timeline.evaluate((node, before) => {
    const target = [...node.querySelectorAll<HTMLElement>('[data-turn-key]')].find(item => item.dataset.turnKey === before.key)!;
    return Math.abs(target.getBoundingClientRect().top - node.getBoundingClientRect().top - before.offset);
  }, before)).toBeLessThanOrEqual(1);
  await fixture.app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async (...args: unknown[]) => {
      const options = args.at(-1) as { title?: string };
      if (options.title !== 'Add text or images') throw new Error('Native dialog did not follow persisted locale');
      return { canceled: true, filePaths: [] };
    };
  });
  expect(await fixture.invoke({ op: 'attachment.pick', threadId: 't' })).toEqual([]);
  expect(fixture.calls).toHaveLength(4);
});

test('native browser dialogs follow live locale without recreating tabs or clearing cancelled site data', async () => {
  const url = fixture.url + '/';
  await fixture.invoke({ op: 'browser.open', threadId: 't', tabId: 'locale-tab', url });
  const contentId = await fixture.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)!.id, url);
  await fixture.app.evaluate(async ({ webContents }, id) => {
    await webContents.fromId(id)!.executeJavaScript('localStorage.setItem("locale-test", "原始站点数据")');
  }, contentId);
  for (const locale of ['zh-CN', 'en-US', 'zh-CN'] as const) {
    await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale } });
    await fixture.app.evaluate(({ dialog }) => {
      const captured: NativeDialogRecord[] = [];
      Reflect.set(globalThis, '__piNativeDialogs', captured);
      dialog.showMessageBox = async (...args: unknown[]) => {
        const { message, detail, buttons, defaultId, cancelId } = args.at(-1) as MessageBoxOptions;
        captured.push({ message, detail, buttons, defaultId, cancelId });
        return { response: 0, checkboxChecked: false };
      };
    });
    for (const action of ['permissions', 'clearSite', 'clearAll'] as const)
      await fixture.invoke({ op: 'browser.action', threadId: 't', tabId: 'locale-tab', action });
    const captured = await fixture.app.evaluate(() => Reflect.get(globalThis, '__piNativeDialogs') as NativeDialogRecord[]);
    expect(captured).toHaveLength(3);
    expect(captured[0]).toMatchObject(locale === 'en-US' ? {
      message: fixture.url + ' · Site permissions',
      detail: 'No permissions granted. You will be asked when the site requests access.',
      buttons: ['Close', 'Revoke site permissions'], cancelId: 0,
    } : {
      message: fixture.url + ' · 站点权限', detail: '尚未授予权限；网站请求时会询问。',
      buttons: ['关闭', '撤销此站点权限'], cancelId: 0,
    });
    expect(captured.slice(1).map(item => item.message)).toEqual(locale === 'en-US'
      ? ['Clear data for this site?', 'Clear all browser site data?']
      : ['清除此站点数据？', '清除浏览器所有站点数据？']);
    for (const item of captured.slice(1)) expect(item).toMatchObject({
      detail: locale === 'en-US' ? 'You will be signed out of the affected sites.' : '相关网站的登录状态会退出。',
      buttons: locale === 'en-US' ? ['Cancel', 'Clear'] : ['取消', '清除'], defaultId: 0, cancelId: 0,
    });
    expect(await fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('localStorage.getItem("locale-test")'), contentId)).toBe('原始站点数据');
    const title = await fixture.app.evaluate(({ session, webContents }, input) => new Promise<string | undefined>(resolve => {
      session.fromPartition('persist:pi-browser').once('will-download', (_event, item) => {
        const options = item.getSaveDialogOptions();
        item.cancel();
        resolve(options.title);
      });
      webContents.fromId(input.id)!.downloadURL(input.url);
    }), { id: contentId, url });
    expect(title).toBe(locale === 'en-US' ? 'Save download' : '保存下载文件');
  }
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' } });
  expect(await fixture.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('Notification.requestPermission()', true), contentId)).toBe('denied');
  const permission = await fixture.app.evaluate(() => (Reflect.get(globalThis, '__piNativeDialogs') as NativeDialogRecord[]).at(-1));
  expect(permission).toMatchObject({ message: fixture.url + ' requests permission: notifications', buttons: ['Deny', 'Allow for this session'], defaultId: 0, cancelId: 0 });
  expect(fixture.calls).toHaveLength(0);
});
