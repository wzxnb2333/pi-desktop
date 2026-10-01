import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { migrateDesktopData, UnsupportedDataVersionError } from '../src/main/data-migrations.ts';
import { JsonStore, SecretVault, StoreRecoveryError, type Encryption } from '../src/main/store.ts';
import { DATA_VERSION, defaultData, modelProviderSchema, providerModelSchema, threadSchema } from '../src/shared/contracts.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

const encryption: Encryption = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from([...value].reverse().join('')),
  decryptString: buffer => [...buffer.toString()].reverse().join(''),
};

/** A v2 document whose models still carry their own connection. */
function legacyData(providers: Record<string, unknown>[], defaultModel = '') {
  const data = structuredClone(defaultData()) as unknown as Record<string, unknown>;
  data.version = 2;
  data.settings = { ...(data.settings as Record<string, unknown>), providers, providerId: defaultModel };
  data.threads = [threadSchema.parse({ id: 't', projectId: 'p', cwd: 'C:/work', title: '任务', createdAt: 1, updatedAt: 2, modelId: providers[0]?.id ?? '', thinking: 'off', policy: 'ask' })];
  return data;
}
const legacyModel = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, name: id, provider: 'openai', model: id + '-upstream', baseUrl: '', api: 'openai-completions',
  custom: false, reasoning: true, thinkingLevels: ['off'], contextWindow: 128000, maxTokens: 8192, ...overrides,
});

test('migration preserves project, session, queue, locale and unsent draft without mutating the source', () => {
  const before = { ...defaultData(), version: 1 };
  before.projects.push({ id: 'p', path: 'C:/用户/项目', name: '项目', trusted: true, createdAt: 1 });
  before.threads.push(threadSchema.parse({ id: 't', projectId: 'p', cwd: before.projects[0].path, title: '工作', createdAt: 1, updatedAt: 2, modelId: 'model', thinking: 'off', policy: 'ask', sessionFile: 'session.jsonl', queue: [{ text: '待处理', attachments: ['image.png'], kind: 'steer' }] }));
  before.ui.locale = 'en-US';
  before.ui.threads.t = { reviewTab: 'files', terminalOpen: false, selectedPath: '文件.txt', folds: {}, draft: { text: '未发送', attachments: ['image.png'] }, scroll: { itemId: 'i', offset: 12, follow: false } };
  const original = structuredClone(before);
  const result = migrateDesktopData(before);
  assert.deepEqual(before, original);
  assert.equal(result.fromVersion, 1);
  assert.deepEqual(result.data, { ...before, version: DATA_VERSION });
  assert.equal(result.data.threads[0].modelId, 'model');
  assert.deepEqual(migrateDesktopData(result.data), { data: result.data });
});

test('a legacy model list becomes one provider per connection and key, keeping every model id', () => {
  const legacy = legacyData([
    legacyModel('m1', { name: 'GPT-4.1' }),
    legacyModel('m2', { name: 'GPT-5', contextWindow: 400000, maxTokens: 16384 }),
    legacyModel('m3', { name: '中转', custom: true, provider: 'desktop-m3', model: 'deepseek-chat', baseUrl: 'https://proxy.example/v1', reasoning: false, thinkingLevels: undefined }),
  ], 'm2');
  const result = migrateDesktopData(legacy, { providerKeyFingerprints: { 'provider:m1': 'same', 'provider:m2': 'same', 'provider:m3': 'other' } });
  assert.equal(result.fromVersion, 2);
  assert.deepEqual(result.data.settings.modelProviders.map(provider => [provider.id, provider.name, provider.kind, provider.namespace, provider.baseUrl]), [
    ['m1', 'GPT-4.1', 'builtin', 'openai', ''],
    ['m3', '中转', 'custom', 'desktop-m3', 'https://proxy.example/v1'],
  ]);
  assert.deepEqual(result.data.settings.models.map(model => [model.id, model.provider, model.model, model.contextWindow, model.maxTokens]), [
    ['m1', 'm1', 'm1-upstream', 128000, 8192],
    ['m2', 'm1', 'm2-upstream', 400000, 16384],
    ['m3', 'm3', 'deepseek-chat', 128000, 8192],
  ]);
  // The thread and the default keep pointing at the same model.
  assert.equal(result.data.settings.modelId, 'm2');
  assert.equal(result.data.threads[0].modelId, 'm1');
  // Only the merged entries hand their credential to the surviving provider.
  assert.deepEqual(result.providerKeyMoves, [{ from: 'provider:m2', to: 'provider:m1' }]);
  assert.ok(!('providers' in result.data.settings) && !('providerId' in result.data.settings));
});

test('a legacy connection whose entries hold different keys splits instead of dropping a credential', () => {
  const legacy = legacyData([
    legacyModel('m1', { baseUrl: 'https://proxy.example/v1' }),
    legacyModel('m2', { baseUrl: 'https://proxy.example/v1' }),
  ]);
  const result = migrateDesktopData(legacy, { providerKeyFingerprints: { 'provider:m1': 'a', 'provider:m2': 'b' } });
  assert.deepEqual(result.data.settings.modelProviders.map(provider => [provider.id, provider.name]), [['m1', 'm1'], ['m2', 'm2']]);
  assert.deepEqual(result.data.settings.models.map(model => [model.id, model.provider]), [['m1', 'm1'], ['m2', 'm2']]);
  assert.deepEqual(result.providerKeyMoves ?? [], []);
});

