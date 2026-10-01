import { taskAction } from './fixtures/task-actions.ts';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Goal } from '../../src/shared/goals.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });
async function goal() { return (await fixture.snapshot()).data.threads.find(item => item.id === 't')!.goal!; }
async function create(start = true) { return await fixture.invoke({ op: 'goal.save', threadId: 't', start, definition: { objective: 'Verify a complete local workflow', criteria: [{ id: crypto.randomUUID(), text: 'Verify the final result' }] } }) as Goal; }
async function control(action: 'pause' | 'resume' | 'clear') { const g = await goal(); return fixture.invoke({ op: 'goal.control', threadId: 't', goalId: g.id, revision: g.revision, action }); }

test('feature dialogs share compact typography and usable scrolling across themes, languages and desktop sizes', async () => {
  await fixture.invoke({ op: 'settings.patch', patch: { subtasksEnabled: true } });
  const scenes = [
    { trigger: '设置持续目标', selector: '.goal-panel' },
    { trigger: '管理可选子任务', selector: '.subtask-panel' },
    { trigger: '项目动作', selector: '.project-actions-editor' },
    { trigger: '项目目录', selector: '.project-directory-manager' },
    { trigger: 'Worktree 管理', selector: '.worktree-manager' },
  ];
  for (const scene of scenes) {
    await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'zh-CN' } });
    if (scene.trigger === '项目动作') await fixture.page.getByRole('button', { name: scene.trigger, exact: true }).click();
    else await taskAction(fixture.page, scene.trigger);
    if (scene.trigger === '项目动作') await fixture.page.getByRole('menuitem', { name: '配置环境与动作', exact: true }).click();
    const dialog = fixture.page.locator('.dialog-panel'), panel = dialog.locator(scene.selector);
    await expect(panel).toBeVisible();
    await expect(fixture.page.locator('.command-palette')).toHaveCount(0);
    for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'] as const) for (const size of [[1440, 940], [1000, 700], [1280, 800]]) {
      await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale } });
      await fixture.invoke({ op: 'settings.patch', patch: { theme } });
      await fixture.app.evaluate(({ BrowserWindow }, dimensions) => BrowserWindow.getAllWindows()[0].setContentSize(dimensions[0], dimensions[1]), size);
      await expect(fixture.page.locator('html')).toHaveAttribute('lang', locale);
      await expect(fixture.page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(panel).toHaveCSS('font-size', '13px');
      await expect(panel.locator('.hint').first()).toHaveCSS('font-size', '12px');
      await expect(panel.locator('.hint').first()).not.toHaveCSS('color', await panel.evaluate(node => getComputedStyle(node).color));
      await expect.poll(() => dialog.evaluate(node => {
        const box = node.getBoundingClientRect();
        return box.top >= 31 && box.bottom <= innerHeight - 31 && box.left >= 15 && box.right <= innerWidth - 15 && node.scrollWidth <= node.clientWidth + 1;
      })).toBe(true);
      const controls = await panel.locator('input, select, textarea, button').evaluateAll(nodes => nodes.map(node => ({
        tag: node.tagName, font: parseFloat(getComputedStyle(node).fontSize),
        icon: node.querySelector('svg')?.getBoundingClientRect().width ?? 0,
      })));
      expect(controls.every(control => control.font <= 14 && control.icon <= 16)).toBe(true);
      if (scene.trigger === '设置持续目标' || scene.trigger === '管理可选子任务') {
        await expect(panel.locator('header h2').first()).toHaveCSS('font-size', '15px');
        const close = panel.locator('header button').first();
        await expect(close).toHaveCSS('width', '28px');
        await expect(close).toHaveCSS('height', '28px');
      }
      if (process.env.PI_OVERLAY_EVIDENCE === '1' && scene.trigger === '设置持续目标' &&
        (locale === 'zh-CN' && theme === 'light' && size[0] === 1440 || locale === 'en-US' && theme === 'dark' && size[0] === 1000)) {
        const output = join(process.cwd(), '../../.artifacts/overlay-scale');
        await mkdir(output, { recursive: true });
        await fixture.page.screenshot({ path: join(output, `goal-${theme}-${locale}-${size[0]}.png`), animations: 'disabled' });
      }
    }
    // The end of each form must actually be reachable, not just inside the horizontal viewport.
    await panel.getByRole('button').last().scrollIntoViewIfNeeded();
    await expect(panel.getByRole('button').last()).toBeInViewport();
    await fixture.page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  expect(fixture.calls).toHaveLength(0);
});

