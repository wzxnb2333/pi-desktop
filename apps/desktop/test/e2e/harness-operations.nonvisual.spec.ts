import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Thread } from '../../src/shared/contracts.ts';
import type { OperationRecord } from '../../src/shared/operations.ts';
import { projectEnvironmentSchema } from '../../src/shared/project-environment.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => {
  fixture = await acceptanceApp(development.url);
  await writeFile(join(fixture.project, 'harness-action.cjs'), 'const fs=require("node:fs");process.stdout.write("HARNESS_ACTION_READY\\n");setInterval(()=>{if(fs.existsSync("release.flag")){process.stdout.write("HARNESS_ACTION_FINISHED\\n");process.exit(Number(process.argv[2]||0));}},20);');
  const environment = projectEnvironmentSchema.parse({ shell: 'cmd', actions: [{ id: 'test', name: 'Harness test', command: 'node harness-action.cjs 7' }] });
  await fixture.invoke({ op: 'project.environment', projectId: 'p', environment, base: projectEnvironmentSchema.parse({}) });
});
test.afterEach(async () => { if (fixture) {
  const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
} });
const idle = () => expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.status).toBe('idle');
const result = async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'manage_operations')!;
async function call(args: Record<string, unknown>, error = false) {
  fixture.requestTool('manage_operations', args);
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'OPERATIONS_' + fixture.calls.length, attachments: [] });
  await idle(); const item = await result(); expect(item?.state, item?.text).toBe(error ? 'error' : 'done');
  return error ? item.text : JSON.parse(item.text);
}
async function start(threadId = 't') {
  const operation = await fixture.invoke({ op: 'project.action', threadId, requestId: crypto.randomUUID(), kind: 'action', actionId: 'test' }) as OperationRecord;
  await expect.poll(async () => (await fixture.snapshot()).terminals.find(terminal => terminal.operationId === operation.id)?.output).toContain('HARNESS_ACTION_READY');
  return operation;
}
async function wait(operationId: string, cursor: string) {
  fixture.requestTool('manage_operations', { action: 'operations.wait', operationId, cursor, timeoutMs: 30000 });
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'OPERATIONS_WAIT_' + fixture.calls.length, attachments: [] });
  await expect.poll(async () => (await result())?.state).toBe('running');
}

test('model lists and starts a configured project action through scoped harness tools', async () => {
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'full' });
  fixture.requestTool('list_project_actions', {});
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'LIST_PROJECT_ACTIONS', attachments: [] });
  await idle();
  const listed = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'list_project_actions')!;
  expect(listed.state, listed.text).toBe('done');
  expect(listed.text).toContain('Harness test');
  expect(listed.text).toContain('node harness-action.cjs 7');

  fixture.requestTool('run_project_action', { kind: 'action', actionId: 'test', command: 'node harness-action.cjs 7' });
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'RUN_PROJECT_ACTION', attachments: [] });
  await idle();
  const started = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'run_project_action')!;
  expect(started.state, started.text).toBe('done');
  const operation = JSON.parse(started.text) as { id: string; status: string; kind: string };
  expect(operation.kind).toBe('environment.action.test');
  expect(operation.status).toBe('running');
  const call = fixture.calls.at(-1);
  expect(call?.tools?.map(tool => tool.function.name)).toContain('run_project_action');
  await writeFile(join(fixture.project, 'release.flag'), 'release');
  await expect.poll(async () => (await fixture.snapshot()).data.operations.find(item => item.id === operation.id)?.status).toBe('failed');
  expect((await fixture.snapshot()).data.operations.find(item => item.id === operation.id)?.result).toMatchObject({ exitCode: 7 });
});

