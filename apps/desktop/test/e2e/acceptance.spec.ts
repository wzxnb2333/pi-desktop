import { taskAction } from './fixtures/task-actions.ts';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { BrowserWindow } from 'electron';
import { appearanceSchema, mcpSchema, type Bootstrap, type Thread } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async ({}, info) => {
  const authorizeExternalTools = /Skills create|MCP settings test|extension confirmation/.test(info.title);
  fixture = await acceptanceApp(development.url, { authorizeExternalTools });
});
test.afterEach(async () => {
  if (fixture) {
    const errors = [...fixture.errors];
    await fixture.close();
    await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(errors).toEqual([]);
  }
});
test('fixture cleanup removes temporary user data after restart and is safe to repeat', async () => {
  const marker = join(fixture.storage, 'cleanup-marker.txt');
  await writeFile(marker, 'kept for restart');
  await fixture.restart();
  expect(await readFile(marker, 'utf8')).toBe('kept for restart');
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'cleanup while streaming', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await fixture.close();
  await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fetch(fixture.url)).rejects.toThrow();
  await fixture.close();
});

test('initial launch failures release the local server and temporary user data', async () => {
  const launch = electron.launch;
  let storage = '';
  let serverUrl = '';
  electron.launch = async options => {
    storage = options?.env?.PI_DESKTOP_USER_DATA ?? '';
    const data = JSON.parse(await readFile(join(storage, 'desktop.json'), 'utf8'));
    serverUrl = data.settings.modelProviders[0].baseUrl;
    throw new Error('fixture launch failed');
  };
  try {
    await expect(acceptanceApp(development.url)).rejects.toThrow('fixture launch failed');
  } finally { electron.launch = launch; }
  expect(storage).not.toBe('');
  await expect(access(storage)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fetch(serverUrl)).rejects.toThrow();
});
async function idle(id = 't') {
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find((thread) => thread.id === id)?.status).toBe('idle');
}
async function send(text: string) {
  const before = fixture.calls.length;
  await fixture.invoke({ op: 'thread.send', id: 't', text, attachments: [] });
  await expect.poll(async () => ({
    dispatched: fixture.calls.length > before,
    thread: (await fixture.snapshot()).data.threads.find(item => item.id === 't')?.error,
  })).toMatchObject({ dispatched: true });
  await idle();
}

test('theme files import into the draft, export without secrets and survive a real restart', async () => {
  const imported = join(fixture.storage, 'theme-import.json');
  const exported = join(fixture.storage, 'theme-export.json');
  const appearance = appearanceSchema.parse({ theme: 'dark', uiFontFamily: 'Segoe UI', codeFontFamily: 'Consolas', fontSize: 16, codeFontSize: 18, accentColor: '#6699cc', backgroundColor: '#202428', foregroundColor: '#eeeeee' });
  await writeFile(imported, JSON.stringify({ version: 1, appearance }));
  await fixture.app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.imported] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.exported });
  }, { imported, exported });
  const page = fixture.page;
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '导入主题', exact: true }).click();
  await expect(page.locator('#settings-code-font-size')).toHaveValue('18');
  expect((await fixture.snapshot()).data.settings.codeFontSize).toBe(12);
  await page.getByRole('button', { name: '导出主题', exact: true }).click();
  await expect.poll(async () => JSON.parse(await readFile(exported, 'utf8'))).toEqual({ version: 1, appearance });
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.locator('.settings-footer [role=status]')).toHaveText('设置已保存');
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(238, 238, 238)');
  await fixture.restart();
  await expect(fixture.page.locator('body')).toHaveCSS('color', 'rgb(238, 238, 238)');
  expect((await fixture.snapshot()).data.settings).toMatchObject(appearance);
  await writeFile(imported, JSON.stringify({ version: 1, appearance: { ...appearance, backgroundColor: 'url(https://invalid)' } }));
  await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, imported);
  await expect(fixture.invoke({ op: 'theme.import' })).rejects.toThrow(/主题格式无效/);
  expect((await fixture.snapshot()).data.settings).toMatchObject(appearance);
});

test('runtime preferences apply during streaming and native sleep prevention releases for approval and completion', async () => {
  await fixture.app.evaluate(({ powerSaveBlocker }) => {
    const state = globalThis as typeof globalThis & { preferenceBlockers: number[] };
    state.preferenceBlockers = [];
    const start = powerSaveBlocker.start.bind(powerSaveBlocker);
    powerSaveBlocker.start = type => { const id = start(type); state.preferenceBlockers.push(id); return id; };
  });
  const blockers = () => fixture.app.evaluate(({ powerSaveBlocker }) => (globalThis as typeof globalThis & { preferenceBlockers: number[] }).preferenceBlockers.map(id => powerSaveBlocker.isStarted(id)));
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '保持运行', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await fixture.page.keyboard.press('Control+,');
  await fixture.page.getByRole('button', { name: '通用', exact: true }).click();
  await fixture.page.locator('#settings-prevent-sleep').check();
  await fixture.page.locator('#settings-notifications').uncheck();
  await fixture.page.locator('#settings-follow-up').selectOption('steer');
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.locator('.settings-footer [role=status]')).toHaveText('设置已保存');
  await expect.poll(blockers).toEqual([true]);
  expect((await fixture.snapshot()).data.threads[0].status).toBe('running');
  fixture.release();
  await idle();
  await expect.poll(blockers).toEqual([false]);
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'ask' });
  fixture.requestTool('write', { path: 'sleep-test.txt', content: 'fixture' });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '审批等待', attachments: [] });
  await expect.poll(async () => (await fixture.snapshot()).approvals.length).toBe(1);
  await expect.poll(blockers).toEqual([false, false]);
  const approval = (await fixture.snapshot()).approvals[0];
  await fixture.invoke({ op: 'approval.reply', id: approval.id, approved: false });
  await idle();
  await expect.poll(async () => (await blockers()).every(active => !active)).toBe(true);
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings).toMatchObject({ preventSleep: true, notifications: false, followUpMode: 'steer' });
});