test('long goal forms stay reachable and nested discard keeps the draft and focus', async () => {
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700));
  await taskAction(fixture.page, '设置持续目标');
  const panel = fixture.page.locator('.goal-panel');
  await panel.getByLabel('目标说明', { exact: true }).fill('保留目标草稿');
  for (let index = 0; index < 12; index++) await panel.getByRole('button', { name: '添加验收条件', exact: true }).click();
  await panel.getByLabel('验收条件 13', { exact: true }).fill('滚动到底部仍可编辑');
  await panel.getByRole('button', { name: '保存为暂停', exact: true }).scrollIntoViewIfNeeded();
  await expect(panel.getByRole('button', { name: '保存为暂停', exact: true })).toBeInViewport();
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  const confirm = fixture.page.getByRole('dialog', { name: '放弃未保存的目标修改？', exact: true });
  await expect(confirm.locator('.dialog-description')).toHaveCSS('font-size', '14px');
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(panel.getByLabel('目标说明', { exact: true })).toHaveValue('保留目标草稿');
  await expect(panel.getByLabel('验收条件 13', { exact: true })).toHaveValue('滚动到底部仍可编辑');
  await expect(panel.getByRole('button', { name: '关闭', exact: true })).toBeFocused();
  await fixture.page.keyboard.press('Escape');
  await confirm.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(fixture.page.getByRole('dialog')).toHaveCount(0);
  await expect(fixture.page.locator('.toolbar .task-actions-trigger')).toBeFocused();
});

test('goal UI persists bilingual edits and completes through real worker tools after a successful turn', async () => {
  await fixture.page.getByLabel('向 Pi 发送消息').fill('保留输入草稿');
  await taskAction(fixture.page, '设置持续目标');
  const panel = fixture.page.locator('.goal-panel'); await panel.getByLabel('目标说明', { exact: true }).fill('完成本地验收'); await panel.getByLabel('验收条件 1', { exact: true }).fill('结果经过验证');
  const staleUi = (await fixture.snapshot()).data.ui;
  await fixture.invoke({ op: 'ui.update', ui: { ...staleUi, locale: 'en-US' } });
  await fixture.invoke({ op: 'ui.update', ui: { ...staleUi, sidebarWidth: 260 }, frame: { sidebarWidth: 260 } });
  expect((await fixture.snapshot()).data.ui.locale).toBe('en-US');
  for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'] as const) for (const size of [[1440, 940], [1000, 700], [1280, 800]]) {
    const snapshot = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...snapshot.data.ui, locale } }); await fixture.invoke({ op: 'settings.patch', patch: { theme } }); await fixture.app.evaluate(({ BrowserWindow }, dimensions) => BrowserWindow.getAllWindows()[0].setContentSize(dimensions[0], dimensions[1]), size);
    await expect.poll(() => panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
  }
  await expect(fixture.page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(panel.getByLabel('Objective', { exact: true })).toHaveValue('完成本地验收');
  await panel.getByRole('button', { name: 'Save as paused', exact: true }).click(); await expect.poll(async () => (await goal()).status).toBe('paused');
  await panel.getByRole('button', { name: 'Close', exact: true }).click(); await fixture.restart(); expect((await goal()).objective).toBe('完成本地验收');
  await expect(fixture.page.getByRole('textbox', { name: 'Message Pi', exact: true })).toHaveValue('保留输入草稿');
  fixture.setMode('hold'); fixture.requestTool('get_goal', {}); await control('resume');
  await expect.poll(() => fixture.calls.length).toBe(2); expect(fixture.calls[0].tools?.map(item => item.function.name)).toContain('update_goal');
  const g = await goal(); expect(g.pendingRunId).toBeTruthy();
  fixture.releaseTool('update_goal', { goalId: g.id, revision: g.revision, summary: 'Verified in the actual worker', status: 'completed', checks: g.criteria.map(item => ({ id: item.id, completed: true, evidence: 'Actual worker round-trip verified' })) });
  await expect.poll(async () => (await goal()).completionRequested).toBe(true); expect((await goal()).status).toBe('active');
  fixture.release(); await expect.poll(async () => (await goal()).status).toBe('completed');
  expect((await goal()).rounds).toBe(1); expect((await goal()).history[0].status).toBe('succeeded');
  await fixture.restart(); expect((await goal()).status).toBe('completed'); expect((await goal()).criteria[0].evidence).toBe('Actual worker round-trip verified');
  const count = fixture.calls.length; await taskAction(fixture.page, 'View persistent goal'); await fixture.page.locator('.goal-panel').getByRole('button', { name: 'Clear goal', exact: true }).click();
  await fixture.page.getByRole('dialog', { name: 'Clear persistent goal?', exact: true }).getByRole('button', { name: 'Clear goal', exact: true }).click(); await expect.poll(() => goal()).toBeUndefined(); expect(fixture.calls.length).toBe(count);
});

