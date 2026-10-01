import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileSearchService } from '../src/main/file-search.ts';
import { FILE_SEARCH_PAGE_SIZE, fileSearchPageSchema, requestSchema, type DesktopRequest, type FileSearchPage, type FileSearchResult } from '../src/shared/contracts.ts';

type Request = Extract<DesktopRequest, { op: 'file.search' }>;
const request = (query: string, content = true, threadId = 't'): Request => ({ op: 'file.search', threadId, requestId: crypto.randomUUID(), query, content });
async function collect(service: FileSearchService, root: string, search: Request) {
  const matches: FileSearchResult[] = [];
  const pages: FileSearchPage[] = [];
  let cursor: string | undefined;
  do {
    const page = fileSearchPageSchema.parse(await service.search(root, { ...search, cursor }));
    assert.ok(page.matches.length <= FILE_SEARCH_PAGE_SIZE);
    assert.equal(page.threadId, search.threadId);
    assert.equal(page.requestId, search.requestId);
    assert.ok(page.progress.files >= (pages.at(-1)?.progress.files ?? 0));
    matches.push(...page.matches); pages.push(page); cursor = page.cursor;
  } while (cursor);
  return { matches, pages, progress: pages.at(-1)!.progress };
}

test('search pages preserve every matching line and repeat requests do not consume another page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-search-pages-'));
  const service = new FileSearchService();
  try {
    await writeFile(join(root, '中文.txt'), Array.from({ length: 451 }, (_, index) => '目标 ' + (index + 1)).join('\r\n'));
    const search = request('目标');
    const [first, duplicate] = await Promise.all([service.search(root, search), service.search(root, search)]);
    assert.deepEqual(duplicate, first);
    assert.deepEqual(await service.search(root, search), first);
    assert.equal(first.done, false);
    const all = [...first.matches];
    let cursor = first.cursor;
    let last = first;
    while (cursor) {
      last = await service.search(root, { ...search, cursor });
      assert.deepEqual(await service.search(root, { ...search, cursor }), last);
      all.push(...last.matches); cursor = last.cursor;
    }
    assert.deepEqual(all.map(item => item.line), Array.from({ length: 451 }, (_, index) => index + 1));
    assert.equal(last.progress.lines, 451);
    await assert.rejects(service.search(root, search), /失效/);
    await assert.rejects(service.search(root, { ...search, cursor: crypto.randomUUID() }), /失效/);
    await assert.rejects(service.search(root, { ...search, query: 'different' }), /条件已改变/);
    await assert.rejects(service.search(root, { ...search, threadId: 'other', cursor: first.cursor }), /过期/);
  } finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('search traverses beyond twenty thousand entries without a silent global cutoff', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-search-many-'));
  const service = new FileSearchService();
  try {
    const count = 20005;
    let next = 0;
    await Promise.all(Array.from({ length: 32 }, async () => {
      while (next < count) { const index = next++; await writeFile(join(root, String(index).padStart(5, '0') + '.txt'), ''); }
    }));
    const result = await collect(service, root, request('20004.txt', false));
    assert.deepEqual(result.matches, [{ path: '20004.txt' }]);
    assert.equal(result.progress.files, count);
    assert.ok(result.pages.length > 10);
    assert.ok(result.pages.some(page => !page.done && page.matches.length === 0));
  } finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('content search passes the editor preview boundary and reports exclusions and unsupported files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-search-coverage-'));
  const service = new FileSearchService();
  try {
    await writeFile(join(root, 'long.txt'), 'first\n' + 'x'.repeat(520000) + '\n末尾目标\n');
    await writeFile(join(root, 'binary.dat'), Buffer.from([0, 1, 2]));
    await writeFile(join(root, 'legacy.txt'), Buffer.from([0xff, 0xfe, 1]));
    const large = await open(join(root, 'large.txt'), 'w');
    try { await large.truncate(10 * 1024 * 1024 + 1); } finally { await large.close(); }
    for (const name of ['.git', 'node_modules', 'dist', 'build', '.cache', '.artifacts']) {
      await mkdir(join(root, name)); await writeFile(join(root, name, 'ignored.txt'), '目标');
    }
    await symlink(root, join(root, 'cycle'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await collect(service, root, request('目标'));
    assert.deepEqual(result.matches, [{ path: 'long.txt', line: 3, text: '末尾目标' }]);
    assert.deepEqual(result.progress, { files: 5, lines: 3, binary: 1, encoding: 1, oversized: 1, unreadable: 1, excludedDirectories: 6 });
  } finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('cancellation is request scoped, cancels pending reads and cannot resurrect superseded searches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-search-cancel-'));
  const service = new FileSearchService();
  try {
    await writeFile(join(root, 'text.txt'), 'target\n'.repeat(500));
    const beforeStart = request('target');
    service.cancel('t', beforeStart.requestId);
    await assert.rejects(service.search(root, beforeStart), /停止/);
    const inFlight = request('target');
    const pending = service.search(root, inFlight);
    service.cancel('t', inFlight.requestId);
    await assert.rejects(pending, /停止/);
    const original = request('target');
    const first = await service.search(root, original);
    const replacement = request('other');
    await service.search(root, replacement);
    await assert.rejects(service.search(root, { ...original, cursor: first.cursor }), /停止/);
    service.cancel('t', original.requestId);
    assert.equal((await service.search(root, replacement)).done, true);
    const other = request('target', true, 'other');
    const otherFirst = await service.search(root, other);
    service.closeThread('t');
    assert.ok((await service.search(root, { ...other, cursor: otherFirst.cursor })).matches.length > 0);
    service.dispose();
    await assert.rejects(service.search(root, { ...other, cursor: otherFirst.cursor }), /过期/);
  } finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('IPC validates request identity and response cursor consistency', () => {
  const valid = request('file', false);
  assert.equal(requestSchema.safeParse(valid).success, true);
  assert.equal(requestSchema.safeParse({ ...valid, requestId: '' }).success, false);
  assert.equal(requestSchema.safeParse({ ...valid, cursor: '../escape' }).success, false);
  assert.equal(requestSchema.safeParse({ op: 'file.search.cancel', threadId: 't', requestId: 'id' }).success, true);
  const page = { threadId: 't', requestId: 'id', done: true, matches: [], progress: { files: 0, lines: 0, excludedDirectories: 0, unreadable: 0, binary: 0, encoding: 0, oversized: 0 } };
  assert.equal(fileSearchPageSchema.safeParse(page).success, true);
  assert.equal(fileSearchPageSchema.safeParse({ ...page, done: false }).success, false);
  assert.equal(fileSearchPageSchema.safeParse({ ...page, cursor: crypto.randomUUID() }).success, false);
  assert.equal(fileSearchPageSchema.safeParse({ ...page, matches: [{ path: 'test', line: 0 }] }).success, false);
});
