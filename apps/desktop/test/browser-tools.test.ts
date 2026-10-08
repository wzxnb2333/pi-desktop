import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { browserToolSchema, browserSitePoliciesSchema } from '../src/shared/browser-tools.ts';
import { defaultData, requestSchema, threadSchema } from '../src/shared/contracts.ts';
import { browserControlAllowed } from '../src/shared/browser-access.ts';
import { Operations } from '../src/main/operations.ts';
import type { OperationRecord } from '../src/shared/operations.ts';
import { browserKeyboardEvents, browserMouseEvents } from '../src/main/browser-input.ts';
import { browserTool } from '../src/worker/browser-tool.ts';
import { BrowserTools } from '../src/main/browser-tools.ts';
import type { PreviewService } from '../src/main/preview.ts';
import type { BrowserWindow } from 'electron';

test('browser requests reject arbitrary code, unsafe URLs and unbounded waits', () => {
  for (const url of ['', 'not a URL', 'javascript:alert(1)', 'file:///C:/secret.txt', 'data:text/html,test', 'https://user:secret@example.com'])
    assert.equal(browserToolSchema.safeParse({ action: 'navigate', url }).success, false);
  for (const request of [{ action: 'evaluate', code: 'alert(1)' }, { action: 'inspect' }, { action: 'click', tabId: 't' }, { action: 'type', tabId: 't', ref: 'r' }, { action: 'wait', tabId: 't', milliseconds: 10001 }])
    assert.equal(browserToolSchema.safeParse(request).success, false);
  assert.equal(browserToolSchema.safeParse({ action: 'type', tabId: 't', ref: 'r', text: "\"');window.evil=true;//" }).success, true);
  assert.deepEqual(defaultData().settings.browserSitePolicies, {});
  assert.equal(browserSitePoliciesSchema.safeParse({ 'https://example.com/path': 'allow' }).success, false);
  assert.equal(requestSchema.safeParse({ op: 'browser.site', origin: 'https://example.com', policy: 'allow' }).success, true);
});

test('browser control accepts semantic and visual actions with bounded conditions', () => {
  assert.equal(browserToolSchema.safeParse({ action: 'open', url: 'https://example.com' }).success, true);
  assert.equal(browserToolSchema.safeParse({ action: 'click', tabId: 't', locator: { role: 'button', name: 'Continue' } }).success, true);
  assert.equal(browserToolSchema.safeParse({ action: 'click', tabId: 't', ref: 'e1', observationRevision: 'revision-1' }).success, true);
  assert.equal(browserToolSchema.safeParse({ action: 'type', tabId: 't', locator: { placeholder: 'Search' }, text: 'Pi', append: true }).success, true);
  assert.equal(browserToolSchema.safeParse({ action: 'key', tabId: 't', keys: ['Control', 'l'] }).success, true);
  assert.equal(browserToolSchema.safeParse({ action: 'drag', tabId: 't', x: 10, y: 20, target: { x: 100, y: 200 } }).success, true);
  assert.equal(browserToolSchema.safeParse({ action: 'drag', tabId: 't', x: 10, y: 20, target: { locator: { role: 'button', name: 'Drop here' } } }).success, true);
  assert.equal(browserToolSchema.safeParse({ action: 'drag', tabId: 't', x: 10, y: 20, target: { ref: 'drop-target' } }).success, true);
  assert.equal(browserToolSchema.safeParse({ action: 'wait', tabId: 't', condition: { kind: 'text', value: 'loaded' }, milliseconds: 10000 }).success, true);
  assert.equal(browserToolSchema.safeParse({ action: 'click', tabId: 't', x: 10 }).success, false);
  assert.equal(browserToolSchema.safeParse({ action: 'drag', tabId: 't', x: 10, y: 20, target: { x: 100 } }).success, false);
  assert.equal(browserToolSchema.safeParse({ action: 'drag', tabId: 't', x: 10, y: 20, target: {} }).success, false);
  assert.equal(browserToolSchema.safeParse({ action: 'wait', tabId: 't', condition: { kind: 'text' } }).success, false);
  assert.equal(browserToolSchema.safeParse({ action: 'navigate', tabId: 't', url: 'https://example.com', backend: 'chrome' }).success, true);
});

test('main-process operation wait returns completed results and cancellation without restarting work', async () => {
  const records: OperationRecord[] = []; const operations = new Operations(() => records, async () => {}, () => {});
  const id = crypto.randomUUID();
  await operations.start({ id, threadId: 't', directoryId: '', kind: 'browser.wait' }, async signal => {
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); signal.throwIfAborted(); return null;
  });
  operations.cancel('t', id); assert.equal((await operations.wait('t', id)).status, 'cancelled');
  await assert.rejects(operations.wait('another', id), /不属于/);
  const success = crypto.randomUUID();
  await operations.start({ id: success, threadId: 't', directoryId: '', kind: 'browser.inspect' }, async () => ({ ok: true }));
  assert.deepEqual((await operations.wait('t', success)).result, { ok: true }); await operations.dispose();
});

