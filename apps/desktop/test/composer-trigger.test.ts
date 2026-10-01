import assert from 'node:assert/strict';
import test from 'node:test';
import { composerTrigger } from '../src/renderer/src/lib/composer-trigger.ts';
import { composerCommand, shortcutConflicts } from '../src/shared/shortcuts.ts';

test('composer recognizes only the active mention or command token and preserves caret boundaries', () => {
  assert.deepEqual(composerTrigger('请检查 @src/main.ts', 16), { kind: '@', start: 4, end: 16, query: 'src/main.ts' });
  assert.deepEqual(composerTrigger('/plan 后文', 5), { kind: '/', start: 0, end: 5, query: 'plan' });
  for (const value of ['mail@example.com', 'https://example.com', '/usr/local', 'ordinary prose']) assert.equal(composerTrigger(value, value.length), undefined);
  assert.equal(composerTrigger('/plan', 0, 5), undefined);
});
test('suggestion navigation uses configurable bindings without conflicting with other focused scopes', () => {
  const event = { key: 'ArrowDown', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  assert.equal(composerCommand(event), 'composerNext');
  assert.equal(composerCommand(event, { composerNext: 'Ctrl+J' }), undefined);
  assert.equal(composerCommand({ ...event, key: 'j', ctrlKey: true }, { composerNext: 'Ctrl+J' }), 'composerNext');
  assert.deepEqual(shortcutConflicts(), []);
  assert.ok(shortcutConflicts({ composerChoose: 'ArrowDown' }).length > 0);
});
