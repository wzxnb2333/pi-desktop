import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timelineSchema } from '../src/shared/contracts.ts';
import { groupTurns } from '../src/renderer/src/lib/timeline-groups.ts';
import { recordedTurnChanges } from '../src/renderer/src/lib/turn-changes.ts';

const patch = '--- app.ts\n+++ app.ts\n@@ -1,2 +1,3 @@\n const keep = true;\n-old\n+new\n+added\n';
const item = (id: string, toolName = 'edit', args: Record<string, unknown> = { path: 'app.ts' }) => timelineSchema.parse({ id, role: 'tool', text: 'done', toolName, args: JSON.stringify(args), timestamp: 1, state: 'done', details: toolName === 'edit' ? { diff: '-old\n+new', patch } : undefined });

test('edit records parse the real tool patch format and count only changed lines', () => {
  const files = recordedTurnChanges(groupTurns([item('one')], false)[0]);
  assert.equal(files.length, 1); assert.equal(files[0].additions, 2); assert.equal(files[0].deletions, 1);
  assert.equal(files[0].partial, false); assert.match(files[0].records[0].text, /^diff --git /);
});
test('repeated edits stay in order and separate directories do not merge', () => {
  const turn = groupTurns([item('one'), item('two'), item('other', 'project_write', { path: 'app.ts', directoryId: 'second', content: 'second root' })], false)[0];
  const files = recordedTurnChanges(turn);
  assert.equal(files.length, 2); assert.equal(files[0].records.length, 2); assert.equal(files[0].additions, 4);
  assert.equal(files[1].directoryId, 'second'); assert.equal(files[1].records[0].text, 'second root');
});
test('writes retain exact content but never invent an old version or net line count', () => {
  const file = recordedTurnChanges(groupTurns([item('write', 'write', { path: 'app.ts', content: 'overwritten\r\n' })], false)[0])[0];
  assert.equal(file.records[0].kind, 'write'); assert.equal(file.records[0].text, 'overwritten\r\n');
  assert.equal(file.records[0].additions, undefined); assert.equal(file.partial, true);
});
test('reads, failed tools, running tools and malformed paths are excluded', () => {
  const turn = groupTurns([item('read', 'read'), { ...item('failed'), state: 'error' as const }, { ...item('running'), state: 'running' as const }, { ...item('invalid'), args: '{' }, item('no-root', 'project_write', { path: 'app.ts', content: 'x' }), item('empty', 'write', { path: ' ', content: 'x' })], false)[0];
  assert.deepEqual(recordedTurnChanges(turn), []);
});
test('empty writes and legacy edits remain previewable without guessed statistics', () => {
  const files = recordedTurnChanges(groupTurns([item('empty', 'write', { path: 'empty.txt', content: '' }), { ...item('legacy'), details: { diff: '-1 old\n+1 new' } }, { ...item('missing'), args: JSON.stringify({ path: 'missing.ts' }), details: undefined }], false)[0]);
  assert.equal(files[0].records[0].kind, 'write'); assert.equal(files[1].records[0].kind, 'legacy');
  assert.equal(files[2].records[0].kind, 'unavailable'); assert.ok(files.every(file => file.partial));
});
test('turns remain isolated and malformed patches cannot produce trusted totals', () => {
  const turns = groupTurns([timelineSchema.parse({ id: 'u1', role: 'user', text: 'first', timestamp: 0 }), item('one'), timelineSchema.parse({ id: 'u2', role: 'user', text: 'second', timestamp: 3 }), { ...item('two'), details: { diff: 'legacy', patch: 'not a patch' } }], false);
  assert.equal(recordedTurnChanges(turns[0])[0].records.length, 1);
  assert.equal(recordedTurnChanges(turns[1])[0].partial, true);
});
