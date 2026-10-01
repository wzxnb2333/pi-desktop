import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { mkdtemp } from './fixtures/node-temp.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GitService } from '../src/main/git.ts';
import {
  alignHunks,
  alignSideBySide,
  diffMarker,
  diffPath,
  maxLineNo,
  noTextDiff,
  parseUnifiedDiff,
  type DiffHunk,
  type FileDiff,
} from '../src/renderer/src/lib/diff.ts';

/** Mirrors GitService's own invocation so fixtures are byte-identical to what the renderer gets. */
function gitAt(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8' });
}

async function makeRepo(): Promise<{ root: string; diff: (path: string) => Promise<string> }> {
  const root = await mkdtemp(join(tmpdir(), 'pi diff '));
  const git = new GitService(await mkdtemp(join(tmpdir(), 'pi-diff-storage-')));
  gitAt(root, ['init', '-b', 'main', '.']);
  gitAt(root, ['config', 'core.autocrlf', 'false']);
  gitAt(root, ['config', 'user.name', 'Test']);
  gitAt(root, ['config', 'user.email', 'test@example.invalid']);
  return { root, diff: (path) => git.diff(root, path) };
}

async function commitAll(root: string, message: string): Promise<void> {
  gitAt(root, ['add', '--', '.']);
  gitAt(root, ['commit', '-qm', message]);
}

function write(root: string, path: string, content: string): Promise<void> {
  return writeFile(join(root, path), content);
}

function only(files: FileDiff[]): FileDiff {
  assert.equal(files.length, 1, `期望一个文件的差异，实际 ${files.length} 个`);
  return files[0];
}

function rawLine(hunk: DiffHunk, index: number): string {
  const line = hunk.lines[index];
  return diffMarker[line.kind] + line.text;
}