test('Skills create, import, disable, re-enable and remove through the real desktop', async () => {
  const page = fixture.page;
  await page.getByRole('button', { name: 'Skills 与扩展', exact: true }).click();
  await page.getByRole('button', { name: '创建 Skill', exact: true }).click();
  await page.getByLabel(/^名称/).fill('验收流程');
  await page.locator('#skill-content').fill('---\nname: acceptance-skill\ndescription: Acceptance workflow\n---\n\nACCEPTANCE_SKILL_TOKEN');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已创建 验收流程');
  const created = (await fixture.snapshot()).data.settings.resources[0];
  expect(await readFile(created.path, 'utf8')).toContain('ACCEPTANCE_SKILL_TOKEN');
  await send('/skill:acceptance-skill');
  expect(JSON.stringify(fixture.calls.at(-1)?.messages)).toContain('ACCEPTANCE_SKILL_TOKEN');
  await page.getByLabel('启用 验收流程').click();
  await expect(page.getByLabel('启用 验收流程')).not.toBeChecked();
  await expect.poll(async () => (await fixture.snapshot()).data.settings.resources[0].enabled).toBe(false);
  await page.getByLabel('启用 验收流程').click();
  await expect(page.getByLabel('启用 验收流程')).toBeChecked();
  const extension = join(fixture.project, 'acceptance-extension.mjs');
  await writeFile(extension, 'export default function (pi) { pi.on("session_start", (_event, ctx) => { for (let i = 0; i < 100; i++) ctx.ui.notify("acceptance-notice-" + i); }); }');
  await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, extension);
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '导入 Pi 扩展' }).click();
  await expect(page.getByRole('status')).toContainText('已导入 acceptance-extension.mjs');
  await send('验证扩展通知');
  const notices = (await fixture.snapshot()).data.threads[0].items.filter((item) => item.text.startsWith('acceptance-notice-'));
  expect(notices).toHaveLength(100);
  expect(new Set(notices.map((item) => item.id)).size).toBe(100);
  await fixture.restart();
  expect((await fixture.snapshot()).data.threads[0].items.filter((item) => item.text.startsWith('acceptance-notice-'))).toHaveLength(100);
  await fixture.page.getByLabel('移除 acceptance-extension.mjs').click();
  await fixture.page.getByLabel('移除 验收流程').click();
  await expect.poll(async () => (await fixture.snapshot()).data.settings.resources.length).toBe(0);
});

test('MCP settings test stdio transport, encrypt secrets and preserve controls after restart', async () => {
  const page = fixture.page;
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('验收 MCP');
  await page.getByLabel(/^命令/).fill(process.execPath);
  await page.getByLabel(/^参数/).fill(resolve('test/fixtures/mcp-server.mjs'));
  await page.getByLabel(/^加密环境变量/).fill('{"ACCEPTANCE_TOKEN":"local-test-secret"}');
  await page.getByRole('checkbox', { name: '启用 只在信任项目中连接', exact: true }).check();
  await page.getByRole('button', { name: '保存并测试' }).click();
  await expect(page.getByRole('status')).toContainText('连接成功');
  expect(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')).not.toContain('local-test-secret');
  await send('列出可用工具');
  expect(fixture.calls.at(-1)?.tools?.some((tool) => tool.function.name.startsWith('mcp_'))).toBe(true);
  await fixture.restart();
  await fixture.page.getByRole('button', { name: 'MCP', exact: true }).click();
  await expect(fixture.page.getByLabel('名称', { exact: true })).toHaveValue('验收 MCP');
  await expect(fixture.page.getByRole('checkbox', { name: '启用 只在信任项目中连接', exact: true })).toBeChecked();
  await fixture.page.getByRole('button', { name: '删除', exact: true }).click();
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.settings.mcpServers.length).toBe(0);
});

test('saving settings and credentials preserves an active worker and reloads them on the next run', async () => {
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '等待验收', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  const settings = (await fixture.snapshot()).data.settings;
  const pid = () => fixture.app.evaluate(({ app }) => app.getAppMetrics().find(item => item.type === 'Utility' && item.name === 'Pi Agent')?.pid);
  const activePid = await pid();
  await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark', followUpMode: 'steer' }, base: { theme: settings.theme, followUpMode: settings.followUpMode } });
  await fixture.invoke({ op: 'settings.patch', patch: { models: settings.models.map(model => ({ ...model, model: 'next-model' })) } });
  await fixture.invoke({ op: 'resource.create', name: '运行期间创建', content: '---\nname: running-save\ndescription: settings regression\n---\nAPPLIES_NEXT_RUN' });
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [mcpSchema.parse({ id: 'test', name: '已配置的测试服务', transport: 'stdio', command: process.execPath, enabled: false })] } });
  await fixture.invoke({ op: 'mcp.secret', id: 'test', value: { TOKEN: 'new' } });
  await fixture.invoke({ op: 'provider.key', id: 'local-provider', key: 'next-key' });
  expect(await pid()).toBe(activePid);
  expect((await fixture.snapshot()).data.threads[0].status).toBe('running');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '当前运行的引导', attachments: [], queue: 'steer' });
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].queue?.map(item => item.kind)).toEqual(['steer']);
  fixture.release();
  await expect.poll(() => fixture.calls.length).toBe(2);
  await idle();
  expect(fixture.calls.map(call => call.model)).toEqual(['acceptance', 'acceptance']);
  expect(fixture.authorizations).not.toContain('Bearer next-key');
  await send('使用更新后的配置');
  expect(await pid()).not.toBe(activePid);
  expect(fixture.calls.at(-1)?.model).toBe('next-model');
  expect(fixture.authorizations.at(-1)).toBe('Bearer next-key');
  expect((await fixture.snapshot()).data.settings.resources).toHaveLength(1);
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings).toMatchObject({ theme: 'dark', followUpMode: 'steer' });
  expect(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')).not.toContain('next-key');
});

test('automation UI creates, pauses, resumes, runs, reviews and removes a job', async () => {
  const page = fixture.page;
  await page.getByRole('button', { name: '自动化', exact: true }).click();
  await page.getByRole('button', { name: '新建自动化', exact: true }).click();
  await page.getByLabel(/^名称/).fill('验收自动化');
  await page.getByLabel(/^任务描述/).fill('自动化验收');
  await page.getByRole('button', { name: '创建自动化' }).click();
  await expect(page.getByRole('status')).toContainText('已创建 验收自动化');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.automations[0].enabled).toBe(false);
  await page.getByRole('button', { name: '启用', exact: true }).click();
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.automations[0].lastThreadId).toBeTruthy();
  const id = (await fixture.snapshot()).data.automations[0].lastThreadId!;
  await idle(id);
  await page.getByRole('button', { name: /^待审阅/ }).click();
  await page.getByRole('button', { name: '标记已审阅', exact: true }).click();
  await expect(page.getByRole('heading', { name: '没有待审阅的任务' })).toBeVisible();
  await fixture.restart();
  expect((await fixture.snapshot()).data.threads.find((thread) => thread.id === id)?.reviewed).toBe(true);
  await fixture.page.getByRole('button', { name: /^自动化(?: \d+)?$/ }).click();
  await fixture.page.getByLabel('删除 验收自动化').click();
  await fixture.page.getByRole('dialog').getByRole('button', { name: '删除自动化', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.automations.length).toBe(0);
});

