import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Browser, type Page, chromium, expect, test } from '@playwright/test';

/*
 * The sidebar, measured in a real browser against the real component and the real stylesheets.
 *
 * Like `primitives.spec.ts`, this launches plain Chromium instead of Electron: the app-level spec owns
 * the built workbench and its screenshot baselines, and nothing below needs either. The harness bundles
 * `Sidebar` with the real `AppProvider` behind a scripted `DesktopBridge`, so every interaction travels
 * through the same request shapes the main process sees.
 *
 * The sheets are read from disk and inlined rather than copied, so a metric drifting in `tokens.css` or
 * `shell.css` fails here instead of quietly diverging.
 */
const specDir = dirname(fileURLToPath(import.meta.url));
const sheetDir = join(specDir, '../../src/renderer/src/styles');
const sheets = ['tokens.css', 'codex-26915-theme.css', 'base.css', 'utilities.css', 'shell.css', 'sidebar.css'];

const harness = `
import { createRoot } from 'react-dom/client';
import {
  type DesktopBridge,
  type DesktopData,
  defaultData,
  projectSchema,
  threadSchema,
} from '../../src/shared/contracts.ts';
import { AppProvider } from '../../src/renderer/src/state/app.tsx';
import { Sidebar } from '../../src/renderer/src/components/sidebar/sidebar.tsx';

const initial = defaultData();
initial.settings.theme = 'light';
initial.projects = [
  projectSchema.parse({ id: 'alpha', name: '示例项目', path: 'C:/work/alpha', trusted: true, createdAt: 1 }),
  projectSchema.parse({ id: 'beta', name: '另一个项目', path: 'C:/work/beta', trusted: true, createdAt: 1 }),
];
const task = (id, projectId, title, updatedAt, extra) =>
  threadSchema.parse({
    id,
    projectId,
    title,
    cwd: 'C:/work/' + projectId,
    createdAt: 1,
    updatedAt,
    modelId: 'fake',
    thinking: 'off',
    policy: 'ask',
    ...extra,
  });
initial.threads = [
  task('a1', 'alpha', '第一条任务', 100),
  task('a2', 'alpha', '第二条任务', 300, { status: 'running', worktreeBranch: 'worktree/a2' }),
  task('a3', 'alpha', '第三条标题很长是为了检查省略号是否稳定出现', 200),
  task('a4', 'alpha', '已归档的旧任务', 50, { archived: true }),
  task('b1', 'beta', '另一个项目里的任务', 250),
];
initial.ui = { ...initial.ui, activeThreadId: 'a2' };

let data = initial;
const listeners = [];
const echo = () => listeners.forEach((send) => send({ type: 'state', data }));
let created = 0;

const bridge = {
  async invoke(request) {
    if (request.op === 'bootstrap') return { data, approvals: [], terminals: [], version: 'harness' };
    if (request.op === 'ui.update') {
      data = { ...data, ui: request.ui };
      echo();
      return undefined;
    }
    if (request.op === 'thread.update') {
      data = {
        ...data,
        threads: data.threads.map((item) =>
          item.id === request.id
            ? { ...item, archived: request.archived ?? item.archived, pinned: request.pinned ?? item.pinned }
            : item,
        ),
      };
      echo();
      return undefined;
    }
    if (request.op === 'thread.purge') {
      data = { ...data, threads: data.threads.filter((item) => item.id !== request.id) };
      echo();
      return undefined;
    }
    if (request.op === 'thread.create') {
      created += 1;
      const thread = task('new' + created, request.projectId, '新建任务 ' + created, Date.now());
      data = { ...data, threads: [thread, ...data.threads] };
      echo();
      return thread;
    }
    if (request.op === 'project.add') {
      created += 1;
      const next = projectSchema.parse({
        id: 'project' + created,
        name: '新项目 ' + created,
        path: 'C:/work/new',
        trusted: false,
        createdAt: 1,
      });
      data = { ...data, projects: [...data.projects, next] };
      echo();
      return next;
    }
    throw new Error('unexpected op ' + request.op);
  },
  onEvent(callback) {
    listeners.push(callback);
    return () => {
      const index = listeners.indexOf(callback);
      if (index >= 0) listeners.splice(index, 1);
    };
  },
};

globalThis.desktop = bridge;

const width = Number(new URLSearchParams(window.location.search).get('width') || 275);

createRoot(document.getElementById('root')).render(
  <AppProvider>
    <div className="desktop">
      <div className="workspace">
        <Sidebar width={width} />
      </div>
    </div>
  </AppProvider>,
);
`;

let browser: Browser;
let pageUrl = '';
let activePage: Page;

/** Computed style of the first match, in the CSS spelling so no cast is needed. */
async function cssOf(selector: string, property: string): Promise<string> {
  const value = await activePage
    .locator(selector)
    .first()
    .evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
  return value.trim();
}