test('browser input chords preserve modifiers and drag releases the pointer', () => {
  const keys = browserKeyboardEvents({ keys: ['Control', 'a'] });
  assert.deepEqual(keys.map(event => [event.type, event.key, event.modifiers]), [['rawKeyDown', 'Control', 2], ['rawKeyDown', 'a', 2], ['keyUp', 'a', 2], ['keyUp', 'Control', 2]]);
  assert.deepEqual(browserKeyboardEvents({ key: 'Ctrl+a' }), keys);
  assert.equal(browserKeyboardEvents({ keys: ['Shift', 'a'] })[1].text, 'A');
  assert.throws(() => browserKeyboardEvents({ key: 'UnsupportedKey' }), /不支持/);
  const events = browserMouseEvents('drag', { x: 20, y: 30 }, { x: 100, y: 200 });
  assert.equal(events.filter(event => event.buttons === 1).length, 13);
  assert.deepEqual(events.at(-1), { type: 'mouseReleased', x: 100, y: 200, button: 'left', buttons: 0, clickCount: 1 });
});

test('browser authority is closed for children, read-only chats, archived tasks and untrusted projects', () => {
  const thread = threadSchema.parse({ id: 'main', projectId: 'project', cwd: 'C:/project', title: 'Main', createdAt: 1, updatedAt: 1, modelId: 'model', thinking: 'high', policy: 'auto' });
  assert.equal(browserControlAllowed(thread, true), true);
  assert.equal(browserControlAllowed(thread, false), false);
  for (const patch of [{ projectId: '' }, { archived: true }, { deletedAt: 1 }, { planMode: true }, { policy: 'deny' as const }, { subtaskId: '00000000-0000-4000-8000-000000000001' },
    { sidechat: { parentThreadId: 'parent', parentTitle: 'Parent', anchorItemId: 'anchor', capturedAt: 1, temporary: true, context: '' } }])
    assert.equal(browserControlAllowed({ ...thread, ...patch }, true), false);
});

test('browser tool publishes main-process progress and preserves its operation metadata in the completed result', async () => {
  const updates: unknown[] = [];
  const tool = browserTool(async (_request, _signal, onData) => {
    onData?.(new TextEncoder().encode(JSON.stringify({ backend: 'chrome', action: 'inspect', tabId: 'session/1', operationId: 'operation', stage: '正在通过 Chrome 扩展执行' })));
    return { result: { content: [{ type: 'text', text: '{"url":"https://example.com/"}' }] } };
  });
  const result = await tool.execute('call', { backend: 'chrome', action: 'inspect', tabId: 'session/1' }, undefined, value => updates.push(value), {} as Parameters<typeof tool.execute>[4]);
  assert.equal(updates.length, 1);
  assert.match(JSON.stringify(updates[0]), /正在通过 Chrome 扩展执行/);
  assert.match(JSON.stringify(result.details), /"operationId":"operation"/);
  assert.match(JSON.stringify(result.details), /"stage":"操作完成"/);
});

for (const kind of ['key', 'drag'] as const) test(`cancelled ${kind} releases held input and detaches the debugger`, async () => {
  const calls: Record<string, unknown>[] = []; let attached = false, cancelled = false, restored = false;
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => 'https://example.com/', isDestroyed: () => false, isCrashed: () => false, stop() {},
    executeJavaScriptInIsolatedWorld: async () => ({ point: { x: 20, y: 20 } }),
    debugger: { isAttached: () => attached, attach() { attached = true; }, detach() { attached = false; }, async sendCommand(_method: string, event: Record<string, unknown>) {
      calls.push(event); if (event.type === 'rawKeyDown' || event.type === 'mousePressed') cancelled = true;
    } },
  });
  const preview = { agentContents: () => contents, agentFocus: () => () => { restored = true; }, agentInput: async (_thread: string, _tab: string, perform: () => Promise<void>) => perform() } as unknown as PreviewService;
  const tools = new BrowserTools(preview, () => 'allow');
  const request = kind === 'key' ? { action: kind, tabId: 'tab', keys: ['Control', 'a'] } : { action: kind, tabId: 'tab', x: 20, y: 20, target: { x: 60, y: 60 } };
  await assert.rejects(tools.run('task', request, {} as BrowserWindow, new AbortController().signal, async () => {}, () => {}, () => { if (cancelled) throw new Error('REVOKED_DURING_INPUT'); }), /REVOKED_DURING_INPUT/);
  assert.equal(attached, false); assert.equal(restored, true);
  if (kind === 'key') assert.deepEqual(calls.map(event => [event.type, event.key, event.modifiers]), [['rawKeyDown', 'Control', 2], ['keyUp', 'Control', 0]]);
  else assert.deepEqual(calls.at(-1), { type: 'mouseReleased', x: -1, y: -1, button: 'left', buttons: 0, clickCount: 1 });
});

