import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { eventItem, messageItem, restoreItems } from '../src/worker/timeline.ts';
import { mergeTimelineItem } from '../src/shared/timeline.ts';
import { activity, activitySummary, editStats, elapsed } from '../src/renderer/src/lib/activity.ts';

test('internal child question notifications do not become duplicate user-visible messages', () => {
  const hidden = { role: 'custom', customType: 'pi-subtask-question', display: false, content: 'INTERNAL_CHILD_ROUTING', timestamp: 1 };
  assert.equal(messageItem(hidden), undefined);
  assert.deepEqual(restoreItems([{ message: hidden }]), []);
  assert.equal(messageItem({ ...hidden, customType: 'extension-notice', display: true })?.text, 'INTERNAL_CHILD_ROUTING');
});

test('timeline retains streamed thinking, tool arguments and error state', () => {
  const assistant = messageItem({
    role: 'assistant',
    timestamp: 42,
    content: [
      { type: 'thinking', thinking: '检查项目' },
      { type: 'text', text: '已找到问题' },
    ],
  });
  assert.equal(assistant?.thinking, '检查项目');
  assert.equal(assistant?.text, '已找到问题');
  const start = eventItem({
    type: 'tool_execution_start',
    toolCallId: 'tool-1',
    toolName: 'read',
    args: { path: 'hello.txt' },
  });
  const end = eventItem(
    {
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'read',
      result: { content: [{ type: 'text', text: 'not found' }], details: {} },
      isError: true,
    },
    start,
  );
  assert.equal(end?.id, start?.id);
  assert.equal(end?.args, start?.args);
  assert.equal(end?.state, 'error');
});

test('history reconstructs parallel tool arguments without inventing measured times', () => {
  const restored = restoreItems([
    { id: 'a', message: { role: 'assistant', timestamp: 1, stopReason: 'toolUse', content: [
      { type: 'thinking', thinking: '分析' }, { type: 'text', text: '说明' },
      { type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'a.ts' } },
      { type: 'toolCall', id: 'edit-1', name: 'edit', arguments: { path: 'b.ts', oldText: 'a', newText: 'b' } },
    ] } },
    { message: { role: 'toolResult', toolCallId: 'edit-1', timestamp: 3, content: 'done', details: { diff: '-1 a\n+1 b' } } },
    { message: { role: 'toolResult', toolCallId: 'read-1', timestamp: 4, content: 'contents' } },
  ]);
  assert.deepEqual(restored[0].blocks?.map(block => block.type), ['thinking', 'text', 'toolCall', 'toolCall']);
  assert.equal(JSON.parse(restored[1].args!).path, 'b.ts');
  assert.deepEqual(restored[1].details, { diff: '-1 a\n+1 b' });
  assert.equal(restored[2].toolName, 'read');
  assert.equal(restored[2].startedAt, undefined);
  const live = { ...restored[2], startedAt: 10, completedAt: 20, timestamp: 10 };
  const merged = mergeTimelineItem(restored[2], live);
  assert.equal(merged.startedAt, 10);
  assert.equal(merged.completedAt, 20);
  assert.equal(merged.timestamp, 10);
  assert.equal(merged.id, live.id);
});

test('validated edit details survive stream and history replacement; write has no invented diff', () => {
  const start = eventItem({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'edit', args: { path: 'a.ts' } }, undefined, 100);
  const end = eventItem({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'edit', result: { content: [], details: { diff: '-1 a\n+1 b\n+2 c', firstChangedLine: 1 } }, isError: false }, start, 1250)!;
  const history = messageItem({ role: 'toolResult', toolName: 'edit', toolCallId: 'c1', timestamp: 1250, content: 'done' })!;
  const merged = mergeTimelineItem(history, end);
  assert.deepEqual(editStats(merged), { added: 2, removed: 1 });
  assert.equal(elapsed(merged.startedAt, merged.completedAt), '1 秒');
  assert.equal(elapsed(undefined, 1250), '');
  assert.equal(messageItem({ role: 'toolResult', toolName: 'edit', details: { diff: 2 }, content: '' })?.details, undefined);
  assert.equal(editStats({ ...end, toolName: 'write' }), undefined);
  assert.match(activity({ ...end, toolName: 'write' }).label, /已写入/);
  assert.equal(activity({ ...end, toolName: 'bash', args: '{ broken' }).kind, 'command');
  assert.equal(activity({ ...end, toolName: 'custom' }).kind, 'tool');
  assert.equal(activitySummary([{ ...end, toolName: 'read' }, { ...end, toolName: 'grep' }]), '1 次读取、1 次搜索');
  assert.equal(activitySummary([end], true), '正在思考');
});

test('thinking elapsed time is measured only from observed block events and survives history merge', () => {
  const message: AssistantMessage = { role: 'assistant', content: [{ type: 'thinking', thinking: '' }], api: 'openai-completions', provider: 'test', model: 'test', timestamp: 40, stopReason: 'pending', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const start = eventItem({ type: 'message_start', message }, undefined, 100);
  const thinking = eventItem({ type: 'message_update', message, assistantMessageEvent: { type: 'thinking_start', contentIndex: 0, partial: message } }, start, 200);
  message.content = [{ type: 'thinking', thinking: '供应商思考' }];
  const ended = eventItem({ type: 'message_update', message, assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: '供应商思考', partial: message } }, thinking, 1500);
  message.stopReason = 'stop';
  const complete = eventItem({ type: 'message_end', message }, ended, 2000)!;
  assert.deepEqual(complete.blocks?.[0], { type: 'thinking', text: '供应商思考', startedAt: 200, completedAt: 1500 });
  const history = messageItem(message)!;
  assert.deepEqual(history.blocks?.[0], { type: 'thinking', text: '供应商思考' });
  assert.deepEqual(mergeTimelineItem(history, complete).blocks, complete.blocks);
  const unknown = eventItem({ type: 'message_end', message }, undefined, 2000)!;
  assert.equal(unknown.blocks?.[0].type === 'thinking' ? unknown.blocks[0].startedAt : null, undefined);
});
