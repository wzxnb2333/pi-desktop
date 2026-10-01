import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { defaultData } from '../src/shared/contracts.ts';
import type { Plugin } from '../src/shared/plugins.ts';
import { Plugins, pluginMcpConfigurations } from '../src/main/plugins.ts';
import { retiredMcpCredentials } from '../src/main/mcp-credentials.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

const signal = () => new AbortController().signal;
const manifest = (version = '1.0.0') => ({ schemaVersion: 1, id: 'test.plugin', name: '测试插件', version, description: 'local fixture',
  skills: [{ name: 'fixture-skill', path: 'skill/SKILL.md' }], extensions: [{ name: 'Fixture extension', path: 'extension.mjs' }],
  mcp: [{ id: 'local', name: 'Fixture MCP', enabled: true, transport: 'stdio', command: 'node', args: ['{pluginRoot}/server.mjs'] }] });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pi-plugins-')); const source = join(root, 'catalog', 'plugin'); const storage = join(root, 'storage');
  await mkdir(join(source, 'skill'), { recursive: true }); await mkdir(storage);
  await writeFile(join(source, 'pi-plugin.json'), JSON.stringify(manifest()));
  await writeFile(join(source, 'skill/SKILL.md'), '---\nname: fixture-skill\ndescription: Local fixture\n---\nUse only for the test.\n');
  await writeFile(join(source, 'extension.mjs'), 'throw new Error("DO_NOT_EXECUTE_DURING_INSTALL");');
  await writeFile(join(source, 'server.mjs'), 'throw new Error("DO_NOT_EXECUTE_DURING_INSTALL");');
  await writeFile(join(source, 'package.json'), JSON.stringify({ scripts: { postinstall: 'exit 99' } }));
  const records: Plugin[] = []; let saved = '[]'; let failSave = false;
  const plugins = new Plugins(storage, () => records, async next => { if (failSave) throw new Error('DISK_FAILURE'); saved = JSON.stringify(next); records.splice(0, records.length, ...next); });
  return { root, source, storage, records, plugins, saved: () => saved, fail(value: boolean) { failSave = value; } };
}

test('plugin installation, explicit trust, staged updates and rollback preserve the working version without running scripts', async () => {
  const { source, plugins, records, saved } = await fixture(); const base = defaultData().settings;
  let record = await plugins.install(source, signal(), () => {});
  assert.equal(record.enabled, false); assert.equal(record.current.approved, false); assert.equal((await plugins.settings(base)).resources.length, 0);
  await assert.rejects(plugins.setEnabled(record.id, true, 'bad-hash'), /版本已变化/);
  record = await plugins.setEnabled(record.id, true, record.current.hash);
  const original = record.current;
  const active = await plugins.settings(base); assert.equal(active.resources.length, 2); assert.equal(active.mcpServers.length, 1);
  assert.equal(active.mcpServers[0].args[0], original.path + '/server.mjs'); assert.equal(base.resources.length, 0);
  const duplicate = structuredClone(base); duplicate.mcpServers.push(active.mcpServers[0]);
  await assert.rejects(plugins.settings(duplicate), /标识.*冲突/);
  await writeFile(join(source, 'pi-plugin.json'), JSON.stringify(manifest('2.0.0')));
  record = await plugins.install(source, signal(), () => {}, record.id);
  assert.equal(record.current.manifest.version, '1.0.0'); assert.equal(record.candidate?.manifest.version, '2.0.0');
  assert.equal((await plugins.settings(base)).resources[0].path, join(original.path, 'skill/SKILL.md'));
  record = await plugins.setEnabled(record.id, true, record.candidate!.hash);
  assert.equal(record.current.manifest.version, '2.0.0'); assert.equal(record.previous?.hash, original.hash);
  record = await plugins.rollback(record.id); assert.equal(record.current.hash, original.hash); assert.equal(record.enabled, true);
  await writeFile(join(source, 'pi-plugin.json'), 'not-json');
  await assert.rejects(plugins.install(source, signal(), () => {}, record.id));
  assert.equal(record.current.hash, original.hash); assert.equal(record.enabled, true); assert.equal(records.length, 1);
  assert.equal(JSON.parse(saved())[0].current.hash, original.hash);
  await plugins.setEnabled(record.id, false); assert.equal((await plugins.settings(base)).resources.length, 0);
});

test('failed persistence and cancellation remove only owned staging; modified installed files fail closed', async () => {
  const { source, storage, plugins, records, fail } = await fixture(); fail(true);
  await assert.rejects(plugins.install(source, signal(), () => {}), /DISK_FAILURE/); assert.equal(records.length, 0);
  fail(false); const controller = new AbortController();
  await assert.rejects(plugins.install(source, controller.signal, stage => { if (stage === '保存插件版本') controller.abort(); }));
  assert.equal((await readdir(join(storage, 'plugins'))).some(name => name.startsWith('.staging-')), false);
  const record = await plugins.install(source, signal(), () => {}); await plugins.setEnabled(record.id, true, record.current.hash);
  await writeFile(join(record.current.path, 'extension.mjs'), 'changed');
  await assert.rejects(plugins.settings(defaultData().settings), /发生变化/);
  await plugins.setEnabled(record.id, false); await plugins.settings(defaultData().settings);
  assert.equal(await readFile(join(source, 'extension.mjs'), 'utf8'), 'throw new Error("DO_NOT_EXECUTE_DURING_INSTALL");');
});

