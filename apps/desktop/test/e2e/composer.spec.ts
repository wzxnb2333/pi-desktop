import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Browser, type Page, chromium, expect, test } from '@playwright/test';

/*
 * The composer, driven in a real browser against the real component and the real stylesheet.
 *
 * Same isolation as `primitives.spec.ts`: esbuild bundles the harness (which mounts `AppProvider` +
 * `Composer` behind a fake `window.desktop`) into a temp directory, and plain Chromium loads it. The
 * CSS import in the harness is what makes the metric assertions below meaningful — they read computed
 * values, so `--radius-composer-single` has to have survived the token -> utility -> component chain.
 */
const entry = fileURLToPath(new URL('./fixtures/composer-harness.tsx', import.meta.url));
const html =
  '<!doctype html><meta charset="utf-8"><body><div id="root"></div>' +
  '<link rel="stylesheet" href="./harness.css"><script src="./harness.js"></script>';

let browser: Browser;
let pageUrl = '';
let activePage: Page;

test.beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-composer-'));
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

// A fresh context per test: React state and the fake bridge's log must not leak between key sequences.
// `colorScheme: light` pins the theme because the token assertions below quote light-theme values; the
// harness leaves `settings.theme` on `system`, so the media query is what decides them.
test.beforeEach(async () => {
  activePage = await browser.newPage({ colorScheme: 'light' });
  await openComposer();
});

test.afterEach(async () => {
  await activePage.close();
});

test.afterAll(async () => {
  await browser?.close();
});
test.afterAll(cleanupTemporaryDirectories);

async function openComposer(query = '') {
  await activePage.goto(pageUrl + query);
  await expect(activePage.locator('.composer-input')).toBeVisible();
}

const input = () => activePage.getByLabel('向 Pi 发送消息');
const surface = () => activePage.locator('.composer');
const trigger = (label: string) => activePage.getByLabel(label, { exact: true });
const list = () => activePage.getByRole('menu');
// `exact` matters: without it 高 also matches 极高 and every 思考级别 locator becomes ambiguous.
const item = (name: string) => activePage.getByRole('menuitemradio', { name, exact: true });
const sendButton = () => activePage.getByLabel('发送消息', { exact: true });
const lastUpdate = () => activePage.getByTestId('last-update');
const lastSend = () => activePage.getByTestId('last-send');
const status = () => activePage.getByTestId('status');

/** One row per replaced `<select>`: what the trigger shows at rest, and what Enter is expected to write. */
const menus = [
  {
    label: '执行策略',
    atRest: '请求批准',
    focusedAtRest: '请求批准',
    next: '替我批准',
    first: '请求批准',
    written: 'policy:auto',
  },
];

for (const menu of menus) {
  test.describe(menu.label, () => {
    test('a click opens with the current row focused and checked', async () => {
      await expect(trigger(menu.label)).toHaveAttribute('aria-haspopup', 'menu');
      await expect(trigger(menu.label)).toHaveText(menu.atRest);
      await trigger(menu.label).click();
      await expect(list()).toBeVisible();
      await expect(trigger(menu.label)).toHaveAttribute('aria-expanded', 'true');
      await expect(item(menu.focusedAtRest)).toBeFocused();
      await expect(item(menu.focusedAtRest)).toHaveAttribute('aria-checked', 'true');
    });

    test('ArrowDown on the closed trigger opens it and focuses the first row', async () => {
      await trigger(menu.label).focus();
      await activePage.keyboard.press('ArrowDown');
      await expect(list()).toBeVisible();
      await expect(item(menu.first)).toBeFocused();
    });

    test('Enter writes through thread.update and returns focus to the trigger', async () => {
      await trigger(menu.label).click();
      await activePage.keyboard.press('ArrowDown');
      await expect(item(menu.next)).toBeFocused();
      await activePage.keyboard.press('Enter');
      await expect(list()).toHaveCount(0);
      await expect(trigger(menu.label)).toBeFocused();
      // The label only changes if the fake main process echoed a new `state`, so this proves the write
      // went through `thread.update` rather than through local composer state.
      await expect(lastUpdate()).toHaveText(menu.written);
      await expect(trigger(menu.label)).toContainText(menu.next.slice(-4));
    });

    test('Escape closes without selecting and restores focus', async () => {
      await trigger(menu.label).click();
      await expect(item(menu.focusedAtRest)).toBeFocused();
      await activePage.keyboard.press('Escape');
      await expect(list()).toHaveCount(0);
      await expect(trigger(menu.label)).toBeFocused();
      await expect(lastUpdate()).toHaveText('none');
      await expect(trigger(menu.label)).toHaveText(menu.atRest);
    });

    test('a pointerdown outside closes without selecting', async () => {
      await trigger(menu.label).click();
      await expect(item(menu.focusedAtRest)).toBeFocused();
      await input().click();
      await expect(list()).toHaveCount(0);
      await expect(lastUpdate()).toHaveText('none');
      await expect(trigger(menu.label)).toHaveText(menu.atRest);
    });
  });
}

