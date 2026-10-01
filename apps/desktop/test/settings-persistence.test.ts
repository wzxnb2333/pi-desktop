import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { JsonStore, SecretVault, type Encryption } from '../src/main/store.ts';
import { mcpSchema } from '../src/shared/contracts.ts';
import { pluginSchema } from '../src/shared/plugins.ts';
import { mcpCredentialReference, retiredMcpCredentials } from '../src/main/mcp-credentials.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

const encryption: Encryption = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value).reverse(),
  decryptString: value => Buffer.from(value).reverse().toString(),
};

test('mixed settings publish only after durable save and queued snapshots retain committed preferences', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-settings-store-'));
  const store = new JsonStore(dir); await store.load(); await store.save();
  const before = structuredClone(store.data.settings);
  const blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(store.saveSettings({ theme: 'dark', fontSize: 17 }), /EISDIR|EPERM|EACCES/);
  assert.deepEqual(store.data.settings, before);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'desktop.json'), 'utf8')).settings, before);
  await rm(blocked, { recursive: true });
  const commit = store.saveSettings({ theme: 'dark', fontSize: 17 });
  assert.deepEqual(store.data.settings, before);
  store.data.ui.sidebarWidth = 390;
  const background = store.save();
  await Promise.all([commit, background]);
  const restored = new JsonStore(dir); await restored.load();
  assert.equal(restored.data.settings.theme, 'dark');
  assert.equal(restored.data.settings.fontSize, 17);
  assert.equal(restored.data.settings.keepInTray, before.keepInTray);
  assert.equal(restored.data.ui.sidebarWidth, 390);
});

test('failed credential writes do not poison later reads or retries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-settings-vault-'));
  const vault = new SecretVault(dir, encryption);
  await vault.set('provider:local', 'old-fake-key');
  const blocked = join(dir, 'secrets.json.tmp'); await mkdir(blocked);
  await assert.rejects(vault.set('provider:local', 'new-fake-key'), /EISDIR|EPERM|EACCES/);
  assert.equal(await vault.get('provider:local'), 'old-fake-key');
  await rm(blocked, { recursive: true });
  await vault.set('provider:local', 'new-fake-key');
  assert.equal(await vault.get('provider:local'), 'new-fake-key');
});

test('failed settings removal restores encrypted credentials and a retry deletes them together', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-settings-vault-'));
  const referenced = new Set(['provider:local', 'mcp:local']);
  const vault = new SecretVault(dir, encryption, id => referenced.has(id));
  await vault.set('provider:local', 'fake-provider-key');
  await vault.set('mcp:local', 'fake-mcp-secret');
  const before = await readFile(join(dir, 'secrets.json'), 'utf8');
  await assert.rejects(vault.removeForSettings([...referenced], async () => { throw new Error('SAVE_FAILED'); }), /SAVE_FAILED/);
  assert.equal(await readFile(join(dir, 'secrets.json'), 'utf8'), before);
  assert.equal(await vault.get('provider:local'), 'fake-provider-key');
  await assert.rejects(readFile(join(dir, 'secrets-removal.json')), { code: 'ENOENT' });
  await vault.removeForSettings([...referenced], async () => { referenced.clear(); });
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'secrets.json'), 'utf8')), {});
});

test('restart recovers pending removals according to the durable configuration without exposing plaintext', async () => {
  for (const committed of [false, true]) {
    const dir = await mkdtemp(join(tmpdir(), 'pi-settings-vault-'));
    const vault = new SecretVault(dir, encryption);
    await vault.set('provider:local', 'private-fake-key');
    const entries = JSON.parse(await readFile(join(dir, 'secrets.json'), 'utf8')) as Record<string, string>;
    const journal = JSON.stringify({ version: 1, entries });
    assert.equal(journal.includes('private-fake-key'), false);
    await writeFile(join(dir, 'secrets-removal.json'), journal);
    if (!committed) await writeFile(join(dir, 'secrets.json'), '{}');
    const restored = new SecretVault(dir, encryption, () => !committed);
    await restored.recover();
    assert.equal(await restored.get('provider:local'), committed ? undefined : 'private-fake-key');
    await assert.rejects(readFile(join(dir, 'secrets-removal.json')), { code: 'ENOENT' });
  }
});