test('failed activation, disable, rollback and uninstall keep exactly the last committed plugin records', async () => {
  const { plugins, records, source, fail } = await fixture();
  let record = await plugins.install(source, signal(), () => {});
  const checkFailure = async (action: () => Promise<unknown>) => {
    const before = structuredClone(records); fail(true);
    try { await assert.rejects(action(), /DISK_FAILURE/); assert.deepEqual(records, before); } finally { fail(false); }
  };
  await checkFailure(() => plugins.setEnabled(record.id, true, record.current.hash));
  record = await plugins.setEnabled(record.id, true, record.current.hash);
  const originalServers = pluginMcpConfigurations(records);
  await writeFile(join(source, 'pi-plugin.json'), JSON.stringify(manifest('2.0.0')));
  record = await plugins.install(source, signal(), () => {}, record.id);
  assert.deepEqual(pluginMcpConfigurations(records), originalServers);
  await checkFailure(() => plugins.setEnabled(record.id, true, record.candidate!.hash));
  record = await plugins.setEnabled(record.id, true, record.candidate!.hash);
  assert.deepEqual(retiredMcpCredentials(originalServers, pluginMcpConfigurations(records)), []);
  await checkFailure(() => plugins.setEnabled(record.id, false));
  await checkFailure(() => plugins.rollback(record.id));
  await checkFailure(() => plugins.uninstall(record.id));
  const cancelled = AbortSignal.abort(); const beforeCancellation = structuredClone(records);
  await assert.rejects(plugins.setEnabled(record.id, false, undefined, cancelled));
  await assert.rejects(plugins.rollback(record.id, cancelled));
  await assert.rejects(plugins.uninstall(record.id, cancelled));
  assert.deepEqual(records, beforeCancellation);
  await plugins.setEnabled(record.id, false);
  assert.equal(pluginMcpConfigurations(records).length, 1); assert.equal(pluginMcpConfigurations(records, true).length, 0);
});

test('catalogs report invalid packages and garbage collection retains live revisions and unrelated directories', async () => {
  const { root, source, storage, plugins } = await fixture();
  const record = await plugins.install(source, signal(), () => {}); const path = record.current.path;
  const sources = [{ id: crypto.randomUUID(), name: 'catalog', path: join(root, 'catalog') }];
  const catalog = await plugins.catalog(sources); assert.equal(catalog[0].manifest?.id, record.id);
  await mkdir(join(storage, 'plugins', 'unrelated')); await writeFile(join(storage, 'plugins', 'unrelated', 'keep.txt'), 'user');
  const interrupted = crypto.randomUUID(); const stage = join(storage, 'plugins', '.staging-' + interrupted); await mkdir(stage);
  await writeFile(join(stage, '.pi-plugin-owner.json'), JSON.stringify({ kind: 'pi-plugin-version', revision: interrupted, pid: process.pid }));
  assert.deepEqual(await plugins.collect(), []); await access(path);
  await assert.rejects(access(stage), { code: 'ENOENT' });
  await plugins.uninstall(record.id); await access(path); // Running workers can still read their snapshot.
  assert.deepEqual(await plugins.collect(), []); await assert.rejects(access(path), { code: 'ENOENT' }); await access(source);
  assert.equal(await readFile(join(storage, 'plugins', 'unrelated/keep.txt'), 'utf8'), 'user');
  await writeFile(join(source, 'pi-plugin.json'), '{}'); assert.ok((await plugins.catalog(sources))[0].error);
});

test('source links and manifest paths cannot escape the selected package', async () => {
  const { root, source, plugins } = await fixture();
  await mkdir(join(root, 'outside')); await writeFile(join(root, 'outside', 'secret'), 'outside');
  await symlink(join(root, 'outside'), join(source, 'linked'), 'junction');
  await assert.rejects(plugins.install(source, signal(), () => {}), /链接/);
  assert.equal(await readFile(join(root, 'outside/secret'), 'utf8'), 'outside');
});

async function zip(path: string, files: Array<{ name: string; text: string }>) {
  const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($env:PI_TEST_PLUGIN_ZIP, [System.IO.Compression.ZipArchiveMode]::Create)
try { foreach ($file in (ConvertFrom-Json $env:PI_TEST_PLUGIN_FILES)) { $entry = $zip.CreateEntry($file.name); $stream = New-Object System.IO.StreamWriter($entry.Open()); try { $stream.Write($file.text) } finally { $stream.Dispose() } } } finally { $zip.Dispose() }`;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    env: { ...process.env, PI_TEST_PLUGIN_ZIP: path, PI_TEST_PLUGIN_FILES: JSON.stringify(files) }, windowsHide: true,
  });
}

test('real ZIP adapter installs a wrapper folder and rejects traversal and case collisions without modifying the old plugin', async () => {
  const { root, plugins } = await fixture(); const path = join(root, 'valid.zip');
  const minimal = { schemaVersion: 1, id: 'zip-plugin', name: 'ZIP plugin', version: '1.0.0' };
  await zip(path, [{ name: 'wrapper/pi-plugin.json', text: JSON.stringify(minimal) }, { name: 'wrapper/readme.txt', text: '中文 ZIP' }]);
  const record = await plugins.install(path, signal(), () => {});
  assert.equal(await readFile(join(record.current.path, 'readme.txt'), 'utf8'), '中文 ZIP'); const hash = record.current.hash;
  const evil = join(root, 'evil.zip'); await zip(evil, [{ name: '../escape.txt', text: 'escape' }]);
  await assert.rejects(plugins.install(evil, signal(), () => {}, record.id), /Invalid ZIP entry path/);
  await assert.rejects(access(join(root, 'escape.txt')), { code: 'ENOENT' }); assert.equal(record.current.hash, hash);
  const duplicate = join(root, 'duplicate.zip'); await zip(duplicate, [{ name: 'file.txt', text: 'a' }, { name: 'FILE.txt', text: 'b' }]);
  await assert.rejects(plugins.install(duplicate, signal(), () => {}), /Duplicate or escaping ZIP entry/);
});