test('model observes real project action exit, bounded result and restart without executing the action again', async () => {
  const action = await start();
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'PRIVATE_UNSENT_OPERATION_DRAFT', attachments: [] } } });
  const list = await call({ action: 'operations.list' }); expect(list.operations).toHaveLength(1); expect(list.operations[0].id).toBe(action.id);
  expect(list.operations[0].cancellable).toBe(false); expect(JSON.stringify(list)).not.toContain('PRIVATE_UNSENT');
  const initial = await call({ action: 'operations.read', operationId: action.id });
  expect(initial.settled).toBe(false); expect(initial.operation.result.terminalId).toBeTruthy();
  await wait(action.id, initial.cursor); await writeFile(join(fixture.project, 'release.flag'), 'release'); await idle();
  const finished = JSON.parse((await result()).text);
  expect(finished.settled).toBe(true); expect(finished.timedOut).toBe(false); expect(finished.operation.status).toBe('failed');
  expect(finished.operation.result.exitCode).toBe(7); expect(finished.operation.result.output).toContain('HARNESS_ACTION_FINISHED');
  expect(finished.operation.result).not.toHaveProperty('command'); expect(finished.operation.result).not.toHaveProperty('cwd');
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('PRIVATE_UNSENT_OPERATION_DRAFT');
  const count = fixture.calls.length; await fixture.restart(); expect(fixture.calls).toHaveLength(count);
  const restored = await call({ action: 'operations.read', operationId: action.id });
  expect(restored.operation.result.exitCode).toBe(7); expect(restored.operation.result.output).toContain('HARNESS_ACTION_FINISHED');
  expect((await fixture.snapshot()).terminals).toEqual([]); expect((await fixture.snapshot()).data.operations.filter(item => item.id === action.id)).toHaveLength(1);
});

test('model wait timeout and stopped inference preserve the action until an explicit scoped cancellation', async () => {
  const action = await start(), initial = await call({ action: 'operations.read', operationId: action.id });
  const timeout = await call({ action: 'operations.wait', operationId: action.id, cursor: initial.cursor, timeoutMs: 10 });
  expect(timeout.timedOut).toBe(true); expect(timeout.changed).toBe(false); expect(timeout.settled).toBe(false);
  await wait(action.id, timeout.cursor); await fixture.invoke({ op: 'thread.stop', id: 't' }); await idle();
  expect((await fixture.snapshot()).data.operations.find(item => item.id === action.id)?.status).toBe('running');
  expect((await fixture.snapshot()).terminals.find(item => item.operationId === action.id)?.exited).toBe(false);
  const cancellation = await call({ action: 'operations.cancel', operationId: action.id });
  expect(cancellation.cancelRequested).toBe(true);
  await expect.poll(async () => (await fixture.snapshot()).data.operations.find(item => item.id === action.id)?.status).toBe('cancelled');
  expect((await fixture.snapshot()).terminals.find(item => item.operationId === action.id)?.exited).toBe(true);
  const ended = await call({ action: 'operations.cancel', operationId: action.id }); expect(ended.cancelRequested).toBe(false); expect(ended.settled).toBe(true);
});

test('model operation access rejects foreign records, raw command injection and cancellation in read-only or plan mode', async () => {
  const foreign = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread, other = await start(foreign.id);
  expect((await call({ action: 'operations.list' })).operations).toEqual([]);
  expect(await call({ action: 'operations.read', operationId: other.id }, true)).toContain('操作不存在或不属于此任务');
  expect(await call({ action: 'operations.cancel', operationId: other.id }, true)).toContain('操作不存在或不属于此任务');
  const own = await start();
  await call({ action: 'operations.read', operationId: own.id, command: 'echo INJECTED>unsafe.txt' }, true);
  await expect(access(join(fixture.project, 'unsafe.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  for (const mode of [{ policy: 'deny' as const, planMode: false }, { policy: 'auto' as const, planMode: true }]) {
    await fixture.invoke({ op: 'thread.update', id: 't', ...mode });
    expect((await call({ action: 'operations.read', operationId: own.id })).operation.cancellable).toBe(false);
    expect(await call({ action: 'operations.cancel', operationId: own.id }, true)).toContain('此操作不允许模型取消');
    expect((await fixture.snapshot()).data.operations.find(item => item.id === own.id)?.status).toBe('running');
  }
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'auto', planMode: false });
  await call({ action: 'operations.cancel', operationId: own.id });
  expect((await fixture.snapshot()).data.operations.find(item => item.id === other.id)?.status).toBe('running');
});