test('pause, stop, closing and restart preserve state without duplicate continuation or permission bypass', async () => {
  fixture.setMode('hold'); await create(); await expect.poll(() => fixture.calls.length).toBe(1);
  await control('pause'); expect((await fixture.snapshot()).data.threads[0].status).toBe('running'); fixture.release();
  await expect.poll(async () => (await goal()).pendingRunId).toBeUndefined(); expect((await goal()).status).toBe('paused'); expect(fixture.calls.length).toBe(1);
  fixture.setMode('hold'); await control('resume'); await expect.poll(() => fixture.calls.length).toBe(2);
  await fixture.invoke({ op: 'thread.stop', id: 't' }); await expect.poll(async () => (await goal()).pendingRunId).toBeUndefined(); expect((await goal()).status).toBe('paused');
  await control('resume'); await expect.poll(() => fixture.calls.length).toBe(3); await fixture.restart();
  expect((await goal()).status).toBe('blocked'); expect((await goal()).pendingRunId).toBeUndefined(); expect((await goal()).history.at(-1)?.status).toBe('interrupted'); expect(fixture.calls.length).toBe(3);
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'ask' }); fixture.requestTool('write', { path: 'goal-approval.txt', content: 'only if approved' });
  await control('resume'); await expect.poll(async () => (await fixture.snapshot()).approvals.length).toBe(1); expect((await fixture.snapshot()).data.threads[0].status).toBe('waiting');
  await expect(access(join(fixture.project, 'goal-approval.txt'))).rejects.toThrow();
  await fixture.invoke({ op: 'thread.stop', id: 't' }); await expect.poll(async () => (await goal()).pendingRunId).toBeUndefined(); expect((await goal()).status).toBe('paused');
  await expect(access(join(fixture.project, 'goal-approval.txt'))).rejects.toThrow();
  const persisted = JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')); expect(persisted.threads[0].goal.status).toBe('paused');
});

test('real provider errors and no-progress rounds stop; user can edit and clear without altering plans', async () => {
  fixture.setMode('fail'); await create(); await expect.poll(async () => (await goal()).status, { timeout: 30000 }).toBe('blocked');
  expect((await goal()).consecutiveFailures).toBe(3); expect(fixture.calls.length).toBe(3);
  fixture.setMode('reply'); await control('resume'); await expect.poll(async () => (await goal()).noProgress, { timeout: 30000 }).toBe(3);
  expect((await goal()).status).toBe('blocked'); expect(fixture.calls.length).toBe(6); expect((await fixture.snapshot()).data.threads[0].plan).toEqual([]);
  const g = await goal(); await fixture.invoke({ op: 'goal.save', threadId: 't', expectedId: g.id, expectedRevision: g.revision, start: false, definition: { objective: '拆分后目标', criteria: g.criteria.map(item => ({ id: item.id, text: '先验证一个小步骤' })) } });
  await fixture.restart(); expect((await goal()).status).toBe('paused'); expect((await goal()).history).toHaveLength(6); await control('clear'); await fixture.restart(); expect(await goal()).toBeUndefined();
});

