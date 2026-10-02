import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { defaultData, modelProviderSchema, providerModelSchema, threadSchema, timelineSchema } from '../../src/shared/contracts.ts';

/**
 * The size x theme matrix the spec asks for, plus the geometry literals that a pixel baseline
 * cannot prove. Every screenshot is taken against seeded data with fixed timestamps, so no test
 * needs a live provider and no clock patching is required.
 */
const SIZES: [number, number][] = [
  [1440, 940],
  [1280, 800],
];
const THEMES = ['light', 'dark'] as const;

// Structural literals read straight from the reference (docs/desktop/design-tokens.md §1).
const GEOMETRY = { sidebar: 275, navRow: 30, review: 390, composerRadius: 22 };

test.afterAll(cleanupTemporaryDirectories);

let storage: string;
let projectPath: string;
let seeded: string;

test.beforeAll(async () => {
  storage = await mkdtemp(join(tmpdir(), 'pi-desktop-visual-'));
  projectPath = join(storage, 'demo-project');
  await mkdir(projectPath);
  execFileSync('git', ['init', '-b', 'main', projectPath]);
  execFileSync('git', ['-C', projectPath, 'config', 'core.autocrlf', 'false']);
  execFileSync('git', ['-C', projectPath, 'config', 'user.name', 'Visual Fixture']);
  execFileSync('git', ['-C', projectPath, 'config', 'user.email', 'fixture@example.invalid']);
  await writeFile(join(projectPath, 'README.md'), '# 示例项目\n');
  execFileSync('git', ['-C', projectPath, 'add', '--', 'README.md']);
  execFileSync('git', ['-C', projectPath, 'commit', '-m', 'initial']);
  // One tracked edit plus one untracked file, so the review panel shows both diff shapes.
  await writeFile(join(projectPath, 'README.md'), '# 示例项目\n\n新增一行说明。\n');
  await writeFile(join(projectPath, 'hello.txt'), 'Hello Pi Desktop\n');

  const base = defaultData();
  base.projects.push({
    id: 'project',
    name: '示例项目',
    path: projectPath,
    trusted: false,
    createdAt: 1_700_000_000_000,
  });
  base.settings.modelProviders.push(
    modelProviderSchema.parse({
      id: 'fake-provider',
      name: 'Local Test',
      kind: 'custom',
      namespace: 'desktop-fake-provider',
      baseUrl: 'http://127.0.0.1:9/v1',
    }),
  );
  base.settings.models.push(
    providerModelSchema.parse({
      id: 'fake',
      provider: 'fake-provider',
      name: 'Local Test',
      model: 'fake-model',
      reasoning: true,
    }),
  );
  base.settings.modelId = 'fake';
  base.settings.keepInTray = false;
  const at = (offset: number) => 1_700_000_000_000 + offset;
  const item = (part: Parameters<typeof timelineSchema.parse>[0]) => timelineSchema.parse(part);
  base.threads.push(
    threadSchema.parse({
      id: 'thread',
      title: '整理示例项目文档',
      projectId: 'project',
      cwd: projectPath,
      createdAt: at(0),
      updatedAt: at(9000),
      modelId: 'fake',
      thinking: 'medium',
      policy: 'ask',
      plan: [
        { text: '阅读 README', status: 'completed' },
        { text: '补充安装步骤', status: 'in_progress' },
      ],
      artifacts: ['README.md'],
      sources: ['https://example.invalid/docs'],
      items: [
        item({ id: 'user-1', role: 'user', text: '请阅读 README，并补充安装步骤。', timestamp: at(0) }),
        item({
          id: 'assistant-1',
          role: 'assistant',
          text: '我先看一下项目结构。',
          thinking: '需要确认 README 的现有章节层级。',
          timestamp: at(1200),
        }),
        item({
          id: 'tool-1',
          role: 'tool',
          toolName: 'read',
          args: '{"path":"README.md"}',
          text: '# 示例项目',
          state: 'done',
          timestamp: at(2400),
        }),
        item({
          id: 'notice-1',
          role: 'notice',
          text: '上下文已压缩。',
          timestamp: at(3600),
        }),
        item({
          id: 'user-2',
          role: 'user',
          text: '再加一个 hello 示例。',
          timestamp: at(4800),
        }),
        item({
          id: 'tool-2',
          role: 'tool',
          toolName: 'powershell',
          args: '{"command":"Set-Content hello.txt"}',
          text: 'DESKTOP_COMMAND_OK',
          state: 'done',
          timestamp: at(5600),
        }),
        item({
          id: 'assistant-2',
          role: 'assistant',
          text: '已完成。\n\n- README 增加了安装步骤\n- 新建了 `hello.txt`\n- 右侧 Review 可以看到两处差异',
          timestamp: at(7200),
        }),
      ],
    }),
  );
  // Layout is seeded too, so the matrix is not accidentally testing the defaults of a fresh store.
  base.ui.sidebarWidth = GEOMETRY.sidebar;
  base.ui.reviewWidth = GEOMETRY.review;
  base.ui.activeThreadId = 'thread';
  base.ui.threads.thread = { reviewTab: 'changes', terminalOpen: false, selectedPath: '', folds: {} };
  seeded = JSON.stringify(base);
});