test('permission modes expose exactly three choices and preserve the draft while changing real policy', async () => {
  await input().fill('权限切换保留草稿');
  await trigger('执行策略').click();
  await expect(list().getByRole('menuitemradio')).toHaveText(['请求批准', '替我批准', '完全访问']);
  // The shield is a flex sibling of the label, so its optical centre matches the row it sits in
  // instead of riding the text baseline.
  for (const row of await list().getByRole('menuitemradio').all()) {
    const label = (await row.locator('.composer-policy-label').boundingBox())!, icon = (await row.locator('.composer-policy-label svg').boundingBox())!;
    expect(Math.abs(icon.y + icon.height / 2 - (label.y + label.height / 2))).toBeLessThanOrEqual(0.5);
    expect(icon.x - label.x).toBeCloseTo(0, 0);
  }
  await item('完全访问').click();
  await expect(lastUpdate()).toHaveText('policy:full');
  await expect(input()).toHaveValue('权限切换保留草稿');
  await trigger('执行策略').click(); await item('请求批准').click();
  await expect(lastUpdate()).toHaveText('policy:ask');
  await openComposer('?locale=en-US');
  await activePage.getByLabel('Permissions', { exact: true }).click();
  await expect(list().getByRole('menuitemradio')).toHaveText(['Ask for approval', 'Approve for me', 'Full access']);
});

test('the input grows with the content and caps out at ten lines', async () => {
  const rest = await input().evaluate((el) => el.getBoundingClientRect().height);
  expect(rest).toBe(44);
  await expect(input()).toHaveCSS('overflow-y', 'hidden');

  await input().fill('第一行\n第二行\n第三行');
  const three = await input().evaluate((el) => el.getBoundingClientRect().height);
  expect(three).toBeGreaterThan(rest);
  await expect(input()).toHaveCSS('max-height', '200px');

  await input().fill(Array.from({ length: 40 }, (_, i) => `第${i}行`).join('\n'));
  const grown = await input().evaluate((el) => ({
    box: el.getBoundingClientRect().height,
    scroll: el.scrollHeight,
    client: el.clientHeight,
  }));
  expect(grown.box).toBeCloseTo(200, 0);
  expect(grown.scroll).toBeGreaterThan(grown.client + 400);
  await expect(input()).toHaveCSS('overflow-y', 'auto');

  await input().fill('');
  await expect(input()).toHaveCSS('overflow-y', 'hidden');
});

test('the composer keeps the ported 22px radius while it grows', async () => {
  // design-tokens.md §1.9: `--radius-token-composer-single-line` = calc(var(--spacing) * 5.5) = 22px,
  // and `--composer-radius` resolves to the same 22px on desktop, so the corner must not move.
  await expect(surface()).toHaveCSS('border-top-left-radius', '22px');
  await input().fill(Array.from({ length: 20 }, (_, i) => `第${i}行`).join('\n'));
  await expect(surface()).toHaveCSS('border-top-left-radius', '22px');
});

test('the composer controls share the ported 28px size', async () => {
  await input().fill('内容');
  const box = await sendButton().evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(box.width).toBeCloseTo(28, 0);
  expect(box.height).toBeCloseTo(28, 0);
  const menu = await trigger('模型与能力').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(menu.height).toBeCloseTo(28, 0);
});

