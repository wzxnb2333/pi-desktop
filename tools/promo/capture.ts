/*
 * Capture real Pi Desktop UI at 2x for the promo video.
 *
 * A port of apps/desktop/test/e2e/visual.spec.ts: same seeded profile (temp git
 * repo, fixed timestamps, dead fake provider) so the UI renders fully populated
 * with no live model. Differences from the spec, and why:
 *   - --force-device-scale-factor=2 gives 2880x1880 real pixels from a 1440x940
 *     window, which is what lets the camera push in without going soft.
 *   - It is a plain script, not a spec, so it stays out of testDir.
 *
 * Two profiles are needed because the home screen only exists with no active
 * thread: seeding one and then screenshotting gives the chat, not the hero.
 *
 *   node --import tsx tools/promo/capture.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { dataSchema, defaultData, modelProviderSchema, providerModelSchema, threadSchema, timelineSchema } from '../../apps/desktop/src/shared/contracts.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const SHOTS = join(ROOT, '.artifacts/promo/shots');
const VIEWPORT = { width: 1440, height: 940 };
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

/** Layout the spec asserts on, so shots match the validated geometry. */
const GEOMETRY = { sidebar: 275, review: 390 };

type Seeded = { storage: string; projectPath: string };

/** Shared fixture scaffolding: a real git repo with one edit and one untracked file. */
async function makeProject(projectPath: string) {
  await mkdir(projectPath);
  execFileSync('git', ['init', '-b', 'main', projectPath]);
  execFileSync('git', ['-C', projectPath, 'config', 'core.autocrlf', 'false']);
  execFileSync('git', ['-C', projectPath, 'config', 'user.name', 'Promo Fixture']);
  execFileSync('git', ['-C', projectPath, 'config', 'user.email', 'promo@example.invalid']);
  await writeFile(join(projectPath, 'README.md'), '# 示例项目\n\n一个用于演示的本地项目。\n');
  execFileSync('git', ['-C', projectPath, 'add', '--', 'README.md']);
  execFileSync('git', ['-C', projectPath, 'commit', '-m', 'initial']);
  // A tracked edit plus an untracked file, so Review shows both diff shapes.
  await writeFile(
    join(projectPath, 'README.md'),
    '# 示例项目\n\n一个用于演示的本地项目。\n\n## 安装\n\n```bash\nnpm install\nnpm run dev\n```\n',
  );
  await writeFile(join(projectPath, 'hello.txt'), 'Hello Pi Desktop\n');
}

/** Everything both seeds share: project, dead provider, model, theme. */
function baseData(projectPath: string) {
  const base = defaultData();
  base.projects.push({ id: 'project', name: '示例项目', path: projectPath, trusted: false, createdAt: 1_700_000_000_000 });
  base.settings.modelProviders.push(
    modelProviderSchema.parse({
      id: 'fake-provider',
      name: 'Local Test',
      kind: 'custom',
      namespace: 'desktop-fake-provider',
      baseUrl: 'http://127.0.0.1:9/v1', // deliberately dead: nothing may call a model
    }),
  );
  base.settings.models.push(
    providerModelSchema.parse({ id: 'fake', provider: 'fake-provider', name: 'Local Test', model: 'fake-model', reasoning: true }),
  );
  base.settings.modelId = 'fake';
  base.settings.keepInTray = false;
  return base;
}

/**
 * Home screen seed: a project but no thread, which is the state `Welcome`
 * renders. `Welcome` creates an empty thread on mount, so no transcript exists.
 */
async function seedHome(theme: Theme): Promise<Seeded> {
  const storage = await mkdtemp(join(tmpdir(), 'promo-home-'));
  const projectPath = join(storage, 'demo-project');
  await makeProject(projectPath);
  const base = baseData(projectPath);
  base.settings.theme = theme;
  base.ui.sidebarWidth = GEOMETRY.sidebar;
  await writeFile(join(storage, 'desktop.json'), JSON.stringify(dataSchema.parse(base)));
  return { storage, projectPath };
}

