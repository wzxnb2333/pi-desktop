import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { TerminalInfo, Thread } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); await fixture.invoke({ op: 'settings.patch', patch: { terminal: 'cmd' } }); });
test.afterEach(async () => { if (fixture) {
  const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
} });
const idle = () => expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.status).toBe('idle');
const result = async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.items.findLast(item => item.toolName === 'read_terminal')!;
async function read(args: Record<string, unknown>) {
  fixture.requestTool('read_terminal', args);
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'READ_TERMINAL_' + fixture.calls.length, attachments: [] });
  await idle(); const item = await result(); expect(item?.state, item?.text).toBe('done'); return JSON.parse(item.text);
}

test('model reads native terminal output incrementally without changing the process or draft', async () => {
  const terminal = await fixture.invoke({ op: 'terminal.open', threadId: 't' }) as TerminalInfo;
  await fixture.invoke({ op: 'terminal.input', id: terminal.id, data: 'echo TERMINAL_MODEL_FIRST\r' });
  await expect.poll(async () => (await fixture.snapshot()).terminals[0]?.output).toContain('TERMINAL_MODEL_FIRST');
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'UNSENT_TERMINAL_DRAFT', attachments: [] } } });
  const listed = await read({});
  expect(listed.terminals).toHaveLength(1); expect(listed.terminals[0].id).toBe(terminal.id);
  expect(JSON.stringify(listed)).not.toContain('TERMINAL_MODEL_FIRST');
  const first = await read({ terminalId: terminal.id });
  expect(first.output).toContain('TERMINAL_MODEL_FIRST'); expect(first.status).toBe('open');
  await fixture.invoke({ op: 'terminal.input', id: terminal.id, data: 'echo TERMINAL_MODEL_SECOND\r' });
  await expect.poll(async () => (await fixture.snapshot()).terminals[0]?.output).toContain('TERMINAL_MODEL_SECOND');
  const second = await read({ terminalId: terminal.id, cursor: first.cursor });
  expect(second.output).toContain('TERMINAL_MODEL_SECOND'); expect(second.output).not.toContain('TERMINAL_MODEL_FIRST');
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('UNSENT_TERMINAL_DRAFT');
  expect((await fixture.snapshot()).terminals[0].exited).toBe(false); expect((await fixture.snapshot()).approvals).toHaveLength(0);
  await fixture.invoke({ op: 'terminal.input', id: terminal.id, data: 'exit 7\r' });
  await expect.poll(async () => (await fixture.snapshot()).terminals[0]?.exited).toBe(true);
  const exited = await read({ terminalId: terminal.id, cursor: second.cursor });
  expect(exited.status).toBe('exited'); expect(exited.terminal.exitCode).toBe(7);
  await fixture.restart(); expect((await fixture.snapshot()).terminals).toEqual([]);
  const restored = await read({}); expect(restored.terminals).toEqual([]);
  fixture.requestTool('read_terminal', { terminalId: terminal.id, cursor: exited.cursor });
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'OLD_TERMINAL_AFTER_RESTART', attachments: [] }); await idle();
  expect((await result()).state).toBe('error'); expect((await result()).text).toContain('终端不存在或不属于此任务');
});

test('model terminal waits wake on output or close while stopping a read keeps the real process alive', async () => {
  await writeFile(join(fixture.project, 'terminal-wait.cjs'), 'const fs=require("node:fs");const seen=new Set();process.stdout.write("TERMINAL_WAIT_READY\\n");setInterval(()=>{for(const name of ["release","after-stop"]){if(!seen.has(name)&&fs.existsSync(name+".flag")){seen.add(name);process.stdout.write("OUTPUT_"+name+"\\n");}}},20);');
  const terminal = await fixture.invoke({ op: 'terminal.open', threadId: 't' }) as TerminalInfo;
  await fixture.invoke({ op: 'terminal.input', id: terminal.id, data: 'node terminal-wait.cjs\r' });
  await expect.poll(async () => (await fixture.snapshot()).terminals[0]?.output).toContain('TERMINAL_WAIT_READY');
  const initial = await read({ terminalId: terminal.id });
  const beginWait = async (cursor: string) => {
    fixture.requestTool('read_terminal', { terminalId: terminal.id, cursor, timeoutMs: 30000 });
    await fixture.invoke({ op: 'thread.send', id: 't', text: 'WAIT_FOR_TERMINAL_' + fixture.calls.length, attachments: [] });
    await expect.poll(async () => (await result())?.state).toBe('running');
  };
  await beginWait(initial.cursor);
  await writeFile(join(fixture.project, 'release.flag'), 'release'); await idle();
  const delivered = JSON.parse((await result()).text);
  expect(delivered.output).toContain('OUTPUT_release'); expect(delivered.changed).toBe(true); expect(delivered.timedOut).toBe(false);
  const timedOut = await read({ terminalId: terminal.id, cursor: delivered.cursor, timeoutMs: 50 });
  expect(timedOut.timedOut).toBe(true); expect(timedOut.changed).toBe(false); expect(timedOut.status).toBe('open');
  await beginWait(timedOut.cursor);
  await fixture.invoke({ op: 'thread.stop', id: 't' }); await idle();
  expect((await fixture.snapshot()).terminals[0].exited).toBe(false);
  await writeFile(join(fixture.project, 'after-stop.flag'), 'still running');
  await expect.poll(async () => (await fixture.snapshot()).terminals[0]?.output).toContain('OUTPUT_after-stop');
  const resumed = await read({ terminalId: terminal.id, cursor: timedOut.cursor });
  expect(resumed.output).toContain('OUTPUT_after-stop');
  await beginWait(resumed.cursor);
  await fixture.invoke({ op: 'terminal.close', id: terminal.id }); await idle();
  expect(JSON.parse((await result()).text).status).toBe('closed');
  expect((await fixture.snapshot()).terminals).toEqual([]);
});

test('model terminal access cannot reveal another chat or send shell input through read arguments', async () => {
  const foreign = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  const foreignTerminal = await fixture.invoke({ op: 'terminal.open', threadId: foreign.id }) as TerminalInfo;
  await fixture.invoke({ op: 'terminal.input', id: foreignTerminal.id, data: 'echo PRIVATE_OTHER_TERMINAL\r' });
  await expect.poll(async () => (await fixture.snapshot()).terminals[0]?.output).toContain('PRIVATE_OTHER_TERMINAL');
  const list = await read({}); expect(list.terminals).toEqual([]);
  fixture.requestTool('read_terminal', { terminalId: foreignTerminal.id });
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'REJECT_FOREIGN_TERMINAL', attachments: [] }); await idle();
  const denied = await result(); expect(denied.state).toBe('error'); expect(denied.text).not.toContain('PRIVATE_OTHER_TERMINAL');
  expect(denied.text).toContain('终端不存在或不属于此任务');
  const own = await fixture.invoke({ op: 'terminal.open', threadId: 't' }) as TerminalInfo;
  fixture.requestTool('read_terminal', { terminalId: own.id, input: 'echo injected>model-wrote.txt\r' });
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'REJECT_TERMINAL_INPUT', attachments: [] }); await idle();
  expect((await result()).state).toBe('error'); await expect(access(join(fixture.project, 'model-wrote.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  const recovered = await read({ terminalId: own.id }); expect(recovered.terminal.id).toBe(own.id);
});