test('simultaneous automation runs create one active task', async () => {
  fixture.setMode('hold');
  await fixture.invoke({ op: 'automation.save', automation: { id: 'job', name: '并发验收', projectId: 'p', prompt: 'hold', intervalMinutes: 60, enabled: true, nextRunAt: Date.now() + 3600000 } });
  await Promise.all(Array.from({ length: 5 }, () => fixture.invoke({ op: 'automation.run', id: 'job' })));
  await expect.poll(() => fixture.calls.length).toBeGreaterThan(0);
  expect((await fixture.snapshot()).data.threads.filter((thread) => thread.automationId === 'job')).toHaveLength(1);
  fixture.release();
});

test('provider error recovers and stop aborts streaming without blocking later turns', async () => {
  fixture.setMode('fail');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '错误验收', attachments: [] });
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('error');
  await expect(fixture.page.locator('.timeline')).toContainText('ACCEPTANCE_PROVIDER_ERROR');
  expect((await fixture.snapshot()).data.threads[0].roundSnapshots?.at(-1)?.state).not.toBe('running');
  fixture.setMode('reply');
  await send('恢复后发送');
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '停止验收', attachments: [] });
  await expect(fixture.page.getByLabel('停止任务', { exact: true })).toBeVisible();
  await fixture.page.getByLabel('停止任务', { exact: true }).click();
  await idle();
  fixture.release();
  await send('停止后继续');
  expect((await fixture.snapshot()).data.threads[0].items.filter((item) => item.role === 'user')).toHaveLength(4);
});

test('follow-up and steering queues run exactly once', async () => {
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '第一条', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await fixture.invoke({ op: 'thread.send', id: 't', text: '跟随消息', attachments: [], queue: 'followUp' });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '引导消息', attachments: [], queue: 'steer' });
  fixture.release();
  await expect.poll(() => fixture.calls.length).toBe(3);
  await idle();
  const texts = (await fixture.snapshot()).data.threads[0].items.filter((item) => item.role === 'user').map((item) => item.text);
  expect(texts).toHaveLength(3);
  expect(texts).toEqual(expect.arrayContaining(['第一条', '跟随消息', '引导消息']));
});

test('interrupted sessions resume after restart and worker termination', async () => {
  await send('保存的第一轮');
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '重启前未完成', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(2);
  await fixture.restart();
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('interrupted');
  fixture.release();
  await send('重启恢复');
  const worker = await fixture.app.evaluate(({ app }) => app.getAppMetrics().find((metric) => metric.type === 'Utility' && metric.name === 'Pi Agent')?.pid);
  expect(worker).toBeTruthy();
  await fixture.app.evaluate((_electron, pid) => process.kill(pid!), worker);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('interrupted');
  await fixture.invoke({ op: 'thread.resume', id: 't' });
  await send('进程恢复');
  expect((await fixture.snapshot()).data.threads[0].items.some((item) => item.text === '保存的第一轮')).toBe(true);
});

test('fifty sequential turns preserve history and keep one worker', async () => {
  test.setTimeout(120000);
  for (let index = 0; index < 50; index++) await send('连续验收 ' + index);
  const snapshot = await fixture.snapshot();
  const items = snapshot.data.threads[0].items;
  expect(items.filter((item) => item.role === 'user')).toHaveLength(50);
  expect(items.filter((item) => item.role === 'assistant')).toHaveLength(50);
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  expect(await fixture.app.evaluate(({ app }) => app.getAppMetrics().filter((metric) => metric.type === 'Utility' && metric.name === 'Pi Agent').length)).toBe(1);
  await fixture.restart();
  await fixture.invoke({ op: 'thread.resume', id: 't' });
  expect((await fixture.snapshot()).data.threads[0].items.filter((item) => item.role === 'user')).toHaveLength(50);
});

test('file operations, approved rollback and worktree application preserve the parent project', async () => {
  const file = join(fixture.project, 'README.md');
  await writeFile(file, '# modified\n');
  expect(await fixture.invoke({ op: 'file.read', threadId: 't', path: 'README.md' })).toMatchObject({ kind: 'text', content: '# modified\n' });
  expect(await fixture.invoke({ op: 'git.diff', threadId: 't', path: 'README.md' })).toContain('+# modified');
  const backup = await fixture.invoke({ op: 'git.revert', threadId: 't', path: 'README.md' }) as string;
  expect(await readFile(backup, 'utf8')).toBe('# modified\n');
  expect(await readFile(file, 'utf8')).toBe('# Acceptance\n');
  const thread = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: true }) as Thread;
  await fixture.invoke({ op: 'thread.update', id: thread.id, policy: 'auto' });
  await writeFile(join(thread.cwd, 'README.md'), '# worktree\n');
  await fixture.invoke({ op: 'git.apply', threadId: thread.id });
  expect(await readFile(file, 'utf8')).toBe('# worktree\n');
  await expect(fixture.invoke({ op: 'git.apply', threadId: thread.id })).rejects.toThrow();
  await expect(fixture.invoke({ op: 'file.read', threadId: 't', path: '../desktop.json' })).rejects.toThrow();
});

test('ordinary settings save validates and encrypts MCP secrets before restart', async () => {
  const page = fixture.page;
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByLabel(/^命令/).fill(process.execPath);
  await page.getByLabel(/^参数/).fill(resolve('test/fixtures/mcp-server.mjs'));
  const secret = page.getByLabel(/^加密环境变量/);
  await secret.fill('{"TOKEN":42}');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-error', 'true');
  expect((await fixture.snapshot()).data.settings.mcpServers).toHaveLength(0);
  await secret.fill('{"TOKEN":"acceptance-secret"}');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByRole('status')).toHaveText('设置已保存');
  await expect(secret).toHaveValue('');
  const id = (await fixture.snapshot()).data.settings.mcpServers[0].id;
  const encrypted = JSON.parse(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')) as Record<string, string>;
  expect(encrypted['mcp:' + id]).toBeTruthy();
  expect(JSON.stringify(encrypted)).not.toContain('acceptance-secret');
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings.mcpServers).toHaveLength(1);
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  expect(await fixture.invoke({ op: 'mcp.test', id })).toHaveLength(1);
});

