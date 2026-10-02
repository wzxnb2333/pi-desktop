import { taskAction } from './fixtures/task-actions.ts';
import { expectAdaptedAppearance } from './fixtures/adapted-appearance.ts';
import { build } from 'esbuild';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser } from '@playwright/test';
import type { Bootstrap } from '../../src/shared/contracts.ts';
const homeContract: { samples: { theme: string; width: number; height: number; measurements: Record<string, { rect: { x: number; y: number; w: number; h: number }; css: Record<string, string> }> }[] } = JSON.parse(
  await readFile(new URL('../../../../docs/desktop/satang-reference.json', import.meta.url), 'utf8'),
);
let browser: Browser;
const shellContract: typeof homeContract = JSON.parse(
  await readFile(new URL('../../../../docs/desktop/satang-shell-reference.json', import.meta.url), 'utf8'),
);
let directory = '';
let url = '';
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-reference-'));
  await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/reference-harness.tsx', import.meta.url))],
    outfile: join(directory, 'app.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  await writeFile(
    join(directory, 'index.html'),
    '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>',
  );
  url = pathToFileURL(join(directory, 'index.html')).href;
  // The default headless flag removes the scrollbar gutter; desktop captures include it.
  browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
});

for (const sample of homeContract.samples) {
  test(`Satang project home ${sample.theme} ${sample.width}×${sample.height} captured geometry`, async () => {
    const page = await browser.newPage({ viewport: { width: sample.width, height: sample.height } });
    try {
      await page.goto(url + '?pinned=1&migration=1&theme=' + sample.theme);
      await expect(page.locator('.welcome-task')).toBeVisible();
      await expect(page.getByRole('tablist', { name: '任务标签' })).toHaveCount(0);
      for (const [selector, key] of [['.composer', 'composer'], ['.composer-home-utility', 'utility']] as const) {
        const expected = sample.measurements[key].rect;
        const box = await page.locator(selector).boundingBox();
        expect(box).not.toBeNull();
        for (const [property, value] of Object.entries({ x: expected.x, y: expected.y, width: expected.w, height: expected.h }))
          expect(Math.abs(box![property as keyof typeof box] - value), selector + ' ' + property).toBeLessThanOrEqual(.5);
      }
      const heading = await page.locator('.welcome h1').boundingBox();
      expect(Math.abs(heading!.y - sample.measurements.heading.rect.y)).toBeLessThanOrEqual(.5);
      await expect(page.locator('.welcome h1')).toHaveCSS('font-size', sample.measurements.heading.css.fontSize);
      await expect(page.locator('.welcome h1')).toHaveCSS('font-weight', sample.measurements.heading.css.fontWeight);
      await expect(page.locator('.welcome h1')).toHaveCSS('color', sample.measurements.heading.css.color);
      await expect(page.getByLabel('向 Pi 发送消息')).toHaveCSS('color', sample.measurements.textbox.css.color);
      await expect(page.locator('.composer')).toHaveCSS('border-radius', sample.measurements.body.css.borderRadius);
      await expect(page.getByLabel('向 Pi 发送消息')).toHaveCSS('height', '44px');
      await expect(page.locator('.welcome-setup')).toHaveCount(0);
      expect(await page.evaluate(() => ({ whole: document.documentElement.scrollWidth - innerWidth, home: document.querySelector('.timeline')!.scrollHeight - document.querySelector('.timeline')!.clientHeight }))).toEqual({ whole: 0, home: 0 });
      await page.getByLabel('执行策略', { exact: true }).click();
      const menu = await page.getByRole('menu').boundingBox();
      expect(menu!.y).toBeGreaterThanOrEqual(6);
      expect(menu!.y + menu!.height).toBeLessThanOrEqual(sample.height - 6);
    } finally { await page.close(); }
  });
}