test('renderer loss during inspection rejects promptly and removes its interruption listeners', async () => {
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => 'https://example.com/', isDestroyed: () => false, isCrashed: () => false, stop() {},
    executeJavaScriptInIsolatedWorld: () => { started(); return new Promise<never>(() => {}); },
  });
  const preview = { agentContents: () => contents, agentFocus: () => () => {} } as unknown as PreviewService;
  const tools = new BrowserTools(preview, () => 'allow');
  const inspecting = tools.run('task', { action: 'inspect', tabId: 'tab' }, {} as BrowserWindow, new AbortController().signal, async () => {}, () => {});
  const failed = assert.rejects(inspecting, /网页进程已结束/); await ready; contents.emit('render-process-gone'); await failed;
  assert.equal(contents.listenerCount('render-process-gone'), 0); assert.equal(contents.listenerCount('destroyed'), 0);
});

test('load waits enforce their deadline without queuing DOM work and recover after cancellation', async () => {
  let loading = true, reads = 0;
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => 'https://example.com/', isDestroyed: () => false, isCrashed: () => false, isLoading: () => loading, stop() {},
    executeJavaScriptInIsolatedWorld: async () => { reads++; return { url: 'https://example.com/', conditionMet: true }; },
  });
  const tools = new BrowserTools({ agentContents: () => contents, agentFocus: () => () => {} } as unknown as PreviewService, () => 'allow');
  const started = Date.now();
  await assert.rejects(tools.run('task', { action: 'wait', tabId: 'tab', condition: { kind: 'load' }, milliseconds: 60 }, {} as BrowserWindow, new AbortController().signal, async () => {}, () => {}), /等待浏览器条件超时/);
  assert.equal(reads, 0); assert.ok(Date.now() - started < 600);
  const controller = new AbortController();
  const cancelled = tools.run('task', { action: 'wait', tabId: 'tab', condition: { kind: 'load' }, milliseconds: 10000 }, {} as BrowserWindow, controller.signal, async () => {}, () => {});
  const stopped = assert.rejects(cancelled, { name: 'AbortError' }); controller.abort(); await stopped;
  loading = false;
  const result = await tools.run('task', { action: 'wait', tabId: 'tab', condition: { kind: 'load' }, milliseconds: 1000 }, {} as BrowserWindow, new AbortController().signal, async () => {}, () => {});
  assert.equal((JSON.parse(String(result.result.content[0].text)) as { page: { conditionMet: boolean } }).page.conditionMet, true); assert.equal(reads, 1);
});

test('stalled DOM waits time out or cancel promptly and remove interruption listeners', async () => {
  let started!: () => void;
  let ready = new Promise<void>(resolve => { started = resolve; });
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => 'https://example.com/', isDestroyed: () => false, isCrashed: () => false, isLoading: () => false, stop() {},
    executeJavaScriptInIsolatedWorld: () => { started(); return new Promise<never>(() => {}); },
  });
  const tools = new BrowserTools({ agentContents: () => contents, agentFocus: () => () => {} } as unknown as PreviewService, () => 'allow');
  const began = Date.now();
  await assert.rejects(tools.run('task', { action: 'wait', tabId: 'tab', condition: { kind: 'text', value: 'missing' }, milliseconds: 60 }, {} as BrowserWindow, new AbortController().signal, async () => {}, () => {}), /等待浏览器条件超时/);
  assert.ok(Date.now() - began < 600);
  ready = new Promise<void>(resolve => { started = resolve; });
  const controller = new AbortController();
  const cancelled = tools.run('task', { action: 'wait', tabId: 'tab', condition: { kind: 'text', value: 'missing' }, milliseconds: 10000 }, {} as BrowserWindow, controller.signal, async () => {}, () => {});
  const stopped = assert.rejects(cancelled, { name: 'AbortError' }); await ready; controller.abort(); await stopped;
  assert.equal(contents.listenerCount('render-process-gone'), 0); assert.equal(contents.listenerCount('destroyed'), 0);
});

test('in-app navigation rechecks task authority after approval before loading the target page', async () => {
  let denied = false, loads = 0;
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => 'https://example.com/', isDestroyed: () => false, isCrashed: () => false, stop() {},
    loadURL: async () => { loads++; }, executeJavaScriptInIsolatedWorld: async () => ({}),
  });
  const tools = new BrowserTools({ agentContents: () => contents, agentTabs: () => [{ tabId: 'tab' }], agentFocus: () => () => {} } as unknown as PreviewService, () => 'allow');
  await assert.rejects(tools.run('task', { action: 'navigate', tabId: 'tab', url: 'https://example.com/new' }, {} as BrowserWindow, new AbortController().signal, async () => { denied = true; }, () => {}, () => { if (denied) throw new Error('TASK_ACCESS_REVOKED'); }), /TASK_ACCESS_REVOKED/);
  assert.equal(loads, 0);
});
