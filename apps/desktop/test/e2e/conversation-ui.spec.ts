import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser, type Page, type Locator } from '@playwright/test';
import type { Bootstrap } from '../../src/shared/contracts.ts';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import type {} from './fixtures/conversation-ui-harness.tsx';

let browser: Browser, page: Page, url: string, errors: string[];
test.setTimeout(30000);
test.beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-conversation-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/conversation-ui-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
});
test.afterAll(async () => { try { await browser?.close(); } finally { await cleanupTemporaryDirectories(); } });
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1440, height: 940 } }); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.locator('.composer-input')).toBeVisible(); });
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });
const snapshot = () => page.evaluate(async () => (await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap).data);
const answer = () => page.locator('[data-message-id="answer"] [data-quote-body]');
async function select(element: Locator, text: string) {
  await element.scrollIntoViewIfNeeded();
  await element.evaluate((node, text) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const all = nodes.map(node => node.data).join(''), start = all.indexOf(text), end = start + text.length;
    if (start < 0) throw new Error('Selection fixture text missing');
    const range = document.createRange(); let cursor = 0;
    for (const part of nodes) {
      if (start >= cursor && start < cursor + part.length) range.setStart(part, start - cursor);
      if (end > cursor && end <= cursor + part.length) { range.setEnd(part, end - cursor); break; } cursor += part.length;
    }
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }, text);
  await expect(page.getByRole('button', { name: '引用所选文本', exact: true })).toBeVisible();
}
async function quote(destination = '追加到主任务草稿') {
  await page.getByRole('button', { name: '引用所选文本', exact: true }).click();
  await page.getByRole('menuitem', { name: destination, exact: true }).click();
}

for (const [width, height] of [[1440, 940], [1280, 800], [1000, 700]]) for (const theme of ['light', 'dark'] as const) {
  test('conversation chrome aligns unread dots, context ring and edge scrollbar ' + theme + ' ' + width, async () => {
    await page.setViewportSize({ width, height });
    for (const locale of ['zh-CN', 'en-US'] as const) {
      await page.evaluate(async ({ locale, theme }) => { const data = (await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap).data; await window.desktop.invoke({ op: 'ui.update', ui: { ...data.ui, locale } }); await window.desktop.invoke({ op: 'settings.patch', patch: { theme } }); }, { locale, theme });
      const markers = page.locator('.sidebar .unread-marker'); expect(await markers.count()).toBeGreaterThanOrEqual(3);
      for (const marker of await markers.all()) {
        await expect(marker).toHaveCSS('background-color', 'rgb(52, 133, 228)');
        expect(await marker.evaluate(node => Math.abs(node.parentElement!.getBoundingClientRect().right - node.getBoundingClientRect().right - 8))).toBeLessThan(1);
      }
      const ring = page.locator('.context-usage-ring'), model = page.locator('.composer-model-capabilities');
      await expect(ring).toHaveAttribute('aria-label', /12.5%/);
      const control = (await ring.boundingBox())!, picker = (await model.boundingBox())!;
      expect(picker.x - control.x - control.width).toBeGreaterThanOrEqual(0); expect(picker.x - control.x - control.width).toBeLessThan(16);
      await ring.hover(); await expect(page.getByRole('tooltip')).toContainText('16,384 / 131,072');
      await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0);
      await ring.focus(); await expect(page.getByRole('tooltip')).toBeVisible(); await page.locator('.composer-input').focus();
      expect(await page.locator('.timeline').evaluate(node => Math.abs(node.getBoundingClientRect().right - document.querySelector('.main')!.getBoundingClientRect().right))).toBeLessThanOrEqual(1);
      expect(await page.locator('.composer-actions').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await expect(page.locator('.composer-footer, .message-quote-action')).toHaveCount(0);
    }
    if (process.env.PI_DESKTOP_CAPTURE === '1' && width === 1440) { const directory = fileURLToPath(new URL('../../../../.artifacts/conversation-ui/', import.meta.url)); await mkdir(directory, { recursive: true }); await page.screenshot({ path: join(directory, theme + '.png') }); }
  });
}

test('the context ring appears only for known usage and clamps only its drawing', async () => {
  const ring = page.locator('.context-usage-ring');
  // A conversation the provider has not measured yet shows no ring at all: an empty circle would only
  // ever say "unknown".
  await page.evaluate(() => window.conversationUi.patch('t', { usage: undefined }));
  await expect(ring).toHaveCount(0);
  for (const percent of [0, 135]) {
    await page.evaluate(contextPercent => window.conversationUi.patch('t', { usage: { input: 0, output: 0, total: 0, contextPercent, contextTokens: null, contextWindow: 1000 } }), percent);
    await expect(ring).toHaveCount(1);
    await expect(ring).toHaveAttribute('aria-label', '上下文 ' + percent.toFixed(1) + '%');
    await expect(ring.locator('.context-usage-value')).toHaveAttribute('stroke-dasharray', Math.min(100, percent) + ' 100');
  }
});

