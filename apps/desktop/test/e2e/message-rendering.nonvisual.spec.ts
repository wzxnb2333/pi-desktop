import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser } from '@playwright/test';
import type { DesktopData, TimelineItem } from '../../src/shared/contracts.ts';
import type {} from './fixtures/message-rendering-harness.tsx';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';

let browser: Browser, url: string;
test.beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-message-rendering-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/message-rendering-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href; browser = await chromium.launch();
});
test.afterAll(async () => { try { await browser?.close(); } finally { await cleanupTemporaryDirectories(); } });

function history(count: number): TimelineItem[] {
  return Array.from({ length: count }, (_, i) => [
    { id: 'u' + i, role: 'user' as const, timestamp: i * 2, state: 'done' as const, thinking: '', text: '问题 ' + i },
    { id: 'a' + i, role: 'assistant' as const, timestamp: i * 2 + 1, state: 'done' as const, thinking: '', stopReason: 'stop' as const,
      text: '回答 **' + i + '** SEARCH_TOKEN_' + i + '\n\n' + '技术说明与 Unicode 内容。'.repeat(12) + '\n\n~~~typescript\nconst sample = ' + i + ';\n\tconsole.log(sample);\n~~~\n\n| Key | Value |\n| --- | --- |\n| sample | ' + i + ' |' },
  ]).flat();
}

test('measures unchanged updates across 180 turns', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, reducedMotion: 'reduce' });
  try {
    await page.goto(url); await expect(page.locator('[data-message-ready]')).toHaveCount(1);
    await page.evaluate(items => window.messageBenchmark.update(items), history(180));
    await expect(page.locator('.turn-answer')).toHaveCount(180);
    const result = await page.evaluate(async () => {
      const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const unchanged: number[] = [], elapsed: number[] = [];
      for (let i = 0; i < 8; i++) {
        window.messageBenchmark.commits = []; const start = performance.now(); window.messageBenchmark.update(); await frame();
        elapsed.push(performance.now() - start); unchanged.push(window.messageBenchmark.commits.reduce((a, b) => a + b, 0));
      }
      return { turns: 180, unchangedCommitMs: unchanged, elapsedMs: elapsed, nodes: document.querySelectorAll('*').length };
    });
    console.log('MESSAGE_RENDER_BENCHMARK ' + JSON.stringify(result));
    await writeFile(join(process.cwd(), '../../.artifacts/message-rendering-' + (process.env.PI_MESSAGE_BENCHMARK === 'baseline' ? 'baseline' : 'current') + '.json'), JSON.stringify(result, null, 2));
    expect(result.unchangedCommitMs.every(Number.isFinite)).toBe(true);
  } finally { await page.close(); }
});

test('1000 turns retain selections, reading position, code state and search during streamed updates', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, reducedMotion: 'reduce' });
  try {
    await page.goto(url); await expect(page.locator('[data-message-ready]')).toHaveCount(1);
    const items = history(1000);
    await page.evaluate(items => window.messageBenchmark.update(items), items);
    await expect(page.locator('.turn-answer')).toHaveCount(1000);
    expect(await page.evaluate(() => window.messageBenchmark.search('SEARCH_TOKEN_350'))).toBe(true);
    const selected = page.locator('[data-turn-key="u350"] .turn-answer .markdown p').first();
    await selected.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); });
    const quote = await page.evaluate(() => window.getSelection()?.toString());
    const y = await page.locator('.timeline').evaluate(node => node.scrollTop);
    const oldNode = await selected.elementHandle();
    for (let i = 0; i < 4; i++) { items.at(-1)!.text += '\n\nSTREAM_' + i; await page.evaluate(items => window.messageBenchmark.update(items), items); }
    await expect(page.locator('.turn-answer').last()).toContainText('STREAM_3');
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(quote);
    expect(Math.abs(await page.locator('.timeline').evaluate(node => node.scrollTop) - y)).toBeLessThanOrEqual(1);
    expect(await selected.evaluate((node, old) => node === old, oldNode)).toBe(true);
    await page.locator('[data-turn-key="u350"] .markdown-code-block').getByRole('button', { name: '代码自动换行', exact: true }).click();
    await page.evaluate(() => window.messageBenchmark.update());
    await expect(page.locator('[data-turn-key="u350"] .markdown-code-block')).toHaveAttribute('data-wrapped', 'true');
    expect(await page.evaluate(() => window.messageBenchmark.search('SEARCH_TOKEN_999'))).toBe(true);
    await expect(page.locator('[data-search-active]')).toContainText('SEARCH_TOKEN_999');
    const saved = await page.locator('.timeline').evaluate(node => node.scrollTop);
    await page.evaluate(async () => { const snapshot = await window.desktop.invoke({ op: 'bootstrap' }) as { data: DesktopData }; await window.desktop.invoke({ op: 'ui.update', ui: { ...snapshot.data.ui, locale: 'en-US' }, frame: { locale: 'en-US' } }); });
    await expect(page.locator('[data-turn-key="u999"] .message-actions').last().getByRole('button', { name: 'Copy message', exact: true })).toHaveCount(1);
    expect(Math.abs(await page.locator('.timeline').evaluate(node => node.scrollTop) - saved)).toBeLessThanOrEqual(1);
  } finally { await page.close(); }
});

for (const theme of ['light', 'dark']) for (const locale of ['zh-CN', 'en-US']) for (const width of [1000, 1280, 1440]) test('code and wide tables stay local: ' + theme + ' ' + locale + ' ' + width, async () => {
  const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 940 : width === 1280 ? 800 : 700 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    await page.goto(url + '?theme=' + theme + '&locale=' + locale); await expect(page.locator('[data-message-ready]')).toHaveCount(1);
    const code = '\tconst title = "中文 & <tag>";\n\n' + Array.from({ length: 44 }, (_, i) => '// line ' + i + ' ' + 'wide_text_'.repeat(20)).join('\n');
    const text = '~~~typescript\n' + code + '\n~~~\n\n| ' + Array.from({ length: 14 }, (_, i) => 'Column ' + i).join(' | ') + ' |\n| ' + Array(14).fill('---').join(' | ') + ' |\n| ' + Array(14).fill('wide long table text').join(' | ') + ' |';
    await page.evaluate(text => window.messageBenchmark.update([{ id: 'u', role: 'user', thinking: '', timestamp: 1, state: 'done', text: '检查' }, { id: 'a', role: 'assistant', thinking: '', timestamp: 2, state: 'done', stopReason: 'stop', text }]), text);
    const block = page.locator('.markdown-code-block'), pre = block.locator('pre');
    await expect(block).toHaveAttribute('data-expanded', 'false');
    expect(await pre.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await block.getByRole('button', { name: locale === 'zh-CN' ? '复制代码' : 'Copy code', exact: true }).click();
    // Windows clipboard text uses CRLF; all other code content must remain exact.
    expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')).toBe(code);
    expect(await page.evaluate(() => window.messageBenchmark.search('line 43'))).toBe(true);
    expect(await pre.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await block.getByRole('button', { name: locale === 'zh-CN' ? '展开全部代码' : 'Expand all code', exact: true }).click();
    await expect(block).toHaveAttribute('data-expanded', 'true');
    expect(await pre.evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
    const table = page.locator('.markdown-table-scroller');
    expect(await table.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    expect(await page.locator('.timeline').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  } finally { await page.close(); }
});