test('goal disk failures preserve the editor, committed state and clear confirmation across retry and restart', async () => {
  const saved = await create(false), blocked = join(fixture.storage, 'desktop.json.tmp');
  await taskAction(fixture.page, '查看持续目标'); const panel = fixture.page.locator('.goal-panel');
  await panel.getByRole('button', { name: '修改目标', exact: true }).click(); await panel.getByLabel('目标说明', { exact: true }).fill('Recovered goal edit');
  await mkdir(blocked);
  try {
    await panel.getByRole('button', { name: '保存为暂停', exact: true }).click(); await expect(panel.getByRole('alert')).toContainText(/EISDIR|EPERM|EACCES/);
    await expect(panel.getByLabel('目标说明', { exact: true })).toHaveValue('Recovered goal edit'); expect((await goal()).objective).toBe(saved.objective); expect(fixture.calls.length).toBe(0);
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark' } });
  expect(JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')).threads[0].goal.objective).toBe(saved.objective);
  await panel.getByRole('button', { name: '保存为暂停', exact: true }).click(); await expect.poll(async () => (await goal()).objective).toBe('Recovered goal edit');
  await panel.getByRole('button', { name: '清除目标', exact: true }).click(); const confirm = fixture.page.getByRole('dialog', { name: '清除持续目标？', exact: true }); await mkdir(blocked);
  try {
    await confirm.getByRole('button', { name: '清除目标', exact: true }).click(); await expect(confirm.getByRole('alert')).toContainText(/EISDIR|EPERM|EACCES/); expect((await goal()).objective).toBe('Recovered goal edit');
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await confirm.getByRole('button', { name: '清除目标', exact: true }).click(); await expect.poll(() => goal()).toBeUndefined(); await fixture.restart(); expect(await goal()).toBeUndefined(); expect(fixture.calls.length).toBe(0);
});

test('goal completion storage failure releases the task and resumes only after an explicit retry', async () => {
  fixture.setMode('hold'); await create(); await expect.poll(() => fixture.calls.length).toBe(1);
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try {
    fixture.release(); await expect.poll(async () => (await goal()).status).toBe('blocked');
    expect((await goal()).pendingRunId).toBeUndefined(); expect((await goal()).history.at(-1)?.status).toBe('interrupted'); expect(fixture.calls.length).toBe(1);
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark' } }); await fixture.restart();
  expect((await goal()).status).toBe('blocked'); expect((await goal()).pendingRunId).toBeUndefined(); expect(fixture.calls.length).toBe(1);
  fixture.setMode('hold'); await taskAction(fixture.page, '查看持续目标'); await fixture.page.locator('.goal-panel').getByRole('button', { name: '恢复目标', exact: true }).click(); await expect.poll(() => fixture.calls.length).toBe(2);
  const g = await goal(); fixture.releaseTool('update_goal', { goalId: g.id, revision: g.revision, summary: 'Verified after storage recovery', status: 'completed', checks: g.criteria.map(item => ({ id: item.id, completed: true, evidence: 'Completed through real worker after explicit resume' })) });
  await expect.poll(async () => (await goal()).completionRequested).toBe(true); fixture.release(); await expect.poll(async () => (await goal()).status).toBe('completed');
  await fixture.restart(); expect((await goal()).status).toBe('completed'); expect((await goal()).history).toHaveLength(2);
});

test('archived goal rounds finish their history without continuing or reserving a restored task', async () => {
  fixture.setMode('hold'); await create(); await expect.poll(() => fixture.calls.length).toBe(1);
  await fixture.invoke({ op: 'thread.update', id: 't', archived: true }); expect((await goal()).status).toBe('paused');
  fixture.release(); await expect.poll(async () => (await goal()).pendingRunId).toBeUndefined(); expect((await goal()).history.at(-1)?.status).toBe('succeeded');
  await fixture.invoke({ op: 'thread.update', id: 't', archived: false }); await fixture.restart();
  expect((await goal()).status).toBe('paused'); expect((await goal()).pendingRunId).toBeUndefined(); expect(fixture.calls.length).toBe(1);
});

test('goal pause storage failure cannot prevent the user from stopping the running worker', async () => {
  fixture.setMode('hold'); await create(); await expect.poll(() => fixture.calls.length).toBe(1);
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'thread.stop', id: 't' })).rejects.toThrow();
    await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
    await expect.poll(async () => (await goal()).pendingRunId).toBeUndefined(); expect((await goal()).status).toBe('paused');
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark' } }); await fixture.restart();
  expect((await goal()).status).toBe('paused'); expect((await goal()).pendingRunId).toBeUndefined(); expect(fixture.calls.length).toBe(1);
});