test('Satang home keeps project switching, suggestions, plan mode and draft restoration live', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  try {
    await page.goto(url + '?pinned=1&migration=1');
    await page.getByLabel('新任务选项').click();
    await page.getByRole('menuitem', { name: '了解这个项目', exact: true }).click();
    await expect(page.getByLabel('向 Pi 发送消息')).toBeFocused();
    await expect(page.getByLabel('向 Pi 发送消息')).toHaveValue('请阅读这个项目，说明它的结构、主要功能和启动方式。');
    await page.getByLabel('新任务选项').click();
    await page.getByRole('menuitem', { name: '开启计划模式', exact: true }).click();
    await expect(page.getByLabel('新任务选项')).toContainText('计划模式');
    const saved = await page.evaluate(async () => ((await window.desktop.invoke({ op: 'bootstrap' })) as Bootstrap).data);
    expect(saved.threads.find(thread => thread.id === 't1')!.planMode).toBe(true);
    await page.getByLabel('输入区项目').click();
    await page.getByRole('menuitemradio', { name: '第二项目', exact: true }).click();
    await expect(page.getByLabel('输入区项目')).toHaveText('第二项目');
    await expect(page.getByLabel('向 Pi 发送消息')).toHaveValue('');
    await page.locator('.thread-main[title="任务1"]').click();
    await expect(page.getByLabel('向 Pi 发送消息')).toHaveValue('请阅读这个项目，说明它的结构、主要功能和启动方式。');
    await page.getByLabel('新任务选项').click();
    await page.getByRole('menuitem', { name: '关闭当前任务', exact: true }).click();
    await page.getByLabel('文件菜单').click();
    await page.getByRole('menuitem', { name: '重新打开任务', exact: true }).click();
    await expect(page.getByLabel('向 Pi 发送消息')).toHaveValue('请阅读这个项目，说明它的结构、主要功能和启动方式。');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.locator('.welcome')).toHaveCount(0);
    await expect(page.locator('.message.user')).toContainText('请阅读这个项目');
    await expect(page.getByRole('button', { name: '关闭计划模式', exact: true })).toBeDisabled();
    await expect(page.getByLabel('排队发送', { exact: true })).toBeVisible();
  } finally { await page.close(); }
});

test('Satang home retains model setup and global onboarding instead of copying Windows setup state', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  try {
    await page.goto(url + '?pinned=1&setup=1');
    await expect(page.getByLabel('模型配置引导')).toBeVisible();
    await expect(page.getByLabel('发送消息', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '配置 API Key 和模型', exact: true }).click();
    await expect(page.locator('.settings-body')).toBeVisible();
    await page.goto(url + '?pinned=1&usage=1');
    await page.locator('.context-usage-ring').hover();
    await expect(page.getByRole('tooltip')).toContainText('输入 400 · 输出 100 · 总计 500 tokens');
    await page.goto(url + '?empty=1');
    await expect(page.getByRole('heading', { name: '开始你的下一个想法' })).toBeVisible();
    await expect(page.locator('.welcome-start').getByRole('button', { name: '添加本地项目' })).toBeVisible();
    await expect(page.locator('.composer')).toHaveCount(0);
  } finally { await page.close(); }
});

