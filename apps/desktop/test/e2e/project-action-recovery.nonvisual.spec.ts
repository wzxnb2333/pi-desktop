import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { OperationRecord } from '../../src/shared/operations.ts';
import { projectEnvironmentSchema } from '../../src/shared/project-environment.ts';
import { processAlive, slowGitFixture } from '../fixtures/git-process.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => {
  const errors = [...fixture.errors]; await fixture.close();
  await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
});

test('project environment disk failure keeps the saved command, retains the editor draft and allows the same save to retry', async () => {
  const base = projectEnvironmentSchema.parse({});
  const original = projectEnvironmentSchema.parse({ actions: [{ id: 'check', name: '检查', command: "Write-Output 'SAVED_COMMAND'" }] });
  await fixture.invoke({ op: 'project.environment', projectId: 'p', environment: original, base });
  const page = fixture.page;
  await page.getByRole('button', { name: '项目动作', exact: true }).click();
  await page.getByRole('menuitem', { name: '配置环境与动作' }).click();
  const editor = page.getByRole('dialog', { name: '项目环境与动作' });
  const command = editor.getByLabel('动作命令 1'); await command.fill("Write-Output 'NEW_COMMAND'");
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try {
    await editor.getByRole('button', { name: '保存项目环境', exact: true }).click();
    await expect(editor.getByRole('alert')).toBeVisible();
    expect((await fixture.snapshot()).data.projects[0].environment).toEqual(original);
    expect(JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')).projects[0].environment).toEqual(original);
    await expect(command).toHaveValue("Write-Output 'NEW_COMMAND'");
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await editor.getByRole('button', { name: '保存项目环境', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('项目环境已保存');
  await fixture.restart();
  expect((await fixture.snapshot()).data.projects[0].environment?.actions[0].command).toBe("Write-Output 'NEW_COMMAND'");
});

test('cancelling and quitting real project actions stops their descendants before recording completion', async () => {
  test.skip(process.platform !== 'win32', 'Uses the real Windows PTY');
  const slow = await slowGitFixture(fixture.storage);
  const command = '& ' + slow.command;
  const environment = projectEnvironmentSchema.parse({ actions: [{ id: 'hold', name: '等待动作', command }] });
  await fixture.invoke({ op: 'project.environment', projectId: 'p', environment, base: projectEnvironmentSchema.parse({}) });
  const operation = (id: string) => fixture.snapshot().then(state => state.data.operations.find(item => item.id === id)!);
  try {
    const job = await fixture.invoke({ op: 'project.action', threadId: 't', requestId: crypto.randomUUID(), kind: 'action', actionId: 'hold' }) as OperationRecord;
    const first = await slow.ready();
    await fixture.invoke({ op: 'operation.cancel', threadId: 't', requestId: job.id });
    await expect.poll(async () => (await operation(job.id)).status).toBe('cancelled');
    expect(first.filter(processAlive)).toEqual([]);
    const next = await fixture.invoke({ op: 'project.action', threadId: 't', requestId: crypto.randomUUID(), kind: 'action', actionId: 'hold' }) as OperationRecord;
    const second = await slow.ready();
    const closed = fixture.app.waitForEvent('close');
    await fixture.invoke({ op: 'window', action: 'close' }); await closed;
    expect(second.filter(processAlive)).toEqual([]);
    await fixture.restart(); expect((await operation(next.id)).status).toBe('cancelled');
  } finally { await slow.cleanup(); }
});
