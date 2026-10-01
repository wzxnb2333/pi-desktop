import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QuickShortcut } from '../src/main/quick-shortcut.ts';
import { settingsSchema } from '../src/shared/contracts.ts';
import { shortcutConflicts } from '../src/shared/shortcuts.ts';

test('quick chat shortcut keeps the working binding on failure and supports retry, disabling and disposal', () => {
  const bindings = new Map<string, () => void>();
  let blocked = 'Ctrl+Alt+Q'; let opens = 0;
  const shortcut = new QuickShortcut({ register(keys, callback) { if (keys === blocked) return false; bindings.set(keys, callback); return true; }, unregister(keys) { bindings.delete(keys); } }, () => { opens++; });
  const settings = settingsSchema.parse({});
  assert.equal(shortcut.update(settings).registered, 'Ctrl+Alt+Space');
  bindings.get('Ctrl+Alt+Space')!(); assert.equal(opens, 1);
  const next = { ...settings, shortcuts: { quickChat: 'Ctrl+Alt+Q' } };
  assert.match(shortcut.update(next).error, /注册失败/);
  assert.equal(shortcut.status().registered, 'Ctrl+Alt+Space');
  assert.equal(bindings.size, 1);
  blocked = '';
  assert.equal(shortcut.update(next, true).registered, 'Ctrl+Alt+Q');
  assert.deepEqual([...bindings.keys()], ['Ctrl+Alt+Q']);
  shortcut.update({ ...settings, shortcuts: { quickChat: '' } });
  assert.equal(bindings.size, 0);
  shortcut.update(settings); shortcut.dispose();
  assert.equal(bindings.size, 0);
  assert.ok(shortcutConflicts({ quickChat: 'Ctrl+N' }).length);
});
