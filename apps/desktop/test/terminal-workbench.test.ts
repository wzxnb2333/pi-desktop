import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerminalInfo } from '../src/shared/contracts.ts';
import { appendTerminalOutput, mergeTerminalSnapshot, terminalOutputEnd, TERMINAL_OUTPUT_LIMIT } from '../src/shared/terminal-output.ts';
import { editorCommand, shortcutConflicts, terminalCommand } from '../src/shared/shortcuts.ts';
import { findTerminalMatches, terminalBufferText } from '../src/renderer/src/lib/terminal-text.ts';

const snapshot = (output: string, outputOffset = 0): TerminalInfo => ({ id: 'pty', threadId: 'task', title: 'Shell', output, outputOffset, exited: false });

test('bounded terminal tails retain absolute offsets through rename, duplicate events and continued output', () => {
  let current = appendTerminalOutput(snapshot(''), 'A'.repeat(TERMINAL_OUTPUT_LIMIT + 37));
  assert.equal(current.output.length, TERMINAL_OUTPUT_LIMIT);
  assert.equal(current.outputOffset, 37);
  const renamed = { ...current, title: '命令' };
  current = appendTerminalOutput(current, 'AFTER');
  current = mergeTerminalSnapshot(current, renamed);
  assert.equal(current.title, '命令');
  assert.ok(current.output.endsWith('AFTER'));
  assert.equal(terminalOutputEnd(current), TERMINAL_OUTPUT_LIMIT + 42);
  assert.equal(appendTerminalOutput(current, 'AFTER', TERMINAL_OUTPUT_LIMIT + 37), current);
  current = appendTerminalOutput(current, 'TER_NEXT', TERMINAL_OUTPUT_LIMIT + 39);
  assert.ok(current.output.endsWith('AFTER_NEXT'));
  assert.equal(terminalOutputEnd(current), TERMINAL_OUTPUT_LIMIT + 47);
});

test('bootstrap fills a prefix without discarding newer live output or reviving an exited terminal', () => {
  const live = { ...snapshot('DEFG', 3), exited: true };
  const merged = mergeTerminalSnapshot(live, snapshot('ABCDE'));
  assert.equal(merged.output, 'ABCDEFG');
  assert.equal(merged.outputOffset, 0);
  assert.equal(merged.exited, true);
  assert.equal(mergeTerminalSnapshot(snapshot('ABCDE'), snapshot('DEFG', 3)).output, 'ABCDEFG');
  assert.equal(mergeTerminalSnapshot(snapshot('ABCDE'), snapshot('DE', 3)).output, 'ABCDE');
});

test('missing output is an explicit offset gap and surrogate pairs survive tail trimming', () => {
  assert.deepEqual(appendTerminalOutput({ output: 'abc', outputOffset: 0 }, 'XYZ', 20), { output: 'XYZ', outputOffset: 20 });
  const data = 'A😀' + 'Z'.repeat(TERMINAL_OUTPUT_LIMIT - 1);
  const tail = appendTerminalOutput({ output: '', outputOffset: 0 }, data);
  assert.equal(tail.output, 'Z'.repeat(TERMINAL_OUTPUT_LIMIT - 1));
  assert.equal(tail.outputOffset, 3);
  assert.equal(terminalOutputEnd(tail), data.length);
  assert.equal(mergeTerminalSnapshot(undefined, snapshot(data)).output, tail.output);
});

type TestCell = readonly [text: string, width: number];
function buffer(rows: { cells: TestCell[]; wrapped?: boolean }[], columns: number) {
  const lines = rows.map(row => ({
    length: columns, isWrapped: row.wrapped ?? false,
    getCell(column: number) { const [text, width] = row.cells[column] ?? ['', 1]; return { getChars: () => text, getWidth: () => width }; },
  }));
  return { length: lines.length, getLine: (row: number) => lines[row] };
}
const cells = (text: string): TestCell[] => [...text].map(char => [char, 1]);

test('terminal search maps Chinese, surrogate pairs and combined characters to physical cells', () => {
  const text = buffer([{ cells: [['中', 2], ['', 0], ['😀', 2], ['', 0], ['e\u0301', 1], ['X', 1]] }], 10);
  assert.deepEqual(findTerminalMatches(text, 10, '😀e\u0301'), [{ start: 2, end: 5 }]);
  assert.deepEqual(findTerminalMatches(text, 10, 'x'), [{ start: 5, end: 6 }]);
  assert.deepEqual(findTerminalMatches(text, 10, '中'), [{ start: 0, end: 2 }]);
  assert.equal(terminalBufferText(text, 10), '中😀e\u0301X');
});

test('search and copy join soft wraps but retain real newlines and skip wide-character padding', () => {
  const text = buffer([
    { cells: cells('abcde') },
    { cells: cells('fghi'), wrapped: true },
    { cells: [['中', 2], ['', 0], ['尾', 2], ['', 0]], wrapped: true },
    { cells: cells('next') },
    { cells: [] },
  ], 5);
  assert.equal(terminalBufferText(text, 5), 'abcdefghi中尾\nnext');
  assert.deepEqual(findTerminalMatches(text, 5, 'hi中尾'), [{ start: 7, end: 14 }]);
  assert.deepEqual(findTerminalMatches(text, 5, '尾next'), []);
  assert.deepEqual(findTerminalMatches(text, 5, ''), []);
});

test('matches enumerate every occurrence on one row and preserve cell positions after case expansion', () => {
  const text = buffer([{ cells: cells('İX XxX') }], 12);
  assert.deepEqual(findTerminalMatches(text, 12, 'x'), [{ start: 1, end: 2 }, { start: 3, end: 4 }, { start: 4, end: 5 }, { start: 5, end: 6 }]);
  assert.deepEqual(findTerminalMatches(text, 12, 'missing'), []);
});

test('terminal find bindings are configurable and only conflict with commands in their scope', () => {
  const key = { key: 'Enter', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };
  assert.equal(terminalCommand(key), 'terminalFindNext');
  assert.equal(editorCommand(key), 'fileActivate');
  assert.equal(terminalCommand({ ...key, shiftKey: true }), 'terminalFindPrevious');
  assert.equal(terminalCommand({ ...key, key: 'F3' }, { terminalFindNext: 'F3' }), 'terminalFindNext');
  assert.equal(terminalCommand(key, { terminalFindNext: 'F3' }), undefined);
  assert.deepEqual(shortcutConflicts(), []);
  assert.equal(shortcutConflicts({ terminalFindNext: 'Ctrl+N' }).length, 1);
  assert.equal(shortcutConflicts({ terminalFindPrevious: 'Enter' }).length, 1);
  assert.deepEqual(shortcutConflicts({ fileActivate: 'F3', terminalFindNext: 'F3' }), []);
});