async function open(
  theme: string,
  width: number,
  height: number,
  reseed = true,
): Promise<{ page: Page; app: ElectronApplication; close(): Promise<void> }> {
  // Reseeding overwrites desktop.json, so a caller that wants to observe persistence must pass
  // `reseed: false` on the second launch or it only ever re-tests the seed.
  if (reseed) {
    await writeFile(join(storage, 'desktop.json'), seeded.replace('"theme":"system"', `"theme":"${theme}"`));
  }
  const env = { ...process.env, PI_DESKTOP_USER_DATA: storage } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.PI_DESKTOP_EXECUTABLE
      ? { executablePath: process.env.PI_DESKTOP_EXECUTABLE, args: [`--user-data-dir=${storage}`] }
      : { args: [resolve('out/main/index.js')] }),
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  // Content size, not window size: the frame is `frame: false`, so content == CSS viewport.
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(w, h);
      window.setPosition(0, 0);
    },
    [width, height],
  );
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
  await expect(page.getByLabel('向 Pi 发送消息')).toBeVisible();
  const close = async () => app.close();
  return { page, app, close };
}

const box = (page: Page, selector: string) => page.locator(selector).first().boundingBox();

for (const [width, height] of SIZES) {
  for (const theme of THEMES) {
    test(`workbench ${width}x${height} ${theme}`, async () => {
      const { page, close } = await open(theme, width, height);
      try {
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        // Forced explicitly rather than via OS preference, so the run is reproducible.
        await expect(page).toHaveScreenshot(`visual-${width}x${height}-${theme}.png`, {
          mask: [page.locator('.statusbar')],
          maxDiffPixelRatio: 0.003,
        });
      } finally {
        await close();
      }
    });
  }
}

test('geometry literals hold at both window sizes', async () => {
  for (const [width, height] of SIZES) {
    const { page, close } = await open('light', width, height);
    try {
      expect(await page.evaluate(() => document.querySelector<HTMLElement>('.sidebar')!.getBoundingClientRect().width)).toBe(
        GEOMETRY.sidebar,
      );
      expect(await page.evaluate(() => document.querySelector<HTMLElement>('.thread-row button')!.getBoundingClientRect().height)).toBe(
        GEOMETRY.navRow,
      );
      expect(await page.evaluate(() => document.querySelector<HTMLElement>('.review-pane')!.getBoundingClientRect().width)).toBe(
        GEOMETRY.review,
      );
      expect(
        await page.evaluate(() => getComputedStyle(document.querySelector<HTMLElement>('.composer')!).borderRadius),
      ).toBe(`${GEOMETRY.composerRadius}px`);
      // No viewport-clamp assertion here on purpose: `min(520, vw-320)` only binds below an 840px
      // viewport, and the window has minWidth 1000, so the term is inert in the app. The clamp math
      // itself is covered against narrow viewports in test/layout.test.ts.
    } finally {
      await close();
    }
  }
});

test('the timeline groups one answer per user request, not per item', async () => {
  const { page, close } = await open('light', 1440, 940);
  try {
    // Two user turns seeded, so each answer renders once - one turn section per request, not per item.
    await expect(page.locator('.turn')).toHaveCount(2);
    await expect(page.locator('.turn-body')).toHaveCount(2);
    // Each run collapses behind one process block, so the timeline shows a single one per turn.
    await expect(page.locator('.turn-body > .disclosure-process')).toHaveCount(2);
    await expect(page.locator('.notice')).toHaveCount(1);
    // thread.plan is thread-level, so the timeline shows it only on the live turn. This seeded
    // thread is idle, so the honest assertion is absence - and the data must still surface in the
    // review panel's plan tab, which the next block proves.
    await expect(page.locator('.turn-plan')).toHaveCount(0);
    await page.getByRole('tab', { name: '计划' }).click();
    await expect(page.locator('.plan-list > div')).toHaveCount(2);
  } finally {
    await close();
  }
});

test('the review panel parses hunks with independent old and new numbers', async () => {
  const { page, close } = await open('light', 1440, 940);
  try {
    await page.getByLabel('刷新 Git').click();
    await page.getByRole('button', { name: /README\.md/ }).first().click();
    await expect(page.locator('.diff')).toContainText('新增一行说明');
    const numbers = await page.locator('.diff .line-number').allTextContents();
    expect(numbers.length).toBeGreaterThan(0);
    // A modified file must show a real old-side number, never the blob-wide index the old code printed.
    expect(numbers).toContain('1');
    await page.getByRole('button', { name: /hello\.txt/ }).first().click();
    await expect(page.locator('.diff')).toContainText('+Hello Pi Desktop');
  } finally {
    await close();
  }
});

test('layout written by ui.update survives a restart', async () => {
  const first = await open('light', 1440, 940);
  try {
    await first.page.getByLabel('切换 Review 面板').click();
    await first.page.getByLabel('切换侧栏').click();
    await expect(first.page.locator('.review-pane')).toHaveCount(0);
    await expect(first.page.locator('.sidebar')).toHaveCount(0);
  } finally {
    await first.close();
  }
  const second = await open('light', 1440, 940, false);
  try {
    // Both flags came back through the store, which only happens if ui.update wrote them.
    await expect(second.page.locator('.review-pane')).toHaveCount(0);
    await expect(second.page.locator('.sidebar')).toHaveCount(0);
  } finally {
    await second.close();
  }
});
