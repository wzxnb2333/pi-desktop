import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mkdtemp } from './fixtures/node-temp.ts';
import { BrowserHistory } from '../src/main/browser-history.ts';
import { historyRangeStart } from '../src/shared/browser-history.ts';

test('browser history searches actual visits, persists titles and clears only the selected time interval', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'pi-browser-history-'));
  const history = new BrowserHistory(storage); await history.load();
  const now = 2000000000;
  history.visit('a', 'https://example.com/old', '旧页面', true, now - 86400001);
  history.visit('b', 'https://example.org/recent', '未完成标题', true, now - 1000);
  history.visit('b', 'https://example.org/recent', '中文页面', false, now);
  history.visit('c', 'https://example.net/future', '保留后续访问', true, now + 1000);
  history.visit('c', 'file:///C:/secret.txt', 'invalid', true, now);
  assert.equal(history.query('中文').entries[0].title, '中文页面'); assert.equal(history.query('').total, 3);
  assert.equal(historyRangeStart('hour', now), now - 3600000);
  assert.deepEqual(history.range('day', now).origins, ['https://example.org']);
  await history.flush(); const restored = new BrowserHistory(storage); await restored.load(); assert.equal(restored.query('').total, 3);
  assert.equal(await restored.clear('day', now), 1); assert.equal(restored.query('recent').total, 0);
  const backup = JSON.parse(await readFile(join(storage, 'browser-history.json.bak'), 'utf8')); assert.equal(backup.entries.length, 2);
  const again = new BrowserHistory(storage); await again.load(); assert.equal(again.query('').total, 2);
});

test('damaged and future histories stay recoverable and require explicit complete reset', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'pi-browser-history-broken-')); const path = join(storage, 'browser-history.json');
  await writeFile(path, '{broken'); const broken = new BrowserHistory(storage); await broken.load();
  assert.match(broken.query('').error!, /无法读取/); broken.visit('a', 'https://example.com', 'no overwrite', true); await broken.flush();
  assert.equal(await readFile(path, 'utf8'), '{broken'); await assert.rejects(broken.clear('day', Date.now()), /无法读取/);
  await broken.clear('all', Date.now()); assert.equal(broken.query('').error, undefined);
  const backups = (await readdir(storage)).filter(name => name.includes('.recovery-')); assert.equal(backups.length, 1); assert.equal(await readFile(join(storage, backups[0]), 'utf8'), '{broken');
  await writeFile(path, '{"version":10,"entries":[]}'); const future = new BrowserHistory(storage); await future.load(); assert.match(future.error, /更新版本/); assert.equal(await readFile(path, 'utf8'), '{"version":10,"entries":[]}');
});

test('history cleanup publication failure preserves live visits and supports retry', async t => {
  const storage = await mkdtemp(join(tmpdir(), 'pi-browser-history-retry-'));
  const path = join(storage, 'browser-history.json'), history = new BrowserHistory(storage);
  await history.load(); history.visit('a', 'https://example.org/private', 'Original visit', true, 1000); await history.flush();
  const original = await readFile(path, 'utf8'), rename = fs.rename;
  fs.rename = async (from, to) => { if (String(to) === path) throw new Error('HISTORY_DISK_FAILURE'); return rename(from, to); };
  syncBuiltinESMExports(); t.after(() => { fs.rename = rename; syncBuiltinESMExports(); });
  await assert.rejects(history.clear('all', 2000), /HISTORY_DISK_FAILURE/);
  assert.equal(history.query('').total, 1); assert.equal(await readFile(path, 'utf8'), original);
  fs.rename = rename; syncBuiltinESMExports();
  assert.equal(await history.clear('all', 2000), 1); assert.equal(history.query('').error, undefined);
  for (const file of [path, path + '.bak']) assert.equal(JSON.parse(await readFile(file, 'utf8')).entries.length, 0);
});

test('failed damaged-history reset stays blocked until the replacement is saved', async t => {
  const storage = await mkdtemp(join(tmpdir(), 'pi-browser-history-reset-'));
  const path = join(storage, 'browser-history.json'); await writeFile(path, '{broken');
  const history = new BrowserHistory(storage); await history.load(); const rename = fs.rename;
  fs.rename = async (from, to) => { if (String(to) === path) throw new Error('HISTORY_RESET_FAILURE'); return rename(from, to); };
  syncBuiltinESMExports(); t.after(() => { fs.rename = rename; syncBuiltinESMExports(); });
  await assert.rejects(history.clear('all', 2000), /HISTORY_RESET_FAILURE/);
  history.visit('a', 'https://example.org/keep-blocked', 'Blocked', true, 1000);
  assert.equal(history.query('').total, 0); assert.throws(() => history.range('day', 2000));
  fs.rename = rename; syncBuiltinESMExports(); await history.flush(); assert.equal(await readFile(path, 'utf8'), '{broken');
  await history.clear('all', 2000); assert.equal(history.query('').error, undefined);
});

