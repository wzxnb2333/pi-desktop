import { expectAdaptedAppearance } from './fixtures/adapted-appearance.ts';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import type { Bootstrap, TimelineItem } from '../../src/shared/contracts.ts';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';

// Existing Pi interaction behavior, not a same-version visual reference.
const motion = { durationMs: 300, easing: [0.19, 1, 0.22, 1] };
const selectors: Record<string, string> = { row: '[data-disclosure="row"]', 'row-header': '.disclosure-header', 'row-toggle': '.disclosure-toggle', 'row-summary': '.disclosure-summary', 'row-label': '.disclosure-label', 'row-chevron': '.disclosure-chevron', 'row-body': '.disclosure-content', group: '[data-disclosure="group"]', 'group-body': '.disclosure-content', 'file-header': '.disclosure-header', 'file-label': '.disclosure-label', 'file-link': '.activity-file-link', diff: '.activity-diff', 'diff-heading': '.activity-diff-heading' };
let browser: Browser;
let directory = '';
let url = '';
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-activity-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/activity-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
async function open(page: Page, scene: string, mode = 'light') {
  await page.goto(url + '?scene=' + scene + '&theme=' + (mode.startsWith('system') ? 'system' : mode));
  await expect(page.locator('[data-activity-ready]')).toHaveCount(1);
}
async function update(page: Page, items: Partial<TimelineItem>[], status = 'running') {
  await page.evaluate(({ items, status }) => window.dispatchEvent(new CustomEvent('fixture:update', { detail: { items: items.map((item, index) => ({ text: '', timestamp: index, ...item })), status } })), { items, status });
}

test('running and completed defaults respect explicit nested choices and unknown thinking time', async () => {
  const page = await browser.newPage();
  try {
    await open(page, 'behavior');
    const items: Partial<TimelineItem>[] = [{ id: 'u', role: 'user', text: '检查' }, { id: 'a', role: 'assistant', state: 'running', blocks: [{ type: 'thinking', text: '供应商原文' }] }];
    await update(page, items);
    const process = page.locator('[data-disclosure="process:u"] > .disclosure-header > button');
    const thinking = page.locator('[data-disclosure="thinking:a:0"] > .disclosure-header > button');
    await expect(thinking).toHaveAttribute('aria-expanded', 'true');
    await thinking.click();
    items[1].blocks = [{ type: 'thinking', text: '供应商原文继续' }];
    await update(page, items);
    await expect(thinking).toHaveAttribute('aria-expanded', 'false');
    items[1].state = 'done'; items[1].stopReason = 'toolUse';
    items.push({ id: 'c', role: 'tool', toolName: 'mcp_demo', state: 'running', text: '实时输出' });
    await update(page, items);
    await page.locator('[data-disclosure="group:c"] > .disclosure-header > button').click();
    const tool = page.locator('[data-disclosure="tool:c"] > .disclosure-header > button');
    await expect(tool).toHaveAttribute('aria-expanded', 'true');
    await tool.click();
    items[2].text += '继续';
    await update(page, items);
    await expect(tool).toHaveAttribute('aria-expanded', 'false');
    // A deliberate process expansion overrides the completion default.
    await process.click(); await process.click();
    items[2].state = 'done';
    items.push({ id: 'answer', role: 'assistant', state: 'done', text: '完成', stopReason: 'stop' });
    await update(page, items, 'idle');
    await expect(process).toHaveAttribute('aria-expanded', 'true');
    await expect(thinking).toHaveAccessibleName('思考过程');
    await expect(tool).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: '切换任务二' }).click();
    await page.getByRole('button', { name: '切换任务一' }).click();
    await expect(process).toHaveAttribute('aria-expanded', 'true');
    await expect(thinking).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.turn-answer .markdown')).toHaveText('完成');
  } finally { await page.close(); }
});

test('harness calls read as ordinary tool activity with the pi icon and exact tool names', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await open(page, 'harness');
    const activity = page.locator('[data-tool-kind="harness"]');
    await expect(activity).toHaveCount(1);
    await expect(activity).toHaveAttribute('data-harness-tool', 'get_harness');
    await expect(activity.locator('.tool-activity-origin')).toHaveCount(0);
    await expect(activity.locator('.disclosure-summary svg.lucide-pi')).toHaveCount(1);
    await expect(activity.locator('.disclosure-label')).toContainText('已调用 get_harness');
  } finally { await page.close(); }
});

