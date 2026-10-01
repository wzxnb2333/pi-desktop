import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerminalInfo } from '../src/shared/contracts.ts';
import { inspectTerminal } from '../src/main/terminal-inspection.ts';
import { appendTerminalOutput, terminalOutputEnd } from '../src/shared/terminal-output.ts';
import { getLocale, localizeAppError, setLocale, translate } from '../src/shared/localization.ts';

function fixture() {
  const own: TerminalInfo = { id: crypto.randomUUID(), threadId: 't', title: 'Own shell', exited: false, output: '', outputOffset: 0 };
  const foreign: TerminalInfo = { ...own, id: crypto.randomUUID(), threadId: 'other', title: 'PRIVATE_OTHER_TITLE', output: 'PRIVATE_OTHER_OUTPUT' };
  const terminals = [own, foreign], listeners = new Set<(id: string) => void>();
  let allowed = true;
  const runtime = { authorize: () => { if (!allowed) throw new Error('revoked'); return 't'; }, list: () => terminals,
    subscribe: (listener: (id: string) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const notify = (id = own.id) => { for (const listener of [...listeners]) listener(id); };
  const read = (args: { cursor?: string; maxChars?: number; timeoutMs?: number; terminalId?: string } = {}, signal = new AbortController().signal) =>
    inspectTerminal(runtime, { action: 'terminal.inspect', terminalId: own.id, ...args }, signal);
  const add = (text: string) => { Object.assign(own, appendTerminalOutput(own, text)); notify(); };
  return { own, foreign, terminals, runtime, listeners, notify, read, add, revoke: () => { allowed = false; } };
}

test('terminal listing projects only caller metadata and never output or other tasks', async () => {
  const f = fixture(); f.own.output = 'PRIVATE_OWN_OUTPUT';
  const result = await inspectTerminal(f.runtime, { action: 'terminal.inspect' }, new AbortController().signal);
  assert.equal(result.kind, 'list'); if (result.kind !== 'list') throw new Error('Expected list');
  assert.equal(result.terminals.length, 1); assert.equal(result.terminals[0].id, f.own.id);
  assert(!JSON.stringify(result).includes('PRIVATE_')); assert.equal(f.listeners.size, 0);
});

test('terminal tails and cursors page exact output without splitting unicode pairs or mutating the buffer', async () => {
  const f = fixture(); f.add('PREFIX' + 'x'.repeat(255) + '\uD842\uDFB7' + '尾'.repeat(300));
  const before = structuredClone(f.own), initial = await f.read({ maxChars: 256 });
  assert.equal(initial.kind, 'terminal'); if (initial.kind !== 'terminal') throw new Error('Expected output');
  assert.equal(initial.output, '尾'.repeat(256)); assert.equal(initial.skippedChars, before.output.length - 256);
  f.add('a'.repeat(255) + '\uD842\uDFB7' + 'b'.repeat(20));
  const first = await f.read({ cursor: initial.cursor, maxChars: 256 });
  if (first.kind !== 'terminal') throw new Error('Expected output');
  assert.equal(first.output, 'a'.repeat(255)); assert(first.hasMore);
  const second = await f.read({ cursor: first.cursor, maxChars: 256 });
  if (second.kind !== 'terminal') throw new Error('Expected output');
  assert.equal(second.output, '\uD842\uDFB7' + 'b'.repeat(20)); assert(!second.hasMore);
  assert.equal(second.endOffset, terminalOutputEnd(f.own));
  assert.equal(f.own.output, before.output + first.output + second.output);
  const unchanged = await f.read({ cursor: second.cursor });
  if (unchanged.kind !== 'terminal') throw new Error('Expected output');
  assert.equal(unchanged.output, ''); assert.equal(unchanged.changed, false); assert.equal(unchanged.timedOut, false);
});

test('trimmed terminal history reports skipped characters instead of silently inventing continuity', async () => {
  const f = fixture(), initial = await f.read();
  if (initial.kind !== 'terminal') throw new Error('Expected output');
  f.add('A'.repeat(220000));
  const tail = await f.read({ cursor: initial.cursor, maxChars: 256 });
  if (tail.kind !== 'terminal') throw new Error('Expected output');
  assert.equal(tail.skippedChars, 20000); assert.equal(tail.startOffset, 20000); assert.equal(tail.output.length, 256); assert(tail.hasMore);
});

test('terminal cursors cannot read foreign sessions and reject corruption or future offsets', async () => {
  const f = fixture(), initial = await f.read();
  if (initial.kind !== 'terminal') throw new Error('Expected output');
  await assert.rejects(f.read({ terminalId: f.foreign.id }), /终端不存在或不属于此任务/);
  await assert.rejects(f.read({ terminalId: crypto.randomUUID() }), /终端不存在或不属于此任务/);
  await assert.rejects(f.read({ cursor: 'corrupt' }), /终端读取游标无效/);
  const cursor = JSON.parse(Buffer.from(initial.cursor, 'base64url').toString());
  for (const patch of [{ threadId: 'other' }, { terminalId: f.foreign.id }, { offset: 1000000 }, { offset: -1 }]) {
    await assert.rejects(f.read({ cursor: Buffer.from(JSON.stringify({ ...cursor, ...patch })).toString('base64url') }), /终端读取游标无效/);
  }
  assert.equal(f.listeners.size, 0);
});

test('terminal wait wakes for incremental output and releases its subscription', async () => {
  const f = fixture(), initial = await f.read();
  if (initial.kind !== 'terminal') throw new Error('Expected output');
  const pending = f.read({ cursor: initial.cursor, timeoutMs: 1000 });
  assert.equal(f.listeners.size, 1); f.notify(f.foreign.id); assert.equal(f.listeners.size, 1);
  f.add('NEW_OUTPUT'); const result = await pending;
  if (result.kind !== 'terminal') throw new Error('Expected output');
  assert.equal(result.output, 'NEW_OUTPUT'); assert(result.changed); assert(!result.timedOut); assert.equal(f.listeners.size, 0);
});

test('terminal wait reports process exit, close and timeout distinctly', async () => {
  for (const action of ['exit', 'close', 'timeout']) {
    const f = fixture(), initial = await f.read();
    if (initial.kind !== 'terminal') throw new Error('Expected output');
    const pending = f.read({ cursor: initial.cursor, timeoutMs: 10 });
    if (action === 'exit') { f.own.exited = true; f.own.exitCode = 7; f.notify(); }
    if (action === 'close') { f.terminals.splice(0, 1); f.notify(); }
    const result = await pending; if (result.kind !== 'terminal') throw new Error('Expected output');
    assert.equal(result.status, action === 'exit' ? 'exited' : action === 'close' ? 'closed' : 'open');
    assert.equal(result.timedOut, action === 'timeout'); assert.equal(result.changed, action !== 'timeout');
    if (action === 'exit') assert.equal(result.terminal.exitCode, 7);
    assert.equal(f.listeners.size, 0);
  }
});

test('cancelling or revoking a terminal read releases listeners without stopping or changing the terminal', async () => {
  for (const action of ['abort', 'revoke']) {
    const f = fixture(), initial = await f.read(), controller = new AbortController();
    if (initial.kind !== 'terminal') throw new Error('Expected output');
    const before = structuredClone(f.own), pending = f.read({ cursor: initial.cursor, timeoutMs: 30000 }, controller.signal);
    const rejection = assert.rejects(pending, action === 'abort' ? /cancelled/ : /revoked/);
    if (action === 'abort') controller.abort(new Error('cancelled')); else { f.revoke(); f.notify(); }
    await rejection; assert.equal(f.listeners.size, 0); assert.deepEqual(f.own, before);
    if (action === 'abort') await assert.rejects(f.read({}, controller.signal), /cancelled/);
  }
});

test('terminal output appearing during subscription setup is not lost', async () => {
  const f = fixture(), initial = await f.read();
  if (initial.kind !== 'terminal') throw new Error('Expected output');
  const subscribe = f.runtime.subscribe;
  f.runtime.subscribe = listener => { f.add('BETWEEN_READ_AND_SUBSCRIBE'); return subscribe(listener); };
  const result = await f.read({ cursor: initial.cursor, timeoutMs: 1000 });
  if (result.kind !== 'terminal') throw new Error('Expected output');
  assert.equal(result.output, 'BETWEEN_READ_AND_SUBSCRIBE'); assert.equal(f.listeners.size, 0);
});

test('terminal tool labels and errors follow locale while raw terminal output stays unchanged', async () => {
  const previous = getLocale();
  try {
    setLocale('en-US');
    assert.equal(translate('en-US', '读取桌面终端'), 'Read desktop terminal');
    assert.equal(localizeAppError('终端不存在或不属于此任务'), 'The terminal is unavailable or does not belong to this task.');
    assert.equal(localizeAppError('终端读取游标无效，请重新读取'), 'The terminal cursor is invalid. Read the terminal again.');
    const f = fixture(); f.add('任务不存在\n原始输出\uD842\uDFB7'); const result = await f.read();
    if (result.kind !== 'terminal') throw new Error('Expected output');
    assert.equal(result.output, '任务不存在\n原始输出\uD842\uDFB7');
    setLocale('zh-CN'); assert.equal(localizeAppError('终端不存在或不属于此任务'), '终端不存在或不属于此任务');
  } finally { setLocale(previous); }
});