test('visits and queued saves during cleanup keep correct deletion counts and cannot resurrect history', async t => {
  const storage = await mkdtemp(join(tmpdir(), 'pi-browser-history-concurrent-'));
  const path = join(storage, 'browser-history.json'), history = new BrowserHistory(storage);
  await history.load(); history.visit('a', 'https://example.org/private', 'Original', true, 1000); await history.flush();
  const rename = fs.rename; let release!: () => void, entered!: () => void, paused = false;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  fs.rename = async (from, to) => { if (String(to) === path && !paused) { paused = true; entered(); await gate; } return rename(from, to); };
  syncBuiltinESMExports(); t.after(() => { release(); fs.rename = rename; syncBuiltinESMExports(); });
  const clearing = history.clear('all', 2000); await ready;
  history.visit('a', 'https://example.org/new', 'New visit', true, 3000);
  const saving = history.flush(); release(); assert.equal(await clearing, 1); await saving;
  history.visit('a', 'https://example.org/new', 'Updated title', false, 3000); await history.flush();
  assert.equal(history.query('').total, 1); assert.equal(history.query('').entries[0].title, 'Updated title');
  for (const file of [path, path + '.bak']) assert.equal(JSON.parse(await readFile(file, 'utf8')).entries.some((item: { url: string }) => item.url.endsWith('/private')), false);
  const restored = new BrowserHistory(storage); await restored.load(); assert.equal(restored.query('').entries[0].title, 'Updated title');
});

test('history backup failure cannot publish deletion or prevent a later retry', async t => {
  const storage = await mkdtemp(join(tmpdir(), 'pi-browser-history-backup-'));
  const path = join(storage, 'browser-history.json'), history = new BrowserHistory(storage);
  await history.load(); history.visit('a', 'https://example.org/original', 'Original', true, 1000); await history.flush();
  const before = await readFile(path, 'utf8'), rename = fs.rename;
  fs.rename = async (from, to) => { if (String(to) === path + '.bak') throw new Error('HISTORY_BACKUP_FAILURE'); return rename(from, to); };
  syncBuiltinESMExports(); t.after(() => { fs.rename = rename; syncBuiltinESMExports(); });
  await assert.rejects(history.clear('all', 2000), /HISTORY_BACKUP_FAILURE/);
  assert.equal(history.query('').total, 1); assert.equal(await readFile(path, 'utf8'), before);
  const restored = new BrowserHistory(storage); await restored.load(); assert.equal(restored.query('').total, 1);
  fs.rename = rename; syncBuiltinESMExports(); assert.equal(await history.clear('all', 2000), 1);
});

test('concurrent cleanup requests report each visit once and backup recovery keeps deletions', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'pi-browser-history-queued-'));
  const path = join(storage, 'browser-history.json'), history = new BrowserHistory(storage);
  await history.load(); history.visit('a', 'https://example.org/old', 'Old', true, 1000);
  history.visit('b', 'https://example.org/later', 'Later', true, 3000);
  assert.deepEqual(await Promise.all([history.clear('all', 2000), history.clear('all', 4000), history.flush()]), [1, 1, undefined]);
  assert.equal(history.query('').total, 0); await writeFile(path, '{corrupted after cleanup');
  const restored = new BrowserHistory(storage); await restored.load(); assert.equal(restored.query('').total, 0); assert.equal(restored.error, '');
});

test('failed history saves keep dirty visits and retry through the same write queue', async t => {
  const storage = await mkdtemp(join(tmpdir(), 'pi-browser-history-save-'));
  const history = new BrowserHistory(storage), path = join(storage, 'browser-history.json'), rename = fs.rename;
  await history.load(); history.visit('a', 'https://example.org/unsaved', 'Unsaved', true, 1000);
  fs.rename = async (from, to) => { if (String(to) === path) throw new Error('HISTORY_SAVE_FAILURE'); return rename(from, to); };
  syncBuiltinESMExports(); t.after(() => { fs.rename = rename; syncBuiltinESMExports(); });
  await assert.rejects(history.flush(), /HISTORY_SAVE_FAILURE/); assert.equal(history.query('').total, 1);
  fs.rename = rename; syncBuiltinESMExports(); await history.flush();
  const restored = new BrowserHistory(storage); await restored.load(); assert.equal(restored.query('').total, 1); assert.equal(history.error, '');
});