test('close exits when tray persistence is disabled', async () => {
  const closed = fixture.app.waitForEvent('close', { timeout: 10000 });
  await fixture.page.getByLabel('关闭窗口', { exact: true }).click();
  await closed;
});

test('close hides with tray persistence enabled and second-instance restores the window', async () => {
  const settings = (await fixture.snapshot()).data.settings;
  await fixture.invoke({ op: 'settings.save', settings: { ...settings, keepInTray: true } });
  await fixture.page.getByLabel('关闭窗口', { exact: true }).click();
  expect(await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
  await fixture.app.evaluate(({ app }) => app.emit('second-instance', {}, [], '', {}));
  await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
});

test('renderer termination reloads persisted conversation without losing the worker', async () => {
  await send('渲染进程恢复前');
  await fixture.app.evaluate(async ({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Renderer did not recover')), 10000);
      contents.once('did-finish-load', () => { clearTimeout(timeout); resolve(); });
      contents.forcefullyCrashRenderer();
    });
  });
  // Playwright retains the crashed Page session. Inspect the recovered renderer via its host.
  await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
    "!!document.querySelector('textarea[aria-label=\"向 Pi 发送消息\"]') && document.querySelector('.timeline')?.textContent.includes('渲染进程恢复前')",
  ))).toBe(true);
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
    "window.desktop.invoke({op:'thread.send',id:'t',text:'渲染进程恢复后',attachments:[]})",
  ));
  await expect.poll(() => fixture.calls.length).toBe(2);
  await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
    "window.desktop.invoke({op:'bootstrap'}).then(b=>({status:b.data.threads[0].status,users:b.data.threads[0].items.filter(i=>i.role==='user').length}))",
  ))).toEqual({ status: 'idle', users: 2 });
});

test('extension confirmation, selection and input resolve through real approval cards', async () => {
  const extension = join(fixture.project, 'interactive.mjs');
  await writeFile(extension, 'export default function(pi) { pi.on("session_start", async (_event,ctx) => { const yes = await ctx.ui.confirm("验收确认","确认后继续"); if (!yes) { ctx.ui.notify("EXTENSION_REJECTED"); return; } const choice = await ctx.ui.select("验收选择",["一","二"]); const answer = await ctx.ui.input("验收输入","请输入"); ctx.ui.notify("EXTENSION_RESULT:" + choice + ":" + answer); }); }');
  const settings = (await fixture.snapshot()).data.settings;
  await fixture.invoke({ op: 'settings.save', settings: { ...settings, resources: [{ id: 'interactive', name: 'interactive', path: extension, kind: 'extension', enabled: true }] } });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '交互扩展验收', attachments: [] });
  const card = fixture.page.getByLabel('待审批操作');
  await expect(card).toContainText('验收确认');
  await card.getByRole('button', { name: '允许这一次' }).click();
  await card.getByLabel('选择回复').selectOption('二');
  await card.getByRole('button', { name: '允许这一次' }).click();
  await card.getByLabel('回复内容').fill('中文输入');
  await card.getByRole('button', { name: '允许这一次' }).click();
  await idle();
  await expect(fixture.page.locator('.timeline')).toContainText('EXTENSION_RESULT:二:中文输入');
  await fixture.invoke({ op: 'provider.key', id: 'local-provider', key: 'local-only' });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '拒绝扩展验收', attachments: [] });
  await expect(card).toContainText('验收确认');
  await card.getByRole('button', { name: '拒绝' }).click();
  await idle();
  await expect(fixture.page.locator('.timeline')).toContainText('EXTENSION_REJECTED');
});

test('text attachments enter the model context and invalid attachments fail before network access', async () => {
  const text = join(fixture.project, '附件.txt');
  const binary = join(fixture.project, 'binary.bin');
  const large = join(fixture.project, 'large.txt');
  await writeFile(text, 'ATTACHMENT_ACCEPTANCE 中文');
  await writeFile(binary, Buffer.from([0, 1, 2, 3]));
  await writeFile(large, Buffer.alloc(10 * 1024 * 1024 + 1, 65));
  await fixture.app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, [text, binary, large]);
  const picked = await fixture.invoke({ op: 'attachment.pick', threadId: 't' }) as string[];
  expect(picked).toHaveLength(3);
  expect(picked[0]).not.toBe(text);
  await fixture.invoke({ op: 'thread.send', id: 't', text: '读取附件', attachments: [picked[0]] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await idle();
  expect(JSON.stringify(fixture.calls[0].messages)).toContain('ATTACHMENT_ACCEPTANCE 中文');
  for (const attachment of picked.slice(1)) {
    await fixture.invoke({ op: 'thread.send', id: 't', text: '错误附件', attachments: [attachment] });
    await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('error');
    expect(fixture.calls).toHaveLength(1);
  }
  await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, join(fixture.project, 'missing.txt'));
  await expect(fixture.invoke({ op: 'attachment.pick', threadId: 't' })).rejects.toThrow();
  expect(fixture.calls).toHaveLength(1);
  await send('附件错误后恢复');
});

test('drop and clipboard attachments keep their bytes and draft through a native restart', async () => {
  await fixture.page.getByLabel('向 Pi 发送消息').fill('附件草稿保留');
  for (const kind of ['drop', 'paste'] as const) {
    await fixture.page.locator('.composer-area').evaluate((element, action) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['ATTACHMENT_' + action + '_中文'], action + '.txt', { type: 'text/plain' }));
      element.dispatchEvent(action === 'drop' ? new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }) :
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, kind);
    await expect(fixture.page.locator('.attachment-name').filter({ hasText: kind + '.txt' })).toBeVisible();
  }
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.draft?.attachments.length).toBe(2);
  const paths = (await fixture.snapshot()).data.ui.threads.t.draft!.attachments;
  expect(await readFile(paths[0], 'utf8')).toBe('ATTACHMENT_drop_中文');
  await fixture.restart();
  await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue('附件草稿保留');
  await expect(fixture.page.locator('.attachment-name')).toHaveCount(2);
  await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => fixture.calls.length).toBe(1);
  await idle();
  expect(JSON.stringify(fixture.calls[0].messages)).toContain('ATTACHMENT_drop_中文');
  expect(JSON.stringify(fixture.calls[0].messages)).toContain('ATTACHMENT_paste_中文');
});

