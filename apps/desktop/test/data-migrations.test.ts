import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { migrateDesktopData, UnsupportedDataVersionError } from '../src/main/data-migrations.ts';
import { JsonStore, StoreRecoveryError } from '../src/main/store.ts';
import { DATA_VERSION, defaultData, threadSchema } from '../src/shared/contracts.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

test('migration preserves project, session, queue, locale and unsent draft without mutating the source', () => {
  const before = { ...defaultData(), version: 1 };
  before.projects.push({ id: 'p', path: 'C:/用户/项目', name: '项目', trusted: true, createdAt: 1 });
  before.threads.push(threadSchema.parse({ id: 't', projectId: 'p', cwd: before.projects[0].path, title: '工作', createdAt: 1, updatedAt: 2, providerId: 'model', thinking: 'off', policy: 'ask', sessionFile: 'session.jsonl', queue: [{ text: '待处理', attachments: ['image.png'], kind: 'steer' }] }));
  before.ui.locale = 'en-US';
  before.ui.threads.t = { reviewTab: 'files', terminalOpen: false, selectedPath: '文件.txt', folds: {}, draft: { text: '未发送', attachments: ['image.png'] }, scroll: { itemId: 'i', offset: 12, follow: false } };
  const original = structuredClone(before);
  const result = migrateDesktopData(before);
  assert.deepEqual(before, original);
  assert.equal(result.fromVersion, 1);
  assert.deepEqual(result.data, { ...before, version: DATA_VERSION });
  assert.deepEqual(migrateDesktopData(result.data), { data: result.data });
});

test('legacy migration preserves exact source once and writes current data atomically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-migrations-'));
  const raw = JSON.stringify({ ...defaultData(), version: 1 }, null, 2);
  await writeFile(join(dir, 'desktop.json'), raw);
  const store = new JsonStore(dir);
  await store.load();
  assert.equal(store.data.version, DATA_VERSION);
  const backups = (await readdir(dir)).filter(name => name.includes('pre-migration'));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(join(dir, backups[0]), 'utf8'), raw);
  assert.equal(JSON.parse(await readFile(join(dir, 'desktop.json'), 'utf8')).version, DATA_VERSION);
  await store.load();
  assert.equal((await readdir(dir)).filter(name => name.includes('pre-migration')).length, 1);
});

test('corrupt primary restores a valid backup and preserves both original byte sequences', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-migrations-'));
  const valid = defaultData(); valid.settings.theme = 'dark';
  const backup = JSON.stringify(valid);
  await writeFile(join(dir, 'desktop.json'), '{invalid');
  await writeFile(join(dir, 'desktop.json.bak'), backup);
  const store = new JsonStore(dir); await store.load();
  assert.equal(store.recoveredFromBackup, true);
  assert.equal(store.data.settings.theme, 'dark');
  assert.equal(await readFile(join(dir, 'desktop.json.bak'), 'utf8'), backup);
  const corrupt = (await readdir(dir)).find(name => name.startsWith('desktop.corrupt-'));
  assert.ok(corrupt); assert.equal(await readFile(join(dir, corrupt), 'utf8'), '{invalid');
  assert.equal(JSON.parse(await readFile(join(dir, 'desktop.json'), 'utf8')).settings.theme, 'dark');
});

test('invalid data never becomes an empty profile and cannot be overwritten by save', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-migrations-'));
  await writeFile(join(dir, 'desktop.json'), '{broken');
  await writeFile(join(dir, 'desktop.json.bak'), '[]');
  const store = new JsonStore(dir);
  await assert.rejects(store.load(), StoreRecoveryError);
  await assert.rejects(store.save(), StoreRecoveryError);
  assert.equal(await readFile(join(dir, 'desktop.json'), 'utf8'), '{broken');
  assert.equal(await readFile(join(dir, 'desktop.json.bak'), 'utf8'), '[]');
  await writeFile(join(dir, 'desktop.json'), JSON.stringify(defaultData()));
  await store.load(); await store.save();
});

test('future data versions cannot silently downgrade to an older backup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-migrations-'));
  const future = JSON.stringify({ ...defaultData(), version: DATA_VERSION + 1 });
  await writeFile(join(dir, 'desktop.json'), future);
  await writeFile(join(dir, 'desktop.json.bak'), JSON.stringify(defaultData()));
  const store = new JsonStore(dir);
  await assert.rejects(store.load(), error => error instanceof StoreRecoveryError && error.reason === 'future');
  await assert.rejects(store.save(), StoreRecoveryError);
  assert.equal(await readFile(join(dir, 'desktop.json'), 'utf8'), future);
  assert.throws(() => migrateDesktopData({ version: 99 }), UnsupportedDataVersionError);
});

test('only a genuinely new directory starts with defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-migrations-'));
  const store = new JsonStore(dir); await store.load(); await store.save();
  assert.equal(store.data.version, DATA_VERSION);
  assert.equal(store.recoveredFromBackup, false);
  assert.throws(() => migrateDesktopData({ settings: {} }));
});
