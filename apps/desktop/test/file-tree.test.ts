import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileTreeFocus, fileTreePrefix, fileTreeRows, type DirectoryListing } from '../src/renderer/src/lib/file-tree.ts';
import { editorCommand, keyboardShortcut, shortcutConflicts } from '../src/shared/shortcuts.ts';
import { requestSchema, uiSchema, uiThreadSchema } from '../src/shared/contracts.ts';
import { applyUiPatch } from '../src/shared/ui-patches.ts';
import { FileSearchService } from '../src/main/file-search.ts';

const listings = new Map<string, DirectoryListing>([
  ['', { state: 'ready', entries: [{ name: 'src', path: 'src', directory: true }, { name: 'README.md', path: 'README.md', directory: false }] }],
  ['src', { state: 'ready', entries: [{ name: 'pages', path: 'src/pages', directory: true }, { name: '页面.ts', path: 'src/页面.ts', directory: false }] }],
  ['src/pages', { state: 'ready', entries: [{ name: '首页.ts', path: 'src/pages/首页.ts', directory: false }] }],
]);

test('file tree exposes only expanded descendants with accessible hierarchy and stable paths', () => {
  const rows = fileTreeRows('', listings, new Set(['src', 'src/pages']));
  assert.deepEqual(rows.map(({ path, parent, level, position, siblings }) => ({ path, parent, level, position, siblings })), [
    { path: 'src', parent: '', level: 1, position: 1, siblings: 2 },
    { path: 'src/pages', parent: 'src', level: 2, position: 1, siblings: 2 },
    { path: 'src/pages/首页.ts', parent: 'src/pages', level: 3, position: 1, siblings: 1 },
    { path: 'src/页面.ts', parent: 'src', level: 2, position: 2, siblings: 2 },
    { path: 'README.md', parent: '', level: 1, position: 2, siblings: 2 },
  ]);
  assert.deepEqual(fileTreeRows('', listings, new Set(['src/pages'])).map(row => row.path), ['src', 'README.md']);
  assert.deepEqual(fileTreeRows('src', listings, new Set()).map(row => row.level), [1, 1]);
  assert.deepEqual(fileTreeRows('missing', listings, new Set()), []);
});

test('file tree restores focus to a visible ancestor and finds names in cyclic reading order', () => {
  const collapsed = fileTreeRows('', listings, new Set());
  assert.equal(fileTreeFocus(collapsed, 'src/pages/首页.ts', 'README.md'), 'src');
  assert.equal(fileTreeFocus(collapsed, 'removed.ts', 'README.md'), 'README.md');
  assert.equal(fileTreeFocus(collapsed, 'removed.ts', 'also-removed.ts'), 'src');
  assert.equal(fileTreeFocus([], 'removed.ts', 'README.md'), '');
  const rows = fileTreeRows('', listings, new Set(['src', 'src/pages']));
  assert.equal(fileTreePrefix(rows, 'README.md', 'SRC'), 'src');
  assert.equal(fileTreePrefix(rows, 'src', '首'), 'src/pages/首页.ts');
  assert.equal(fileTreePrefix(rows, 'src/页面.ts', 'read'), 'README.md');
  assert.equal(fileTreePrefix(rows, 'src', 'missing'), undefined);
  assert.equal(fileTreePrefix([], '', 'x'), undefined);
});

test('file tree commands honor configured, cleared and conflicting shortcuts', () => {
  const event = { key: 'ArrowDown', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
  assert.equal(editorCommand(event), 'fileNext');
  assert.equal(editorCommand(event, { fileNext: '' }), undefined);
  assert.equal(editorCommand(event, { fileNext: 'Alt+ArrowDown' }), undefined);
  assert.equal(editorCommand({ ...event, altKey: true }, { fileNext: 'Alt+ArrowDown' }), 'fileNext');
  assert.equal(keyboardShortcut({ ...event, key: ' ' }), 'Space');
  assert.equal(editorCommand({ ...event, key: ' ' }), 'fileToggle');
  assert.equal(editorCommand({ ...event, key: 'Control' }), undefined);
  assert.deepEqual(shortcutConflicts(), []);
  assert.equal(shortcutConflicts({ fileNext: 'Ctrl+K' }).length, 1);
  assert.equal(shortcutConflicts({ fileNext: 'Home' }).length, 1);
});

test('file navigation fields survive schema hydration and independent draft patches', () => {
  assert.equal(uiThreadSchema.parse({}).fileDirectory, undefined);
  const patch = { fileDirectory: 'src', expandedDirectories: ['src', 'src/pages'], fileTreeFocus: 'src/pages/首页.ts' };
  assert.deepEqual(requestSchema.parse({ op: 'ui.threadPatch', threadId: 't', patch }), { op: 'ui.threadPatch', threadId: 't', patch });
  const original = uiSchema.parse({ threads: { t: patch, other: { fileDirectory: 'docs' } } });
  const saved = applyUiPatch(original, { threadId: 't', thread: { draft: { text: '草稿', attachments: [] }, folds: { plan: true } } });
  const restored = uiSchema.parse(JSON.parse(JSON.stringify(saved)));
  for (const [key, value] of Object.entries(patch)) assert.deepEqual(restored.threads.t[key as keyof typeof patch], value);
  assert.equal(restored.threads.other.fileDirectory, 'docs');
  assert.equal(uiThreadSchema.safeParse({ expandedDirectories: [1] }).success, false);
  assert.equal(uiThreadSchema.safeParse({ fileDirectory: 'x'.repeat(2001) }).success, false);
});

test('file search distinguishes missing projects from no matches and reports actual content lines', async () => {
  const project = await mkdtemp(join(tmpdir(), 'pi-file-search-'));
  const service = new FileSearchService();
  const search = async (cwd: string, query: string, content: boolean) => {
    const request = { op: 'file.search' as const, threadId: 'tree', requestId: crypto.randomUUID(), query, content };
    let page = await service.search(cwd, request);
    const matches = [...page.matches];
    // A time-limited scan may yield before the first hit, even in a small project.
    while (page.cursor) { page = await service.search(cwd, { ...request, cursor: page.cursor }); matches.push(...page.matches); }
    assert.equal(page.done, true);
    return { matches };
  };
  try {
    await mkdir(join(project, '目录'));
    await writeFile(join(project, '目录', '说明.txt'), '第一行\n查找内容\n末行');
    const matches = await search(project, '查找', true);
    assert.deepEqual(matches.matches, [{ path: join('目录', '说明.txt'), line: 2, text: '查找内容' }]);
    assert.deepEqual((await search(project, 'not-found', false)).matches, []);
    assert.deepEqual((await search(project, '   ', true)).matches, []);
    await assert.rejects(search(join(project, 'missing'), 'anything', false));
  } finally { service.dispose(); await rm(project, { recursive: true, force: true }); }
});
