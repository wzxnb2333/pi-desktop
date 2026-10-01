import assert from 'node:assert/strict';
import test from 'node:test';
import { threadSchema, type TimelineItem } from '../src/shared/contracts.ts';
import { subtaskSchema } from '../src/shared/subtasks.ts';
import { subtaskCreations } from '../src/renderer/src/lib/subtask-creations.ts';

const records = [0, 1].map(index => subtaskSchema.parse({
  id: '00000000-0000-4000-8000-00000000000' + index, parentThreadId: 'parent', parentItemId: 'u',
  definition: { title: 'Same title', prompt: 'Inspect', environment: 'local' }, context: '', status: 'running', stage: '', createdAt: 10 + index,
}));
const tool = (id: string, action: string, text: string, patch: Partial<TimelineItem> = {}): TimelineItem => threadSchema.parse({
  id: 'parent', projectId: 'p', cwd: 'C:/project', title: 'Parent', createdAt: 1, updatedAt: 1, modelId: '', thinking: 'off', policy: 'deny',
  items: [{ id, role: 'tool', toolName: 'manage_subtasks', args: JSON.stringify({ action }), text, timestamp: 10, state: 'done', ...patch }],
}).items[0];

test('creation rows bind by returned identity even when titles and result order repeat', () => {
  const mapping = subtaskCreations([
    tool('first', 'subtasks.create', JSON.stringify(records[1])),
    tool('second', 'subtasks.create', JSON.stringify(records[0])),
  ], records);
  assert.equal(mapping.get('first'), records[1]); assert.equal(mapping.get('second'), records[0]);
});

test('structured results bind creation without relying on formatted display text', () => {
  const mapping = subtaskCreations([tool('structured', 'subtasks.create', 'Formatted output', {
    toolResult: { result: { content: [{ type: 'text', text: JSON.stringify(records[0]) }] } },
  })], records);
  assert.equal(mapping.get('structured'), records[0]);
});

test('reads, lists, failed and malformed results do not manufacture creation activities', () => {
  const text = JSON.stringify(records[0]);
  assert.equal(subtaskCreations([
    tool('read', 'subtasks.read', text), tool('list', 'subtasks.list', text),
    tool('error', 'subtasks.create', text, { state: 'error' }),
    tool('args', 'subtasks.create', text, { args: '{' }), tool('pending', 'subtasks.create', '{'),
    tool('foreign', 'subtasks.create', JSON.stringify({ id: 'unrelated' })),
  ], records).size, 0);
});

test('a repeated tool result only attributes the existing child once', () => {
  const text = JSON.stringify(records[0]);
  const mapping = subtaskCreations([tool('first', 'subtasks.create', text), tool('replay', 'subtasks.create', text)], records);
  assert.deepEqual([...mapping.keys()], ['first']);
});
