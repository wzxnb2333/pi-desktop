import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { mkdtemp } from './fixtures/node-temp.ts';
import { sandboxPowerShell } from '../src/main/windows-sandbox.ts';

test('Windows sandbox enforces real process file and network boundaries and cleans its runs', { skip: process.platform !== 'win32', timeout: 45000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-sandbox-'));
  const project = join(root, 'project'), storage = join(root, 'private'); await mkdir(project); await mkdir(storage);
  await writeFile(join(root, 'outside.txt'), 'private');
  const operations = sandboxPowerShell(storage); let output = '';
  const windowsShell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const acl = () => execFileSync(windowsShell, ['-NoProfile', '-NonInteractive', '-Command', "[IO.Directory]::GetAccessControl('" + project.replaceAll("'", "''") + "').GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)"], { encoding: 'utf8', windowsHide: true }).trim();
  const originalAcl = acl();
  const run = (command: string) => operations.exec(command, project, { onData: chunk => { output += chunk.toString(); } });
  const outside = join(root, 'outside.txt').replaceAll("'", "''");
  assert.equal((await run("Set-Content -LiteralPath 'inside.txt' -Value 'isolated'; Write-Output $env:PI_SANDBOX")).exitCode, 0, output);
  assert.match(output, /appcontainer/); assert.match(await readFile(join(project, 'inside.txt'), 'utf8'), /isolated/);
  assert.doesNotMatch(output, /#< CLIXML|<Objs Version=/);
  output = '';
  assert.notEqual((await run("[IO.File]::ReadAllText('" + outside + "')")).exitCode, 0, output);
  assert.notEqual((await run("[IO.File]::WriteAllText('" + outside + "','escaped')")).exitCode, 0, output);
  assert.equal(await readFile(join(root, 'outside.txt'), 'utf8'), 'private');
  await symlink(storage, join(project, 'outside-link'), 'junction');
  await assert.rejects(readFile(join(storage, 'escaped.txt')));
  assert.notEqual((await run("[IO.File]::WriteAllText('" + join(project, 'outside-link', 'escaped.txt').replaceAll("'", "''") + "','escape')")).exitCode, 0);
  await assert.rejects(readFile(join(storage, 'escaped.txt')));
  const secret = process.env.PI_SANDBOX_TEST_SECRET;
  process.env.PI_SANDBOX_TEST_SECRET = 'PRIVATE_ENV_VALUE';
  try {
    output = '';
    assert.equal((await run("if ($env:PI_SANDBOX_TEST_SECRET) { throw 'inherited private environment' }; Write-Output 'ENV_ISOLATED'")).exitCode, 0, output);
    assert.match(output, /ENV_ISOLATED/); assert.doesNotMatch(output, /PRIVATE_ENV_VALUE/);
  } finally {
    if (secret === undefined) delete process.env.PI_SANDBOX_TEST_SECRET;
    else process.env.PI_SANDBOX_TEST_SECRET = secret;
  }
  await assert.rejects(sandboxPowerShell(join(project, '.agent')).exec('echo blocked', project, { onData() {} }), /工作目录过宽/);
  let connections = 0;
  const server = createServer(socket => { connections++; socket.end(); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    assert.notEqual((await operations.exec("$socket=New-Object Net.Sockets.TcpClient; $socket.Connect('127.0.0.1'," + address.port + ")", project, { timeout: 3, onData() {} })).exitCode, 0);
    assert.equal(connections, 0);
  }
  finally { await new Promise<void>(done => server.close(() => done())); }
  const controller = new AbortController();
  await assert.rejects(operations.exec("Write-Output 'CANCEL_READY'; Start-Sleep 20; Set-Content 'should-not-exist.txt' 'escaped'", project, {
    signal: controller.signal,
    onData(chunk) { if (chunk.toString().includes('CANCEL_READY')) controller.abort(); },
  }), /已取消/);
  await assert.rejects(readFile(join(project, 'should-not-exist.txt')));
  output = '';
  // A detached child must be terminated when its root command exits.
  assert.equal((await run("$child=Start-Process -FilePath $env:ComSpec -ArgumentList '/d','/c','ping -n 30 127.0.0.1 > nul' -PassThru; Write-Output ('CHILD_PID=' + $child.Id)")).exitCode, 0, output);
  const child = /CHILD_PID=(\d+)/.exec(output); assert.ok(child, output);
  assert.throws(() => process.kill(Number(child[1]), 0), { code: 'ESRCH' });
  const concurrent = await Promise.all([
    operations.exec("Set-Content 'concurrent-a.txt' 'a'; Start-Sleep -Milliseconds 200", project, { onData() {} }),
    operations.exec("Set-Content 'concurrent-b.txt' 'b'; Start-Sleep -Milliseconds 200", project, { onData() {} }),
  ]);
  assert.deepEqual(concurrent.map(run => run.exitCode), [0, 0]);
  assert.equal(acl(), originalAcl, 'temporary package ACL entries must be removed without replacing user permissions');
  assert.deepEqual(await readdir(join(storage, 'sandbox-runs')), []);
});
