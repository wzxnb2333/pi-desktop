import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestSchema, uiSchema, uiThreadSchema } from '../src/shared/contracts.ts';
import { applyUiPatch } from '../src/shared/ui-patches.ts';
import { filePosition, messageLink } from '../src/renderer/src/lib/message-links.ts';

test('conversation file links normalize relative, Windows and file URI paths with line and column', () => {
  const cwd = 'C:/Projects/任务';
  for (const href of ['src/页面%20一.ts:12:3', './src/页面%20一.ts#L12C3', 'c:/projects/任务/src/页面%20一.ts#L12C3-L16', 'file:///C:/Projects/任务/src/页面%20一.ts#L12C3', ['C:', 'Projects', '任务', 'src', '页面 一.ts:12:3'].join(String.fromCharCode(92))]) {
    assert.deepEqual(messageLink(href, cwd), { kind: 'file', path: 'src/页面 一.ts', line: 12, column: 3 }, href);
    assert.deepEqual(messageLink(href, cwd.replaceAll('/', String.fromCharCode(92))), { kind: 'file', path: 'src/页面 一.ts', line: 12, column: 3 }, href);
  }
  assert.deepEqual(messageLink('/home/pi/app/src/main.ts#L5-L9', '/home/pi/app'), { kind: 'file', path: 'src/main.ts', line: 5 });
  assert.deepEqual(messageLink('src/../main.ts', cwd), { kind: 'file', path: 'main.ts' });
  assert.deepEqual(messageLink('src/a%23L9.ts', cwd), { kind: 'file', path: 'src/a#L9.ts' });
});

test('conversation links reject traversal, outside paths, unsafe protocols and malformed locations', () => {
  const cwd = 'C:/Projects/task';
  for (const href of [undefined, '', '../secret', 'src/../../secret', 'C:/Projects/task2/a.ts', 'D:/Projects/task/a.ts', '/Projects/task/a.ts', 'file://server/share/a', 'file:///C:/Projects/task/a?query=1', 'javascript:alert(1)', 'data:text/plain,hello', 'vbscript:abc', 'javascript%3Aalert(1)', 'C:relative.ts', '#section', '%ZZ', 'a%00.ts', 'a.ts:0', 'a.ts:1:0', 'a.ts#L9007199254740992']) {
    assert.equal(messageLink(href, cwd).kind, 'unavailable', String(href));
  }
  assert.equal(messageLink('/HOME/pi/a', '/home/pi').kind, 'unavailable');
});

test('web links preserve query and fragment while rejecting embedded credentials', () => {
  assert.deepEqual(messageLink('https://example.com/a?q=中#L2', '/project'), { kind: 'web', url: 'https://example.com/a?q=%E4%B8%AD#L2' });
  assert.deepEqual(messageLink('//example.com/', '/project'), { kind: 'web', url: 'https://example.com/' });
  assert.deepEqual(messageLink('http://127.0.0.1:1234/one', '/project'), { kind: 'web', url: 'http://127.0.0.1:1234/one' });
  assert.equal(messageLink('https://user:secret@example.com/', '/project').kind, 'unavailable');
});

test('file locations clamp to actual text and never manufacture an out-of-range selection', () => {
  assert.deepEqual(filePosition('第一行\nsecond\n结束', 2, 3), { offset: 6, line: 2, column: 3 });
  assert.deepEqual(filePosition('one\nend', 999, 999), { offset: 7, line: 2, column: 4 });
  assert.deepEqual(filePosition('', 20), { offset: 0, line: 1, column: 1 });
  assert.deepEqual(filePosition('one\nend', -1, 0), { offset: 0, line: 1, column: 1 });
  assert.deepEqual(filePosition('one', Number.NaN, Number.NaN), { offset: 0, line: 1, column: 1 });
});

test('file navigation survives strict UI persistence and unrelated field patches', () => {
  assert.equal(uiThreadSchema.parse({}).fileLocation, undefined);
  const location = { id: 'request', path: 'src/a.ts', line: 9, column: 4 };
  const request = requestSchema.parse({ op: 'ui.threadPatch', threadId: 't', patch: { fileLocation: location } });
  assert.equal(request.op, 'ui.threadPatch');
  const ui = uiSchema.parse({ threads: { t: { fileLocation: location, selectedPath: 'src/a.ts' } } });
  const saved = applyUiPatch(ui, { threadId: 't', thread: { draft: { text: '草稿', attachments: [] }, folds: { plan: true } } });
  assert.deepEqual(uiSchema.parse(JSON.parse(JSON.stringify(saved))).threads.t.fileLocation, location);
  for (const extra of [{ line: 0 }, { column: -1 }, { line: 1.5 }, { unknown: true }]) {
    assert.equal(uiThreadSchema.safeParse({ fileLocation: { ...location, ...extra } }).success, false);
  }
});