test('context picker persists references, resolves real content and commands operate on the task', async () => {
  await fixture.invoke({ op: 'resource.create', name: 'context-check', content: '---\nname: context-check\ndescription: Context selection check\n---\nSELECTED_SKILL_CONTEXT' });
  await fixture.page.getByRole('button', { name: '添加上下文与操作', exact: true }).click();
  await fixture.page.getByRole('menuitem', { name: '文件与文件夹', exact: true }).click();
  const picker = fixture.page.getByRole('dialog', { name: '命令与上下文' });
  await picker.getByRole('button', { name: 'README.md', exact: true }).click();
  await picker.getByRole('button', { name: '引用此文件夹', exact: true }).click();
  await picker.getByRole('button', { name: 'Skills', exact: true }).click();
  await picker.getByRole('button', { name: /context-check/ }).click();
  await picker.getByRole('button', { name: '工具', exact: true }).click();
  await picker.getByRole('button', { name: 'read', exact: true }).click();
  await picker.getByRole('button', { name: '完成选择' }).click();
  await fixture.page.getByLabel('向 Pi 发送消息').fill('保留原始问题');
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.contextReferences?.length).toBe(4);
  expect(fixture.calls).toHaveLength(0);
  await fixture.restart();
  await expect(fixture.page.locator('.composer-context .attachment')).toHaveCount(4);
  await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => fixture.calls.length).toBe(1);
  await idle();
  const sent = JSON.stringify(fixture.calls[0].messages.filter(message => message.role === 'user'));
  expect(sent).toContain('保留原始问题');
  expect(sent).toContain('# Acceptance');
  expect(sent).toContain('direct children only');
  expect(sent).toContain('SELECTED_SKILL_CONTEXT');
  expect(sent).toContain('Existing task permissions');
  await expect(fixture.page.locator('.composer-context .attachment')).toHaveCount(0);
  await fixture.page.getByLabel('向 Pi 发送消息').fill('保留问题 /plan');
  await fixture.page.getByRole('option', { name: '开启计划模式 /plan', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].planMode).toBe(true);
  await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue('保留问题 ');
  await fixture.page.getByRole('button', { name: '关闭计划模式', exact: true }).click();
  await fixture.page.getByLabel('向 Pi 发送消息').fill('新问题 @README');
  await fixture.page.getByRole('option', { name: 'README.md 验收项目 / README.md', exact: true }).click();
  await fixture.page.getByLabel('向 Pi 发送消息').press('End');
  await fixture.page.getByLabel('向 Pi 发送消息').pressSequentially('/context-check');
  await fixture.page.getByRole('option', { name: /context-check/ }).click();
  await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue('新问题 ');
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.contextReferences?.length).toBe(2);
  await fixture.restart();
  await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue('新问题 ');
  await expect(fixture.page.locator('.composer-context .attachment')).toHaveCount(2);
  await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => fixture.calls.length).toBe(2); await idle();
  const selected = JSON.stringify(fixture.calls[1].messages);
  expect(selected).toContain('SELECTED_SKILL_CONTEXT'); expect(selected).toContain('# Acceptance');
});

test('queued context survives withdrawal and rejected references preserve the draft without a provider call', async () => {
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '保持主任务运行', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  const context = [{ kind: 'file' as const, id: 'README.md', label: 'README.md' }];
  await fixture.invoke({ op: 'thread.send', id: 't', text: '引用队列', attachments: [], context, queue: 'followUp' });
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].queue?.length).toBe(1);
  await fixture.invoke({ op: 'thread.queueClear', id: 't' });
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.contextReferences).toEqual(context);
  await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue('引用队列');
  await fixture.invoke({ op: 'thread.stop', id: 't' });
  await idle();
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { contextReferences: [{ kind: 'file', id: '../desktop.json', label: 'outside' }] } });
  await expect(fixture.page.locator('.composer-context')).toContainText('outside');
  await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(fixture.page.locator('.composer-delivery[role=alert]')).toContainText('发送失败');
  expect((await fixture.snapshot()).data.threads[0].status).toBe('idle');
  await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue('引用队列');
  await expect(fixture.page.locator('.composer-context')).toContainText('outside');
  expect(fixture.calls).toHaveLength(1);
});

test('multiple directories isolate same-name file drafts, repositories, primary selection and restart state', async () => {
  const extra = join(fixture.storage, 'extra-project');
  await mkdir(extra);
  execFileSync('git', ['init', '-b', 'extra', extra]);
  await writeFile(join(extra, 'README.md'), 'SECOND_DIRECTORY');
  await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, extra);
  await taskAction(fixture.page, '项目目录');
  await fixture.page.getByRole('button', { name: '添加项目目录', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.projects[0].directories?.length).toBe(1);
  const directory = (await fixture.snapshot()).data.projects[0].directories![0];
  expect(directory.trusted).toBe(false);
  await fixture.page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, reviewOpen: true } });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { reviewTab: 'files', selectedPath: 'README.md', openFiles: ['README.md'] } });
  const editor = fixture.page.getByLabel('文件内容 README.md');
  await expect(editor).toHaveValue('# Acceptance\n');
  await editor.fill('FIRST_DRAFT');
  const choose = async (label: RegExp) => {
    await fixture.page.getByRole('button', { name: '浏览目录与仓库', exact: true }).click();
    await fixture.page.getByRole('menuitemradio', { name: label }).click();
  };
  await choose(/extra-project/);
  await fixture.page.getByRole('treeitem', { name: 'README.md', exact: true }).click();
  await expect(editor).toHaveValue('SECOND_DIRECTORY');
  await editor.fill('SECOND_DRAFT');
  await fixture.page.locator('.files-workbench').getByRole('button', { name: /^保存/ }).click();
  await expect.poll(() => readFile(join(extra, 'README.md'), 'utf8')).toBe('SECOND_DRAFT');
  expect(await readFile(join(fixture.project, 'README.md'), 'utf8')).toBe('# Acceptance\n');
  await choose(/验收项目/);
  await expect(editor).toHaveValue('FIRST_DRAFT');
  await fixture.page.locator('.files-workbench').getByRole('button', { name: /^保存/ }).click();
  await expect.poll(() => readFile(join(fixture.project, 'README.md'), 'utf8')).toBe('FIRST_DRAFT');
  expect(await fixture.invoke({ op: 'git.status', threadId: 't', directoryId: directory.id })).toMatchObject({ branch: 'extra', available: true });
  expect(await fixture.invoke({ op: 'git.status', threadId: 't', directoryId: 'p' })).toMatchObject({ branch: 'main', available: true });
  await expect(fixture.invoke({ op: 'file.read', threadId: 't', directoryId: 'forged', path: 'README.md' })).rejects.toThrow(/目录/);
  await expect(fixture.invoke({ op: 'file.read', threadId: 't', directoryId: directory.id, path: '../desktop.json' })).rejects.toThrow(/目录/);
  await fixture.invoke({ op: 'project.directoryUpdate', projectId: 'p', directoryId: directory.id, primary: true });
  const newThread = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  expect(newThread.cwd).toBe(extra);
  expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')!.cwd).toBe(fixture.project);
  await fixture.restart();
  await expect(fixture.page.getByLabel('文件内容 README.md')).toHaveValue('FIRST_DRAFT');
  await choose(/extra-project/);
  await expect(fixture.page.getByLabel('文件内容 README.md')).toHaveValue('SECOND_DRAFT');
  await expect(fixture.invoke({ op: 'project.directoryRemove', projectId: 'p', directoryId: directory.id })).rejects.toThrow();
});