test('multi-hunk file keeps independent old/new numbering per hunk', async () => {
  const { root, diff } = await makeRepo();
  const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
  await write(root, 'multi.txt', `${lines}\n`);
  await commitAll(root, 'base');
  const edited = lines.split('\n');
  edited[1] = 'CHANGED2';
  edited[16] = 'CHANGED17';
  edited.splice(10, 0, 'INSERTED');
  await write(root, 'multi.txt', `${edited.join('\n')}\n`);

  const file = only(parseUnifiedDiff(await diff('multi.txt')));
  assert.equal(file.kind, 'modified');
  assert.deepEqual([file.oldPath, file.newPath], ['multi.txt', 'multi.txt']);
  assert.deepEqual(file.warnings, []);
  assert.equal(file.hunks.length, 2);

  const [first, second] = file.hunks;
  assert.deepEqual(
    { old: [first.oldStart, first.oldCount], new: [first.newStart, first.newCount] },
    { old: [1, 5], new: [1, 5] },
  );
  assert.deepEqual(
    { old: [second.oldStart, second.oldCount], new: [second.newStart, second.newCount] },
    { old: [8, 13], new: [8, 14] },
  );

  assert.deepEqual(
    first.lines.map((line) => [line.kind, line.oldNo ?? null, line.newNo ?? null]),
    [
      ['context', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['context', 3, 3],
      ['context', 4, 4],
      ['context', 5, 5],
    ],
  );
  // The bug this replaces printed a running blob index; git's minimal script turns line17 into
  // CHANGED17 after the inserted line, so hunk two's new numbers run one ahead of the old ones.
  const changed = second.lines.filter((line) => line.kind !== 'context');
  assert.deepEqual(
    changed.map((line) => [line.kind, line.text, line.oldNo ?? null, line.newNo ?? null]),
    [
      ['add', 'INSERTED', null, 11],
      ['del', 'line17', 17, null],
      ['add', 'CHANGED17', null, 18],
    ],
  );
  assert.deepEqual(
    second.lines.slice(-4).map((line) => [line.text, line.oldNo ?? null, line.newNo ?? null]),
    [
      ['CHANGED17', null, 18],
      ['line18', 18, 19],
      ['line19', 19, 20],
      ['line20', 20, 21],
    ],
  );
  assert.equal(maxLineNo(file), 21);
});

test('untracked file parses through the /dev/null side git.ts synthesizes', async () => {
  const { root, diff } = await makeRepo();
  await write(root, 'hello.txt', 'Hello Pi Desktop\nsecond\n');
  const file = only(parseUnifiedDiff(await diff('hello.txt')));
  assert.equal(file.kind, 'added');
  assert.equal(file.oldPath, '/dev/null');
  assert.equal(file.newPath, 'hello.txt');
  assert.equal(diffPath(file), 'hello.txt');
  assert.deepEqual(file.warnings, []);
  assert.equal(file.hunks.length, 1);
  const hunk = file.hunks[0];
  // "@@ -0,0 +1,2 @@" — an omitted count means 1, so the parser must not default it to 0.
  assert.deepEqual([hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount], [0, 0, 1, 2]);
  assert.deepEqual(
    hunk.lines.map((line) => [line.kind, line.text, line.oldNo ?? null, line.newNo ?? null]),
    [
      ['add', 'Hello Pi Desktop', null, 1],
      ['add', 'second', null, 2],
    ],
  );
  assert.equal(rawLine(hunk, 0), '+Hello Pi Desktop');
});

test('hunk header without counts means one line on each side', async () => {
  const { root, diff } = await makeRepo();
  await write(root, 'one.txt', 'orig\n');
  await commitAll(root, 'base');
  await write(root, 'one.txt', 'replaced\n');
  const hunk = only(parseUnifiedDiff(await diff('one.txt'))).hunks[0];
  assert.equal(hunk.header, '@@ -1 +1 @@');
  assert.deepEqual([hunk.oldCount, hunk.newCount], [1, 1]);
  assert.deepEqual(rawLine(hunk, 0), '-orig');
  assert.deepEqual(rawLine(hunk, 1), '+replaced');
});

test('deleted file is the mirror of an added one', async () => {
  const { root, diff } = await makeRepo();
  await write(root, 'gone.txt', 'bye\n');
  await commitAll(root, 'base');
  gitAt(root, ['rm', '-q', 'gone.txt']);
  const file = only(parseUnifiedDiff(await diff('gone.txt')));
  assert.equal(file.kind, 'deleted');
  assert.equal(file.oldPath, 'gone.txt');
  assert.equal(file.newPath, '/dev/null');
  assert.equal(diffPath(file), 'gone.txt');
  const hunk = file.hunks[0];
  assert.deepEqual([hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount], [1, 1, 0, 0]);
  assert.deepEqual(hunk.lines.map((line) => [line.kind, line.oldNo ?? null, line.newNo ?? null]), [['del', 1, null]]);
});

test('rename keeps both paths and stays one file section', async () => {
  const root = await makeRepoRoot();
  await write(root, 'src.txt', 'l1\nl2\nl3\nl4\nl5\nl6\n');
  await commitAll(root, 'base');
  gitAt(root, ['mv', 'src.txt', 'dst.txt']);
  await write(root, 'dst.txt', 'l1\nEDITED\nl3\nl4\nl5\nl6\n');
  await gitAt(root, ['add', '--', 'dst.txt']);
  const file = only(parseUnifiedDiff(gitAt(root, ['diff', '--cached', '--no-ext-diff', '-M', 'HEAD'])));
  assert.equal(file.kind, 'renamed');
  assert.deepEqual([file.oldPath, file.newPath], ['src.txt', 'dst.txt']);
  assert.equal(diffPath(file), 'dst.txt');
  assert.deepEqual(file.warnings, []);
  assert.equal(file.hunks.length, 1);
  assert.equal(file.hunks[0].lines[1].text, 'l2');
});

test('pure rename has no hunks', async () => {
  const root = await makeRepoRoot();
  await write(root, 'moved.txt', 'content\n');
  await commitAll(root, 'base');
  gitAt(root, ['mv', 'moved.txt', 'target.txt']);
  const file = only(parseUnifiedDiff(gitAt(root, ['diff', '--cached', '--no-ext-diff', '-M', 'HEAD'])));
  assert.equal(file.kind, 'renamed');
  assert.deepEqual([file.oldPath, file.newPath], ['moved.txt', 'target.txt']);
  assert.deepEqual(file.hunks, []);
});

test('mode-only change is recognised instead of treated as content', async () => {
  const root = await makeRepoRoot();
  await write(root, 'script.sh', 'echo hi\n');
  await commitAll(root, 'base');
  gitAt(root, ['update-index', '--chmod=+x', 'script.sh']);
  const file = only(parseUnifiedDiff(gitAt(root, ['diff', '--cached', '--no-ext-diff', 'HEAD'])));
  assert.equal(file.kind, 'modified');
  assert.deepEqual(file.hunks, []);
  assert.match(file.warnings.join('\n'), /权限变更/);
  assert.match(file.warnings.join('\n'), /new mode 100755/);
});

test('binary files yield no hunks and no payload warnings', async () => {
  const { root, diff } = await makeRepo();
  await write(root, 'blob.bin', '\u0000\u0001\u0002binary\u00ff\u0000');
  // git.ts runs `--no-index --binary` for untracked files, which emits a base85 payload instead of
  // "Binary files differ"; the parser must drop the payload rather than count it as rows.
  const added = only(parseUnifiedDiff(await diff('blob.bin')));
  assert.equal(added.kind, 'binary');
  assert.deepEqual(added.hunks, []);
  assert.deepEqual(added.warnings, []);
  assert.equal(added.newPath, 'blob.bin');

  await commitAll(root, 'base');
  await write(root, 'blob.bin', '\u0000\u0009other\u0000');
  const modified = only(parseUnifiedDiff(await diff('blob.bin')));
  assert.equal(modified.kind, 'binary');
  assert.deepEqual(modified.hunks, []);
  assert.deepEqual([modified.oldPath, modified.newPath], ['blob.bin', 'blob.bin']);
});

test('no-newline marker becomes its own row without line numbers', async () => {
  const { root, diff } = await makeRepo();
  await write(root, 'tail.txt', 'a\nb');
  await commitAll(root, 'base');
  await write(root, 'tail.txt', 'a\nB');
  const hunk = only(parseUnifiedDiff(await diff('tail.txt'))).hunks[0];
  assert.deepEqual(
    hunk.lines.map((line) => [line.kind, line.oldNo ?? null, line.newNo ?? null]),
    [
      ['context', 1, 1],
      ['del', 2, null],
      ['nodenl', null, null],
      ['add', null, 2],
      ['nodenl', null, null],
    ],
  );
  // Both sides end without a newline, so git repeats the marker; the second one sits past the header
  // counts and must still be attached to this hunk.
  assert.equal(hunk.lines[2].text, ' No newline at end of file');
  assert.equal(rawLine(hunk, 2), '\\ No newline at end of file');
  assert.deepEqual(only(parseUnifiedDiff(await diff('tail.txt'))).warnings, []);

  await write(root, 'tail.txt', 'a\nB\nadded\n');
  const grown = only(parseUnifiedDiff(await diff('tail.txt'))).hunks[0];
  assert.deepEqual(
    grown.lines.map((line) => line.kind),
    ['context', 'del', 'nodenl', 'add', 'add'],
  );
});

test('no-newline marker after a context line stays on the shared side', async () => {
  const { root, diff } = await makeRepo();
  await write(root, 'eof.txt', 'a\nb');
  await commitAll(root, 'base');
  await write(root, 'eof.txt', 'A\na\nb');
  const hunk = only(parseUnifiedDiff(await diff('eof.txt'))).hunks[0];
  assert.deepEqual(
    hunk.lines.map((line) => line.kind),
    ['add', 'context', 'context', 'nodenl'],
  );
  const rows = alignSideBySide(hunk);
  // The marker applies to both sides here, so it becomes a shared row without numbers.
  assert.deepEqual(
    rows.map((row) => [row.kind, row.left?.kind ?? null, row.right?.kind ?? null]),
    [
      ['add', null, 'add'],
      ['context', 'context', 'context'],
      ['context', 'context', 'context'],
      ['context', 'nodenl', 'nodenl'],
    ],
  );
  assert.equal(rows[0].left, undefined);
  assert.deepEqual([rows[3].left?.oldNo, rows[3].right?.newNo], [undefined, undefined]);
});

test('content lines starting with --- or +++ never split a file', async () => {
  const { root, diff } = await makeRepo();
  const content = '--- not a header\n+++ neither\n';
  await write(root, 'dashes.txt', content);
  const untracked = parseUnifiedDiff(await diff('dashes.txt'));
  const file = only(untracked);
  assert.equal(file.kind, 'added');
  assert.equal(file.newPath, 'dashes.txt');
  assert.equal(file.hunks.length, 1);
  assert.deepEqual(
    file.hunks[0].lines.map((line) => line.text),
    ['--- not a header', '+++ neither'],
  );

  await commitAll(root, 'base');
  await write(root, 'dashes.txt', `${content}appended\n`);
  const modified = only(parseUnifiedDiff(await diff('dashes.txt')));
  assert.equal(modified.hunks.length, 1);
  assert.deepEqual(
    modified.hunks[0].lines.slice(0, 2).map((line) => [line.kind, line.text]),
    [
      ['context', '--- not a header'],
      ['context', '+++ neither'],
    ],
  );
});

test('non-ascii path survives git.ts quoting and the trailing tab on +++', async () => {
  const { root, diff } = await makeRepo();
  await write(root, '文件 hello.txt', '你好 世界\nsecond\n');
  const file = only(parseUnifiedDiff(await diff('文件 hello.txt')));
  assert.equal(file.kind, 'added');
  // git appends a bare tab to "+++ b/文件 hello.txt" here; keeping it would break the label.
  assert.equal(file.newPath, '文件 hello.txt');
  assert.equal(file.oldPath, '/dev/null');
  assert.deepEqual(file.warnings, []);
  assert.deepEqual(
    file.hunks[0].lines.map((line) => line.text),
    ['你好 世界', 'second'],
  );
});

test('git.ts concatenates tracked and untracked files into separate sections', async () => {
  const { root, diff } = await makeRepo();
  await write(root, 'tracked.txt', 'one\ntwo\n');
  await commitAll(root, 'base');
  await write(root, 'tracked.txt', 'one\n2\n');
  await write(root, 'extra.txt', 'fresh\n');
  const files = parseUnifiedDiff(await diff(''));
  assert.deepEqual(
    files.map((file) => [file.kind, diffPath(file)]),
    [
      ['modified', 'tracked.txt'],
      ['added', 'extra.txt'],
    ],
  );
  assert.deepEqual(files[0].hunks[0].lines.map((line) => line.kind), ['context', 'del', 'add']);
});

test('empty and sentinel input parse to nothing so the panel shows its empty state', async () => {
  const { root, diff } = await makeRepo();
  await write(root, 'clean.txt', 'nothing here\n');
  await commitAll(root, 'base');
  assert.equal((await diff('clean.txt')).trim(), noTextDiff);
  assert.deepEqual(parseUnifiedDiff(await diff('clean.txt')), []);
  assert.deepEqual(parseUnifiedDiff(noTextDiff), []);
  assert.deepEqual(parseUnifiedDiff(`  ${noTextDiff}\n`), []);
  assert.deepEqual(parseUnifiedDiff(''), []);
  assert.deepEqual(parseUnifiedDiff('\n\n'), []);
});

test('combined-diff headers are skipped without corrupting neighbouring hunks', async () => {
  // git.ts never emits a combined diff, so this is verbatim `git show --format= --cc HEAD` output for a
  // conflicted merge. What must hold is that its two-column body never becomes rows.
  const merge = [
    'diff --cc dst.txt',
    'index 0ec7861,0ef44dc..90b3cf4',
    '--- a/dst.txt',
    '+++ b/dst.txt',
    '@@@ -1,5 -1,5 +1,5 @@@',
    '  l1',
    '- MAIN',
    ' -FEAT',
    '++RESOLVED',
    '  l3',
  ].join('\n');
  const { root, diff } = await makeRepo();
  await write(root, 'first.txt', 'old\n');
  await commitAll(root, 'base');
  await write(root, 'first.txt', 'new\n');
  await write(root, 'second.txt', 'a\nb\n');
  const blob = `${await diff('first.txt')}${merge}\n${await diff('second.txt')}`;
  const files = parseUnifiedDiff(blob);
  assert.equal(files.length, 2);
  assert.equal(files[0].kind, 'modified');
  assert.deepEqual(files[0].hunks.map((hunk) => hunk.lines.map((line) => line.kind)), [['del', 'add']]);
  assert.deepEqual(files[0].warnings, ['合并差异（combined diff）有多个父提交，无法按新旧两列解析，已跳过该文件。']);
  assert.equal(files[1].kind, 'added');
  assert.deepEqual(files[1].hunks[0].lines.map((line) => line.newNo), [1, 2]);
  assert.deepEqual(files[1].warnings, []);

  // A stray @@@ header inside a real section is tolerated the same way: warn, skip, keep counting.
  const stray = [
    'diff --git a/x.txt b/x.txt',
    'index 1111111..2222222 100644',
    '--- a/x.txt',
    '+++ b/x.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    '@@@ -1,5 -1,5 +1,5 @@@',
    '  l1',
    '- MAIN',
    '++RESOLVED',
    '@@ -9 +9 @@',
    '-nine',
    '+NINE',
    '',
  ].join('\n');
  const [strayFile] = parseUnifiedDiff(stray);
  assert.deepEqual(strayFile.hunks.map((hunk) => hunk.header), ['@@ -1 +1 @@', '@@ -9 +9 @@']);
  assert.deepEqual(strayFile.hunks.map((hunk) => hunk.lines.length), [2, 2]);
  assert.deepEqual(strayFile.hunks[1].lines.map((line) => line.oldNo), [9, undefined]);
  assert.equal(strayFile.warnings.length, 1);
  assert.match(strayFile.warnings[0], /合并差异/);
});

test('truncated hunk data is reported instead of inventing rows', () => {
  const text = [
    'diff --git a/x.txt b/x.txt',
    'index 1..2 100644',
    '--- a/x.txt',
    '+++ b/x.txt',
    '@@ -1,3 +1,3 @@',
    ' a',
  ].join('\n');
  const file = only(parseUnifiedDiff(text));
  assert.deepEqual(file.hunks[0].lines.map((line) => line.text), ['a']);
  assert.match(file.warnings.join('\n'), /截断/);
});

test('alignment pairs a delete run with the add run that follows it', async () => {
  const { root, diff } = await makeRepo();
  const base = Array.from({ length: 9 }, (_, i) => `x${i + 1}`).join('\n');
  await write(root, 'runs.txt', `${base}\n`);
  await commitAll(root, 'base');
  const edited = base.split('\n');
  edited.splice(0, 3, 'y1', 'z1');
  await write(root, 'runs.txt', `${edited.join('\n')}\n`);
  const hunk = only(parseUnifiedDiff(await diff('runs.txt'))).hunks[0];
  assert.deepEqual(hunk.lines.map((line) => line.kind), [
    'del',
    'del',
    'del',
    'add',
    'add',
    'context',
    'context',
    'context',
  ]);
  const rows = alignSideBySide(hunk);
  assert.deepEqual(
    rows.map((row) => [row.kind, row.left?.text ?? null, row.right?.text ?? null]),
    [
      ['pair', 'x1', 'y1'],
      ['pair', 'x2', 'z1'],
      ['del', 'x3', null],
      ['context', 'x4', 'x4'],
      ['context', 'x5', 'x5'],
      ['context', 'x6', 'x6'],
    ],
  );
});

test('alignment never pairs across hunks and marks the skipped lines', async () => {
  const { root, diff } = await makeRepo();
  const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
  await write(root, 'multi.txt', `${lines}\n`);
  await commitAll(root, 'base');
  const edited = lines.split('\n');
  edited[1] = 'CHANGED2';
  edited[19] = 'CHANGED20';
  await write(root, 'multi.txt', `${edited.join('\n')}\n`);
  const file = only(parseUnifiedDiff(await diff('multi.txt')));
  assert.deepEqual(file.hunks.map((hunk) => hunk.header), ['@@ -1,5 +1,5 @@', '@@ -17,4 +17,4 @@ line16']);
  const rows = alignHunks(file.hunks);
  assert.deepEqual(
    rows
      .filter((row) => row.kind !== 'context')
      .map((row) => [
        row.kind,
        row.left?.text ?? null,
        row.right?.text ?? null,
        row.left?.oldNo ?? null,
        row.right?.newNo ?? null,
      ]),
    [
      ['pair', 'line2', 'CHANGED2', 2, 2],
      ['gap', null, null, null, null],
      ['pair', 'line20', 'CHANGED20', 20, 20],
    ],
  );
  // The gap row carries both headers so the tooltip can explain what disappeared between them.
  const gap = rows.find((row) => row.kind === 'gap');
  assert.ok(gap);
  assert.equal(gap.hint, `${file.hunks[0].header} → ${file.hunks[1].header}（省略 旧 11 行 / 新 11 行）`);
  // The rows after the gap restart at 17: the superseded renderer kept counting the whole blob.
  const afterGap = rows.slice(rows.indexOf(gap) + 1);
  assert.deepEqual(
    afterGap.map((row) => [row.kind, row.left?.oldNo ?? null, row.right?.newNo ?? null]),
    [
      ['context', 17, 17],
      ['context', 18, 18],
      ['context', 19, 19],
      ['pair', 20, 20],
    ],
  );
});

async function makeRepoRoot(): Promise<string> {
  return (await makeRepo()).root;
}
