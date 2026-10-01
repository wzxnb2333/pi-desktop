import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Browser, type Page, chromium, expect, test } from '@playwright/test';

/*
 * The panel chrome, driven in a real browser against the real components.
 *
 * Same isolated harness as primitives.spec.ts: esbuild bundles a small entry, the bundle is served from
 * a temp directory, and plain Chromium renders it - no Electron, no fake provider, no snapshot files.
 * StrictMode is kept because the real entry uses it and the terminal's mount contract (adopt a live
 * xterm, park it on unmount) is exactly what a double mount would break.
 *
 * The terminal assertions need a pty without depending on one: the entry installs a fake
 * `window.desktop` whose store mirrors src/main/terminal.ts - `terminal.close` is the only op that
 * marks a process dead, `terminal.resize` records whatever it is handed, and output only arrives
 * through `__panels.write`. That is what makes hide / close-tab / kill three observable states instead
 * of three names for the same click.
 */

const panelsDir = fileURLToPath(new URL('../../src/renderer/src/components/panels', import.meta.url));
const html =
  '<!doctype html><meta charset="utf-8"><body><div id="root"></div>' +
  '<link rel="stylesheet" href="./harness.css"><script src="./harness.js"></script></body>';

/**
 * Mounts the real panels under the real `AppProvider`, mirroring how components/shell/workspace.tsx
 * decides visibility: the terminal section exists only while `terminalOpen` is true, which is the case
 * that used to throw the xterm away with it.
 */
