import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Browser, type Page, chromium, expect, test } from '@playwright/test';

/*
 * The Menu keyboard contract, driven in a real browser against the real component.
 *
 * These specs launch plain Chromium rather than Electron on purpose: the primitives have no call site
 * in the app yet (the composer still renders native `<select>`s until WP3 swaps them), so mounting them
 * needs the small harness below rather than the whole workbench. esbuild is already the repo's bundler,
 * so this adds no dependency.
 */
const entry = fileURLToPath(new URL('./fixtures/primitives-harness.tsx', import.meta.url));
const html = '<!doctype html><meta charset="utf-8"><body><div id="root"></div><script src="./harness.js"></script>';

let browser: Browser;
let pageUrl = '';
let activePage: Page;

test.beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-primitives-'));
  const bundle = join(dir, 'harness.js');
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  await writeFile(join(dir, 'index.html'), html);
  browser = await chromium.launch();
  pageUrl = pathToFileURL(join(dir, 'index.html')).href;
});

// A fresh context per test so React state cannot leak from one keyboard sequence into the next.
test.beforeEach(async () => {
  activePage = await browser.newPage();
  await activePage.goto(pageUrl);
});

test.afterEach(async () => {
  await activePage.close();
});

test.afterAll(async () => {
  await browser?.close();
});
test.afterAll(cleanupTemporaryDirectories);

const trigger = () => activePage.getByLabel('模型');
const list = () => activePage.getByRole('menu');
const item = (name: string) => activePage.getByRole('menuitemradio', { name });

test('opening a menu focuses the selected row and advertises the expanded state', async () => {
  await expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
  await expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  await trigger().click();
  await expect(list()).toBeVisible();
  await expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  await expect(item('选项 B')).toBeFocused();
  await expect(item('选项 B')).toHaveAttribute('aria-checked', 'true');
  await expect(item('选项 A')).toHaveAttribute('aria-checked', 'false');
});

test('arrow keys move focus, wrap at both ends, and skip disabled rows', async () => {
  await trigger().click();
  await expect(item('选项 B')).toBeFocused();
  await activePage.keyboard.press('ArrowDown');
  await expect(item('选项 C')).toBeFocused();
  // 选项 D is disabled, so it is stepped over rather than landed on.
  await activePage.keyboard.press('ArrowDown');
  await expect(item('选项 E')).toBeFocused();
  await activePage.keyboard.press('ArrowDown');
  await expect(item('选项 A')).toBeFocused();
  await activePage.keyboard.press('ArrowUp');
  await expect(item('选项 E')).toBeFocused();
  await activePage.keyboard.press('ArrowUp');
  await expect(item('选项 C')).toBeFocused();
  await activePage.keyboard.press('End');
  await expect(item('选项 E')).toBeFocused();
  await activePage.keyboard.press('Home');
  await expect(item('选项 A')).toBeFocused();
  await expect(list()).toBeVisible();
});

test('Enter selects the focused row and returns focus to the trigger', async () => {
  await trigger().click();
  await activePage.keyboard.press('ArrowDown');
  await activePage.keyboard.press('Enter');
  await expect(list()).toHaveCount(0);
  await expect(trigger()).toBeFocused();
  await expect(trigger()).toHaveText('选项 C');
  await expect(activePage.getByTestId('selections')).toHaveText('1');
});

test('Space selects the focused row', async () => {
  await trigger().click();
  await activePage.keyboard.press('ArrowDown');
  await activePage.keyboard.press('ArrowDown');
  await expect(item('选项 E')).toBeFocused();
  await activePage.keyboard.press('Space');
  await expect(list()).toHaveCount(0);
  await expect(trigger()).toHaveText('选项 E');
  await expect(activePage.getByTestId('selections')).toHaveText('1');
});

test('Escape closes the menu and restores focus to the trigger', async () => {
  await trigger().click();
  await expect(item('选项 B')).toBeFocused();
  await activePage.keyboard.press('Escape');
  await expect(list()).toHaveCount(0);
  await expect(trigger()).toBeFocused();
  await expect(trigger()).toHaveText('选项 B');
  await expect(activePage.getByTestId('selections')).toHaveText('0');
});

test('a pointerdown outside the menu closes it without selecting', async () => {
  await trigger().click();
  await expect(item('选项 B')).toBeFocused();
  await activePage.getByTestId('outside').click();
  await expect(list()).toHaveCount(0);
  await expect(trigger()).toHaveText('选项 B');
  await expect(activePage.getByTestId('selections')).toHaveText('0');
});
