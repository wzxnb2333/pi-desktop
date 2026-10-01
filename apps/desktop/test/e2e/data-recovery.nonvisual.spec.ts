import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { defaultData, threadSchema } from '../../src/shared/contracts.ts';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.afterAll(cleanupTemporaryDirectories);

async function recoveryFixture(mode: 'invalid' | 'future' | 'backup' | 'legacy' | 'credentials') {
  const root = await mkdtemp(join(tmpdir(), 'pi-recovery-')), storage = join(root, 'profile'); await mkdir(storage);
  const data = defaultData(); data.settings.keepInTray = false; data.settings.shortcuts = { quickChat: '' };
  data.threads.push(threadSchema.parse({ id: 'preserved', projectId: '', title: '迁移不能丢失', cwd: root, providerId: '', thinking: 'off', policy: 'deny', createdAt: 1, updatedAt: 1 }));
  data.ui.activeThreadId = 'preserved'; data.ui.threads.preserved = { reviewTab: 'changes', terminalOpen: false, selectedPath: '', folds: {}, draft: { text: '旧草稿', attachments: [] } };
  const original = mode === 'invalid' || mode === 'backup' ? '{CORRUPT' : JSON.stringify({ ...data, version: mode === 'future' ? 9999 : mode === 'credentials' ? 2 : 1 });
  await writeFile(join(storage, 'desktop.json'), original);
  const recoveryRecord = join(storage, 'secrets-removal.json');
  if (mode === 'credentials') await writeFile(recoveryRecord, '{CORRUPT_CREDENTIAL_RECORD');
  if (mode === 'backup') await writeFile(join(storage, 'desktop.json.bak'), JSON.stringify(data));
  const callsPath = join(root, 'dialogs.json'), sourcePath = join(root, 'correct.json'); await writeFile(sourcePath, JSON.stringify(data));
  const hook = join(root, 'recovery-hook.cjs');
  // Preload only in this owned test process, before production index.js registers its startup flow.
  await writeFile(hook, [
    "const { dialog, shell } = require('electron');",
    "const fs = require('node:fs');",
    'const calls = [];',
    'const target = ' + JSON.stringify(join(storage, 'desktop.json')) + ';',
    'const callsPath = ' + JSON.stringify(callsPath) + ';',
    'const sourcePath = ' + JSON.stringify(sourcePath) + ';',
    'const mode = ' + JSON.stringify(mode) + ';',
    'const recoveryRecord = ' + JSON.stringify(recoveryRecord) + ';',
    "shell.openPath = async path => { calls.push({ open: path }); fs.writeFileSync(callsPath, JSON.stringify(calls)); return ''; };",
    "dialog.showMessageBox = async (_window, options) => { calls.push({ ...options, recoveryRecord: mode === 'credentials' ? fs.readFileSync(recoveryRecord, 'utf8') : undefined }); fs.writeFileSync(callsPath, JSON.stringify(calls)); if (mode === 'future' && calls.length === 1) return { response: 1 }; if (options.type === 'error') { if (mode === 'credentials') { fs.copyFileSync(recoveryRecord, recoveryRecord + '.preserved'); fs.writeFileSync(recoveryRecord, JSON.stringify({ version: 1, entries: {} })); } else fs.copyFileSync(sourcePath, target); return { response: 0 }; } return { response: 0 }; };",
  ].join('\n'));
  const env = { ...process.env, PI_DESKTOP_USER_DATA: storage, ELECTRON_RENDERER_URL: development.url } as Record<string, string>; delete env.ELECTRON_RUN_AS_NODE;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['-r', hook, resolve('out/main/index.js')], env }); const page = await application.firstWindow();
    await page.locator('.desktop').waitFor();
    return { root, storage, original, callsPath, app: application, page, close: async () => { await application!.close(); } };
  } catch (error) { await application?.close(); throw error; }
}

for (const mode of ['invalid', 'future', 'backup', 'legacy', 'credentials'] as const) test('native startup ' + mode + ' preserves data and offers real recovery', async () => {
  const fixture = await recoveryFixture(mode);
  try {
    await expect(fixture.page.getByRole('textbox', { name: '向 Pi 发送消息', exact: true })).toHaveValue('旧草稿');
    const saved = JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')); expect(saved.version).toBe(2);
    expect(saved.threads[0].title).toBe('迁移不能丢失');
    if (mode === 'legacy') {
      const backup = (await readdir(fixture.storage)).find(name => name.startsWith('desktop.pre-migration-v1-'))!;
      expect(await readFile(join(fixture.storage, backup), 'utf8')).toBe(fixture.original);
      await expect(access(fixture.callsPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } else {
      const calls = JSON.parse(await readFile(fixture.callsPath, 'utf8')) as { type?: string; message?: string; open?: string; buttons?: string[]; recoveryRecord?: string }[];
      if (mode === 'backup') {
        expect(calls[0].message).toBe('已从备份恢复桌面数据');
        const corrupt = (await readdir(fixture.storage)).find(name => name.startsWith('desktop.corrupt-'))!; expect(await readFile(join(fixture.storage, corrupt), 'utf8')).toBe(fixture.original);
      } else {
        expect(calls[0].buttons).toEqual(['重试', '打开数据目录', '退出']);
        expect(calls[0].message).toContain(mode === 'future' ? '更新版本' : mode === 'credentials' ? '凭据存储无法恢复' : '原文件已保留');
        if (mode === 'future') expect(calls.find(item => item.open)?.open).toBe(fixture.storage);
        if (mode === 'credentials') {
          expect(calls).toHaveLength(1);
          expect(calls[0].recoveryRecord).toBe('{CORRUPT_CREDENTIAL_RECORD');
          expect(await readFile(join(fixture.storage, 'secrets-removal.json.preserved'), 'utf8')).toBe('{CORRUPT_CREDENTIAL_RECORD');
          await expect(access(join(fixture.storage, 'secrets-removal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
        }
      }
    }
  } finally { await fixture.close(); }
});