test('Satang home long project names and expanding drafts stay usable in a narrow pane', async () => {
  const page = await browser.newPage({ viewport: { width: 620, height: 700 } });
  try {
    await page.goto(url + '?pinned=1&longproject=1');
    await expect(page.getByLabel('向 Pi 发送消息')).toBeVisible();
    await page.getByLabel('向 Pi 发送消息').fill(Array.from({ length: 14 }, (_, index) => '多行草稿 ' + index).join('\n'));
    await expect(page.getByLabel('向 Pi 发送消息')).toHaveCSS('height', '200px');
    for (const selector of ['.welcome', '.composer-home-utility', '.composer-actions']) {
      expect(await page.locator(selector).evaluate(element => element.scrollWidth - element.clientWidth), selector).toBeLessThanOrEqual(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.getByLabel('新任务选项').click();
    await expect(page.getByRole('menuitem', { name: '审查最近改动' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '新建 Worktree', exact: true }).click();
    await expect(page.locator('.home-branch')).toHaveText('task/test-worktree');
  } finally { await page.close(); }
});
test('combined wide saved panes fit a 1000×640 window without losing controls', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  try {
    await page.goto(url + '?wide=1');
    await expect(page.locator('.composer')).toBeVisible();
    const bounds = await page.locator('.conversation').boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(320);
    for (const selector of ['.composer-actions', '.composer-home-utility', '.workspace-tab-header']) {
      const overflow = await page
        .locator(selector)
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(overflow, selector).toBeLessThanOrEqual(1);
    }
    await expect(page.locator('.conversation-layout')).toHaveClass(/auxiliary-overlay/);
    await page.getByLabel('关闭辅助栏', { exact: true }).click();
    await page.getByLabel('模型与能力', { exact: true }).click();
    await page.getByRole('button', { name: '模型', exact: true }).click();
    const menu = await page.getByRole('menu').boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(8);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(992);
    await page.keyboard.press('Escape');
    const saved = await page.evaluate(
      async () => ((await window.desktop.invoke({ op: 'bootstrap' })) as Bootstrap).data.ui,
    );
    expect([saved.sidebarWidth, saved.reviewWidth, saved.terminalHeight]).toEqual([520, 760, 800]);
  } finally {
    await page.close();
  }
});

for (const [width, reviewWidth] of [[1000, 407], [1280, 520], [1440, 847]]) test('docked review preserves the reference top row and readable conversation at ' + width, async () => {
  const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 940 : 700 } });
  try {
    await page.goto(url + '?pinned=1&workspace=1&longproject=1');
    await page.evaluate(async reviewWidth => {
      const { data } = await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap;
      await window.desktop.invoke({ op: 'ui.update', ui: { ...data.ui, summaryOpen: false, reviewOpen: true, reviewWidth } });
    }, reviewWidth);
    await expect(page.locator('.conversation-layout')).not.toHaveClass(/auxiliary-overlay/);
    const pane = (await page.locator('.review-pane').boundingBox())!;
    const conversation = (await page.locator('.conversation').boundingBox())!;
    const toolbar = (await page.locator('.toolbar').boundingBox())!;
    expect(pane.width).toBe(reviewWidth);
    expect(pane.y).toBe(toolbar.y);
    expect(conversation.width).toBeGreaterThanOrEqual(320);
    expect(conversation.x + conversation.width).toBeLessThanOrEqual(pane.x);
    expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(pane.x);
    for (const selector of ['.composer-actions', '.toolbar', '.toolbar-actions'])
      expect(await page.locator(selector).evaluate(node => node.scrollWidth - node.clientWidth), selector).toBeLessThanOrEqual(1);
    // The toolbar no longer repeats the task status; the sidebar dot and the summary panel carry it.
    await expect(page.locator('.toolbar-actions .status')).toHaveCount(0);
    await page.getByRole('button', { name: '项目动作', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: '配置环境与动作', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '项目动作', exact: true })).toBeFocused();
    for (const locale of ['zh-CN', 'en-US'] as const) {
      await page.evaluate(async locale => {
        const { data } = await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap;
        await window.desktop.invoke({ op: 'ui.update', ui: { ...data.ui, locale } });
      }, locale);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      expect(await page.locator('.composer-actions').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      const projectLabel = page.locator('.breadcrumb > span');
      expect((await projectLabel.boundingBox())!.height).toBeLessThanOrEqual(20);
      await expect(projectLabel).toHaveAttribute('title', await projectLabel.innerText());
    }
    await page.evaluate(async () => {
      const { data } = await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap;
      await window.desktop.invoke({ op: 'ui.update', ui: { ...data.ui, locale: 'zh-CN' } });
    });
    await page.getByLabel('关闭辅助栏', { exact: true }).click();
    await expect(page.locator('.review-pane')).toHaveCount(0);
    expect((await page.locator('.conversation').boundingBox())!.width).toBeGreaterThan(conversation.width);
  } finally { await page.close(); }
});

