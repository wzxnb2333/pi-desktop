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
 * Plain Chromium drives the real primitives and styles without launching the whole workbench.
 * esbuild is already the repo's bundler, so this adds no dependency.
 */
const entry = fileURLToPath(new URL('./fixtures/primitives-harness.tsx', import.meta.url));
const html = '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./harness.css"><body><div id="root"></div><script src="./harness.js"></script>';

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

test('nonlinear entrance preserves menu placement, dialog centering and keyboard focus', async () => {
  await activePage.emulateMedia({ reducedMotion: 'no-preference' });
  await trigger().evaluate(element => (element as HTMLButtonElement).click());
  const motion = await list().evaluate(element => {
    const animation = element.getAnimations()[0];
    if (!animation?.effect) throw new Error('Missing menu entrance');
    animation.pause();
    animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
    const progress = Number(getComputedStyle(element).opacity);
    const easing = getComputedStyle(element).animationTimingFunction;
    animation.finish();
    return { progress, easing };
  });
  expect(motion.easing).toContain('cubic-bezier');
  expect(motion.progress).toBeGreaterThan(.8);
  await expect(item('选项 B')).toBeFocused();
  const menuBox = await list().boundingBox();
  const triggerBox = await trigger().boundingBox();
  expect(menuBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();
  expect(Math.abs(menuBox!.x - triggerBox!.x)).toBeLessThan(2);
  expect(menuBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height);
  await activePage.keyboard.press('Escape');

  const opener = activePage.getByRole('button', { name: '打开确认弹窗', exact: true });
  await opener.click();
  const dialog = activePage.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '确认', exact: true })).toBeFocused();
  await dialog.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  const box = await dialog.boundingBox();
  const viewport = activePage.viewportSize()!;
  expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(1);
  expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThan(1);
  await activePage.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('press feedback and switch motion settle without changing control layout', async () => {
  await activePage.emulateMedia({ reducedMotion: 'no-preference' });
  const button = activePage.getByRole('button', { name: '打开确认弹窗', exact: true });
  const box = await button.boundingBox();
  await activePage.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await activePage.mouse.down();
  await expect.poll(() => button.evaluate(element => getComputedStyle(element).scale)).toBe('0.97');
  await activePage.mouse.move(0, 400);
  await activePage.mouse.up();
  await expect.poll(() => button.evaluate(element => getComputedStyle(element).scale)).toBe('none');
  expect(await button.boundingBox()).toEqual(box);
  const toggle = activePage.getByLabel('测试开关');
  await toggle.check();
  await expect.poll(() => toggle.evaluate(element => getComputedStyle(element, '::before').transform)).toBe('matrix(1, 0, 0, 1, 12, 0)');
  expect(await toggle.evaluate(element => getComputedStyle(element, '::before').transitionTimingFunction)).toContain('cubic-bezier');
  await activePage.getByRole('button', { name: '禁用操作', exact: true }).evaluate(element => {
    if (getComputedStyle(element).scale !== 'none') throw new Error('Disabled controls must not compress');
  });
});

test('reduced motion removes active entrances and keeps controls and focus immediate', async () => {
  await activePage.emulateMedia({ reducedMotion: 'no-preference' });
  await trigger().evaluate(element => (element as HTMLButtonElement).click());
  await activePage.emulateMedia({ reducedMotion: 'reduce' });
  await expect(list()).toHaveCSS('animation-name', 'none');
  await expect(item('选项 B')).toBeFocused();
  await activePage.keyboard.press('Escape');
  await expect(trigger()).toBeFocused();
  const button = activePage.getByRole('button', { name: '打开确认弹窗', exact: true });
  const box = await button.boundingBox();
  await activePage.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await activePage.mouse.down();
  await expect(button).toHaveCSS('scale', 'none');
  await expect(button).toHaveCSS('transition-duration', '0s');
  await activePage.mouse.up();
  const dialog = activePage.getByRole('dialog');
  await expect(dialog).toHaveCSS('animation-name', 'none');
  await expect(dialog.getByRole('button', { name: '确认', exact: true })).toBeFocused();
  await activePage.keyboard.press('Escape');
  const toggle = activePage.getByLabel('测试开关');
  await toggle.focus();
  await activePage.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  expect(await toggle.evaluate(element => ({ duration: getComputedStyle(element, '::before').transitionDuration,
    transform: getComputedStyle(element, '::before').transform }))).toEqual({ duration: '0s', transform: 'matrix(1, 0, 0, 1, 12, 0)' });
});