test('corrupt removal journals are retained and prevent unsafe credential changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-settings-vault-'));
  const vault = new SecretVault(dir, encryption, () => true);
  await vault.set('provider:local', 'old-fake-key');
  const before = await readFile(join(dir, 'secrets.json'), 'utf8');
  await writeFile(join(dir, 'secrets-removal.json'), '{broken');
  await assert.rejects(vault.recover(), /恢复/);
  await assert.rejects(vault.set('provider:local', 'new-fake-key'), /恢复/);
  assert.equal(await readFile(join(dir, 'secrets.json'), 'utf8'), before);
  assert.equal(await readFile(join(dir, 'secrets-removal.json'), 'utf8'), '{broken');
});

test('a failed credential rollback remains recoverable and blocks later configuration commits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-settings-vault-'));
  const vault = new SecretVault(dir, encryption, () => true);
  await vault.set('provider:local', 'rollback-fake-key');
  const blocked = join(dir, 'secrets.json.tmp');
  await assert.rejects(vault.removeForSettings(['provider:local'], async () => {
    await mkdir(blocked);
    throw new Error('SAVE_FAILED');
  }), /凭据恢复尚未完成/);
  assert.equal((await readFile(join(dir, 'secrets-removal.json'), 'utf8')).includes('rollback-fake-key'), false);
  let committed = false;
  await assert.rejects(vault.removeForSettings([], async () => { committed = true; }), /EISDIR|EPERM|EACCES/);
  assert.equal(committed, false);
  await rm(blocked, { recursive: true });
  assert.equal(await vault.get('provider:local'), 'rollback-fake-key');
  await assert.rejects(readFile(join(dir, 'secrets-removal.json')), { code: 'ENOENT' });
});

test('pending recovery never overwrites a newer external credential', async () => {
  for (const referenced of [true, false]) {
    const dir = await mkdtemp(join(tmpdir(), 'pi-settings-vault-'));
    const vault = new SecretVault(dir, encryption);
    await vault.set('provider:local', 'old-fake-key');
    const entries = JSON.parse(await readFile(join(dir, 'secrets.json'), 'utf8'));
    await vault.set('provider:local', 'external-new-key');
    await writeFile(join(dir, 'secrets-removal.json'), JSON.stringify({ version: 1, entries }));
    const recovered = new SecretVault(dir, encryption, () => referenced);
    await recovered.recover();
    assert.equal(await recovered.get('provider:local'), 'external-new-key');
  }
});

test('credential readers wait for a removal transaction to settle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-settings-vault-'));
  const vault = new SecretVault(dir, encryption, () => true);
  await vault.set('provider:local', 'still-valid-key');
  let started!: () => void;
  let finish!: () => void;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  const finishPromise = new Promise<void>(resolve => { finish = resolve; });
  const removal = vault.removeForSettings(['provider:local'], async () => {
    started();
    await finishPromise;
    throw new Error('SAVE_FAILED');
  });
  const rejected = assert.rejects(removal, /SAVE_FAILED/);
  await startedPromise;
  const read = vault.get('provider:local');
  finish();
  await rejected;
  assert.equal(await read, 'still-valid-key');
});

test('credential presence does not depend on OS decryption availability', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-settings-vault-'));
  await new SecretVault(dir, encryption).set('provider:local', 'presence-fake-key');
  const locked = new SecretVault(dir, { ...encryption, isEncryptionAvailable: () => false });
  assert.equal(await locked.has('provider:local'), true);
  await assert.rejects(locked.get('provider:local'), /系统加密存储不可用/);
});

test('OAuth removal rolls back and recovers after restart without reviving a committed deletion', async () => {
  const key = 'mcp-oauth:' + 'a'.repeat(64);
  for (const committed of [false, true]) {
    const dir = await mkdtemp(join(tmpdir(), 'pi-settings-vault-'));
    const vault = new SecretVault(dir, encryption, () => true);
    await vault.set(key, 'fake-private-oauth-tokens');
    await assert.rejects(vault.removeForSettings([key], async () => { throw new Error('SAVE_FAILED'); }), /SAVE_FAILED/);
    assert.equal(await vault.get(key), 'fake-private-oauth-tokens');
    const entries = JSON.parse(await readFile(join(dir, 'secrets.json'), 'utf8'));
    const journal = JSON.stringify({ version: 1, entries });
    assert.equal(journal.includes('fake-private-oauth-tokens'), false);
    await writeFile(join(dir, 'secrets-removal.json'), journal);
    if (!committed) await writeFile(join(dir, 'secrets.json'), '{}');
    const restored = new SecretVault(dir, encryption, () => !committed);
    await restored.recover();
    assert.equal(await restored.get(key), committed ? undefined : 'fake-private-oauth-tokens');
    await assert.rejects(readFile(join(dir, 'secrets-removal.json')), { code: 'ENOENT' });
  }
});