test('agent directory tools require an explicit root and untrusted directory writes retain approval', async () => {
  const extra = join(fixture.storage, 'untrusted-directory');
  await mkdir(extra);
  await writeFile(join(extra, 'data.txt'), 'DIRECTORY_TOOL_CONTEXT');
  await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, extra);
  const directory = await fixture.invoke({ op: 'project.directoryAdd', projectId: 'p' }) as { id: string };
  fixture.requestTool('project_read', { directoryId: directory.id, path: 'data.txt' });
  await send('从指定目录读取');
  await expect.poll(() => fixture.calls.length).toBe(2);
  expect(JSON.stringify(fixture.calls[1].messages.filter(item => item.role === 'tool'))).toContain('DIRECTORY_TOOL_CONTEXT');
  const file = await fixture.invoke({ op: 'file.read', threadId: 't', directoryId: directory.id, path: 'data.txt' }) as { version: string };
  fixture.requestTool('project_write', { directoryId: directory.id, path: 'data.txt', content: 'MUST_NOT_WRITE', version: file.version });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '未信任目录写入需要确认', attachments: [] });
  const card = fixture.page.getByLabel('待审批操作');
  await expect(card).toContainText('project_write');
  await card.getByRole('button', { name: '拒绝', exact: true }).click();
  await idle();
  expect(await readFile(join(extra, 'data.txt'), 'utf8')).toBe('DIRECTORY_TOOL_CONTEXT');
  fixture.requestTool('project_write', { directoryId: directory.id, path: 'data.txt', content: 'APPROVED_DIRECTORY_WRITE', version: file.version });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '明确同意目录写入', attachments: [] });
  await expect(card).toContainText('project_write');
  await card.getByRole('button', { name: '允许这一次', exact: true }).click();
  await idle();
  expect(await readFile(join(extra, 'data.txt'), 'utf8')).toBe('APPROVED_DIRECTORY_WRITE');
  expect(await readFile(join(fixture.project, 'README.md'), 'utf8')).toBe('# Acceptance\n');
});

test('standalone chats retain isolated drafts and history, reject project access, and bind a directory when idle', async () => {
  // The entry is temporarily hidden; retained records still load and recover through the real service.
  await expect(fixture.page.getByRole('button', { name: '选择聊天类型', exact: true })).toHaveCount(0);
  const retained = await fixture.invoke({ op: 'chat.create', requestId: crypto.randomUUID() }) as Thread;
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, activeThreadId: retained.id } });
  await expect.poll(async () => (await fixture.snapshot()).data.threads.filter(item => !item.projectId).length).toBe(1);
  const first = (await fixture.snapshot()).data.threads.find(item => !item.projectId)!;
  await expect(fixture.page.getByRole('button', { name: '绑定项目目录', exact: true })).toBeVisible();
  await fixture.page.getByLabel('向 Pi 发送消息').fill('独立草稿一');
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads[first.id]?.draft?.text).toBe('独立草稿一');
  const another = await fixture.invoke({ op: 'chat.create', requestId: crypto.randomUUID() }) as Thread;
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, activeThreadId: another.id } });
  await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue('');
  const second = (await fixture.snapshot()).data.threads.find(item => !item.projectId && item.id !== first.id)!;
  await fixture.page.getByLabel('向 Pi 发送消息').fill('独立草稿二');
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads[second.id]?.draft?.text).toBe('独立草稿二');
  await fixture.restart();
  await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue('独立草稿二');
  expect((await fixture.snapshot()).data.ui.threads[first.id]?.draft?.text).toBe('独立草稿一');
  for (const request of [
    { op: 'file.read' as const, threadId: second.id, path: 'README.md' },
    { op: 'git.status' as const, threadId: second.id },
    { op: 'terminal.open' as const, threadId: second.id },
    { op: 'thread.fork' as const, id: second.id, worktree: true },
  ]) await expect(fixture.invoke(request)).rejects.toThrow(/绑定项目/);
  fixture.setMode('hold');
  await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => fixture.calls.length).toBe(1);
  expect(fixture.calls[0].tools?.map(tool => tool.function.name)).toEqual(['update_plan', 'get_goal', 'update_goal', 'manage_automations']);
  await expect(fixture.invoke({ op: 'thread.bindProject', id: second.id, projectId: 'p' })).rejects.toThrow(/空闲/);
  fixture.release();
  await idle(second.id);
  await fixture.page.getByLabel('向 Pi 发送消息').fill('绑定后的草稿');
  await fixture.page.getByRole('button', { name: '绑定项目目录', exact: true }).click();
  await fixture.page.getByRole('menuitem', { name: /验收项目/ }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === second.id)?.projectId).toBe('p');
  await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue('绑定后的草稿');
  fixture.setMode('reply');
  await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => fixture.calls.length).toBe(2);
  await idle(second.id);
  expect(fixture.calls[1].tools?.map(tool => tool.function.name)).toContain('read');
  expect(JSON.stringify(fixture.calls[1].messages)).toContain('独立草稿二');
  expect((await fixture.snapshot()).data.threads.find(item => item.id === second.id)?.cwd).toBe(fixture.project);
  await fixture.restart();
  expect((await fixture.snapshot()).data.threads.find(item => item.id === second.id)?.projectId).toBe('p');
});