test('runtime controls are disabled while the task runs, and a send queues', async () => {
  await input().fill('跑个测试');
  await expect(sendButton()).toBeEnabled();
  await sendButton().click();
  await expect(lastSend()).toHaveText('direct');
  await expect(status()).toHaveText('running');

  for (const menu of menus) await expect(trigger(menu.label)).toBeDisabled();
  await expect(trigger('模型与能力')).toBeDisabled();
  await trigger('添加上下文与操作').click();
  await expect(activePage.getByRole('menuitem', { name: '开启计划模式', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(activePage.getByRole('menuitem', { name: '新建 Worktree', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await activePage.keyboard.press('Escape');
  await expect(list()).toHaveCount(0);

  await input().fill('补充一句');
  await expect(activePage.getByLabel('排队发送', { exact: true })).toBeEnabled();
  await expect(activePage.getByLabel('发送消息', { exact: true })).toHaveCount(0);
  await activePage.getByLabel('排队发送', { exact: true }).click();
  await expect(lastSend()).toHaveText('followUp');
  await activePage.getByLabel('运行中追加消息', { exact: true }).click();
  await activePage.getByRole('menuitemradio', { name: '引导', exact: true }).click();
  await input().fill('修正当前任务');
  await activePage.getByLabel('引导发送', { exact: true }).click();
  await expect(lastSend()).toHaveText('steer');

  await activePage.getByLabel('停止任务').click();
  await expect(status()).toHaveText('idle');
  await expect(trigger('模型与能力')).toBeEnabled();
});

test('send needs both text and a provider', async () => {
  await expect(sendButton()).toBeDisabled();
  await input().fill('只有文字');
  await expect(sendButton()).toBeEnabled();

  await openComposer('?noprovider=1');
  await expect(trigger('模型与能力')).toHaveText('选择模型');
  await input().fill('依然没有模型');
  await expect(sendButton()).toBeDisabled();
});

test('a composing Enter reaches the handler without sending', async () => {
  await input().fill('合成中的拼音');
  // Both events are dispatched from inside the page so `defaultPrevented` is readable: the send branch
  // calls preventDefault, so the flag proves the handler ran and which side of the guard it took.
  const fired = await input().evaluate((el) => {
    const fire = (isComposing: boolean) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return { composing: fire(true), idle: fire(false) };
  });
  expect(fired.composing).toBe(false);
  expect(fired.idle).toBe(true);
  await expect(lastSend()).toHaveText('direct');
});

test('ctrl-enter mode ignores a bare Enter', async () => {
  await openComposer('?shortcut=ctrl-enter');
  await input().fill('按回车不该发');
  await activePage.keyboard.press('Enter');
  await expect(lastSend()).toHaveText('none');
  await activePage.keyboard.press('Control+Enter');
  await expect(lastSend()).toHaveText('direct');
});

test('Shift+Enter inserts a newline instead of sending', async () => {
  await input().fill('第一行');
  await activePage.keyboard.press('Shift+Enter');
  await expect(lastSend()).toHaveText('none');
  await expect(input()).toHaveValue('第一行\n');
});

// The strip must update without waiting for a subsequent keystroke.
test('the attachment strip lists picks and removes one', async () => {
  await trigger('添加上下文与操作').click();
  await activePage.getByRole('menuitem', { name: '添加附件', exact: true }).click();
  await expect(activePage.locator('.composer-attachment')).toHaveCount(2);
  await expect(activePage.getByLabel('移除附件 diagram.png')).toBeVisible();
  await activePage.getByLabel('移除附件 notes.txt').click();
  await expect(activePage.locator('.composer-attachment')).toHaveCount(1);
  await expect(activePage.locator('.attachment-name')).toHaveText('diagram.png');
});

test('the menus open upward, out of the bottom-anchored composer', async () => {
  await trigger('模型与能力').click();
  await activePage.getByRole('button', { name: '模型', exact: true }).click();
  await expect(list()).toBeVisible();
  const menu = await list().boundingBox();
  const button = await trigger('模型与能力').boundingBox();
  if (!menu || !button) throw new Error('neither the popover nor the trigger has a box');
  // `side="top"`: the popover's bottom edge has to sit above the trigger, or it opens into the composer.
  expect(menu.y + menu.height).toBeLessThanOrEqual(button.y + 1);
});

test('slash plan selection changes the actual mode without sending and preserves surrounding draft', async () => {
  await input().fill('保留前文 /plan');
  await expect(activePage.getByRole('option', { name: '开启计划模式 /plan', exact: true })).toBeVisible();
  await expect(input()).toBeFocused(); await input().press('Enter');
  await expect(lastUpdate()).toHaveText('planMode:true'); await expect(lastSend()).toHaveText('none');
  await expect(input()).toHaveValue('保留前文 ');
  const chip = activePage.getByRole('button', { name: '关闭计划模式', exact: true });
  await expect(chip).toBeVisible(); await expect(chip).not.toHaveCSS('box-shadow', 'none');
  await chip.click(); await expect(lastUpdate()).toHaveText('planMode:false'); await expect(chip).toHaveCount(0);
});

test('one model and effort control supports the native slider and a focused model list', async () => {
  await expect(trigger('模型与能力')).toHaveText('快速模型中等');
  await trigger('模型与能力').click(); const slider = activePage.getByRole('slider', { name: '思考级别', exact: true });
  await expect(slider).toBeFocused(); await slider.press('ArrowRight');
  await expect(lastUpdate()).toHaveText('thinking:high'); await expect(trigger('模型与能力')).toHaveText('快速模型高');
  // The heading carries no glyph: it is the current level's own label, centred.
  await expect(activePage.locator('.composer-capability-heading svg')).toHaveCount(0);
  await activePage.getByRole('button', { name: '模型', exact: true }).click();
  // Two levels: the first list picks the provider, the second one the model under it.
  await activePage.keyboard.press('Enter'); await expect(item('快速模型')).toBeFocused(); await activePage.keyboard.press('ArrowDown'); await activePage.keyboard.press('Enter');
  await expect(lastUpdate()).toHaveText('modelId:deep'); await expect(trigger('模型与能力')).toBeFocused();
  await expect(trigger('模型与能力')).toContainText('深度模型'); await expect(list()).toHaveCount(0);
  await trigger('模型与能力').click(); await activePage.keyboard.press('Escape');
  await expect(activePage.getByRole('dialog')).toHaveCount(0); await expect(trigger('模型与能力')).toBeFocused();
  await input().fill('键盘焦点顺序'); await trigger('模型与能力').click();
  await slider.press('Tab'); await expect(sendButton()).toBeFocused();
  await expect(activePage.getByRole('dialog')).toHaveCount(0);
});

test('at mentions select real files, folders and tools, and slash searches enabled skills', async () => {
  for (const [value, label] of [['@README', 'README.md README.md'], ['@src/main', 'main.ts src/main.ts'], ['@src', 'src src'], ['@read_file', 'read_file 读取项目文件'], ['/Design', 'UI Design 界面设计与布局']]) {
    await input().fill('上下文 ' + value);
    await expect(activePage.getByRole('option', { name: label, exact: true })).toBeVisible();
    await expect(activePage.getByRole('option', { name: label, exact: true })).toHaveCSS('justify-content', 'flex-start');
    await activePage.getByRole('option', { name: label, exact: true }).click();
    await expect(input()).toHaveValue('上下文 '); await expect(input()).toBeFocused();
  }
  await expect(activePage.locator('.composer-context .attachment')).toHaveCount(5);
  await input().fill('使用这些上下文'); await sendButton().click();
  const sent = JSON.parse(await activePage.getByTestId('last-context').textContent() ?? '[]');
  expect(sent.map((item: { kind: string }) => item.kind)).toEqual(['file', 'file', 'folder', 'tool', 'skill']);
});

test('suggestions respect composition and Escape; retry does not send the raw command', async () => {
  await openComposer('?catalogerror=1'); await input().fill('/plan');
  await expect(activePage.getByRole('alert')).toHaveText('CATALOG_RETRY_PROOF');
  await input().press('Enter'); await expect(lastSend()).toHaveText('none');
  await expect(activePage.getByRole('option', { name: '开启计划模式 /plan', exact: true })).toBeVisible();
  await input().evaluate(el => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await expect(activePage.getByRole('listbox')).toHaveCount(0);
  await input().evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })));
  await expect(lastSend()).toHaveText('none');
  await input().evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await expect(activePage.getByRole('listbox')).toBeVisible(); await input().press('Escape');
  await expect(activePage.getByRole('listbox')).toHaveCount(0); await expect(input()).toHaveValue('/plan');
  await input().press('Enter'); await expect(lastSend()).toHaveText('direct');
});

test('compact toolbar has four idle controls and no voice, slash or at buttons across themes and sizes', async () => {
  for (const locale of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark']) for (const width of [1000, 1280, 1440]) {
    await activePage.setViewportSize({ width, height: width === 1000 ? 700 : 940 }); await openComposer('?locale=' + locale + '&theme=' + theme);
    await expect(activePage.locator('.composer-actions button')).toHaveCount(4);
    await expect(activePage.locator('.voice-controls, .voice-outlet')).toHaveCount(0);
    const geometry = await activePage.locator('.composer-actions').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth, tops: [...node.querySelectorAll('button')].map(button => Math.round(button.getBoundingClientRect().top)) }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1); expect(new Set(geometry.tops).size).toBe(1);
  }
});

test('context selection waits for validation before consuming the mention and cannot send incomplete context', async () => {
  test.setTimeout(30000);
  await openComposer('?contextdelay=1');
  await input().fill('分析 @README');
  await activePage.getByRole('option', { name: 'README.md README.md', exact: true }).click();
  await expect.poll(() => activePage.evaluate(() => window.__composerContext.pending())).toBe(1);
  await expect(input()).toHaveValue('分析 @README', { timeout: 3000 });
  await expect(sendButton()).toBeDisabled();
  await input().press('Enter');
  await expect(lastSend()).toHaveText('none');
  expect(await activePage.evaluate(() => window.__composerContext.pending())).toBe(1);
  const sendBox = await sendButton().boundingBox();
  if (!sendBox) throw new Error('Send control is not visible');
  await activePage.mouse.click(sendBox.x + sendBox.width / 2, sendBox.y + sendBox.height / 2);
  await expect(sendButton()).toBeDisabled();
  await expect(lastSend()).toHaveText('none');
  await activePage.evaluate(() => window.__composerContext.finish());
  await expect(input()).toHaveValue('分析 ');
  await expect(input()).toBeFocused();
  await expect(activePage.locator('.composer-context .attachment')).toHaveCount(1);
  await sendButton().click();
  await expect(lastSend()).toHaveText('direct');
  expect(JSON.parse(await activePage.getByTestId('last-context').textContent() ?? '[]')).toMatchObject([{ id: 'README.md', kind: 'file' }]);
});

test('context selection failure preserves the mention and can retry without duplicating the reference', async () => {
  test.setTimeout(30000);
  await openComposer('?contextdelay=1');
  await input().fill('分析 @README');
  const option = activePage.getByRole('option', { name: 'README.md README.md', exact: true });
  await option.click();
  await expect.poll(() => activePage.evaluate(() => window.__composerContext.pending())).toBe(1);
  await activePage.evaluate(() => window.__composerContext.finish('CONTEXT_READ_FAILED'));
  await expect(activePage.getByRole('alert')).toHaveText('CONTEXT_READ_FAILED');
  await expect(input()).toHaveValue('分析 @README');
  await expect(activePage.locator('.composer-context .attachment')).toHaveCount(0);
  await input().press('Enter');
  await expect.poll(() => activePage.evaluate(() => window.__composerContext.pending())).toBe(1);
  await expect(activePage.getByRole('alert')).toHaveCount(0);
  await expect(lastSend()).toHaveText('none');
  await activePage.evaluate(() => window.__composerContext.finish());
  await expect(input()).toHaveValue('分析 ');
  await expect(activePage.locator('.composer-context .attachment')).toHaveCount(1);
});

for (const cancel of ['escape', 'button', 'edit'] as const) {
  test('context selection cancels by ' + cancel + ' and a late result cannot complete a newer choice', async () => {
    test.setTimeout(30000);
    await openComposer('?contextdelay=1');
    await input().fill('旧引用 @README');
    await activePage.getByRole('option', { name: 'README.md README.md', exact: true }).click();
    await expect.poll(() => activePage.evaluate(() => window.__composerContext.pending())).toBe(1);
    if (cancel === 'escape') await input().press('Escape');
    else if (cancel === 'button') await activePage.getByRole('button', { name: '取消添加引用', exact: true }).click();
    else await input().fill('修改后的草稿');
    await expect(sendButton()).toBeEnabled();
    await input().fill('新引用 @src/main');
    await activePage.getByRole('option', { name: 'main.ts src/main.ts', exact: true }).click();
    await expect.poll(() => activePage.evaluate(() => window.__composerContext.pending())).toBe(2);
    await activePage.evaluate(() => window.__composerContext.finish());
    await expect(input()).toHaveValue('新引用 @src/main');
    await expect(sendButton()).toBeDisabled();
    await expect(activePage.locator('.composer-context .attachment')).toHaveCount(0);
    await activePage.evaluate(() => window.__composerContext.finish());
    await expect(input()).toHaveValue('新引用 ');
    await expect(activePage.getByTestId('context-references')).toHaveText(JSON.stringify([{ kind: 'file', id: 'src/main.ts', label: 'main.ts', directoryId: 'p1' }]));
  });
}

test('context selection belongs to its task and switching tasks keeps each draft independent', async () => {
  test.setTimeout(30000);
  await openComposer('?contextdelay=1');
  await input().fill('任务一 @README');
  await activePage.getByRole('option', { name: 'README.md README.md', exact: true }).click();
  await expect.poll(() => activePage.evaluate(() => window.__composerContext.pending())).toBe(1);
  await activePage.evaluate(() => window.__composerContext.switchThread('t2'));
  await expect(input()).toHaveValue('');
  await input().fill('任务二草稿');
  await expect(sendButton()).toBeEnabled();
  await activePage.evaluate(() => window.__composerContext.finish());
  await expect(input()).toHaveValue('任务二草稿');
  await expect(activePage.getByTestId('context-references')).toHaveText('[]');
  await sendButton().click();
  await expect(lastSend()).toHaveText('direct');
  await expect(activePage.getByTestId('last-context')).toHaveText('[]');
  await activePage.evaluate(() => window.__composerContext.switchThread('t1'));
  await expect(input()).toHaveValue('任务一 @README');
  await expect(activePage.getByTestId('context-references')).toHaveText('[]');
});

test('context picker validates before replacing a mention and leaves failed choices available for retry', async () => {
  test.setTimeout(30000);
  await openComposer('?contextdelay=1');
  await input().fill('保留 @README');
  await activePage.getByRole('option', { name: '浏览项目文件 文件与文件夹', exact: true }).click();
  const dialog = activePage.getByRole('dialog', { name: '命令与上下文', exact: true });
  const choice = dialog.getByRole('button', { name: 'README.md', exact: true });
  await choice.click();
  await expect(choice).toBeDisabled();
  await expect(input()).toHaveValue('保留 @README');
  await activePage.evaluate(() => window.__composerContext.finish('PICKER_READ_FAILED'));
  await expect(dialog.getByRole('alert')).toHaveText('PICKER_READ_FAILED');
  await expect(choice).toBeEnabled();
  await choice.click();
  await expect(choice).toBeDisabled();
  await activePage.evaluate(() => window.__composerContext.finish());
  await expect(dialog).toHaveCount(0);
  await expect(input()).toHaveValue('保留 ');
  await expect(input()).toBeFocused();
  await expect(activePage.locator('.composer-context .attachment')).toHaveCount(1);
});

test('context picker closing cancels selection without clearing the draft or appending late references', async () => {
  test.setTimeout(30000);
  await openComposer('?contextdelay=1');
  await input().fill('保留 @README');
  await activePage.getByRole('option', { name: '浏览项目文件 文件与文件夹', exact: true }).click();
  const dialog = activePage.getByRole('dialog', { name: '命令与上下文', exact: true });
  await dialog.getByRole('button', { name: 'README.md', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'README.md', exact: true })).toBeDisabled();
  await activePage.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(input()).toHaveValue('保留 @README');
  await expect(sendButton()).toBeEnabled();
  await activePage.evaluate(() => window.__composerContext.finish());
  await expect(activePage.getByTestId('context-references')).toHaveText('[]');
  await expect(input()).toHaveValue('保留 @README');
});

test('slash templates replace the token at the caret and preserve the following text', async () => {
  test.setTimeout(30000);
  await input().fill('前文 /边界 后文');
  await input().press('ArrowLeft'); await input().press('ArrowLeft'); await input().press('ArrowLeft');
  await activePage.getByRole('option', { name: '边界检查 检查边界与失败恢复', exact: true }).click();
  await expect(input()).toHaveValue('前文 检查边界与失败恢复 后文', { timeout: 3000 });
  await expect(input()).toBeFocused();
  expect(await input().evaluate(element => [(element as HTMLTextAreaElement).selectionStart, (element as HTMLTextAreaElement).selectionEnd])).toEqual([12, 12]);
  await input().press('!');
  await expect(input()).toHaveValue('前文 检查边界与失败恢复! 后文');
  await expect(lastSend()).toHaveText('none');
});