test('plugin records publish only after durable save and cannot be undone by queued background snapshots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-settings-store-')); const store = new JsonStore(dir); await store.load(); await store.save();
  const plugin = pluginSchema.parse({ id: 'fixture', source: dir, enabled: false, current: { revision: crypto.randomUUID(), path: dir, hash: 'a'.repeat(64),
    installedAt: 1, manifest: { schemaVersion: 1, id: 'fixture', name: 'Fixture', version: '1.0.0' } } });
  const blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(store.savePlugins([plugin]), /EISDIR|EPERM|EACCES/);
  assert.deepEqual(store.data.plugins, []);
  await rm(blocked, { recursive: true });
  const commit = store.savePlugins([plugin]);
  assert.deepEqual(store.data.plugins, []);
  await Promise.all([commit, store.save(), store.saveSettings({ theme: 'dark' })]);
  const reopened = new JsonStore(dir); await reopened.load();
  assert.deepEqual(reopened.data.plugins, [plugin]); assert.equal(reopened.data.settings.theme, 'dark');
});

test('MCP recovery fingerprints prevent a leftover journal from restoring secrets to a changed target', async () => {
  const original = mcpSchema.parse({ id: 'server', name: 'Server', enabled: true, transport: 'http', url: 'https://one.example/mcp' });
  const changed = { ...original, url: 'https://two.example/mcp' };
  assert.deepEqual(retiredMcpCredentials([original], [changed]), ['mcp:server']);
  assert.deepEqual(retiredMcpCredentials([original], [{ ...original, enabled: false, name: 'Renamed' }]), []);
  for (const committed of [false, true]) {
    const dir = await mkdtemp(join(tmpdir(), 'pi-settings-vault-'));
    const vault = new SecretVault(dir, encryption, () => mcpCredentialReference(original));
    await vault.set('mcp:server', 'fake-header-secret');
    let journal = '';
    await assert.rejects(vault.removeForSettings(['mcp:server'], async () => {
      journal = await readFile(join(dir, 'secrets-removal.json'), 'utf8'); throw new Error('SAVE_FAILED');
    }), /SAVE_FAILED/);
    assert.equal(await vault.get('mcp:server'), 'fake-header-secret');
    assert.equal(JSON.parse(journal).references['mcp:server'], mcpCredentialReference(original));
    assert.equal(journal.includes('fake-header-secret'), false);
    await writeFile(join(dir, 'secrets.json'), '{}'); await writeFile(join(dir, 'secrets-removal.json'), journal);
    const restored = new SecretVault(dir, encryption, () => mcpCredentialReference(committed ? changed : original));
    await restored.recover();
    assert.equal(await restored.get('mcp:server'), committed ? undefined : 'fake-header-secret');
  }
});

test('orphan MCP cleanup is atomic and preserves referenced credentials and unrelated namespaces', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-settings-vault-'));
  const active = 'mcp-oauth:' + 'a'.repeat(64), orphan = 'mcp-oauth:' + 'b'.repeat(64);
  const retained = new Set([active, 'mcp:disabled-plugin']);
  const vault = new SecretVault(dir, encryption, id => retained.has(id));
  for (const id of [active, orphan, 'mcp:removed-plugin', 'mcp:disabled-plugin', 'provider:orphan', 'future:unknown']) await vault.set(id, 'fake-' + id);
  const before = await readFile(join(dir, 'secrets.json'), 'utf8');
  const blocked = join(dir, 'secrets.json.tmp'); await mkdir(blocked);
  await assert.rejects(vault.pruneMcp(), /EISDIR|EPERM|EACCES/);
  assert.equal(await readFile(join(dir, 'secrets.json'), 'utf8'), before);
  await rm(blocked, { recursive: true });
  assert.equal(await vault.pruneMcp(), 2); assert.equal(await vault.pruneMcp(), 0);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(dir, 'secrets.json'), 'utf8'))).sort(), [active, 'mcp:disabled-plugin', 'provider:orphan', 'future:unknown'].sort());
});
