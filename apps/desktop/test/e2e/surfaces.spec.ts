import { expectAdaptedAppearance } from './fixtures/adapted-appearance.ts';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';

const selectors: Record<string, string> = {
  tableContainer: '.markdown-table-container', tableScroller: '.markdown-table-scroller', tableWrapper: '.markdown-table-wrapper', table: '.markdown table', tableHeading: '.markdown th:first-child', tableCell: '.markdown tbody tr:first-child td:first-child', tableLastCell: '.markdown tbody tr:last-child td:first-child',
  codeBlock: '.markdown-code-block', codeToolbar: '.markdown-code-toolbar', codeContent: '.markdown-code-content', codeText: '.markdown-code-content code',
  menu: '.menu-list', item0: '.menu-item:nth-child(1)', item1: '.menu-item:nth-child(2)', item2: '.menu-item:nth-child(3)', content0: '.menu-item:first-child .menu-item-content', indicator0: '.menu-item:first-child .menu-item-indicator',
  tooltip: '.tooltip', tooltipContent: '.tooltip-content',
  overlay: '.dialog-backdrop', dialog: '.dialog', dialogBody: '.dialog-body', dialogHeading: '.dialog-heading', dialogTitle: '.dialog-title', dialogDescription: '.dialog-description', dialogActions: '.dialog-actions',
  bubble: '.user-message-bubble', markdown: '.user-message-bubble .markdown', paragraph: '.user-message-bubble .markdown > p',
  dialogCancel: '.dialog-actions button:first-child', dialogConfirm: '.dialog-actions button:last-child',
  dialogClose: '.dialog-close', dialogCloseIcon: '.dialog-close svg',
  prose: '.message.assistant .markdown', heading1: '.markdown h1', heading2: '.markdown h2', heading3: '.markdown h3', heading4: '.markdown h4', heading5: '.markdown h5', heading6: '.markdown h6',
  proseP1: '.markdown > p:nth-of-type(1)', proseP2: '.markdown > p:nth-of-type(2)', strong: '.markdown strong', list: '.markdown > ul', listItem: '.markdown > ul > li:first-child', nestedList: '.markdown ul ul', orderedList: '.markdown > ol', quote: '.markdown blockquote', quoteP: '.markdown blockquote > p', rule: '.markdown hr',
};
let browser: Browser;
let directory = '';
let url = '';
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-surfaces-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/surfaces-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><style>.surface-anchor{position:fixed;left:48px;top:180px;width:220px;height:32px}.surface-anchor :is(.menu,.tooltip-anchor){width:100%;height:100%}.surface-anchor button{width:100%;height:32px}</style><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});
test.afterAll(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function openScene(page: Page, scene: string, mode = 'light') {
  await page.goto(url + '?scene=' + scene + '&theme=' + (mode.startsWith('system') ? 'system' : mode));
  await expect(page.locator('[data-surface-ready]')).toHaveCount(1);
  if (scene === 'menu') await page.getByLabel('菜单', { exact: true }).click();
  if (scene === 'tooltip') await page.getByRole('button', { name: '提示', exact: true }).focus();
  if (scene === 'dialog') await page.getByRole('button', { name: '打开确认' }).click();
}

// Missing 26.915 captures are adaptations, never reported as reference pixel passes.
for (const mode of ['light', 'dark', 'system-light', 'system-dark']) for (const width of [1000, 1440]) for (const scene of ['table', 'code', 'menu', 'tooltip', 'dialog', 'bubble', 'prose']) test(mode + ' ' + width + ' ' + scene + ' adapted surface', async () => {
  const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 940 : 700 }, colorScheme: mode.endsWith('dark') ? 'dark' : 'light' });
  try {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openScene(page, scene === 'bubble' ? 'user' : scene, mode);
    const selector = { table: selectors.tableContainer, code: selectors.codeBlock, menu: selectors.menu, tooltip: selectors.tooltip, dialog: selectors.dialog, bubble: selectors.bubble, prose: selectors.prose }[scene]!;
    await expectAdaptedAppearance(page, mode, [selector]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

test('tooltip follows keyboard, delay, click, escape and window blur states', async () => {
  const page = await browser.newPage();
  try {
    await openScene(page, 'tooltip');
    const target = page.getByRole('button', { name: '提示', exact: true });
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    // install alone still advances with wall time while hover waits for actionability.
    const time = new Date('2026-09-25T00:00:00Z');
    await page.clock.install({ time });
    await page.clock.pauseAt(new Date(time.getTime() + 10000));
    await target.hover();
    await page.clock.runFor(199);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.clock.runFor(1);
    await expect(page.getByRole('tooltip')).toBeVisible();
    await target.click();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await target.blur();
    await target.focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(target).not.toHaveAttribute('aria-describedby');
  } finally { await page.close(); }
});
test('dialog traps keyboard focus, closes through each real action and restores its trigger', async () => {
  const page = await browser.newPage();
  try {
    await openScene(page, 'dialog');
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.dialog-close svg')).toHaveAttribute('data-icon-origin', 'pi-adaptation');
    await expect(dialog.getByRole('button', { name: '删除自动化', exact: true })).toBeFocused();
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '打开确认' })).toBeFocused();
    await expect(page.locator('output')).toHaveText('cancelled');
    await page.getByRole('button', { name: '打开确认' }).click();
    await page.getByLabel('关闭对话框').click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: '打开确认' }).click();
    await page.getByRole('button', { name: '删除自动化', exact: true }).click();
    await expect(page.locator('output')).toHaveText('confirmed');
  } finally { await page.close(); }
});

