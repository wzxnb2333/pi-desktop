import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mkdtemp } from './fixtures/node-temp.ts';
import { recoverSandboxRuns, sandboxPowerShell } from '../src/main/windows-sandbox.ts';

test('sandbox recovers its permissions and profile after the native broker is killed', { skip: process.platform !== 'win32', timeout: 45000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-sandbox-recovery-'));
  const project = join(root, 'project'), storage = join(root, 'private');
  await mkdir(project); await mkdir(storage);
  const shell = join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const acl = () => execFileSync(shell, ['-NoProfile', '-Command', "[IO.Directory]::GetAccessControl('" + project.replaceAll("'", "''") + "').GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)"], { encoding: 'utf8', windowsHide: true }).trim();
  const original = acl();
  const operations = sandboxPowerShell(storage);
  let output = '', killed = false;
  try {
    await operations.exec('Write-Output warmup', project, { onData() {} });
    const executable = join(storage, 'sandbox-runtime', (await readdir(join(storage, 'sandbox-runtime'))).find(name => name.endsWith('.exe'))!);
    await operations.exec("Write-Output 'BROKER_CRASH_READY'; Start-Sleep 30; Set-Content 'escaped.txt' 'late'", project, { onData(data) {
      output += data.toString();
      if (killed || !output.includes('BROKER_CRASH_READY')) return;
      const pid = Number(execFileSync(shell, ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name LIKE 'launcher%.exe'\" | Where-Object { $_.ExecutablePath -eq '" + executable.replaceAll("'", "''") + "' }).ProcessId"], { encoding: 'utf8', windowsHide: true }).trim());
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      killed = true; process.kill(pid);
    } }).catch(error => { assert.match(String(error), /沙箱|sandbox/i); });
    assert.equal(killed, true, output);
    assert.notEqual(acl(), original, 'the fault must actually interrupt native cleanup');
    assert.equal((await sandboxPowerShell(storage).exec('Write-Output recovered', project, { onData() {} })).exitCode, 0);
    assert.equal(acl(), original, 'the next command must recover orphaned ACL entries');
    await assert.rejects(readFile(join(project, 'escaped.txt')));
    assert.deepEqual(await readdir(join(storage, 'sandbox-runs')), []);
    assert.deepEqual(await readdir(join(storage, 'sandbox-leases')), []);
  } finally {
    // The pre-fix reproduction must not leave OS profiles behind. Only this fixture's added SIDs qualify.
    const added = [...acl().matchAll(/S-1-15-2-(?:\d+-)*\d+/g)].map(match => match[0]).filter(sid => !original.includes(sid));
    const cleanup = join(root, 'cleanup-owned.ps1');
    await writeFile(cleanup, String.raw`param([string]$Project,[string]$Original,[string]$Sids)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PiTestProfile {
  [DllImport("userenv.dll",CharSet=CharSet.Unicode)] public static extern int DeriveAppContainerSidFromAppContainerName(string name,out IntPtr sid);
  [DllImport("userenv.dll",CharSet=CharSet.Unicode)] public static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll")] public static extern IntPtr FreeSid(IntPtr sid);
}
'@
foreach($item in Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'pidesktop.run.*') {
  $pointer=[IntPtr]::Zero
  try {
    if([PiTestProfile]::DeriveAppContainerSidFromAppContainerName($item.Name,[ref]$pointer) -lt 0) { throw 'Cannot derive profile SID' }
    $identity=[Security.Principal.SecurityIdentifier]::new($pointer)
    if(($Sids -split ',') -contains $identity.Value) {
      if([PiTestProfile]::DeleteAppContainerProfile($item.Name) -lt 0) { throw 'Cannot remove owned test profile' }
    }
  } finally { if($pointer -ne [IntPtr]::Zero) { [void][PiTestProfile]::FreeSid($pointer) } }
}
$permissions=[IO.Directory]::GetAccessControl($Project)
$permissions.SetSecurityDescriptorSddlForm($Original,[Security.AccessControl.AccessControlSections]::Access)
[IO.Directory]::SetAccessControl($Project,$permissions)
`);
    execFileSync(shell, ['-NoProfile', '-File', cleanup, project, original, added.join(',')], { windowsHide: true });
  }
});

test('recovery skips a live native lease without changing the running command', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-sandbox-recovery-'));
  const project = join(root, 'project'), storage = join(root, 'private');
  await mkdir(project); await mkdir(storage);
  const controller = new AbortController();
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  let output = '';
  const running = sandboxPowerShell(storage).exec("Write-Output 'LEASE_ACTIVE'; Start-Sleep 30", project, {
    signal: controller.signal, onData(data) { output += data.toString(); if (output.includes('LEASE_ACTIVE')) ready(); },
  });
  const stopped = assert.rejects(running, /已取消/);
  try {
    await Promise.race([started, running]);
    const before = await readdir(join(storage, 'sandbox-leases'));
    assert.equal(before.length, 1);
    await Promise.all([recoverSandboxRuns(storage), recoverSandboxRuns(storage)]);
    assert.deepEqual(await readdir(join(storage, 'sandbox-leases')), before);
    assert.equal((await readdir(join(storage, 'sandbox-runs'))).length, 1);
  } finally { controller.abort(); await stopped; }
  assert.deepEqual(await readdir(join(storage, 'sandbox-leases')), []);
});

test('damaged or linked recovery records fail closed and retain evidence for retry', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-sandbox-recovery-'));
  const project = join(root, 'project'), storage = join(root, 'private'), outside = join(root, 'outside');
  await mkdir(project); await mkdir(storage); await mkdir(outside);
  await writeFile(join(outside, 'keep.txt'), 'keep');
  const leases = join(storage, 'sandbox-leases'); await mkdir(leases);
  const profile = 'PiDesktop.Run.' + crypto.randomUUID().replaceAll('-', '');
  const record = join(leases, profile + '.json');
  await writeFile(record, '{broken');
  await assert.rejects(sandboxPowerShell(storage).exec("Set-Content 'should-not-run.txt' 'unexpected'", project, { onData() {} }), /沙箱恢复失败/);
  assert.equal(await readFile(record, 'utf8'), '{broken');
  await assert.rejects(readFile(join(project, 'should-not-run.txt')));
  await writeFile(record, JSON.stringify({ version: 1, profile, cwd: project, temp: outside }));
  await assert.rejects(recoverSandboxRuns(storage), /Invalid sandbox recovery scope/);
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'keep');
  const runs = join(storage, 'sandbox-runs'); await mkdir(runs);
  const temp = join(runs, 'run-linked'); await symlink(outside, temp, 'junction');
  await writeFile(record, JSON.stringify({ version: 1, profile, cwd: project, temp }));
  await assert.rejects(recoverSandboxRuns(storage), /recovery path is linked/);
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'keep');
  await rm(temp); await mkdir(temp);
  // A crash can occur after the lease is durable but before the profile exists.
  await recoverSandboxRuns(storage);
  await assert.rejects(readFile(record));
  await assert.rejects(readdir(temp));
  assert.equal((await sandboxPowerShell(storage).exec("Set-Content 'recovered.txt' 'ready'", project, { onData() {} })).exitCode, 0);
  assert.match(await readFile(join(project, 'recovered.txt'), 'utf8'), /ready/);
});