test('rendered selection quotes repeated text, bold spans, code, tables and escaped entities at exact source offsets', async () => {
  await expect(page.getByRole('button', { name: '引用所选文本' })).toHaveCount(0);
  const source = await page.evaluate(() => window.conversationUi.source);
  for (const [selector, rendered, raw] of [
    ['p:nth-child(2)', '重复片段', '重复片段'],
    ['p:nth-child(2)', '与 加粗内容', '与 **加粗内容'],
    ['pre', 'console.log(repeated);', 'console.log(repeated);'],
    ['td:last-child', '表格内容', '表格内容'],
    ['p:last-child', '& 与 *星号*', '&amp; 与 \\*星号\\*'],
  ]) {
    const target = answer().locator(selector); await select(target, rendered); await quote();
    await expect(page.locator('.composer-reference-open')).toBeVisible();
    const reference = (await snapshot()).ui.threads.t.contextReferences![0];
    const start = selector === 'p:nth-child(2)' && rendered === '重复片段' ? source.indexOf(raw, source.indexOf('第二段')) : source.indexOf(raw);
    expect(reference.quote).toEqual({ start, end: start + raw.length, text: raw });
    await page.locator('.composer-context .attachment-remove').click();
  }
  expect(await page.evaluate(() => window.conversationUi.calls.some(call => call.op === 'thread.send'))).toBe(false);
});

test('code selection ignores language fences and handles CRLF and unfinished EOF fences', async () => {
  for (const source of ['```js\njs\n```', '```js\r\nconst one = 1;\r\nconst two = 2;\r\n```', '```js\nlastLine']) {
    await page.evaluate(source => { window.conversationUi.patch('t', { items: [{ id: 'answer', role: 'assistant', state: 'done', thinking: '', timestamp: 4, text: source }] }); }, source);
    const value = source.split(/\r?\n/)[1];
    await select(answer().locator('pre'), value); await quote();
    const start = source.indexOf('\n') + 1;
    await expect.poll(async () => (await snapshot()).ui.threads.t.contextReferences?.[0]?.quote).toEqual({ start, end: start + value.length, text: value });
    await page.locator('.composer-context .attachment-remove').click();
  }
});

test('selection quote opens an anchored sidechat draft and preserves the main draft', async () => {
  await page.locator('.composer-input').fill('主对话草稿');
  await select(answer().locator('p').first(), '第一段 重复片段。'); await quote('从此处侧聊');
  await expect(page.getByLabel('侧聊消息', { exact: true })).toHaveValue('> 第一段 重复片段。\n\n');
  await expect(page.locator('.composer-input')).toHaveValue('主对话草稿');
  const sidechat = (await snapshot()).threads.find(thread => thread.sidechat)!;
  expect(sidechat.sidechat!.anchorItemId).toBe('answer'); expect(sidechat.policy).toBe('deny');
  expect(await page.evaluate(() => window.conversationUi.calls.some(call => call.op === 'thread.send'))).toBe(false);
});

test('selection quote dismisses on scroll, Escape and task switch; pending quote never steals another draft', async () => {
  await select(answer().locator('p').first(), '第一段'); await page.keyboard.press('Escape'); await expect(page.locator('.selection-quote')).toHaveCount(0);
  await select(answer().locator('p').first(), '第一段'); await page.locator('.timeline').evaluate(node => { node.scrollTop -= 30; }); await expect(page.locator('.selection-quote')).toHaveCount(0);
  await select(answer().locator('p').first(), '第一段'); await page.evaluate(() => window.conversationUi.hold(true)); await quote();
  await page.locator('.thread-main[title="短任务"]').click(); await page.locator('.composer-input').fill('别的任务草稿');
  await page.evaluate(() => window.conversationUi.release());
  await expect.poll(async () => (await snapshot()).ui.threads.t.contextReferences?.length).toBe(1);
  await expect(page.locator('.composer-input')).toHaveValue('别的任务草稿'); await expect(page.locator('.composer-input')).toBeFocused();
  expect((await snapshot()).ui.threads.short.contextReferences ?? []).toHaveLength(0);
  await expect(page.locator('.selection-quote')).toHaveCount(0);
});

test('the context tooltip shows cache hit rate and output speed only when the provider reported them', async () => {
  const ring = page.locator('.context-usage-ring');
  await page.evaluate(() => window.conversationUi.patch('t', { usage: { input: 12000, output: 4384, total: 16384, contextTokens: 16384, contextWindow: 131072, contextPercent: 12.5, cacheRead: 10800, cacheWrite: 300, cacheHitRate: 47.4, outputPerSecond: 62.5 } }));
  await ring.hover();
  await expect(page.getByRole('tooltip')).toContainText('缓存命中 47.4%');
  await expect(page.getByRole('tooltip')).toContainText('缓存读 10,800 · 缓存写 300 tokens');
  await expect(page.getByRole('tooltip')).toContainText('输出速度 62.5 tokens/s');
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { const data = (await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap).data; await window.desktop.invoke({ op: 'ui.update', ui: { ...data.ui, locale: 'en-US' } }); });
  await ring.hover();
  await expect(page.getByRole('tooltip')).toContainText('Cache hit 47.4%');
  await expect(page.getByRole('tooltip')).toContainText('Output speed 62.5 tokens/s');
  await page.keyboard.press('Escape');
  // A provider that reports no cache numbers leaves those rows out entirely.
  await page.evaluate(() => window.conversationUi.patch('t', { usage: { input: 12000, output: 4384, total: 16384, contextTokens: 16384, contextWindow: 131072, contextPercent: 12.5 } }));
  // The pointer has to leave the ring first, otherwise hovering again never re-opens the tooltip.
  await page.mouse.move(0, 0); await page.waitForTimeout(50);
  await ring.hover();
  await expect(page.getByRole('tooltip')).not.toContainText('Cache hit');
  await expect(page.getByRole('tooltip')).not.toContainText('Output speed');
});