test('menu flips at the bottom edge and follows resized trigger geometry', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  try {
    await page.goto(url + '?scene=menu');
    await expect(page.locator('[data-surface-ready]')).toHaveCount(1);
    await page.locator('.surface-anchor').evaluate(element => { element.style.top = '600px'; element.style.left = '740px'; });
    await page.getByLabel('菜单', { exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toHaveAttribute('data-side', 'top');
    await page.locator('.surface-anchor').evaluate(element => { element.style.width = '340px'; });
    await expect(menu).toHaveCSS('width', '340px');
    await expect.poll(async () => {
      const box = (await menu.boundingBox())!;
      return Math.abs(box.y + box.height + 2 - 600);
    }).toBeLessThanOrEqual(.5);
    // Width and placement settle on successive ResizeObserver deliveries.
    await expect.poll(async () => {
      const box = (await menu.boundingBox())!;
      return box.x + box.width;
    }).toBeLessThanOrEqual(994);
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('菜单', { exact: true })).toBeFocused();
  } finally { await page.close(); }
});

test('tooltip flips near the titlebar and follows multiline content resizing', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  try {
    await page.goto(url + '?scene=tooltip');
    await expect(page.locator('[data-surface-ready]')).toHaveCount(1);
    await page.locator('.surface-anchor').evaluate(element => { element.style.top = '8px'; element.style.left = '760px'; });
    await page.getByRole('button', { name: '提示', exact: true }).focus();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toHaveAttribute('data-side', 'bottom');
    await tooltip.locator('.tooltip-label').evaluate(element => { element.textContent = '较长的中文说明用于验证换行与窗口边缘，浮层应随着内容尺寸自动重新定位。'.repeat(3); });
    await expect.poll(async () => {
      const box = (await tooltip.boundingBox())!;
      return box.x + box.width;
    }).toBeLessThanOrEqual(992);
    const box = (await tooltip.boundingBox())!;
    expect(box.y).toBe(42);
    expect(box.height).toBeGreaterThan(30);
    expect(box.y + box.height).toBeLessThanOrEqual(632);
  } finally { await page.close(); }
});

test('code copy keeps literal text, reports clipboard errors and allows retry', async () => {
  const page = await browser.newPage();
  try {
    await openScene(page, 'code');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async () => { throw new Error('Clipboard unavailable'); },
      } });
    });
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('复制失败，请选择代码后重试。');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (text: string) => { document.body.setAttribute('data-copied-text', text); },
      } });
    });
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-copied-text', 'npm run desktop:check\n设置已恢复');
    await expect(page.getByRole('button', { name: '已复制代码' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { await page.close(); }
});

test('long code scrolls within the block and keyboard wrapping preserves its content', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  try {
    await openScene(page, 'long-code');
    const code = page.locator('.markdown-code-content');
    const text = await code.textContent();
    expect(await code.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const toggle = page.getByRole('button', { name: '代码自动换行' });
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(code.locator('code')).toHaveCSS('white-space', 'pre-wrap');
    expect(await code.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    expect(await code.textContent()).toBe(text);
    await page.keyboard.press('Space');
    await expect(code.locator('code')).toHaveCSS('white-space', 'pre');
  } finally { await page.close(); }
});

test('wide tables preserve column alignment and scroll without widening the conversation', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  try {
    await openScene(page, 'table');
    // A split conversation is narrower than the window used by the source fixture.
    await page.locator('main > div').evaluate(element => { element.style.width = '480px'; });
    const compact = page.getByRole('region', { name: '表格，可横向滚动' });
    expect(await compact.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await openScene(page, 'wide-table');
    await expect(page.locator('th').first()).toHaveAttribute('data-col-size', 'xl');
    await expect(page.locator('td').first()).toHaveAttribute('data-col-size', 'xl');
    await expect(page.locator('th').nth(1)).toHaveCSS('text-align', 'center');
    await expect(page.locator('td').nth(2)).toHaveCSS('text-align', 'right');
    await expect(page.locator('td strong')).toHaveText('强调');
    await expect(page.locator('td code')).toHaveText('代码');
    const scroller = page.getByRole('region', { name: '表格，可横向滚动' });
    expect(await scroller.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await scroller.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  } finally { await page.close(); }
});
