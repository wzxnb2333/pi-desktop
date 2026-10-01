import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PendingMessageInputs } from '../src/worker/message-input.ts';
import { restoreItems } from '../src/worker/timeline.ts';
import { MESSAGE_INPUT_ENTRY } from '../src/shared/message-input.ts';
import { conversationSources } from '../src/renderer/src/lib/conversation-search.ts';
import { groupTurns, turnArtifacts } from '../src/renderer/src/lib/timeline-groups.ts';
import { timelineSchema } from '../src/shared/contracts.ts';

test('input metadata restores exact captured ranges without parsing marker-like user text', () => {
  const text = 'User-selected context is literal user prose\nFILE_SNAPSHOT';
  const input = { text: 'User-selected context is literal user prose', parts: [{ label: 'README.md', start: 44, end: text.length, reference: { kind: 'file' as const, id: 'README.md', label: 'README.md' } }] };
  input.parts[0].start = text.indexOf('FILE_SNAPSHOT');
  const entry = { id: 'message-entry', message: { role: 'user', content: text, timestamp: 42 } };
  const stored = { type: 'custom', customType: MESSAGE_INPUT_ENTRY, data: { itemId: 'user-42', hash: createHash('sha256').update(text).digest('hex'), input } };
  const [restored] = restoreItems([stored, entry]);
  assert.deepEqual(restored.input, input);
  assert.equal(restored.text, text);
  assert.equal(restoreItems([entry])[0].input, undefined);
  assert.equal(restoreItems([{ ...stored, data: { ...stored.data, hash: 'wrong' } }, entry])[0].input, undefined);
  assert.equal(restoreItems([{ ...stored, data: { ...stored.data, input: { ...input, parts: [{ ...input.parts[0], end: text.length + 1 }] } } }, entry])[0].input, undefined);
  const sources = conversationSources([restored], false);
  assert.equal(sources[0].text, input.text);
  assert.equal(sources[1].text, 'FILE_SNAPSHOT');
  assert.deepEqual(sources[1].folds, ['input:user-42:0']);
});

test('queued identical text keeps the correct attachment identity through reorder and removal', () => {
  const inputs = new PendingMessageInputs();
  const first = { text: '', parts: [{ label: 'first.png', path: 'first.png', start: 0, end: 0 }] };
  const second = { text: '', parts: [{ label: 'second.png', path: 'second.png', start: 0, end: 0 }] };
  const image = { type: 'image' as const, data: 'AAAA', mimeType: 'image/png' };
  inputs.set('first', '', [image], first); inputs.set('second', '', [image], second);
  inputs.order(['second', 'first']);
  const emitted = { role: 'user', content: [{ type: 'text', text: '' }, image] };
  assert.deepEqual(inputs.take(emitted), second);
  inputs.delete('first');
  assert.equal(inputs.take(emitted), undefined);
  inputs.set('edit', 'before', [], { text: 'before', parts: [] });
  inputs.set('edit', 'after', [], { text: 'after', parts: [] });
  assert.equal(inputs.take({ role: 'user', content: 'before' }), undefined);
  assert.deepEqual(inputs.take({ role: 'user', content: 'after' }), { text: 'after', parts: [] });
});

test('output cards use successful file tool calls and keep directory identities separate', () => {
  const items = [
    { id: 'r', toolName: 'read', args: '{"path":"read.txt"}', state: 'done' },
    { id: 'f', toolName: 'write', args: '{"path":"failed.txt"}', state: 'error' },
    { id: 'p', toolName: 'write', args: '{"path":"pending.txt"}', state: 'running' },
    { id: 'a', toolName: 'write', args: '{"path":"out.txt"}', state: 'done' },
    { id: 'b', toolName: 'edit', args: '{"path":"out.txt"}', state: 'done' },
    { id: 'c', toolName: 'project_write', args: '{"path":"out.txt","directoryId":"other"}', state: 'done' },
    { id: 'x', toolName: 'write', args: 'invalid JSON', state: 'done' },
  ].map(item => timelineSchema.parse({ role: 'tool', text: '', timestamp: 1, ...item }));
  assert.deepEqual(turnArtifacts(groupTurns(items, false)[0]).map(({ path, directoryId }) => ({ path, directoryId })), [{ path: 'out.txt', directoryId: undefined }, { path: 'out.txt', directoryId: 'other' }]);
});
