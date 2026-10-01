import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { projectAction, projectEnvironmentSchema } from '../src/shared/project-environment.ts';
import { actionArguments } from '../src/main/action-shell.ts';

const exec = promisify(execFile);
test('project actions retain stable IDs and reject invalid references, duplicates and empty commands', () => {
  const env = projectEnvironmentSchema.parse({ initialization: 'echo init', actions: [{ id: 'check', name: '检查', command: 'echo check' }] });
  assert.equal(projectAction(env, 'initialization').command, 'echo init'); assert.equal(projectAction(env, 'action', 'check').name, '检查');
  assert.throws(() => projectAction(env, 'action', '检查'), /不存在/); assert.throws(() => projectAction(env, 'cleanup'), /尚未配置/);
  assert.throws(() => projectEnvironmentSchema.parse({ actions: [env.actions[0], env.actions[0]] }));
  assert.throws(() => projectEnvironmentSchema.parse({ actions: [{ id: 'x', name: ' ', command: 'x' }] }));
});
test('PowerShell action invocation preserves literal Chinese and propagates native and script failures', { skip: process.platform !== 'win32' }, async () => {
  const result = await exec('pwsh.exe', actionArguments('powershell', "Write-Output '动作 中文'; Write-Output 'literal $(1+1)'"), { windowsHide: true });
  assert.match(result.stdout, /动作 中文/); assert.match(result.stdout, /literal \$\(1\+1\)/);
  await assert.rejects(exec('pwsh.exe', actionArguments('powershell', "cmd /d /c 'exit 7'"), { windowsHide: true }), (error: unknown) => (error as { code: number }).code === 7);
  await assert.rejects(exec('pwsh.exe', actionArguments('powershell', "throw 'ACTION_FAILURE'"), { windowsHide: true }), /ACTION_FAILURE/);
});