test('browser feedback names its source, reports progress and opens only the corresponding tab', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await open(page, 'behavior');
    const requests = await page.evaluateHandle(() => {
      const calls: unknown[] = [], original = window.desktop.invoke;
      window.desktop.invoke = async request => { calls.push(request); return original(request); }; return calls;
    });
    const item: Partial<TimelineItem> = { id: 'browser', role: 'tool', toolName: 'browser', args: JSON.stringify({ backend: 'chrome', action: 'wait', tabId: '00000000-0000-4000-8000-000000000001/3', condition: { kind: 'text', value: 'Ready' } }), state: 'running', toolResult: { result: { content: [{ type: 'text', text: '正在通过 Chrome 扩展执行' }], structuredContent: { browser: { backend: 'chrome', tabId: '00000000-0000-4000-8000-000000000001/3', stage: '正在通过 Chrome 扩展执行' } } } } };
    const progress = item.toolResult; item.toolResult = undefined;
    await update(page, [{ id: 'u', role: 'user', text: '浏览器检查' }, item]);
    await page.locator('[data-disclosure="group:browser"] > .disclosure-header > button').click();
    const control = page.locator('[data-tool-kind="browser"]');
    await expect(control.locator('.disclosure-label').first()).toContainText('Chrome · 等待页面');
    await expect(control.locator('.lucide-globe')).toHaveCount(1);
    await expect(control.getByRole('status')).toContainText('正在处理…');
    await expect(control.locator('.browser-tool-feedback .row > span')).toHaveText('Chrome');
    item.toolResult = progress; await update(page, [{ id: 'u', role: 'user', text: '浏览器检查' }, item]);
    await expect(control.getByRole('status')).toContainText('正在通过 Chrome 扩展执行');
    await expect(control.getByText('等待文本出现：Ready', { exact: true })).toBeVisible();
    await control.getByRole('button', { name: '打开浏览器查看' }).click();
    expect(await requests.jsonValue()).toContainEqual({ op: 'browser.bridge.focus', sessionId: '00000000-0000-4000-8000-000000000001', tabId: '00000000-0000-4000-8000-000000000001/3' });
    await page.evaluate(async () => {
      const { data } = await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap;
      await window.desktop.invoke({ op: 'ui.update', ui: { ...data.ui, locale: 'en-US' } });
    });
    await expect(control.getByRole('status').first()).toContainText('Using the Chrome extension');
    await expect(control.getByText('Wait for text: Ready', { exact: true })).toBeVisible();
    item.state = 'error'; item.text = '等待浏览器条件超时'; await update(page, [{ id: 'u', role: 'user', text: '浏览器检查' }, item]);
    await expect(control.getByRole('status').first()).toContainText('The browser wait condition timed out');
  } finally { await page.close(); }
});

for (const backend of ['in-app', 'chrome'] as const) test(`${backend} browser tab results show authorized tabs and closed results have no open action`, async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await open(page, 'behavior');
    const requests = await page.evaluateHandle(() => {
      const calls: unknown[] = [], original = window.desktop.invoke;
      window.desktop.invoke = async request => { calls.push(request); return original(request); }; return calls;
    });
    const tabId = backend === 'chrome' ? '00000000-0000-4000-8000-000000000001/5' : 'page-5';
    const user: Partial<TimelineItem> = { id: 'u', role: 'user', text: '查看标签' };
    const item: Partial<TimelineItem> = { id: 'tabs', role: 'tool', toolName: 'browser', state: 'done', args: JSON.stringify({ backend, action: 'tabs' }),
      toolResult: { result: { content: [{ type: 'text', text: JSON.stringify([{ tabId, backend, title: 'Authorized page', url: 'https://example.org/page' }]) }] } } };
    await update(page, [user, item]);
    await page.locator('[data-disclosure="group:tabs"] > .disclosure-header > button').click();
    await page.locator('[data-disclosure="tool:tabs"] > .disclosure-header > button').click();
    const result = page.getByLabel('浏览器标签列表', { exact: true });
    await expect(result.getByText('Authorized page', { exact: true })).toBeVisible();
    await expect(result.getByText('https://example.org/page', { exact: true })).toBeVisible();
    await result.getByRole('button', { name: '打开浏览器查看' }).click();
    expect(await requests.jsonValue()).toContainEqual(backend === 'chrome'
      ? { op: 'browser.bridge.focus', sessionId: '00000000-0000-4000-8000-000000000001', tabId }
      : { op: 'browser.select', threadId: 't', tabId });
    item.toolResult = { result: { content: [{ type: 'text', text: '[]' }] } };
    await update(page, [user, item]);
    await expect(result.getByText('当前任务没有可用的浏览器标签', { exact: true })).toBeVisible();
    item.args = JSON.stringify({ backend, action: 'close', tabId });
    item.toolResult = { result: { content: [{ type: 'text', text: JSON.stringify({ backend, tabId, status: 'closed' }) }] } };
    await update(page, [user, item]);
    await expect(page.locator('.browser-tool-feedback').getByRole('status')).toHaveText('标签已关闭');
    await expect(page.locator('.browser-tool-feedback').getByRole('button', { name: '打开浏览器查看' })).toHaveCount(0);
    await page.evaluate(async () => {
      const { data } = await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap;
      await window.desktop.invoke({ op: 'ui.update', ui: { ...data.ui, locale: 'en-US' } });
    });
    await expect(page.locator('.browser-tool-feedback').getByRole('status')).toHaveText('Tab closed');
  } finally { await page.close(); }
});