test('migration without key fingerprints still merges one connection and stays idempotent', () => {
  const legacy = legacyData([legacyModel('m1'), legacyModel('m2')]);
  const result = migrateDesktopData(legacy);
  assert.deepEqual(result.providerKeyMoves, [{ from: 'provider:m2', to: 'provider:m1' }]);
  assert.deepEqual(result.data.settings.modelProviders.map(provider => provider.id), ['m1']);
  assert.deepEqual(result.data.settings.models.map(model => model.provider), ['m1', 'm1']);
  assert.equal(result.data.version, DATA_VERSION);
});

test('a pending credential removal is replayed against the saved configuration, not an empty store', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-vault-order-'));
  const store = new JsonStore(dir);
  await store.load();
  store.data.settings.modelProviders = [modelProviderSchema.parse({ id: 'p1', name: 'OpenAI', namespace: 'openai' })];
  store.data.settings.models = [providerModelSchema.parse({ id: 'm1', provider: 'p1', name: '测试模型', model: 'gpt-4.1' })];
  store.data.settings.modelId = 'm1';
  await store.save();
  const ciphertext = encryption.encryptString('sk-live').toString('base64');
  // An interrupted removal: the journal exists, the credential is already gone from secrets.json and
  // the settings save that would have retired it never committed.
  await writeFile(join(dir, 'secrets-removal.json'), JSON.stringify({ version: 1, entries: { 'provider:p1': ciphertext }, references: { 'provider:p1': true } }));
  const restarted = new JsonStore(dir);
  const vault = new SecretVault(dir, encryption, id => restarted.data.settings.modelProviders.some(provider => id === `provider:${provider.id}`));
  // The order `Application.init` guarantees: fingerprints, then the saved configuration, then recovery.
  const fingerprints = await vault.providerFingerprints();
  assert.deepEqual(fingerprints, {}, 'a credential parked in the removal journal has no fingerprint yet');
  await restarted.load({ providerKeyFingerprints: fingerprints });
  await vault.recover();
  assert.equal(await vault.get('provider:p1'), 'sk-live');
  assert.equal(await vault.has('provider:p1'), true);
});

test('the store records which credentials followed a merged model into its provider', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-migrations-'));
  await writeFile(join(dir, 'desktop.json'), JSON.stringify(legacyData([legacyModel('m1'), legacyModel('m2')], 'm2')));
  const store = new JsonStore(dir);
  await store.load({ providerKeyFingerprints: { 'provider:m1': 'same', 'provider:m2': 'same' } });
  assert.equal(store.data.version, DATA_VERSION);
  assert.deepEqual(store.providerKeyMoves, [{ from: 'provider:m2', to: 'provider:m1' }]);
  await store.load();
  assert.deepEqual(store.providerKeyMoves, []);
});

test('the vault hashes readable credentials and moves ciphertext without decrypting it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-vault-'));
  const vault = new SecretVault(dir, encryption);
  await vault.set('provider:m1', 'sk-same');
  await vault.set('provider:m2', 'sk-same');
  await vault.set('provider:m3', 'sk-other');
  await vault.set('mcp:server', 'token');
  const fingerprints = await vault.providerFingerprints();
  assert.deepEqual(Object.keys(fingerprints).sort(), ['provider:m1', 'provider:m2', 'provider:m3']);
  assert.equal(fingerprints['provider:m1'], fingerprints['provider:m2']);
  assert.notEqual(fingerprints['provider:m1'], fingerprints['provider:m3']);
  assert.ok(!JSON.stringify(fingerprints).includes('sk-same'));
  await vault.moveProviderKeys([{ from: 'provider:m2', to: 'provider:m1' }]);
  assert.equal(await vault.get('provider:m1'), 'sk-same');
  assert.equal(await vault.get('provider:m2'), undefined);
  assert.equal(await vault.get('provider:m3'), 'sk-other');
  assert.equal(await vault.get('mcp:server'), 'token');
  await vault.moveProviderKeys([{ from: 'provider:m1', to: 'provider:m1' }]);
  assert.equal(await vault.get('provider:m1'), 'sk-same');
  // A credential that the surviving provider already holds is never overwritten.
  await vault.set('provider:m4', 'sk-new');
  await vault.moveProviderKeys([{ from: 'provider:m3', to: 'provider:m4' }]);
  assert.equal(await vault.get('provider:m4'), 'sk-new');
  assert.equal(await vault.get('provider:m3'), undefined);

  // Without system encryption the fingerprints stay unknown, but ciphertext still follows the model.
  const locked = new SecretVault(dir, { ...encryption, isEncryptionAvailable: () => false });
  assert.deepEqual(await locked.providerFingerprints(), {});
  const before = JSON.parse(await readFile(join(dir, 'secrets.json'), 'utf8')) as Record<string, string>;
  await locked.moveProviderKeys([{ from: 'provider:m1', to: 'provider:m5' }]);
  const stored = JSON.parse(await readFile(join(dir, 'secrets.json'), 'utf8')) as Record<string, string>;
  assert.equal(stored['provider:m5'], before['provider:m1']);
  assert.equal(stored['provider:m1'], undefined);
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
