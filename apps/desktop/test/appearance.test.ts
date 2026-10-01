import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appearanceSchema, settingsSchema, themeDocumentSchema } from '../src/shared/contracts.ts';
import { appearanceFromSettings, appearanceProperties } from '../src/shared/appearance.ts';
import { shortcutMatchesQuery } from '../src/shared/shortcuts.ts';

test('theme documents round-trip appearance without providers, secrets or runtime settings', () => {
  const settings = settingsSchema.parse({ theme: 'dark', fontSize: 16, codeFontSize: 18, uiFontFamily: 'Microsoft YaHei UI', codeFontFamily: 'Cascadia Code', accentColor: '#ABCDEF', backgroundColor: '#222222', foregroundColor: '#eeeeee', modelId: 'private', preventSleep: true });
  const appearance = appearanceFromSettings(settings);
  const document = themeDocumentSchema.parse(JSON.parse(JSON.stringify({ version: 1, appearance })));
  assert.deepEqual(document.appearance, appearance);
  assert.equal(JSON.stringify(document).includes('private'), false);
  assert.equal('preventSleep' in appearance, false);
  assert.throws(() => themeDocumentSchema.parse({ version: 2, appearance }));
  assert.throws(() => themeDocumentSchema.parse({ version: 1, appearance, providers: [] }));
  assert.throws(() => appearanceSchema.parse({ accentColor: 'url(https://example.com)' }));
  assert.throws(() => appearanceSchema.parse({ uiFontFamily: 'Arial; color: red' }));
});
test('custom appearance applies both code font surfaces and resets every customized property', () => {
  const custom = appearanceProperties(appearanceSchema.parse({ uiFontFamily: '微软雅黑', codeFontFamily: 'Consolas', accentColor: '#336699', foregroundColor: '#abcdef' }));
  assert.equal(custom['--font-sans'], '"微软雅黑", system-ui, sans-serif');
  assert.equal(custom['--font-mono'], custom['--markdown-code-font']);
  assert.equal(custom['--accent'], '#336699');
  const reset = appearanceProperties(appearanceSchema.parse({}));
  assert.deepEqual(Object.keys(reset), Object.keys(custom));
  assert.equal(reset['--font-mono'], '');
  assert.equal(reset['--accent'], '');
  assert.equal(reset['--muted'], '');
});
test('shortcut search matches names and normalized key combinations', () => {
  assert.equal(shortcutMatchesQuery('新建任务', 'Ctrl+Alt+N', '新建'), true);
  assert.equal(shortcutMatchesQuery('New task', 'Ctrl+Alt+N', 'CONTROL + ALT + N'), true);
  assert.equal(shortcutMatchesQuery('New task', 'Ctrl+Alt+N', 'new'), true);
  assert.equal(shortcutMatchesQuery('New task', 'Ctrl+Alt+N', 'Ctrl+X'), false);
});