test('completed thinking keeps its measured duration and post-answer notices remain outside the folded process', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await open(page, 'behavior');
    await update(page, [
      { id: 'u', role: 'user', text: '检查' },
      { id: 'a', role: 'assistant', state: 'done', stopReason: 'stop', startedAt: 100, completedAt: 3000, text: '最终回答', blocks: [{ type: 'thinking', text: '供应商思考', startedAt: 200, completedAt: 1600 }, { type: 'text', text: '最终回答' }] },
      { id: 'notice', role: 'notice', text: '扩展通知' },
    ], 'idle');
    const process = page.locator('[data-disclosure="process:u"] > .disclosure-header > button');
    await expect(process).toHaveAccessibleName('耗时 2 秒');
    await expect(process).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.turn-answer .markdown')).toHaveText('最终回答');
    await expect(page.locator('.turn-notices')).toHaveText('扩展通知');
    await process.click();
    await expect(page.locator('[data-disclosure="thinking:a:0"] > .disclosure-header > button')).toHaveAccessibleName('已思考 1 秒');
  } finally { await page.close(); }
});

test('folding preserves a reader anchor and follows new output only while pinned', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await open(page, 'behavior');
    const items: Partial<TimelineItem>[] = [{ id: 'u', role: 'user', text: '首轮' }, { id: 'c', role: 'tool', toolName: 'bash', state: 'done', args: '{"command":"echo sample"}', text: '命令输出\n'.repeat(80) }, { id: 'u2', role: 'user', text: '第二轮' }, { id: 'a2', role: 'assistant', text: '很长的历史段落。\n\n'.repeat(90), state: 'done', stopReason: 'stop' }];
    await update(page, items, 'idle');
    const scroll = page.locator('.timeline');
    await scroll.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
    const group = page.locator('[data-disclosure="group:c"] > .disclosure-header > button');
    const before = (await group.boundingBox())!.y;
    await group.click();
    await expect(page.locator('[data-disclosure="group:c"]')).toHaveAttribute('data-phase', 'expanded');
    expect(Math.abs((await group.boundingBox())!.y - before)).toBeLessThanOrEqual(.5);
    const tool = page.locator('[data-disclosure="tool:c"] > .disclosure-header > button');
    const toolY = (await tool.boundingBox())!.y;
    await tool.click();
    await expect(page.locator('.tool-output')).toBeVisible();
    expect(Math.abs((await tool.boundingBox())!.y - toolY)).toBeLessThanOrEqual(.5);
    const scrollTop = await scroll.evaluate(node => node.scrollTop);
    items[3].text += '\n\n新增内容。'; await update(page, items, 'idle');
    expect(await scroll.evaluate(node => node.scrollTop)).toBe(scrollTop);
    await page.getByRole('button', { name: '回到最新消息' }).click();
    items[3].text += '\n\n又一段内容。'; await update(page, items, 'idle');
    await expect.poll(() => scroll.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(1);
  } finally { await page.close(); }
});

