import { execFileSync, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { Bootstrap } from '../../src/shared/contracts.ts';

test.afterAll(cleanupTemporaryDirectories);

test('NSIS installs, upgrades and uninstalls without losing user data', async () => {
  test.skip(
    !process.env.PI_DESKTOP_INSTALLER || !process.env.PI_DESKTOP_PREVIOUS_INSTALLER,
    'Set both installer paths to run install acceptance.',
  );
  test.setTimeout(180000);
  const installed = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName -eq 'Pi Desktop' | Select-Object -ExpandProperty InstallLocation",
    ],
    { windowsHide: true, encoding: 'utf8' },
  ).trim();
  test.skip(!!installed, 'A user installation already exists; preserving it.');
  const artifacts = resolve('../../.artifacts');
  const installPath = join(artifacts, 'install-smoke');
  const rel = relative(artifacts, installPath);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid install test path');
  const storage = await mkdtemp(join(tmpdir(), 'pi-upgrade-data-'));
  const executablePath = join(installPath, 'Pi Desktop.exe');
  const run = (path: string, args: string[]) =>
    new Promise<void>((done, reject) => {
      const child = spawn(path, args, { windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? done() : reject(new Error(`Installer exited with ${code}`)),
      );
    });
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const inspect = async (write: boolean) => {
    const application = await electron.launch({ executablePath, args: [`--user-data-dir=${storage}`], env });
    try {
      const page = await application.firstWindow();
      await page.waitForFunction(() => !!window.desktop);
      const bootstrap = (await page.evaluate(() => window.desktop.invoke({ op: 'bootstrap' }))) as Bootstrap;
      if (write)
        await page.evaluate(
          (settings) =>
            window.desktop.invoke({
              op: 'settings.save',
              settings: { ...settings, theme: 'dark', keepInTray: false },
            }),
          bootstrap.data.settings,
        );
      return { version: bootstrap.version, theme: bootstrap.data.settings.theme };
    } finally {
      await application.close();
    }
  };
  try {
    await run(process.env.PI_DESKTOP_PREVIOUS_INSTALLER!, ['/S', `/D=${installPath}`]);
    expect((await inspect(true)).version).toBe('0.0.9');
    await run(process.env.PI_DESKTOP_INSTALLER!, ['/S', `/D=${installPath}`]);
    expect(await inspect(false)).toEqual({ version: '0.1.0', theme: 'dark' });
  } finally {
    const uninstaller = join(installPath, 'Uninstall Pi Desktop.exe');
    if (
      await access(uninstaller).then(
        () => true,
        () => false,
      )
    )
      await run(uninstaller, ['/S']);
  }
  await expect
    .poll(() =>
      access(executablePath).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false);
  await access(join(storage, 'desktop.json'));
});