test('separate task windows share execution without duplicate editors and preserve drafts and layouts across close and restart', async () => {
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '多窗口运行', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  const opened = fixture.app.waitForEvent('window');
  await taskAction(fixture.page, '在独立窗口打开');
  const task = await opened;
  await expect(task.getByLabel('向 Pi 发送消息')).toBeVisible();
  await expect.poll(async () => (await fixture.snapshot()).data.ui.activeThreadId).toBe('');
  await task.getByLabel('向 Pi 发送消息').fill('窗口任务草稿');
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('窗口任务草稿');
  const second = await fixture.invoke({ op: 'thread.create', projectId: '', worktree: false }) as Thread;
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, activeThreadId: second.id, sidebarWidth: 310 } });
  await task.evaluate(async () => {
    const boot = await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap;
    await window.desktop.invoke({ op: 'ui.update', ui: { ...boot.data.ui, sidebarWidth: 410, locale: 'en-US' } });
  });
  await expect(fixture.page.locator('html')).toHaveAttribute('lang', 'en-US');
  expect((await fixture.snapshot()).data.ui.sidebarWidth).toBe(310);
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, activeThreadId: 't' } });
  expect((await fixture.snapshot()).data.ui.activeThreadId).toBe(second.id);
  await expect(fixture.invoke({ op: 'thread.send', id: 't', text: '不能重复执行', attachments: [] })).rejects.toThrow(/另一个窗口/);
  const count = fixture.app.windows().length;
  await fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' });
  expect(fixture.app.windows()).toHaveLength(count);
  await (await fixture.app.browserWindow(task)).evaluate((window: BrowserWindow) => window.close());
  await expect.poll(() => task.isClosed()).toBe(true);
  expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')?.status).toBe('running');
  fixture.release(); await idle();
  expect(fixture.calls).toHaveLength(1);
  const reopened = fixture.app.waitForEvent('window');
  await fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' });
  const restored = await reopened;
  await expect(restored.locator('.composer textarea')).toHaveValue('窗口任务草稿');
  await fixture.restart();
  await expect.poll(() => fixture.app.windows().length).toBe(2);
  const secondary = fixture.app.windows().find(page => page !== fixture.page)!;
  await expect(secondary.locator('.composer textarea')).toHaveValue('窗口任务草稿');
  expect((await fixture.snapshot()).data.ui.activeThreadId).toBe(second.id);
  expect((await fixture.snapshot()).data.windows?.['task:t'].frame.sidebarWidth).toBe(410);
});

