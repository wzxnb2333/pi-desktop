import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSubtaskObserverRequest } from '../src/main/subtask-observer.ts';
import { defaultData, threadSchema, type DesktopRequest } from '../src/shared/contracts.ts';

test('child conversations stay observer-only after completion and cannot gain permissions through IPC', () => {
  const data = defaultData();
  data.threads.push(threadSchema.parse({ id: 'child', subtaskId: crypto.randomUUID(), projectId: 'p', title: 'Child', cwd: 'unused', createdAt: 1, updatedAt: 1, modelId: 'local', policy: 'deny', thinking: 'off' }));
  const requests: DesktopRequest[] = [
    { op: 'thread.update', id: 'child', policy: 'full' },
    { op: 'thread.send', id: 'child', text: 'interfere', attachments: [] },
    { op: 'thread.stop', id: 'child' },
    { op: 'thread.resume', id: 'child' },
    { op: 'window.open', kind: 'task', threadId: 'child' },
    { op: 'file.write', threadId: 'child', path: 'test.txt', content: 'changed', version: 'old' },
  ];
  for (const request of requests) assert.throws(() => assertSubtaskObserverRequest(data, request), /主代理/);
  assert.throws(() => assertSubtaskObserverRequest(data, { op: 'terminal.input', id: 'terminal', data: 'edit' }, [{ id: 'terminal', threadId: 'child' }]), /主代理/);
  assert.doesNotThrow(() => assertSubtaskObserverRequest(data, { op: 'thread.stop', id: 'parent' }));
});

test('manual delegation, stopping and result insertion are unavailable while safe approval replies remain available', () => {
  const data = defaultData(), id = crypto.randomUUID();
  assert.throws(() => assertSubtaskObserverRequest(data, { op: 'subtask.stop', parentThreadId: 'parent', id }), /主代理/);
  assert.throws(() => assertSubtaskObserverRequest(data, { op: 'subtask.deliver', parentThreadId: 'parent', id }), /主代理/);
  assert.throws(() => assertSubtaskObserverRequest(data, { op: 'subtask.create', parentThreadId: 'parent', requestId: id, definition: { title: 'Child', prompt: 'Read', environment: 'local', startPoint: 'HEAD', policy: 'deny', includeContext: true } }), /主代理/);
  assert.doesNotThrow(() => assertSubtaskObserverRequest(data, { op: 'approval.reply', id, approved: false }));
});