test('streamed thinking keeps the view pinned to the bottom until the reader moves it', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await open(page, 'behavior');
    const preview = page.locator('.thinking-preview');
    const distance = () => preview.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight);
    const items: Partial<TimelineItem>[] = [{ id: 'u', role: 'user', text: '开始' }, { id: 'a', role: 'assistant', state: 'running', stopReason: 'pending', blocks: [{ type: 'thinking', text: '思考第一段。\n\n'.repeat(40) }] }];
    await update(page, items);
    // Streaming keeps the newest line visible without the reader scrolling.
    await expect.poll(distance).toBeLessThanOrEqual(1);
    for (let index = 0; index < 3; index++) {
      (items[1].blocks as { type: string; text: string }[])[0].text += '继续思考 ' + index + '。\n\n';
      await update(page, items);
      await expect.poll(distance).toBeLessThanOrEqual(1);
    }
    // A reader position away from the bottom is kept, and further output no longer drags it.
    await preview.evaluate(node => { node.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true })); node.scrollTop = 0; });
    await expect.poll(distance).toBeGreaterThan(24);
    (items[1].blocks as { type: string; text: string }[])[0].text += '读者离开之后继续输出。\n\n';
    await update(page, items);
    expect(await preview.evaluate(node => node.scrollTop)).toBe(0);
    // Returning to the bottom re-attaches the stream.
    await preview.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect.poll(distance).toBeLessThanOrEqual(1);
    // Let the browser deliver that scroll event before the next delta arrives, as a real reader would.
    await page.waitForTimeout(50);
    (items[1].blocks as { type: string; text: string }[])[0].text += '重新跟随。\n\n';
    await update(page, items);
    await expect.poll(distance).toBeLessThanOrEqual(1);
  } finally { await page.close(); }
});

test('process narration carries no message actions until the turn has its answer', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await open(page, 'behavior');
    const items: Partial<TimelineItem>[] = [
      { id: 'u', role: 'user', text: '开始' },
      { id: 'a1', role: 'assistant', state: 'done', stopReason: 'toolUse', text: '中间说明' },
      { id: 'c1', role: 'tool', toolName: 'read', state: 'done', args: '{"path":"a.ts"}', text: '内容' },
      { id: 'a2', role: 'assistant', state: 'running', stopReason: 'pending', text: '继续中' },
    ];
    await update(page, items, 'running');
    await expect(page.locator('.turn-prose').first()).toContainText('中间说明');
    // Copy, sidechat and regenerate belong to a finished answer, not to work in progress.
    await expect(page.locator('.turn-prose .message-actions')).toHaveCount(0);
    items[3] = { id: 'a2', role: 'assistant', state: 'done', stopReason: 'stop', text: '最终回答' };
    await update(page, items, 'idle');
    await expect(page.locator('.turn-answer')).toContainText('最终回答');
    await expect(page.locator('.turn-answer .message-actions')).toHaveCount(1);
    await expect(page.locator('.turn-prose .message-actions')).toHaveCount(0);
  } finally { await page.close(); }
});

test('disclosure preserves its transition and removes collapsed interactive content', async () => {
  const page = await browser.newPage();
  try {
    await open(page, 'focus');
    const body = page.locator('.disclosure-motion').first();
    const duration = motion.durationMs / 1000 + 's';
    const easing = 'cubic-bezier(' + motion.easing.join(', ') + ')';
    await expect(body).toHaveCSS('transition-duration', duration + ', ' + duration);
    await expect(body).toHaveCSS('transition-timing-function', easing + ', ' + easing);
    await expect(page.locator('.disclosure-chevron').first()).toHaveAttribute('data-icon-origin', 'pi-adaptation');
    await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.getByRole('button', { name: '父项', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
    await expect(body).toHaveAttribute('inert', '');
    await expect(page.locator('[data-disclosure="focus"]')).toHaveAttribute('data-phase', 'closing');
    await page.clock.runFor(motion.durationMs);
    await expect(page.locator('[data-disclosure="focus"]')).toHaveAttribute('data-phase', 'collapsed');
    await expect(page.getByRole('button', { name: '内部按钮', includeHidden: true })).toHaveCount(0);
  } finally { await page.close(); }
});

// 26.917 exact-style samples are retired. These uncaptured components are Pi adaptations.
for (const mode of ['light', 'dark', 'system-light', 'system-dark']) for (const width of [1000, 1440]) for (const scene of ['row', 'group', 'file', 'diff']) test(mode + ' ' + width + ' ' + scene + ' adapted activity', async () => {
  const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 940 : 700 }, colorScheme: mode.endsWith('dark') ? 'dark' : 'light' });
  try {
    await open(page, scene, mode);
    await expectAdaptedAppearance(page, mode, [scene === 'diff' ? '.activity-diff' : '.disclosure']);
  } finally { await page.close(); }
});