test('quick chat keeps its draft after closing and restarting, and shortcut failures can recover without losing the previous binding', async () => {
  await expect(fixture.page.locator('.sidebar-quick-chat')).toHaveCSS('opacity', '0');
  await fixture.page.locator('.sidebar-new-task').hover();
  await expect(fixture.page.locator('.sidebar-quick-chat')).toHaveCSS('opacity', '1');
  await fixture.page.getByRole('button', { name: '快捷聊天', exact: true }).click();
  await expect.poll(() => fixture.app.windows().length).toBe(2);
  let quick = fixture.app.windows().find(page => page !== fixture.page)!;
  await expect(quick.getByLabel('向 Pi 发送消息')).toBeVisible();
  await quick.getByLabel('向 Pi 发送消息').fill('快捷窗口未发送内容');
  await expect.poll(async () => Object.values((await fixture.snapshot()).data.ui.threads).some(item => item.draft?.text === '快捷窗口未发送内容')).toBe(true);
  await (await fixture.app.browserWindow(quick)).evaluate((window: BrowserWindow) => window.close());
  await fixture.restart();
  expect(fixture.app.windows()).toHaveLength(1);
  await fixture.invoke({ op: 'window.open', kind: 'quick' });
  quick = fixture.app.windows().find(page => page !== fixture.page)!;
  await expect(quick.getByLabel('向 Pi 发送消息')).toHaveValue('快捷窗口未发送内容');
  await fixture.app.evaluate(({ globalShortcut }) => {
    const original = globalShortcut.register.bind(globalShortcut);
    const state = globalThis as typeof globalThis & { allowQuickShortcut?: boolean; quickShortcutCallback?: () => void };
    globalShortcut.register = (key, callback) => {
      if (key === 'Ctrl+Alt+9') {
        if (!state.allowQuickShortcut) return false;
        state.quickShortcutCallback = callback;
      }
      return original(key, callback);
    };
  });
  await fixture.invoke({ op: 'settings.patch', patch: { shortcuts: { quickChat: 'Ctrl+Alt+9' } } });
  await fixture.page.keyboard.press('Control+,');
  await fixture.page.getByRole('button', { name: '键盘快捷键', exact: true }).click();
  await expect(fixture.page.locator('.shortcut-registration')).toContainText('注册失败');
  await fixture.app.evaluate(() => { (globalThis as typeof globalThis & { allowQuickShortcut?: boolean }).allowQuickShortcut = true; });
  await fixture.page.getByRole('button', { name: '重试注册', exact: true }).click();
  await expect(fixture.page.locator('.shortcut-registration')).toContainText('Ctrl+Alt+9');
  await expect(fixture.page.locator('.shortcut-registration')).not.toContainText('注册失败');
  expect(await fixture.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Ctrl+Alt+9'))).toBe(true);
  await (await fixture.app.browserWindow(quick)).evaluate((window: BrowserWindow) => window.close());
  await fixture.app.evaluate(() => { (globalThis as typeof globalThis & { quickShortcutCallback?: () => void }).quickShortcutCallback?.(); });
  await expect.poll(() => fixture.app.windows().length).toBe(2);
  await expect(fixture.app.windows().find(page => page !== fixture.page)!.getByLabel('向 Pi 发送消息')).toHaveValue('快捷窗口未发送内容');
});

test('side chat captures a selected point, answers read-only beside a running task and appends only to its draft', async () => {
  await send('PARENT_CONTEXT_BEFORE');
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'PARENT_CONTEXT_AFTER', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(2);
  await fixture.page.getByRole('button', { name: '从此处侧聊', exact: true }).first().click();
  const panel = fixture.page.getByRole('complementary', { name: '任务辅助栏', exact: true }).locator('.sidechat-panel');
  await expect(panel.getByLabel('侧聊消息')).toBeVisible();
  const side = (await fixture.snapshot()).data.threads.find(thread => thread.sidechat?.temporary)!;
  expect(side.sidechat?.context).toContain('PARENT_CONTEXT_BEFORE');
  expect(side.sidechat?.context).not.toContain('PARENT_CONTEXT_AFTER');
  await fixture.page.getByLabel('向 Pi 发送消息').fill('保留主草稿');
  await panel.getByLabel('侧聊消息').fill('SIDE_QUESTION');
  fixture.setMode('reply');
  await panel.getByRole('button', { name: '发送侧聊', exact: true }).click();
  await expect.poll(() => fixture.calls.length).toBe(3);
  await idle(side.id);
  expect(JSON.stringify(fixture.calls[2].messages)).toContain('PARENT_CONTEXT_BEFORE');
  expect(JSON.stringify(fixture.calls[2].messages)).not.toContain('PARENT_CONTEXT_AFTER');
  expect(fixture.calls[2].tools?.map(tool => tool.function.name)).toEqual(expect.arrayContaining(['read', 'grep', 'find', 'ls']));
  expect(fixture.calls[2].tools?.map(tool => tool.function.name)).not.toContain('write');
  expect(fixture.calls[2].tools?.map(tool => tool.function.name)).not.toContain('powershell');
  expect((await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.status).toBe('running');
  await panel.getByRole('button', { name: '追加到主任务草稿', exact: true }).last().click();
  await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue(/保留主草稿[\s\S]*验收回复完成/);
  expect(fixture.calls).toHaveLength(3);
  await expect(fixture.invoke({ op: 'thread.update', id: side.id, policy: 'auto' })).rejects.toThrow(/只允许读取/);
  fixture.requestTool('write', { path: join(fixture.project, 'side-must-not-write.txt'), content: 'FORBIDDEN' });
  await fixture.invoke({ op: 'thread.send', id: side.id, text: 'test forbidden tool call', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(5);
  await idle(side.id);
  await expect(access(join(fixture.project, 'side-must-not-write.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  fixture.setMode('hold');
  await panel.getByLabel('侧聊消息').fill('停止只影响侧聊');
  await panel.getByRole('button', { name: '发送侧聊', exact: true }).click();
  await expect.poll(() => fixture.calls.length).toBe(6);
  await panel.getByRole('button', { name: '停止侧聊', exact: true }).click();
  await idle(side.id);
  expect((await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.status).toBe('running');
  fixture.release(); await idle();
});

test('temporary side chats keep panel drafts until exit, retained chats survive, and parent deletion stops temporary children', async () => {
  await send('来源任务');
  const temporary = await fixture.invoke({ op: 'sidechat.create', threadId: 't' }) as Thread;
  await fixture.invoke({ op: 'thread.send', id: temporary.id, text: '临时问题', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(2); await idle(temporary.id);
  const sessionFile = (await fixture.snapshot()).data.threads.find(thread => thread.id === temporary.id)!.sessionFile!;
  const panel = fixture.page.getByRole('complementary', { name: '任务辅助栏', exact: true }).locator('.sidechat-panel');
  await panel.getByLabel('侧聊消息').fill('关闭后保留');
  await panel.getByRole('button', { name: '关闭侧聊', exact: true }).click();
  await fixture.page.getByRole('button', { name: '辅助栏', exact: true }).click();
  await expect(panel.getByLabel('侧聊消息')).toHaveValue('关闭后保留');
  await fixture.restart();
  expect((await fixture.snapshot()).data.threads.some(thread => thread.id === temporary.id)).toBe(false);
  await expect(access(sessionFile)).rejects.toMatchObject({ code: 'ENOENT' });
  const kept = await fixture.invoke({ op: 'sidechat.create', threadId: 't' }) as Thread;
  await fixture.invoke({ op: 'thread.send', id: kept.id, text: '需要保留的问题', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(3); await idle(kept.id);
  await fixture.page.getByRole('button', { name: '保留为普通聊天', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.ui.activeThreadId).toBe(kept.id);
  await fixture.restart();
  expect((await fixture.snapshot()).data.threads.find(thread => thread.id === kept.id)?.sidechat?.temporary).toBe(false);
  const child = await fixture.invoke({ op: 'sidechat.create', threadId: 't' }) as Thread;
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: child.id, text: '删除主任务会结束临时侧聊', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(4);
  await fixture.invoke({ op: 'thread.update', id: 't', deletedAt: Date.now() });
  expect((await fixture.snapshot()).data.threads.some(thread => thread.id === child.id)).toBe(false);
  expect((await fixture.snapshot()).data.threads.some(thread => thread.id === kept.id)).toBe(true);
  await fixture.restart();
  expect((await fixture.snapshot()).data.threads.filter(thread => thread.sidechat?.temporary)).toHaveLength(0);
  expect((await fixture.snapshot()).data.threads.find(thread => thread.id === kept.id)?.items.some(item => item.text.includes('需要保留的问题'))).toBe(true);
});

test('native Chromium composition commits Chinese text without sending candidate Enter', async () => {
  const page = fixture.page;
  const composer = page.getByLabel('向 Pi 发送消息');
  await composer.focus();
  await page.evaluate(() => {
    document.documentElement.dataset.compositions = '';
    for (const name of ['compositionstart', 'compositionupdate', 'compositionend'])
      document.addEventListener(name, () => { document.documentElement.dataset.compositions += name + ' '; });
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.imeSetComposition', { text: '中文验收', selectionStart: 4, selectionEnd: 4 });
    await expect(composer).toHaveValue('中文验收');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 });
    expect(fixture.calls).toHaveLength(0);
    await cdp.send('Input.insertText', { text: '中文验收' });
    await expect(page.locator('html')).toHaveAttribute('data-compositions', /compositionstart.*compositionend/);
    await composer.press('Enter');
    await expect.poll(() => fixture.calls.length).toBe(1);
    await idle();
    expect((await fixture.snapshot()).data.threads[0].items.some((item) => item.role === 'user' && item.text === '中文验收')).toBe(true);
  } finally { await cdp.detach(); }
});