const harness = `
import { createRoot } from 'react-dom/client';
import { StrictMode, useEffect } from 'react';
import {
  bootstrapSchema,
  defaultData,
  projectSchema,
  threadSchema,
  type DesktopBridge,
  type DesktopData,
  type DesktopEvent,
  type DesktopRequest,
  type TerminalInfo,
} from '../../../../shared/contracts.ts';
import { AppProvider, useApp } from '../../state/app.tsx';
import { applyUiPatch } from '../../../../shared/ui-patches.ts';
import { ReviewPanel } from './review-panel.tsx';
import { usePanelActions } from '../../hooks/use-panel-actions.ts';
import { WorkbenchCommands } from '../shell/commands.tsx';
import '../../styles/index.css';

interface Pty {
  info: TerminalInfo;
  killed: boolean;
}

interface Harness {
  ids(): string[];
  live(id: string): boolean;
  output(id: string): string;
  write(id: string, text: string): void;
  setTheme(mode: 'light' | 'dark'): void;
  setPreview(open: boolean): void;
  showTerminal(): void;
  seedBrowser(): void;
  holdBrowserTab(): void;
  finishBrowserTab(fail?: boolean): void;
  calls(): {
    previewClose: number;
    bounds: number;
    sizes: { cols: number; rows: number }[];
    inputs: string[];
    errors: string[];
  };
}

declare global {
  interface Window {
    desktop: DesktopBridge;
    __panels: Harness;
  }
}

const CRLF = String.fromCharCode(13, 10);
const ptys = new Map<string, Pty>();
const sizes: { cols: number; rows: number }[] = [];
const inputs: string[] = [];
const errors: string[] = [];
let listeners: ((event: DesktopEvent) => void)[] = [];
let previewClose = 0;
let bounds = 0;
let created = 0;
let browserTabPending: Promise<void> | undefined;
let finishBrowserTab: (fail?: boolean) => void = () => {};

const project = projectSchema.parse({ id: 'p1', name: '示例项目', path: 'C:/demo', trusted: true, createdAt: 0 });
const thread = threadSchema.parse({
  id: 't1',
  projectId: 'p1',
  title: '示例任务',
  cwd: 'C:/demo',
  createdAt: 0,
  updatedAt: 0,
  modelId: 'fake',
  thinking: 'off',
  policy: 'ask',
});
const base = defaultData();
let data: DesktopData = {
  ...base,
  projects: [project],
  threads: [thread],
  settings: { ...base.settings, theme: 'light' },
  ui: { ...base.ui, activeThreadId: thread.id, reviewOpen: true },
};

const emit = (event: DesktopEvent): void => listeners.forEach((callback) => callback(event));
const commit = (next: DesktopData): void => {
  data = next;
  emit({ type: 'state', data: next });
};
// Mirrors TerminalService.onData: the session keeps its own tail and every listener gets the chunk,
// whether or not the renderer currently shows a pane for it.
const receive = (id: string, text: string, exited = false): void => {
  const pty = ptys.get(id);
  if (!pty) return;
  pty.info = { ...pty.info, output: pty.info.output + text, exited: pty.info.exited || exited };
  emit({ type: 'terminal', id, threadId: pty.info.threadId, data: text, exited: exited || undefined });
};

window.desktop = {
  invoke: async (request: DesktopRequest): Promise<unknown> => {
    switch (request.op) {
      case 'bootstrap':
        return bootstrapSchema.parse({
          data,
          approvals: [],
          terminals: [...ptys.values()].map((pty) => pty.info),
          version: 'harness',
        });
      case 'ui.update':
        commit({ ...data, ui: applyUiPatch(data.ui, { frame: request.ui }) });
        return data.ui;
      case 'ui.threadPatch':
        commit({ ...data, ui: applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }) });
        return data.ui;
      case 'ui.threadUpdate':
        commit({ ...data, ui: { ...data.ui, threads: { ...data.ui.threads, [request.threadId]: request.thread } } });
        return null;
      case 'terminal.open': {
        created += 1;
        const id = 'pty-' + created;
        const info: TerminalInfo = { id, threadId: request.threadId, title: 'PowerShell', exited: false, output: '' };
        ptys.set(id, { info, killed: false });
        return info;
      }
      case 'terminal.input': {
        const pty = ptys.get(request.id);
        if (!pty || pty.killed) {
          errors.push('input-after-close');
          throw new Error('终端已关闭');
        }
        inputs.push(request.id);
        receive(request.id, request.data);
        return null;
      }
      case 'terminal.resize':
        // shared/contracts.ts clamps this to cols>=2 and rows>=2; a hidden pane must never send one.
        if (request.cols < 2 || request.rows < 2) errors.push('illegal-resize');
        sizes.push({ cols: request.cols, rows: request.rows });
        return null;
      case 'terminal.close': {
        const pty = ptys.get(request.id);
        if (pty) {
          pty.killed = true;
          receive(request.id, CRLF + '[进程已退出：0]' + CRLF, true);
        }
        return null;
      }
      case 'git.status':
        return { branch: 'main', files: [{ path: 'hello.txt', status: 'M', staged: false }], available: true };
      case 'git.inspect':
        return { branches: ['main'], remotes: [], upstream: '', operation: '', commits: [], worktrees: [] };
      case 'browser.downloads':
        return [];
      case 'browser.history':
        return { entries: [], total: 0 };
      case 'browser.tab': {
        await browserTabPending;
        if (request.action !== 'new') throw new Error('Unexpected browser tab action');
        const previous = data.ui.threads[request.threadId];
        const tab = { id: 'new-tab', title: '新标签', url: '' };
        commit({ ...data, ui: applyUiPatch(data.ui, { threadId: request.threadId, thread: { browserTabs: [...(previous?.browserTabs ?? []), tab], activeBrowserTab: tab.id } }) });
        return data.ui;
      }
      case 'git.diff': {
        // lib/diff.ts only builds a file section from a \`diff --git\` line, like GitService.diff().
        // Spelled with fromCharCode: this entry is bundled verbatim, so escape sequences are avoidable.
        const LF = String.fromCharCode(10);
        return (
          [
            'diff --git a/hello.txt b/hello.txt',
            'index 1111111..2222222 100644',
            '--- a/hello.txt',
            '+++ b/hello.txt',
            '@@ -1 +1 @@',
            '-old',
            '+Hello Pi Desktop',
          ].join(LF) + LF
        );
      }
      case 'preview.bounds':
        bounds += 1;
        return null;
      case 'preview.close':
        previewClose += 1;
        return null;
      default:
        return null;
    }
  },
  onEvent: (callback) => {
    listeners.push(callback);
    return () => {
      listeners = listeners.filter((item) => item !== callback);
    };
  },
};

const controls = { preview: (_open: boolean) => {}, terminal: () => {} };

function Frame() {
  const panels = usePanelActions();
  const { thread: active, reviewOpen, setReviewOpen, setReviewTab, setTerminalOpen } = useApp();
  useEffect(() => {
    controls.preview = (open) => { setReviewTab('browser'); setReviewOpen(open); };
    controls.terminal = () => setTerminalOpen(true);
  });
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <WorkbenchCommands panels={panels} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
        </div>
        {reviewOpen && active ? <ReviewPanel width={360} actions={panels} /> : null}
      </div>
    </div>
  );
}

window.__panels = {
  ids: () => [...ptys.keys()],
  live: (id) => {
    const pty = ptys.get(id);
    return !!pty && !pty.killed;
  },
  output: (id) => ptys.get(id)?.info.output ?? '',
  write: (id, text) => receive(id, text),
  setTheme: (mode) => commit({ ...data, settings: { ...data.settings, theme: mode } }),
  setPreview: (open) => controls.preview(open),
  showTerminal: () => controls.terminal(),
  seedBrowser: () => {
    commit({ ...data, ui: applyUiPatch(data.ui, { threadId: thread.id, thread: { browserTabs: [{ id: 'first-tab', title: '第一页', url: 'https://example.invalid/first' }], activeBrowserTab: 'first-tab' } }) });
    controls.preview(true);
  },
  holdBrowserTab: () => { browserTabPending = new Promise<void>((resolve, reject) => { finishBrowserTab = fail => { browserTabPending = undefined; if (fail) reject(new Error('Test tab creation failed')); else resolve(); }; }); },
  finishBrowserTab: fail => finishBrowserTab(fail),
  calls: () => ({ previewClose, bounds, sizes: sizes.slice(), inputs: inputs.slice(), errors: errors.slice() }),
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <Frame />
    </AppProvider>
  </StrictMode>,
);
`;