/** Workbench seed: one populated thread plus filler rows for sidebar depth. */
async function seedWorkbench(theme: Theme): Promise<Seeded> {
  const storage = await mkdtemp(join(tmpdir(), 'promo-workbench-'));
  const projectPath = join(storage, 'demo-project');
  await makeProject(projectPath);
  const base = baseData(projectPath);

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
        item({ id: 'assistant-1', role: 'assistant', text: '我先看一下项目结构。', thinking: '需要确认 README 的现有章节层级。', timestamp: at(1200) }),
        item({ id: 'tool-1', role: 'tool', toolName: 'read', args: '{"path":"README.md"}', text: '# 示例项目', state: 'done', timestamp: at(2400) }),
        item({ id: 'notice-1', role: 'notice', text: '上下文已压缩。', timestamp: at(3600) }),
        item({ id: 'user-2', role: 'user', text: '再加一个 hello 示例。', timestamp: at(4800) }),
        item({ id: 'tool-2', role: 'tool', toolName: 'powershell', args: '{"command":"Set-Content hello.txt"}', text: 'DESKTOP_COMMAND_OK', state: 'done', timestamp: at(5600) }),
        item({
          id: 'assistant-2',
          role: 'assistant',
          text: '已完成。\n\n- README 增加了安装步骤\n- 新建了 `hello.txt`\n- 右侧 Review 可以看到两处差异',
          timestamp: at(7200),
        }),
      ],
    }),
  );

  // Stamped earlier than the transcript: the app activates the most recently
  // updated thread, and the populated one must be the one on screen.
  const extras = ['重构日志模块', '修复终端闪烁', '整理模型配置', '补充端到端测试', '设计插件加载流程', '排查内存占用'];
  extras.forEach((title, index) => {
    const stamp = at(-60_000 - index * 1000);
    base.threads.push(
      threadSchema.parse({
        id: `thread-${index + 2}`,
        title,
        projectId: 'project',
        cwd: projectPath,
        createdAt: stamp,
        updatedAt: stamp,
        modelId: 'fake',
        thinking: 'medium',
        policy: 'ask',
        items: [item({ id: `u-${index}`, role: 'user', text: title, timestamp: stamp })],
      }),
    );
  });

  base.ui.sidebarWidth = GEOMETRY.sidebar;
  base.ui.reviewWidth = GEOMETRY.review;
  base.ui.activeThreadId = 'thread';
  base.ui.threads.thread = { reviewTab: 'changes', terminalOpen: false, selectedPath: '', folds: {} };
  base.settings.theme = theme;
  await writeFile(join(storage, 'desktop.json'), JSON.stringify(dataSchema.parse(base)));
  return { storage, projectPath };
}

async function launch(storage: string) {
  const env = { ...process.env, PI_DESKTOP_USER_DATA: storage } as Record<string, string>;
  // Without this Electron boots as plain Node and dies on its first import.
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [resolve(ROOT, 'apps/desktop/out/main/index.js'), '--force-device-scale-factor=2'],
    env,
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(w, h);
      window.setPosition(0, 0);
    },
    [VIEWPORT.width, VIEWPORT.height],
  );
  await settle(page);
  return { app, page };
}

/** Wait for layout and paint to stop moving before shooting. */
async function settle(page: Page, ms = 350) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));
}

async function shoot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: 'disabled' });
  console.log(`[capture] ${name}.png`);
}

/** Press a chord such as "Control+j". */
async function chord(page: Page, keys: string[]) {
  for (const key of keys) await page.keyboard.down(key);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
  await settle(page);
}

/**
 * Screenshot every surface for one theme. Each entry is a name plus the state it
 * needs; they run in order on one app instance per theme.
 */
async function captureTheme(theme: Theme) {
  console.log(`[capture] === ${theme} ===`);

  // --- home screen: needs its own thread-less profile ---
  {
    const { storage } = await seedHome(theme);
    const { app, page } = await launch(storage);
    try {
      await shoot(page, `welcome-${theme}`);
    } finally {
      await app.close();
      await rm(storage, { recursive: true, force: true }).catch(() => {});
    }
  }

  // --- everything else: the populated workbench, walked in order ---
  {
    const { storage } = await seedWorkbench(theme);
    const { app, page } = await launch(storage);
    try {
      await shoot(page, `workbench-${theme}`);

      // Expanded read tool card: the process block is collapsed by default.
      const process = page.locator('.disclosure-process, .turn-body > details, button:has-text("处理过程")').first();
      if (await process.count()) {
        await process.click().catch(() => {});
        await shoot(page, `tool-expanded-${theme}`);
      }

      // Review pane: real diff of the edited README.
      const changesTab = page.getByRole('tab', { name: '改动' });
      if (await changesTab.count()) {
        await changesTab.click().catch(() => {});
        await settle(page);
        const file = page.getByRole('button', { name: /README\.md/ }).first();
        if (await file.count()) { await file.click().catch(() => {}); await shoot(page, `diff-${theme}`); }
      }

      // Plan tab: the seeded two-step plan.
      const planTab = page.getByRole('tab', { name: '计划' });
      if (await planTab.count()) {
        await planTab.click().catch(() => {});
        await shoot(page, `plan-${theme}`);
      }

      // Integrated terminal.
      await chord(page, ['Control', 'j']);
      await shoot(page, `terminal-${theme}`);
      await chord(page, ['Control', 'j']);

      // Command palette.
      await chord(page, ['Control', 'Shift', 'p']);
      await shoot(page, `palette-${theme}`);
      await page.keyboard.press('Escape');
      await settle(page);

      // Settings, via its shortcut so no sidebar label lookup is needed.
      await chord(page, ['Control', ',']);
      await shoot(page, `settings-${theme}`);
      await page.keyboard.press('Escape');
      await settle(page);

      // Populated sidebar for the parallax layer: hide the review pane.
      const toggleReview = page.getByLabel('切换 Review 面板');
      if (await toggleReview.count()) {
        await toggleReview.click().catch(() => {});
        await shoot(page, `sidebar-${theme}`);
      }
    } finally {
      await app.close();
      await rm(storage, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  for (const theme of THEMES) {
    if (only.length && !only.includes(theme)) continue;
    await captureTheme(theme);
  }
  console.log(`[capture] wrote ${SHOTS}`);
}

main().catch((error) => {
  console.error(`[capture] FAILED: ${error.message}`);
  process.exitCode = 1;
});
