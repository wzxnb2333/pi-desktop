import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { toolMessages } from '../src/shared/tool-messages.ts';

/**
 * Every desktop tool declares a Chinese display name in the worker; the information stream and the `@` picker
 * show it, so an English interface must have an entry for each one. Scanning the sources keeps a brand-new
 * tool from shipping untranslated, which is exactly what happened before this table existed.
 */
const workerDirectory = join(import.meta.dirname, '../src/worker');
const sources = readdirSync(workerDirectory).filter(name => name.endsWith('.ts') && statSync(join(workerDirectory, name)).isFile());
const labels = new Map<string, string>();
for (const name of sources) {
  const text = readFileSync(join(workerDirectory, name), 'utf8');
  for (const match of text.matchAll(/label: '([^']*[\u4e00-\u9fff][^']*)'/g)) labels.set(match[1], name);
}

test('the scan sees the desktop tool labels', () => {
  assert(labels.size >= 40, 'expected the worker tool surface to declare its labels, found ' + labels.size);
  assert(labels.has('管理会话'));
  assert(labels.has('向用户提问'));
});

test('every tool label has an English entry in the message catalog', () => {
  const missing = [...labels].filter(([label]) => !(label in toolMessages)).map(([label, file]) => file + ' -> ' + label);
  assert.deepEqual(missing, [], 'untranslated tool labels: ' + missing.join(', '));
});

test('the catalog entries stay plain English and never repeat a Chinese key', () => {
  for (const [key, value] of Object.entries(toolMessages)) {
    assert.equal(value.trim().length > 0, true, 'empty translation for ' + key);
    const chinese = /[\u4e00-\u9fff]/.test(value);
    // Model names such as "Manage Git and changes" are fine; a value that is still Chinese is not.
    assert.equal(chinese, false, 'translation still contains Chinese characters: ' + key + ' -> ' + value);
  }
});