async function openSidebar(width = 275): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${pageUrl}?width=${width}`);
  await page.locator('.thread-row').first().waitFor();
  return page;
}

test.beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-sidebar-'));
  const bundle = join(dir, 'harness.js');
  await build({
    stdin: { contents: harness, loader: 'tsx', resolveDir: specDir },
    outfile: bundle,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  const css = await Promise.all(sheets.map((name) => readFile(join(sheetDir, name), 'utf8')));
  await writeFile(
    join(dir, 'index.html'),
    `<!doctype html><meta charset="utf-8"><style>${css.join('\n')}</style>` +
      `<body><div id="root"></div><script src="./harness.js"></script>`,
  );
  browser = await chromium.launch();
  pageUrl = pathToFileURL(join(dir, 'index.html')).href;
});

test.afterEach(async () => {
  await activePage?.close();
});

test.afterAll(async () => {
  await browser?.close();
});
test.afterAll(cleanupTemporaryDirectories);

const rows = () => activePage.locator('.thread-row');
const titles = () => activePage.locator('.thread-row .thread-main .truncate');

test('rows carry the pinned Satang metrics: 30px high, 12.5px corner, 14px visible text', async () => {
  activePage = await openSidebar();
  // clamp(240, 275, min(520, 100vw - 320)) at a 1440px viewport is the persisted default, 275.
  const width = await activePage.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBe(275);
  for (const selector of ['button.nav-row', '.project-row', '.thread-row'])
    expect(await cssOf(selector, 'height')).toBe('30px');
  expect(await cssOf('.thread-row', 'border-radius')).toBe('12.5px');
  expect(await cssOf('.thread-main', 'font-size')).toBe('14px');
  expect(await cssOf('.thread-main', 'line-height')).toBe('21px');
  // The 32px icon column aligns both project and task text at x=40.
  expect(await cssOf('.project-row', 'padding-inline-start')).toBe('0px');
  expect(await cssOf('.thread-row', 'padding-inline-start')).toBe('32px');
});

test('the pane width follows the inline size instead of a CSS clamp', async () => {
  activePage = await openSidebar(320);
  const width = await activePage.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBe(320);
});

test('selected and active rows use the captured fill without a synthetic outline', async () => {
  activePage = await openSidebar();
  const selected = activePage.locator('.thread-row.selected');
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveCSS('background-color', 'rgba(26, 28, 31, 0.055)');
  await expect(selected).toHaveCSS('box-shadow', 'none');
  await expect(selected.locator('.thread-main')).toHaveCSS('font-weight', '430');
  await rows().nth(2).hover();
  await expect(rows().nth(2)).toHaveCSS('box-shadow', 'none');
  await activePage.getByRole('button', { name: /自动化/ }).click();
  const activeNav = activePage.locator('button.nav-row.active');
  await expect(activeNav).toHaveAttribute('aria-current', 'page');
  await expect(activeNav).toHaveCSS('background-color', 'rgba(26, 28, 31, 0.055)');
  await expect(activeNav).toHaveCSS('box-shadow', 'none');
});

test('row actions wait for the row, and stay reachable from the keyboard', async () => {
  activePage = await openSidebar();
  const action = rows().nth(1).getByLabel('归档此任务');
  expect(await action.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await rows().nth(1).hover();
  expect(await action.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  // Hover reveals pin and archive only: the context menu stays right-click's job, so its trigger is
  // inert and invisible while the row or its own actions are hovered or focused.
  const menu = rows().nth(1).locator('[data-thread-menu]');
  expect(await menu.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  expect(await menu.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  await rows().nth(1).getByLabel('置顶此任务').focus();
  expect(await menu.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await menu.locator('button').focus();
  expect(await menu.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  expect(await menu.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');

  // Focus reveals it too, and it never leaves the accessibility tree or the tab order.
  const other = rows().nth(2).getByLabel('归档此任务');
  await other.focus();
  expect(await other.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  expect(await other.evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');
  expect(await other.evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
});

test('pinning a shortcut row collects it under 置顶 and takes it out of 最近任务', async () => {
  activePage = await openSidebar();
  await expect(activePage.locator('.sidebar-pinned')).toHaveCount(0);
  const recent = activePage.locator('.shortcut-row').filter({ has: activePage.getByLabel('最近任务：第二条任务') });
  await recent.hover();
  await recent.getByLabel('置顶此任务').click();
  const pinned = activePage.locator('.sidebar-pinned');
  await expect(pinned.locator('.recent-thread')).toHaveCount(1);
  await expect(pinned.locator('.recent-thread')).toHaveAttribute('title', '第二条任务');
  // A pinned task is a shortcut, not a duplicate: recents drop it, the project list keeps it.
  await expect(activePage.locator('.sidebar-recents .recent-thread')).toHaveCount(3);
  expect((await titles().allTextContents()).map((text) => text.trim())).toContain('第二条任务');
  await pinned.locator('.shortcut-row').hover();
  await pinned.getByLabel('取消置顶').click();
  await expect(activePage.locator('.sidebar-pinned')).toHaveCount(0);
  await expect(activePage.locator('.sidebar-recents .recent-thread')).toHaveCount(4);
});

test('tasks sort newest-first under their own project', async () => {
  activePage = await openSidebar();
  expect(await activePage.locator('.project-row .truncate').allTextContents()).toEqual(['示例项目', '另一个项目']);
  expect((await titles().allTextContents()).map((text) => text.trim())).toEqual([
    '第二条任务',
    '第三条标题很长是为了检查省略号是否稳定出现',
    '第一条任务',
    '另一个项目里的任务',
  ]);
  // `a2` is the active task, and its running status plus worktree branch both show.
  expect(await rows().nth(0).locator('.thread-dot.running').count()).toBe(1);
  expect(await rows().nth(0).locator('.thread-main svg').count()).toBe(1);
  expect(await rows().nth(1).locator('.thread-main svg').count()).toBe(0);
});

test('unread and running tasks share one right-aligned indicator without duplicate dots', async () => {
  activePage = await openSidebar(240);
  for (const selector of ['.recent-thread', '.thread-row']) {
    const taskRows = activePage.locator(selector);
    for (const row of await taskRows.all()) {
      const indicator = row.locator('.thread-dot, .unread-marker');
      await expect(indicator).toHaveCount(1, { timeout: 2000 });
      await expect(indicator).toHaveCSS('background-color', 'rgb(52, 133, 228)');
      const before = await indicator.boundingBox(), bounds = await row.boundingBox();
      expect(bounds!.x + bounds!.width - before!.x - before!.width).toBeCloseTo(8, 0);
      // Hovering may scroll the harness scroller, so compare the dot's offset from the row, not page x.
      await row.hover();
      const moved = await indicator.boundingBox(), rowNow = (await row.boundingBox())!;
      expect(rowNow.x + rowNow.width - moved!.x - moved!.width).toBeCloseTo(8, 0);
      // Both row kinds hand the right edge to their actions, so the dot fades instead of crowding them.
      await expect(indicator).toHaveCSS('opacity', '0');
      if (selector === '.thread-row') {
        // The hidden context-menu trigger shares the archive's slot, one step in from the row's edge.
        const menu = await row.locator('[data-thread-menu]').boundingBox();
        expect(bounds!.x + bounds!.width - menu!.x - menu!.width).toBeCloseTo(8, 0);
        const archive = await row.getByLabel('归档此任务').boundingBox();
        expect(bounds!.x + bounds!.width - archive!.x - archive!.width).toBeCloseTo(8, 0);
        const pin = await row.getByLabel('置顶此任务').boundingBox();
        expect(bounds!.x + bounds!.width - pin!.x - pin!.width).toBeCloseTo(34, 0);
      }
    }
  }
  await expect(activePage.locator('.recent-thread').first().getByRole('img')).toHaveAttribute('aria-label', /未读/);
});

test('project chats precede recents and duplicate creation and search entries stay hidden', async () => {
  activePage = await openSidebar();
  const projects = await activePage.getByRole('region', { name: '项目聊天', exact: true }).boundingBox();
  const recents = await activePage.locator('.sidebar-recents').boundingBox();
  // The project collection leads; recents stay below it as the shortcut back to recent work.
  expect(recents!.y).toBeGreaterThan(projects!.y + projects!.height);
  await expect(activePage.locator('.primary-nav .nav-row')).toHaveCount(3);
  await expect(activePage.locator('.sidebar-search-toggle, .sidebar-search, .sidebar-chat-kind')).toHaveCount(0);
  await expect(activePage.getByRole('button', { name: '新建聊天', exact: true })).toHaveCount(1);
  await expect(rows()).toHaveCount(4);
  await activePage.getByRole('button', { name: '最近任务', exact: true }).click();
  await expect(activePage.locator('.recent-thread')).toHaveCount(0);
  await expect(rows()).toHaveCount(4);
});

test('hover and keyboard focus reveal quick chat and row actions without shifting labels', async () => {
  activePage = await openSidebar(240);
  const row = activePage.locator('.sidebar-new-task'), label = row.locator('.new-thread-label');
  const quick = row.getByRole('button', { name: '快捷聊天', exact: true });
  const initial = await label.boundingBox(), quickBox = await quick.boundingBox();
  await expect(quick).toHaveCSS('opacity', '0');
  await row.hover();
  await expect(quick).toHaveCSS('opacity', '1');
  expect(await label.boundingBox()).toEqual(initial); expect(await quick.boundingBox()).toEqual(quickBox);
  await activePage.mouse.move(600, 300); await expect(quick).toHaveCSS('opacity', '0');
  await quick.focus(); await expect(quick).toHaveCSS('opacity', '1');
  await expect(activePage.getByRole('tooltip')).toContainText('Ctrl+Alt+Space');
  expect(await label.boundingBox()).toEqual(initial);
  await activePage.keyboard.press('Escape'); await expect(activePage.getByRole('tooltip')).toHaveCount(0);
  const title = titles().nth(1), titleBox = await title.boundingBox();
  await rows().nth(1).hover(); expect(await title.boundingBox()).toEqual(titleBox);
  await rows().nth(1).locator('[data-thread-menu] button').focus(); expect(await title.boundingBox()).toEqual(titleBox);
});

test('archiving and restoring round-trips through thread.update', async () => {
  activePage = await openSidebar();
  const row = rows().nth(1);
  await row.hover();
  // The Review panel resolves `归档任务` with `getByLabel`; the sidebar's own label must not extend
  // that name, because the match is a substring match.
  expect(await activePage.getByLabel('归档任务').count()).toBe(0);
  expect(await row.getByLabel('归档此任务').count()).toBe(1);
  await row.getByLabel('归档此任务').click();
  await expect(rows()).toHaveCount(3);
  await activePage.getByLabel('本地工作区操作').click();
  await activePage.getByRole('menuitem', { name: /已归档任务/ }).click();
  expect((await titles().allTextContents()).map((text) => text.trim())).toEqual([
    '第三条标题很长是为了检查省略号是否稳定出现',
    '已归档的旧任务',
  ]);
  await rows().nth(0).hover();
  await rows().nth(0).getByLabel('恢复此任务').click();
  await expect(rows()).toHaveCount(1);
  await activePage.getByLabel('本地工作区操作').click();
  await activePage.getByRole('menuitem', { name: /查看活跃任务/ }).click();
  await expect(rows()).toHaveCount(4);
});

test('no sidebar label lands on a name another surface resolves', async () => {
  activePage = await openSidebar();
  // `getByLabel` is a substring match, so these must not appear inside any sidebar control's label.
  for (const name of ['归档任务', '恢复任务', '添加模型', '新建任务', '发送消息'])
    expect(await activePage.getByLabel(name).count()).toBe(0);
  // The row action instead carries one shared, specific label for every listed task: the project rows
  // and both shortcut lists render the same component.
  expect(await activePage.getByLabel('归档此任务').count())
    .toBe(await activePage.locator('.thread-row, .shortcut-row').count());
  expect(await activePage.getByLabel('新建 示例项目 的任务').count()).toBe(1);
});

test('a project collapses without touching its neighbours', async () => {
  activePage = await openSidebar();
  const first = activePage.locator('.project-row').first();
  await first.getByLabel('折叠 示例项目').click();
  expect((await titles().allTextContents()).map((text) => text.trim())).toEqual(['另一个项目里的任务']);
  expect(await first.getByLabel('展开 示例项目').count()).toBe(1);
  await first.getByLabel('展开 示例项目').click();
  await expect(rows()).toHaveCount(4);
});

test('recent tasks share live selection and project filtering while the footer stays reachable', async () => {
  activePage = await openSidebar();
  await expect(activePage.locator('.recent-thread')).toHaveCount(4);
  await activePage.getByLabel('折叠 示例项目').click();
  await activePage.getByRole('button', { name: '最近任务：第一条任务', exact: true }).click();
  await expect(activePage.locator('.recent-thread.selected')).toHaveAttribute('title', '第一条任务');
  await activePage.getByLabel('项目筛选').click();
  await activePage.locator('.menu-item[data-value="beta"]').click();
  await expect(activePage.locator('.recent-thread')).toHaveCount(1);
  await expect(activePage.locator('.project-row')).toHaveCount(1);
  await activePage.setViewportSize({ width: 1000, height: 360 });
  await activePage.getByLabel('本地工作区操作').click();
  await activePage.getByRole('menuitem', { name: /已归档任务/ }).click();
  await expect(activePage.locator('.sidebar-recents')).toHaveCount(0);
  await expect(activePage.locator('.sidebar-project-chats > .section-label')).toContainText('已归档');
  await activePage.getByLabel('本地工作区操作').click();
  await activePage.getByRole('menuitem', { name: '查看活跃任务', exact: true }).click();
  await expect(activePage.locator('.sidebar-project-chats > .section-label')).toContainText('项目聊天');
  await activePage.getByLabel('本地运行信息', { exact: true }).click();
  await expect(activePage.getByRole('dialog')).toContainText('Pi 0.86.1');
  await activePage.keyboard.press('Escape');
  await expect(activePage.getByLabel('本地运行信息', { exact: true })).toBeFocused();
});