test('splitter pointer and keyboard writes persist across task switches', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(url);
    const splitter = page.getByRole('separator', { name: '调整侧栏宽度' });
    await splitter.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.sidebar')).toHaveCSS('width', '285px');
    const box = await splitter.boundingBox();
    await page.mouse.move(box!.x, box!.y + 80);
    await page.mouse.down();
    await page.mouse.move(box!.x + 32, box!.y + 80);
    await page.mouse.up();
    await expect(page.locator('.sidebar')).toHaveCSS('width', '317px');
    await taskAction(page, '查看变更');
    await page.getByRole('button', { name: '新标签', exact: true }).click();
    await page.locator('.tool-launcher').getByRole('button', { name: '文件', exact: true }).click();
    await taskAction(page, '集成终端');
    await expect(page.getByLabel('隐藏终端')).toBeVisible();
    await page.locator('.thread-main').filter({ hasText: '任务2' }).click();
    await expect(page.getByLabel('隐藏终端')).toHaveCount(0);
    await page.locator('.thread-main').filter({ hasText: '任务1' }).click();
    await expect(page.getByLabel('隐藏终端')).toBeVisible();
    await expect(page.getByRole('tab', { name: '终端', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const saved = await page.evaluate(
      async () => ((await window.desktop.invoke({ op: 'bootstrap' })) as Bootstrap).data.ui,
    );
    expect(saved.sidebarWidth).toBe(317);
    expect(saved.threads.t1.reviewTab).toBe('terminal');
    expect(saved.threads.t1.panelTabs).toEqual(expect.arrayContaining([{ id: 'tool:files', kind: 'files' }]));
    expect(saved.threads.t1.terminalOpen).toBe(true);
  } finally {
    await page.close();
  }
});

test('system theme follows live OS changes and settings use contextual navigation', async () => {
  const page = await browser.newPage({ colorScheme: 'light' });
  try {
    await page.goto(url + '?theme=system');
    await expect(page.locator('.composer')).toBeVisible();
    await expectAdaptedAppearance(page, 'light', ['.main']);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAdaptedAppearance(page, 'dark', ['.main']);
    await page.keyboard.press('Control+,');
    await expect(page.locator('.sidebar.settings-sidebar')).toBeVisible();
    await expect(page.locator('.thread-row')).toHaveCount(0);
    await page.getByRole('button', { name: '模型', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: '审批与信任', exact: true })).toBeFocused();
    await expect(page.getByLabel('默认审批', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '外观', exact: true }).click();
    await expect(page.getByLabel('主题', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回工作台' }).click();
    await expect(page.locator('.thread-row')).toHaveCount(2);
  } finally {
    await page.close();
  }
});

test('adapted icons and portal tooltips survive the clipped desktop surface', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  try {
    await page.goto(url);
    await expect(page.locator('.composer')).toBeVisible();
    for (const name of ['sidebar', 'review', 'send', 'plus', 'down']) {
      const icon = page.locator('[data-reference-icon="' + name + '"]:visible').first();
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute('data-icon-origin', 'pi-adaptation');
      await expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
    }
    await page.getByLabel('辅助栏', { exact: true }).focus();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toHaveText('辅助栏');
    const box = await tooltip.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(8);
    expect(box!.x + box!.width).toBeLessThanOrEqual(992);
    expect(await tooltip.evaluate((element) => element.parentElement === document.body)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
  } finally {
    await page.close();
  }
});

test('a resize merges with pending navigation instead of restoring a stale layout', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await expect(page.locator('.thread-row')).toHaveCount(2);
    await page.getByLabel('本地工作区操作').click();
    await page.evaluate(() => {
      const archive = [...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(
        (button) => button.textContent?.includes('已归档任务'),
      )!;
      const splitter = document.querySelector('[aria-label="调整侧栏宽度"]')!;
      archive.click();
      splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    await expect(page.locator('.sidebar-project-chats > .section-label')).toContainText('已归档');
    const saved = await page.evaluate(
      async () => ((await window.desktop.invoke({ op: 'bootstrap' })) as Bootstrap).data.ui,
    );
    expect(saved.showArchived).toBe(true);
    expect(saved.sidebarWidth).toBe(285);
  } finally {
    await page.close();
  }
});

for (const sample of shellContract.samples) {
  test('Satang shell ' + sample.theme + ' ' + sample.width + ' geometry with recents above project chats and compact quick chat', async () => {
    const page = await browser.newPage({ viewport: { width: sample.width, height: sample.height } });
    try {
      // Narrow source captures scroll; match that state instead of forcing a gutter on short lists.
      const scrolls = sample.measurements.primary.rect.w < 224;
      await page.goto(url + '?pinned=1&theme=' + sample.theme + (scrolls ? '&overflow=1' : ''));
      await expect(page.locator('.satang-sidebar')).toBeVisible();
      await expect(page.locator('.primary-nav .nav-row')).toHaveCount(3);
      await expect(page.locator('.sidebar-new-task').getByRole('button', { name: '新建聊天', exact: true })).toBeVisible();
      await page.locator('.sidebar-new-task').hover();
      await expect(page.locator('.sidebar-quick-chat')).toHaveCSS('opacity', '1');
      const recents = (await page.locator('.sidebar-recents').boundingBox())!;
      const projects = (await page.locator('.sidebar-project-chats').boundingBox())!;
      expect(recents.y - projects.y - projects.height).toBe(16);
      for (const [selector, key, properties] of [
        ['.titlebar', 'titlebar', ['x', 'y', 'w', 'h']],
        ['[aria-label="切换侧栏"]', 'toggle', ['x', 'y', 'w', 'h']],
        ['[aria-label="后退"]', 'back', ['x', 'y', 'w', 'h']],
        ['[aria-label="前进"]', 'forward', ['x', 'y', 'w', 'h']],
        ['.sidebar-brand', 'brand', ['x', 'y', 'h']],
        ['.sidebar-heading .icon-button', 'search', ['x', 'y', 'w', 'h']],
        ['.new-thread', 'newTask', ['x', 'y', 'w', 'h']],
        ['.primary-nav .nav-row', 'primary', ['x', 'y', 'w', 'h']],
        ['.sidebar-project-chats > .section-label', 'section', ['x', 'y', 'w', 'h']],
        ['.project-row', 'project', ['x', 'y', 'w', 'h']],
        ['.thread-row', 'thread', ['x', 'y', 'w', 'h']],
        ['.sidebar-footer', 'footer', ['x', 'y', 'w', 'h']],
        ['.sidebar-profile', 'profile', ['x', 'y', 'w', 'h']],
      ] as const) {
        const box = await page.locator(selector).first().boundingBox();
        expect(box, selector).not.toBeNull();
        const actual = { x: box!.x, y: box!.y, w: box!.width, h: box!.height };
        // The pinned reference has the project collection directly after the primary navigation, which
        // is again the shipped order: recents moved below it. The compact quick action still shares the
        // full-width creation row, so only its measured width differs.
        const creationWidth = key === 'newTask' ? 32 : 0;
        for (const property of properties)
          expect(Math.abs(actual[property] - sample.measurements[key].rect[property] - (property === 'w' ? creationWidth : 0)), selector + ' ' + property).toBeLessThanOrEqual(.5);
      }
      await expect(page.locator('.project-name').first()).toHaveCSS('font-size', sample.measurements.projectText.css.fontSize);
      await expect(page.locator('.project-name').first()).toHaveCSS('line-height', sample.measurements.projectText.css.lineHeight);
      await expect(page.locator('.project-name').first()).toHaveCSS('color', sample.measurements.projectText.css.color);
      await expect(page.locator('.thread-row').first()).toHaveCSS('border-radius', sample.measurements.thread.css.borderRadius);
      await expect(page.locator('.primary-nav .nav-row').first()).toHaveCSS('font-size', sample.measurements.navText.css.fontSize);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    } finally { await page.close(); }
  });
}

for (const theme of ['light', 'dark'] as const) test('pinned ' + theme + ' title menus and sidebar headings match captured styling', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  try {
    await page.goto(url + '?pinned=1&locale=en-US&theme=' + theme);
    // 26.915 welcome DOM: menu nodes 376–379 and Projects text node 464.
    const color = theme === 'dark' ? 'rgba(255, 255, 255, 0.498)' : 'rgba(26, 28, 31, 0.494)';
    for (const [index, x, width] of [[0, 102, 45.03], [1, 149.03, 47.52], [2, 198.55, 54.22], [3, 254.77, 52.25]]) {
      const menu = page.locator('.titlebar-menus .menu-trigger').nth(index);
      await expect(menu).toHaveCSS('color', color);
      await expect(menu).toHaveCSS('font-weight', '400');
      await expect(menu).toHaveCSS('line-height', '14px');
      await expect(menu).toHaveCSS('border-radius', '10px');
      const box = (await menu.boundingBox())!;
      expect(Math.abs(box.x - x)).toBeLessThanOrEqual(.5);
      expect(Math.abs(box.width - width)).toBeLessThanOrEqual(.5);
      expect([box.y, box.height]).toEqual([6, 24]);
    }
    await expect(page.locator('.sidebar-project-chats > .section-label > span').first()).toHaveCSS('color', color);
    await expect(page.locator('.recents-heading')).toHaveCSS('color', color);
  } finally { await page.close(); }
});

test('titlebar navigation restores actual tasks and skips deleted destinations', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await expect(page.getByLabel('后退', { exact: true })).toBeDisabled();
    await page.getByLabel('向 Pi 发送消息').fill('保留第一条草稿');
    await page.locator('.thread-main').filter({ hasText: '任务2' }).click();
    await page.getByRole('button', { name: 'Skills 与扩展', exact: true }).click();
    await page.getByLabel('文件菜单').click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    await expect(page.locator('.settings-sidebar')).toBeVisible();
    await page.getByLabel('后退', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Skills 与扩展', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByLabel('后退', { exact: true }).click();
    await expect(page.locator('.thread-row.selected')).toContainText('任务2');
    await page.getByLabel('后退', { exact: true }).click();
    await expect(page.getByLabel('向 Pi 发送消息')).toHaveValue('保留第一条草稿');
    await page.getByLabel('前进', { exact: true }).click();
    await page.evaluate(() => window.desktop.invoke({ op: 'thread.update', id: 't1', deletedAt: Date.now() }));
    await expect(page.getByLabel('后退', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '待审阅', exact: true }).click();
    await expect(page.getByLabel('前进', { exact: true })).toBeDisabled();
    await page.getByLabel('后退', { exact: true }).click();
    await expect(page.locator('.thread-row.selected')).toContainText('任务2');
  } finally { await page.close(); }
});

test('titlebar menus invoke existing search, panel and local information actions', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url + '?conversation=1');
    await page.getByLabel('编辑菜单').click();
    await page.getByRole('menuitem', { name: '搜索任务', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '搜索命令或最近任务', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await page.getByLabel('编辑菜单').click();
    await page.getByRole('menuitem', { name: '查找当前对话', exact: true }).click();
    await expect(page.getByLabel('当前对话查找', { exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await page.getByLabel('视图菜单').click();
    await page.getByRole('menuitem', { name: '任务摘要', exact: true }).click();
    await expect(page.getByRole('region', { name: '任务摘要', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: '摘要', exact: true })).toHaveCount(0);
    await page.getByLabel('帮助菜单').click();
    await page.getByRole('menuitem', { name: '本地运行信息', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('本地运行');
    await expect(page.getByRole('dialog')).toContainText('C:/temporary/project');
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('帮助菜单')).toBeFocused();
    await page.getByLabel('文件菜单').click();
    await page.getByRole('menuitem', { name: '新建任务', exact: true }).click();
    await expect(page.getByLabel('向 Pi 发送消息')).toHaveValue('');
    await expect(page.locator('.thread-row')).toHaveCount(3);
  } finally { await page.close(); }
});

test.afterAll(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

for (const mode of ['light', 'dark', 'system-light', 'system-dark']) for (const width of [1000, 1280, 1440]) test(mode + ' ' + width + ' adapted conversation controls', async () => {
  const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 940 : 800 }, colorScheme: mode.endsWith('dark') ? 'dark' : 'light' });
  try {
    await page.goto(url + '?conversation=1&theme=' + (mode.startsWith('system') ? 'system' : mode));
    await expect(page.locator('.composer')).toBeVisible();
    await expectAdaptedAppearance(page, mode, ['.composer', '.toolbar']);
    await page.getByLabel('模型与能力', { exact: true }).click();
    await page.getByRole('button', { name: '模型', exact: true }).click();
    const menu = (await page.getByRole('menu').boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(6); expect(menu.y).toBeGreaterThanOrEqual(6);
    expect(menu.y + menu.height).toBeLessThanOrEqual(page.viewportSize()!.height - 6);
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('模型与能力', { exact: true })).toBeFocused();
    await taskAction(page, '查看变更');
    await expect(page.locator('.workspace-tabs')).toBeVisible();
  } finally { await page.close(); }
});

test('glyph-only menu triggers centre their icon inside the control', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(url + '?pinned=1&theme=light');
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(page.locator('.menu-trigger-icon-only').first()).toBeVisible();
    // A glyph-only trigger's label box no longer stretches: the icon owns the control's middle.
    const offsets = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.menu-trigger-icon-only')).flatMap(trigger => {
      const icon = trigger.querySelector<SVGElement>('.menu-trigger-label > svg');
      if (!icon || getComputedStyle(icon).display === 'none') return [];
      const box = trigger.getBoundingClientRect();
      const glyph = icon.getBoundingClientRect();
      return [{
        label: trigger.getAttribute('aria-label') ?? '',
        dx: +(glyph.x + glyph.width / 2 - (box.x + box.width / 2)).toFixed(2),
        dy: +(glyph.y + glyph.height / 2 - (box.y + box.height / 2)).toFixed(2),
      }];
    }));
    // The toolbar's "…" and the composer's "+" are the two glyph triggers on this screen.
    expect(offsets.length).toBeGreaterThanOrEqual(2);
    for (const offset of offsets) {
      expect(Math.abs(offset.dx), offset.label + ' dx').toBeLessThanOrEqual(0.5);
      expect(Math.abs(offset.dy), offset.label + ' dy').toBeLessThanOrEqual(0.5);
    }
    // The dropdown chevron is redundant on a glyph-only trigger and would push the glyph off centre.
    await expect(page.locator('.menu-trigger-icon-only > svg')).toHaveCount(0);
  } finally { await page.close(); }
});