test('disclosure keeps independent explicit choices after remount and excludes hidden focus targets', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await open(page, 'focus');
    const parent = page.getByRole('button', { name: '父项', exact: true });
    const child = page.getByRole('button', { name: '子项', exact: true });
    await child.click();
    await expect(child).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: '隐藏按钮', exact: true }).focus();
    await parent.evaluate(node => (node as HTMLButtonElement).click());
    await expect(parent).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '后续按钮' })).toBeFocused();
    await parent.click();
    await expect(page.getByRole('button', { name: '子项', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await page.reload();
    await expect(parent).toHaveAttribute('aria-expanded', 'true');
    await expect(child).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.disclosure-motion').first()).toHaveCSS('transition-duration', '0s');
  } finally { await page.close(); }
});

test('active summary changes are throttled but completion is immediate', async () => {
  const page = await browser.newPage();
  try {
    await page.clock.install();
    await open(page, 'summary');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture:update', { detail: { status: 'running' } })));
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture:update', { detail: { title: '动作 B' } })));
    await page.clock.runFor(1);
    await expect(page.locator('output')).toHaveText('动作 B');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture:update', { detail: { title: '动作 C' } })));
    await page.clock.runFor(500);
    await expect(page.locator('output')).toHaveText('动作 B');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture:update', { detail: { title: '已完成', status: 'idle' } })));
    await expect(page.locator('output')).toHaveText('已完成');
  } finally { await page.close(); }
});

test('notices keep a complete hairline and the model switch stays a flat, centred divider', async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 720 } });
  try {
    await open(page, 'behavior');
    await update(page, [
      { id: 'u', role: 'user', text: '检查' },
      { id: 'a', role: 'assistant', state: 'done', stopReason: 'stop', startedAt: 100, completedAt: 3000, text: '最终回答', blocks: [{ type: 'text', text: '最终回答' }] },
      { id: 'n1', role: 'notice', noticeKind: 'model-switch', text: '已将模型从 8ae0b310-c056-407c-bc4f-95cf0221f4b2 切换到 DeepSeek V4.1 Flash' },
      { id: 'n2', role: 'notice', text: '设置已恢复，可以继续检查当前工作区。' },
      { id: 'n3', role: 'notice', state: 'error', text: '过程遇到错误，请稍后重试。' },
    ] as Partial<TimelineItem>[], 'idle');
    // A sub-pixel ring shadow renders as a broken outline at 1x, so the pill owns a real border.
    const plain = page.locator('.turn-notices .notice:not(.model-switch):not(.danger)');
    await expect(plain).toHaveCSS('border-top-width', '1px');
    await expect(page.locator('.turn-notices .notice.danger')).toHaveCSS('border-top-width', '1px');
    expect(await page.locator('.turn-notices .notice.danger').evaluate(node => getComputedStyle(node).borderTopColor))
      .not.toBe(await plain.evaluate(node => getComputedStyle(node).borderTopColor));
    // The switch notice is a divider, not a card: no padding, radius, background or shadow, and both
    // rules sit on the label's optical middle rather than at the top of its line box.
    const geometry = await page.evaluate(() => {
      const centre = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return rect.y + rect.height / 2;
      };
      const style = getComputedStyle(document.querySelector('.notice.model-switch')!);
      return { rule: centre('.notice.model-switch .notice-rule'), text: centre('.notice.model-switch .notice-text'),
        padding: style.padding, radius: style.borderRadius, background: style.backgroundColor, shadow: style.boxShadow, align: style.alignItems };
    });
    expect(geometry.padding).toBe('0px');
    expect(geometry.radius).toBe('0px');
    expect(geometry.background).toBe('rgba(0, 0, 0, 0)');
    expect(geometry.shadow).toBe('none');
    expect(geometry.align).toBe('center');
    expect(Math.abs(geometry.rule - geometry.text)).toBeLessThanOrEqual(0.5);
  } finally { await page.close(); }
});

