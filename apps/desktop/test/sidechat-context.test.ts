import assert from 'node:assert/strict';
import { test } from 'node:test';
import { threadSchema, timelineSchema } from '../src/shared/contracts.ts';
import { captureSidechat } from '../src/main/sidechat-context.ts';

test('sidechat captures a bounded immutable point without changing a live parent or copying hidden thinking', () => {
  const parent = threadSchema.parse({ id: 'parent', projectId: 'p', title: '主任务', cwd: '.', providerId: 'p', thinking: 'off', policy: 'auto', createdAt: 1, updatedAt: 1,
    items: [
      timelineSchema.parse({ id: 'first', entryId: 'entry-first', role: 'user', text: 'QUESTION', timestamp: 1 }),
      timelineSchema.parse({ id: 'second', role: 'assistant', text: 'PARTIAL', thinking: 'PRIVATE_REASONING', state: 'running', timestamp: 2 }),
      timelineSchema.parse({ id: 'third', role: 'user', text: 'LATER', timestamp: 3 }),
    ],
  });
  const snapshot = captureSidechat(parent, 'second', 100);
  assert.equal(snapshot.capturedAt, 100);
  assert.match(snapshot.context, /PARTIAL/);
  assert.match(snapshot.context, /capturedWhileStreaming":true/);
  assert.doesNotMatch(snapshot.context, /LATER|PRIVATE_REASONING/);
  parent.items[1].text = 'FINISHED';
  assert.doesNotMatch(snapshot.context, /FINISHED/);
  assert.equal(captureSidechat(parent, 'entry-first').anchorItemId, 'first');
  assert.throws(() => captureSidechat(parent, 'missing'), /不存在/);
  parent.items[0].text = 'x'.repeat(1000001);
  assert.throws(() => captureSidechat(parent, 'first'), /过大/);
});
