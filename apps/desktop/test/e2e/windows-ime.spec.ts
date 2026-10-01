import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

test('Windows Pinyin keyboard produces a committed Chinese composition in the real composer', async () => {
  const development = await startDevelopmentSource();
  const fixture = await acceptanceApp(development.url);
  try {
    const page = fixture.page;
    await fixture.app.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.setAlwaysOnTop(true);
      app.focus({ steal: true });
      window.focus();
    });
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())).toBe(true);
    const composer = page.getByLabel('向 Pi 发送消息');
    await composer.focus();
    await page.evaluate(() => {
      document.documentElement.dataset.nativeComposition = '';
      document.addEventListener('compositionend', (event) => { document.documentElement.dataset.nativeComposition = event.data; });
    });
    const handle = await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
    await promisify(execFile)('pwsh.exe', ['-NoProfile', '-File', resolve('test/e2e/fixtures/windows-ime.ps1'), '-WindowHandle', handle], { windowsHide: true, timeout: 15000 });
    await expect(composer).toHaveValue('你好');
    await expect(page.locator('html')).toHaveAttribute('data-native-composition', '你好');
    expect(fixture.calls).toHaveLength(0);
    await composer.press('Enter');
    await expect.poll(() => fixture.calls.length).toBe(1);
    await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
    expect((await fixture.snapshot()).data.threads[0].items.some((item) => item.role === 'user' && item.text === '你好')).toBe(true);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); await development.server.close(); }
});
