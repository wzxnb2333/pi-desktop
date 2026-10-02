import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { defaultData, threadSchema } from '../../src/shared/contracts.ts';
import { recoverSandboxRuns } from '../../src/main/windows-sandbox.ts';
import { cleanupTemporaryDirectories, mkdtemp } from './fixtures/temp-paths.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.afterAll(cleanupTemporaryDirectories);

test('permission choices gate native sandbox commands and full access persists across restart', async () => {
  const fixture = await acceptanceApp(development.url);
  try {
    const outside = join(fixture.storage, 'outside.txt');
    await writeFile(outside, 'private');
    const command = "Set-Content -LiteralPath 'inside.txt' -Value $env:PI_SANDBOX";
    const send = async (text: string, shell: string) => {
      fixture.requestTool('powershell', { command: shell });
      await fixture.invoke({ op: 'thread.send', id: 't', text, attachments: [] });
    };
    const finished = () => expect.poll(async () => (await fixture.snapshot()).data.threads.find(t => t.id === 't')?.status, { timeout: 30000 }).toBe('idle');
    await fixture.invoke({ op: 'thread.update', id: 't', policy: 'ask' });
    await send('拒绝这次写入', command);
    await expect(fixture.page.getByLabel('待审批操作')).toBeVisible();
    await expect(readFile(join(fixture.project, 'inside.txt'))).rejects.toThrow();
    await fixture.page.getByRole('button', { name: '拒绝', exact: true }).click();
    await finished();
    await expect(readFile(join(fixture.project, 'inside.txt'))).rejects.toThrow();

    await send('仅批准沙箱内写入', command);
    await expect(fixture.page.getByLabel('待审批操作')).toBeVisible();
    await fixture.page.getByRole('button', { name: '允许这一次' }).click();
    await finished();
    expect(await readFile(join(fixture.project, 'inside.txt'), 'utf8')).toContain('appcontainer');

    await fixture.invoke({ op: 'thread.update', id: 't', policy: 'auto' });
    await send('自动批准仍限制项目外写入', "[IO.File]::WriteAllText('" + outside.replaceAll("'", "''") + "','host-write')");
    await finished();
    expect((await fixture.snapshot()).approvals).toEqual([]);
    expect(await readFile(outside, 'utf8')).toBe('private');

    await fixture.page.getByLabel('执行策略', { exact: true }).click();
    await fixture.page.getByRole('menuitemradio', { name: '完全访问', exact: true }).click();
    await send('主动完全访问后才允许项目外写入', "[IO.File]::WriteAllText('" + outside.replaceAll("'", "''") + "','host-write')");
    await finished();
    expect(await readFile(outside, 'utf8')).toBe('host-write');
    await fixture.page.keyboard.press('Control+,');
    await fixture.page.getByRole('button', { name: '审批与信任', exact: true }).click();
    const preference = fixture.page.getByLabel('默认审批', { exact: true });
    await expect(preference).toContainText('请求批准');
    await preference.click();
  await fixture.page.getByRole('menuitemradio', { name: '完全访问', exact: true }).click();
    await fixture.page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(fixture.page.locator('.settings-footer [role=status]')).toHaveText('设置已保存');
    await fixture.page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await fixture.restart();
    expect((await fixture.snapshot()).data.settings.policy).toBe('full');
    expect((await fixture.snapshot()).data.threads.find(t => t.id === 't')?.policy).toBe('full');
    await expect(fixture.page.getByLabel('执行策略', { exact: true })).toHaveText('完全访问');
    await fixture.page.getByRole('button', { name: '自动化', exact: true }).click();
    await fixture.page.getByRole('button', { name: '新建自动化', exact: true }).click();
    await expect(fixture.page.getByLabel('运行权限').locator('option')).toHaveText(['沿用聊天或默认设置', '请求批准', '替我批准', '完全访问']);
    await fixture.page.getByRole('button', { name: '取消创建', exact: true }).click();
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('host extension consent stays explicit and localizes while waiting', async () => {
  const fixture = await acceptanceApp(development.url);
  try {
    const marker = join(fixture.storage, 'extension-loaded.txt');
    const extension = join(fixture.project, 'probe.mjs');
    await writeFile(extension, "import { writeFileSync } from 'node:fs'; export default function () { writeFileSync(" + JSON.stringify(marker) + ", 'loaded'); }");
    await fixture.invoke({ op: 'settings.patch', patch: { resources: [{ id: 'probe', name: 'Probe', path: extension, kind: 'extension', enabled: true }] } });
    await fixture.page.keyboard.press('Control+,');
    await fixture.invoke({ op: 'thread.send', id: 't', text: '加载外部工具需要独立授权', attachments: [] });
    const card = fixture.page.getByLabel('待审批操作');
    await expect(card).toContainText('外部扩展与 MCP');
    await expect(access(marker)).rejects.toThrow();
    await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' } });
    const english = fixture.page.getByLabel('Operation awaiting approval');
    await expect(fixture.page.locator('.approval-card')).toContainText('Extensions and MCP');
    await expect(fixture.page.locator('.approval-card')).toContainText('outside the command sandbox');
    await english.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
    await expect(access(marker)).rejects.toThrow();
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('worker termination cancels sandbox descendants and removes owned temporary data', async () => {
  const fixture = await acceptanceApp(development.url);
  try {
    fixture.requestTool('powershell', { command: "Set-Content 'ready.txt' 'ready'; Write-Output 'SANDBOX_STREAM_READY'; Start-Sleep 30; Set-Content 'after-exit.txt' 'escaped'" });
    await fixture.invoke({ op: 'thread.send', id: 't', text: '中断后清理沙箱', attachments: [] });
    await expect.poll(async () => readFile(join(fixture.project, 'ready.txt'), 'utf8').catch(() => ''), { timeout: 30000 }).toContain('ready');
    await expect.poll(async () => (await fixture.snapshot()).data.threads[0].items.filter(item => item.role === 'tool' && item.state === 'running').map(item => item.text).join('\n')).toContain('SANDBOX_STREAM_READY');
    const pid = await fixture.app.evaluate(({ app }) => app.getAppMetrics().find(metric => metric.type === 'Utility' && metric.name === 'Pi Agent')?.pid);
    expect(pid).toBeTruthy();
    await fixture.app.evaluate((_electron, value) => process.kill(value!), pid);
    await expect.poll(async () => (await fixture.snapshot()).data.threads[0]).toMatchObject({ status: expect.stringMatching(/^(interrupted|error)$/), error: expect.stringContaining('Pi 进程退出') });
    await expect.poll(() => readdir(join(fixture.storage, 'agent', 'sandbox-runs'))).toEqual([]);
    await expect(access(join(fixture.project, 'after-exit.txt'))).rejects.toThrow();
    await fixture.invoke({ op: 'thread.send', id: 't', text: '中断清理后继续', attachments: [] });
    await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('restarting after main and broker termination recovers native leases and preserves the draft', async () => {
  const fixture = await acceptanceApp(development.url);
  const shell = join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const acl = () => execFileSync(shell, ['-NoProfile', '-Command', "[IO.Directory]::GetAccessControl('" + fixture.project.replaceAll("'", "''") + "').GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)"], { encoding: 'utf8', windowsHide: true }).trim();
  const original = acl();
  try {
    fixture.requestTool('powershell', { command: "Set-Content 'crash-ready.txt' 'ready'; Start-Sleep 30; Set-Content 'crash-late.txt' 'escaped'" });
    await fixture.invoke({ op: 'thread.send', id: 't', text: '应用中断恢复', attachments: [] });
    await expect.poll(async () => readFile(join(fixture.project, 'crash-ready.txt'), 'utf8').catch(() => ''), { timeout: 30000 }).toContain('ready');
    await fixture.page.getByRole('textbox', { name: '向 Pi 发送消息', exact: true }).fill('中断后保留的草稿');
    await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t?.draft?.text).toBe('中断后保留的草稿');
    const runtime = join(fixture.storage, 'agent', 'sandbox-runtime');
    const executable = join(runtime, (await readdir(runtime)).find(name => name.endsWith('.exe'))!);
    const broker = Number(execFileSync(shell, ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name LIKE 'launcher%.exe'\" | Where-Object { $_.ExecutablePath -eq '" + executable.replaceAll("'", "''") + "' }).ProcessId"], { encoding: 'utf8', windowsHide: true }).trim());
    expect(broker).toBeGreaterThan(0);
    const mainPid = await fixture.app.evaluate(() => process.pid);
    process.kill(broker);
    process.kill(mainPid);
    // After a hard kill Playwright may not emit its protocol-level close until close() is called.
    await expect.poll(() => {
      try { process.kill(mainPid, 0); return false; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; }
    }).toBe(true);
    expect((await readdir(join(fixture.storage, 'agent', 'sandbox-leases'))).length).toBe(1);
    await fixture.restart();
    expect(await readdir(join(fixture.storage, 'agent', 'sandbox-leases'))).toEqual([]);
    expect(await readdir(join(fixture.storage, 'agent', 'sandbox-runs'))).toEqual([]);
    expect(acl()).toBe(original);
    await expect(fixture.page.getByRole('textbox', { name: '向 Pi 发送消息', exact: true })).toHaveValue('中断后保留的草稿');
    await expect(access(join(fixture.project, 'crash-late.txt'))).rejects.toThrow();
    fixture.requestTool('powershell', { command: "Set-Content 'restarted.txt' 'restored'" });
    await fixture.invoke({ op: 'thread.send', id: 't', text: '继续原任务', attachments: [] });
    await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status, { timeout: 30000 }).toBe('idle');
    expect(await readFile(join(fixture.project, 'restarted.txt'), 'utf8')).toContain('restored');
    expect(fixture.errors).toEqual([]);
  } finally {
    try { await fixture.app.close(); await recoverSandboxRuns(join(fixture.storage, 'agent')); }
    finally { await fixture.close(); }
  }
});

for (const locale of ['zh-CN', 'en-US'] as const) test('sandbox startup recovery offers localized retry and keeps damaged records: ' + locale, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-sandbox-startup-')), storage = join(root, 'profile');
  const leases = join(storage, 'agent', 'sandbox-leases'); await mkdir(leases, { recursive: true });
  const record = join(leases, 'PiDesktop.Run.' + crypto.randomUUID().replaceAll('-', '') + '.json');
  await writeFile(record, '{damaged');
  const data = defaultData(); data.ui.locale = locale; data.settings.keepInTray = false; data.settings.shortcuts = { quickChat: '' };
  data.threads.push(threadSchema.parse({ id: 'saved', title: '保留聊天', projectId: '', cwd: root, createdAt: 1, updatedAt: 1, modelId: '', thinking: 'off', policy: 'deny' }));
  data.ui.activeThreadId = 'saved'; data.ui.threads.saved = { reviewTab: 'changes', terminalOpen: false, selectedPath: '', folds: {}, draft: { text: '保留输入内容', attachments: [] } };
  await writeFile(join(storage, 'desktop.json'), JSON.stringify(data));
  const hook = join(root, 'sandbox-dialog.cjs'), callsPath = join(root, 'dialogs.json');
  // Replace only the native dialog interaction; startup recovery still runs the real Windows broker.
  await writeFile(hook, [
    "const { dialog, shell } = require('electron'); const fs = require('node:fs'); const calls = []; let count = 0;",
    'const save = () => fs.writeFileSync(' + JSON.stringify(callsPath) + ', JSON.stringify(calls));',
    "shell.openPath = async path => { calls.push({ open: path }); save(); return ''; };",
    "dialog.showMessageBox = async (_window, options) => { calls.push(options); save(); if (++count === 1) return { response: 1 }; " + (locale === 'zh-CN' ? 'fs.unlinkSync(' + JSON.stringify(record) + '); return { response: 0 };' : 'return { response: 2 };') + ' };',
  ].join('\n'));
  const env = { ...process.env, PI_DESKTOP_USER_DATA: storage, ELECTRON_RENDERER_URL: development.url } as Record<string, string>; delete env.ELECTRON_RUN_AS_NODE;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['-r', hook, resolve('out/main/index.js')], env });
    const page = await application.firstWindow(); await page.locator('.desktop').waitFor();
    await expect(page.locator('textarea')).toHaveValue('保留输入内容');
    const calls = JSON.parse(await readFile(callsPath, 'utf8')) as { title?: string; message?: string; buttons?: string[]; open?: string }[];
    expect(calls[0].title).toBe(locale === 'zh-CN' ? '沙箱恢复未完成' : 'Sandbox recovery is incomplete');
    expect(calls[0].buttons).toEqual(locale === 'zh-CN' ? ['重试', '打开数据目录', '继续打开'] : ['Retry', 'Open data folder', 'Continue opening']);
    expect(calls[0].message).toContain(locale === 'zh-CN' ? '不会执行新的沙箱命令' : 'new sandbox commands will not run');
    expect(calls.find(call => call.open)?.open).toBe(leases);
    if (locale === 'zh-CN') await expect(access(record)).rejects.toThrow();
    else expect(await readFile(record, 'utf8')).toBe('{damaged');
  } finally { await application?.close(); }
});