test('content switching keeps drafts, focus and geometry; repeated switches cancel old motion', async () => {
  await activePage.emulateMedia({ reducedMotion: 'no-preference' });
  const content = activePage.getByTestId('motion-content');
  const draft = activePage.getByLabel('保留草稿');
  await draft.fill('尚未保存的内容');
  await draft.focus();
  const before = await content.boundingBox();
  await activePage.getByRole('button', { name: '切换内容', exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  const motion = await content.evaluate(element => {
    const animation = element.getAnimations()[0];
    if (!animation?.effect) throw new Error('Missing content transition');
    animation.pause();
    animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
    return { easing: animation.effect.getTiming().easing, opacity: Number(getComputedStyle(element).opacity) };
  });
  expect(motion.easing).toContain('cubic-bezier');
  expect(motion.opacity).toBeGreaterThan(.8);
  expect(await content.boundingBox()).toEqual(before);
  await expect(draft).toHaveValue('尚未保存的内容');
  await expect(draft).toBeFocused();
  // A text delta does not replay or cancel the in-flight category animation.
  await activePage.getByRole('button', { name: '流式更新', exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  expect(await content.evaluate(element => element.getAnimations().map(animation => animation.playState))).toEqual(['paused']);
  await activePage.getByRole('button', { name: '切换内容', exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  expect(await content.evaluate(element => element.getAnimations().length)).toBe(1);
  await activePage.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => content.evaluate(element => element.getAnimations().length)).toBe(0);
  await activePage.getByRole('button', { name: '切换内容', exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  expect(await content.evaluate(element => element.getAnimations().length)).toBe(0);
  await expect(draft).toBeFocused();
});

test('popover exits release roles immediately and rapid reopening survives stale cleanup', async () => {
  await activePage.emulateMedia({ reducedMotion: 'no-preference' });
  // Run close and reopen in one browser turn, so a delayed test driver cannot hide a stale timer.
  await trigger().evaluate(async element => {
    const button = element as HTMLButtonElement;
    button.click();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const menu = document.querySelector<HTMLElement>('.menu-list')!;
    menu.getAnimations().forEach(animation => animation.finish());
    button.click();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (!menu.inert || menu.getAttribute('aria-hidden') !== 'true' || menu.hasAttribute('role')) throw new Error('Closing menu still interactive');
    if (button.getAttribute('aria-expanded') !== 'false') throw new Error('Trigger still expanded');
    const exit = menu.getAnimations()[0];
    if (!exit?.effect) throw new Error('Missing menu exit');
    exit.pause();
    exit.currentTime = Number(exit.effect.getTiming().duration) / 2;
    if (Number(getComputedStyle(menu).opacity) >= .4) throw new Error('Exit must ease out');
    button.click();
    await new Promise(resolve => setTimeout(resolve, 160));
  });
  await expect(list()).toBeVisible();
  await expect(item('选项 B')).toBeFocused();
  await activePage.keyboard.press('Escape');
  await expect(list()).toHaveCount(0);
  await expect(trigger()).toBeFocused();
  await expect(activePage.locator('.menu-list')).toHaveCount(0);

  const target = activePage.getByRole('button', { name: '测试提示', exact: true });
  await target.focus();
  await expect(activePage.getByRole('tooltip')).toBeVisible();
  await activePage.keyboard.press('Escape');
  await expect(activePage.getByRole('tooltip')).toHaveCount(0);
  await expect(target).not.toHaveAttribute('aria-describedby');
  await expect(target).toBeFocused();
  await expect(activePage.locator('.tooltip')).toHaveCount(0);
});

test('enabling reduced motion during an exit removes its retained visual immediately', async () => {
  await activePage.emulateMedia({ reducedMotion: 'no-preference' });
  await trigger().evaluate(element => (element as HTMLButtonElement).click());
  // Hold the exit clock long enough to observe the media preference cancelling its cleanup.
  await activePage.clock.install();
  await activePage.keyboard.press('Escape');
  await expect(list()).toHaveCount(0);
  await expect(activePage.locator('.menu-list')).toHaveAttribute('data-motion-state', 'closing');
  await activePage.emulateMedia({ reducedMotion: 'reduce' });
  await expect(activePage.locator('.menu-list')).toHaveCount(0);
  await expect(trigger()).toBeFocused();
});

test('hiding an owning disclosure dismisses its portalled menu and tooltip', async () => {
  await trigger().click();
  await expect(list()).toBeVisible();
  await trigger().evaluate(element => element.closest('.menu')!.setAttribute('inert', ''));
  await expect(list()).toHaveCount(0);
  await expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  await expect(activePage.locator('.menu-list')).toHaveCount(0);
  await trigger().evaluate(element => element.closest('.menu')!.removeAttribute('inert'));
  await trigger().click();
  await expect(list()).toBeVisible();
  await activePage.keyboard.press('Escape');
  const target = activePage.getByRole('button', { name: '测试提示', exact: true });
  await target.focus();
  await expect(activePage.getByRole('tooltip')).toBeVisible();
  await target.evaluate(element => element.closest('.tooltip-anchor')!.setAttribute('hidden', ''));
  await expect(activePage.getByRole('tooltip')).toHaveCount(0);
  await expect(activePage.locator('.tooltip')).toHaveCount(0);
});