interface Calls {
  previewClose: number;
  bounds: number;
  sizes: { cols: number; rows: number }[];
  inputs: string[];
  errors: string[];
}

let browser: Browser;
let pageUrl = '';
let activePage: Page;

test.beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-panels-'));
  const bundle = join(dir, 'harness.js');
  await build({
    stdin: { contents: harness, resolveDir: panelsDir, sourcefile: 'panels-harness.tsx', loader: 'tsx' },
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

test.beforeEach(async () => {
  activePage = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await activePage.goto(pageUrl);
  await expect(activePage.locator('.review-pane')).toBeVisible();
});

test.afterEach(async () => {
  await activePage.close();
});

test.afterAll(async () => {
  await browser?.close();
});
test.afterAll(cleanupTemporaryDirectories);

/**
 * The harness bridge, reached as a property of `window` rather than through a helper function:
 * `page.evaluate` serializes its callback into the page, so anything a Node-side closure provided
 * (including a `hp()` wrapper) simply does not exist there.
 */
interface Bridge {
  ids(): string[];
  live(id: string): boolean;
  output(id: string): string;
  write(id: string, text: string): void;
  calls(): Calls;
  setTheme(mode: 'light' | 'dark'): void;
  setPreview(open: boolean): void;
  showTerminal(): void;
  seedBrowser(): void;
  holdBrowserTab(): void;
  finishBrowserTab(fail?: boolean): void;
}

declare global {
  interface Window {
    __panels: Bridge;
  }
}

// The bridge lives on `window` in the bundle above, so each reader spells out the member it needs.
const ids = (): Promise<string[]> => activePage.evaluate(() => window.__panels.ids());
const live = (id: string): Promise<boolean> =>
  activePage.evaluate((target) => window.__panels.live(target), id);
const output = (id: string): Promise<string> =>
  activePage.evaluate((target) => window.__panels.output(target), id);
const write = (id: string, text: string): Promise<void> =>
  activePage.evaluate(
    ([target, chunk]) => window.__panels.write(target, chunk),
    [id, text] as [string, string],
  );
const calls = (): Promise<Calls> => activePage.evaluate(() => window.__panels.calls());
const setTheme = (mode: 'light' | 'dark'): Promise<void> =>
  activePage.evaluate((target) => window.__panels.setTheme(target), mode);
const setPreview = (open: boolean): Promise<void> =>
  activePage.evaluate((target) => window.__panels.setPreview(target), open);
const showTerminal = (): Promise<void> => activePage.evaluate(() => window.__panels.showTerminal());

const heightOf = (selector: string): Promise<number> =>
  activePage.evaluate((target) => document.querySelector(target)!.getBoundingClientRect().height, selector);
const backgroundOf = (selector: string): Promise<string> =>
  activePage.evaluate((target) => getComputedStyle(document.querySelector(target)!).backgroundColor, selector);
const colorOf = (selector: string): Promise<string> =>
  activePage.evaluate((target) => getComputedStyle(document.querySelector(target)!).color, selector);
/** The text of the rows xterm actually paints, so the a11y tree cannot make an assertion pass. */
const visibleText = (): Promise<string> =>
  activePage.evaluate(() => document.querySelector('.terminal-panel .xterm-rows')?.textContent ?? '');
const stdinDisabled = (): Promise<boolean> =>
  activePage.evaluate(
    () => document.querySelector<HTMLTextAreaElement>('.terminal-panel .xterm-helper-textarea')?.readOnly ?? false,
  );

/** Opens one terminal through the panel's own empty state and returns its pty id. */
async function openTerminal(): Promise<string> {
  await showTerminal();
  await activePage.getByRole('button', { name: /在当前项目启动/ }).click();
  await expect(activePage.locator('.terminal-tabs > button').filter({ hasText: 'PowerShell' })).toHaveCount(1);
  const [id] = await ids();
  return id;
}

const CR = String.fromCharCode(13, 10);

test('tool tabs share one strip while terminal and address controls keep compact heights', async () => {
  // The tab-strip chrome now lives in `.panel-strip`, so re-prove the diff path it shares
  // styles/panels.css with still renders (`.diff` is an e2e-required class name).
  await activePage.getByLabel('刷新 Git').click();
  await activePage.getByRole('button', { name: /hello.txt/ }).first().click();
  await expect(activePage.locator('.diff')).toContainText('+Hello Pi Desktop');

  // A structural literal, so it is compared as text (docs/desktop/interfaces.md 已知遗留).
  expect(
    await activePage.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--height-toolbar-pane').trim(),
    ),
  ).toBe('40px');
  await expect(activePage.locator('.workspace-tab-header.panel-strip')).toBeVisible();
  await expect(activePage.locator('.workspace-tabs [role=tab]')).toHaveCount(1);
  await expect(activePage.getByRole('tab', { name: '变更', exact: true })).toBeVisible();
  await expect(activePage.getByRole('tab', { name: '摘要', exact: true })).toHaveCount(0);

  await showTerminal();
  await expect(activePage.locator('.terminal-tabs.panel-strip')).toBeVisible();
  await expect.poll(() => heightOf('.terminal-tabs')).toBe(40);
  await setPreview(true);
  await expect(activePage.locator('.preview-toolbar.panel-strip')).toBeVisible();

  for (const [selector, height] of [['.workspace-tab-header', 46], ['.preview-toolbar', 40]] as const) {
    await expect.poll(() => heightOf(selector), { message: selector }).toBe(height);
  }
  // One vocabulary means the trailing controls are the same component, not three hand-rolled ones.
  expect(await activePage.locator('.panel-strip .icon-button.btn-sm').count()).toBeGreaterThanOrEqual(4);
  // The active tab needs a second channel besides `--selected`, which equals `--hover` in light.
  expect(
    await activePage.evaluate(() =>
      getComputedStyle(document.querySelector('.workspace-tabs .tab-item[data-selected=true]')!).borderTopColor,
    ),
  ).not.toBe('rgba(0, 0, 0, 0)');
});

test('hiding the pane keeps the pty and the xterm, killing does not', async () => {
  const id = await openTerminal();
  const lines = Array.from({ length: 60 }, (_unused, index) => 'LINE_' + String(index).padStart(3, '0'));
  await write(id, lines.join(CR) + CR);
  await expect.poll(visibleText).toContain('LINE_059');
  const beforeHide = await calls();
  expect(beforeHide.sizes.length).toBeGreaterThan(0);

  // Scroll up into the scrollback with the keystroke a user would use - @xterm/xterm 6 scrolls
  // through its own synthetic scrollbar, not through `viewport.scrollTop` - then tag the host element
  // so re-use is provable rather than assumed.
  await activePage.locator('.terminal-panel .xterm-screen').click({ position: { x: 40, y: 20 } });
  await activePage.keyboard.press('Shift+PageUp');
  await activePage.keyboard.press('Shift+PageUp');
  await activePage.evaluate(() => {
    document.querySelector<HTMLElement>('.terminal-panel .terminal-surface')!.dataset.probe = 'kept';
  });
  const scrolledUp = async (): Promise<boolean> => {
    const text = await visibleText();
    return !text.includes('LINE_059') && /LINE_0[0-4]/.test(text);
  };
  await expect.poll(scrolledUp).toBe(true);

  await activePage.getByLabel('隐藏终端').click();
  await expect(activePage.locator('.terminal-panel')).toHaveCount(0);
  await expect.poll(() => live(id)).toBe(true);

  // Output keeps arriving with nothing mounted, and no resize is attempted while the host is parked.
  await write(id, 'AFTER_HIDE' + CR);
  await expect.poll(() => output(id)).toContain('AFTER_HIDE');
  const hidden = await calls();
  // Hiding unmounts the pane, so the real invariant is that nothing resized the pty to a *different*
  // geometry while it was off-screen. xterm's observer may re-assert the same size a few times
  // around the unmount, and call-count equality would only prove the observer stayed quiet.
  const lastSize = beforeHide.sizes.at(-1);
  if (!lastSize) throw new Error('harness recorded no resize before the pane was hidden');
  expect(hidden.sizes.length).toBeGreaterThanOrEqual(beforeHide.sizes.length);
  expect(hidden.sizes.filter((size) => size.cols !== lastSize.cols || size.rows !== lastSize.rows)).toEqual([]);
  expect(hidden.errors).toEqual([]);

  await showTerminal();
  await expect(activePage.locator('.terminal-panel')).toBeVisible();
  // Same DOM node, still parked at the same place in the scrollback: the instance was kept, not
  // rebuilt from the buffer (a rebuild would be sitting at the bottom, on LINE_059).
  await expect(activePage.locator('.terminal-surface[data-probe=kept]')).toBeVisible();
  await expect.poll(scrolledUp).toBe(true);
  // Scrolling back down reaches the line that arrived while nothing was mounted.
  await activePage.locator('.terminal-panel .xterm-screen').click({ position: { x: 40, y: 20 } });
  for (let step = 0; step < 8; step += 1) await activePage.keyboard.press('Shift+PageDown');
  await expect.poll(visibleText).toContain('AFTER_HIDE');
  await expect.poll(visibleText).toContain('LINE_059');
});

test('closing a tab deselects without touching the process', async () => {
  const first = await openTerminal();
  await activePage.getByLabel('新建终端').click();
  await expect(activePage.locator('.terminal-tabs > button').filter({ hasText: 'PowerShell' })).toHaveCount(2);
  const second = (await ids()).find((id) => id !== first);
  if (!second) throw new Error('第二个终端未创建');
  await write(second, 'SECOND_TAB' + CR);
  await expect.poll(visibleText).toContain('SECOND_TAB');

  await activePage.getByLabel('关闭页签').click();
  await expect(activePage.locator('.terminal-tabs button[aria-selected=true]')).toHaveCount(0);
  await expect(activePage.locator('.terminal-panel')).toBeVisible();
  await expect(activePage.locator('.terminal-empty')).toContainText('后台运行');
  // Both tabs announce that they are still running, which is what 终止终端 must not leave true.
  await expect(activePage.locator('.terminal-tabs .tab-state')).toHaveCount(2);
  for (const id of [first, second]) await expect.poll(() => live(id)).toBe(true);

  await activePage.getByRole('button', { name: '显示 PowerShell' }).click();
  await expect(activePage.locator('.terminal-tabs button[aria-selected=true]')).toHaveCount(1);
  await expect.poll(visibleText).toContain('SECOND_TAB');
});

test('终止终端 is the only control that reaches the process', async () => {
  const id = await openTerminal();
  await write(id, 'BEFORE_KILL' + CR);
  await activePage.locator('.terminal-panel .xterm-helper-textarea').fill('echo-first');
  await expect.poll(() => output(id)).toContain('echo-first');

  await activePage.getByLabel('终止终端').click();
  await expect(activePage.locator('.terminal-tabs')).toContainText('已退出');
  await expect.poll(() => live(id)).toBe(false);
  // The pane stays up and its screen stays readable; only the process is gone.
  await expect(activePage.locator('.terminal-panel')).toBeVisible();
  await expect(activePage.locator('.terminal-panel')).toContainText('BEFORE_KILL');
  await expect(activePage.getByLabel('终止终端')).toBeDisabled();
  await expect.poll(stdinDisabled).toBe(true);
  const after = await calls();
  expect(after.inputs.filter((item) => item === id)).toHaveLength(1);
});

test('the terminal preserves the 26.915 dark output surface in both application themes', async () => {
  const id = await openTerminal();
  await write(id, 'THEME_OK' + CR);
  await expect.poll(visibleText).toContain('THEME_OK');
  await expect(activePage.locator('html')).toHaveAttribute('data-theme', 'light');
  // tokens.css light: --bg #fff, --text #1a1c1f.
  await expect.poll(() => backgroundOf('.terminal-panel')).toBe('rgb(255, 255, 255)');
  // xterm 6 paints theme.background on its scrollable element, not on the (now empty) viewport.
  await expect.poll(() => backgroundOf('.terminal-panel .xterm-scrollable-element')).toBe('rgb(24, 24, 24)');
  await expect.poll(() => colorOf('.terminal-panel .xterm-rows')).toBe('rgb(223, 223, 223)');
  await expect(activePage.locator('.terminal-panel .xterm-rows')).toHaveCSS('font-size', '12px');
  await expect(activePage.getByRole('search', { name: '终端查找' })).toBeHidden();
  await activePage.getByRole('button', { name: '终端查找', exact: true }).click();
  await expect(activePage.getByRole('search', { name: '终端查找' }).getByRole('textbox')).toBeFocused();

  await setTheme('dark');
  await expect(activePage.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Codex 26.915 dark palette, read back as used values off live elements
  // (docs/desktop/interfaces.md 已知遗留 forbids comparing custom-property text).
  await expect.poll(() => backgroundOf('.terminal-panel')).toBe('rgb(24, 24, 24)');
  await expect.poll(() => backgroundOf('.terminal-panel .xterm-scrollable-element')).toBe('rgb(24, 24, 24)');
  await expect.poll(() => colorOf('.terminal-panel .xterm-rows')).toBe('rgb(223, 223, 223)');
  await expect.poll(visibleText).toContain('THEME_OK');
});

test('switching tabs keeps each terminal its own screen and its own stdin', async () => {
  const first = await openTerminal();
  await write(first, 'FIRST_TAB' + CR);
  await activePage.getByLabel('新建终端').click();
  const second = (await ids()).find((id) => id !== first);
  if (!second) throw new Error('第二个终端未创建');
  await write(second, 'SECOND_TAB' + CR);
  await expect.poll(visibleText).toContain('SECOND_TAB');
  expect(await visibleText()).not.toContain('FIRST_TAB');
  await activePage.evaluate(() => {
    document
      .querySelectorAll<HTMLElement>('.terminal-surface')
      .forEach((element, index) => (element.dataset.probe = 'p' + index));
  });

  const tabs = activePage.locator('.terminal-tabs > button[role=tab]');
  await tabs.first().click();
  await expect.poll(visibleText).toContain('FIRST_TAB');
  expect(await visibleText()).not.toContain('SECOND_TAB');
  // Two live instances: one on screen, one parked, and neither rebuilt.
  await expect(activePage.locator('.terminal-parking .terminal-surface')).toHaveCount(1);
  await expect(activePage.locator('.terminal-surface[data-probe=p0], .terminal-surface[data-probe=p1]')).toHaveCount(2);

  await tabs.nth(1).click();
  await activePage.locator('.terminal-panel .xterm-helper-textarea').fill('routed');
  await expect.poll(() => output(second)).toContain('routed');
  expect(await output(first)).not.toContain('routed');
});

test('the preview panel releases the native view when it unmounts', async () => {
  await setPreview(true);
  await expect(activePage.locator('.preview-panel')).toBeVisible();
  await expect
    .poll(async () => (await calls()).bounds)
    .toBeGreaterThan(0);
  const bounds = (await calls()).bounds;

  // Resizing the window has to re-sync the WebContentsView bounds, not orphan them.
  await activePage.setViewportSize({ width: 900, height: 700 });
  await expect
    .poll(async () => (await calls()).bounds)
    .toBeGreaterThan(bounds);
  const closed = (await calls()).previewClose;

  await activePage.getByLabel('隐藏浏览器').click();
  await expect(activePage.locator('.preview-panel')).toHaveCount(0);
  await expect
    .poll(async () => (await calls()).previewClose)
    .toBe(closed + 1);
});

test('pending browser tab creation cannot send the next address draft into the previous tab', async () => {
  await activePage.evaluate(() => window.__panels.seedBrowser());
  const address = activePage.getByLabel('预览地址');
  await address.fill('example.invalid/第一份');
  await activePage.evaluate(() => window.__panels.holdBrowserTab());
  await activePage.getByRole('button', { name: '新标签', exact: true }).click();
  await expect(address).toBeDisabled();
  const filling = address.fill('example.invalid/第二份');
  await activePage.evaluate(() => window.__panels.finishBrowserTab());
  await filling;
  await expect(activePage.getByRole('tab', { name: '新标签', exact: true })).toHaveAttribute('aria-selected', 'true');
  await activePage.getByRole('tab', { name: '第一页', exact: true }).click();
  await expect(address).toHaveValue('example.invalid/第一份');
  await activePage.getByRole('tab', { name: '新标签', exact: true }).click();
  await expect(address).toHaveValue('example.invalid/第二份');

  await activePage.evaluate(() => window.__panels.holdBrowserTab());
  await activePage.getByRole('button', { name: '新标签', exact: true }).click();
  await expect(address).toBeDisabled();
  await activePage.evaluate(() => window.__panels.finishBrowserTab(true));
  await expect(address).toBeEnabled();
  await expect(address).toHaveValue('example.invalid/第二份');
});

test('panel commands preserve shell control keys and closing the tool tab leaves its process alive', async () => {
  const id = await openTerminal();
  await activePage.locator('.terminal-panel .xterm-helper-textarea').focus();
  await activePage.keyboard.press('Control+w');
  await expect.poll(() => output(id)).toContain(String.fromCharCode(23));
  await expect(activePage.locator('.workspace-tabs').getByRole('tab', { name: '终端', exact: true })).toHaveAttribute('aria-selected', 'true');
  await activePage.locator('.workspace-tabs').getByRole('tab', { name: '终端', exact: true }).focus();
  await activePage.keyboard.press('Control+w');
  await expect(activePage.locator('.workspace-tabs').getByRole('tab', { name: '终端', exact: true })).toHaveCount(0);
  await expect(activePage.locator('.workspace-tabs [role=tab][aria-selected=true]')).toBeFocused();
  expect(await live(id)).toBe(true);
});

test('failed browser close retains the tab and its address draft and releases the pending controls', async () => {
  test.setTimeout(30000);
  await activePage.evaluate(() => window.__panels.seedBrowser());
  const address = activePage.getByLabel('预览地址');
  await address.fill('example.invalid/未提交');
  await activePage.evaluate(() => window.__panels.holdBrowserTab());
  await activePage.getByRole('tab', { name: '第一页', exact: true }).hover();
  await activePage.getByRole('button', { name: '关闭 第一页', exact: true }).click();
  await expect(address).toBeDisabled();
  await activePage.evaluate(() => window.__panels.finishBrowserTab(true));
  await expect(address).toBeEnabled();
  await expect(address).toHaveValue('example.invalid/未提交');
  await expect(activePage.getByRole('tab', { name: '第一页', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(activePage.getByRole('button', { name: '新标签', exact: true })).toBeEnabled();
});
