import assert from 'node:assert/strict';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import { mkdtemp } from './fixtures/node-temp.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { evaluateAction, resolveAgentFile, safeProjectPath } from '../src/main/policy.ts';
import { JsonStore, SecretVault } from '../src/main/store.ts';
import { migrateDesktopData } from '../src/main/data-migrations.ts';
import {
  dataSchema,
  defaultData,
  requestSchema,
  REVIEW_WIDTH,
  SIDEBAR_WIDTH,
  uiSchema,
  uiThreadSchema,
} from '../src/shared/contracts.ts';

test('IPC rejects unknown operations, unexpected properties and dangerous preview schemes', () => {
  assert.equal(requestSchema.safeParse({ op: 'shell', command: 'unsafe' }).success, false);
  assert.equal(requestSchema.safeParse({ op: 'thread.stop', id: 'a', extra: true }).success, false);
  assert.equal(requestSchema.safeParse({ op: 'preview.open', url: 'javascript:alert(1)' }).success, false);
  assert.equal(requestSchema.safeParse({ op: 'preview.open', url: 'http://localhost:5173' }).success, true);
});

test('ui.update and ui.threadUpdate accept their shapes and reject invalid layout values', () => {
  assert.equal(requestSchema.safeParse({ op: 'ui.update', ui: defaultData().ui }).success, true);
  assert.equal(
    requestSchema.safeParse({ op: 'ui.update', ui: { ...defaultData().ui, sidebarWidth: 50 } }).success,
    false,
  );
  assert.equal(
    requestSchema.safeParse({ op: 'ui.threadUpdate', threadId: 't', thread: { reviewTab: 'files' } })
      .success,
    true,
  );
  assert.equal(
    requestSchema.safeParse({ op: 'ui.threadUpdate', threadId: 't', thread: { reviewTab: 'nope' } })
      .success,
    false,
  );
  assert.equal(
    requestSchema.safeParse({ op: 'ui.update', ui: defaultData().ui, unexpected: 1 }).success,
    false,
  );
  assert.equal(requestSchema.safeParse({ op: 'ui.threadUpdate', threadId: '', thread: {} }).success, false);
});

test('layout defaults are the reference metrics and survive data without a ui field', () => {
  const fresh = uiSchema.parse({});
  assert.equal(fresh.sidebarWidth, SIDEBAR_WIDTH.default);
  assert.equal(SIDEBAR_WIDTH.default, 275);
  assert.equal(SIDEBAR_WIDTH.min, 240);
  assert.equal(SIDEBAR_WIDTH.max, 520);
  assert.equal(fresh.reviewWidth, REVIEW_WIDTH.default);
  assert.equal(fresh.view, 'thread');
  assert.equal(fresh.threads['missing']?.reviewTab, undefined);
  const legacy = migrateDesktopData({
    version: 1,
    projects: [],
    threads: [],
    settings: {},
    automations: [],
  }).data;
  assert.equal(legacy.ui.sidebarWidth, 275);
  assert.equal(legacy.ui.diffSplit, false);
  assert.deepEqual(legacy.ui.threads, {});
  assert.equal(uiThreadSchema.parse({}).selectedPath, '');
});

test('plan mode blocks mutation, shells and external tools regardless of auto policy', () => {
  assert.equal(evaluateAction('auto', true, 'powershell'), 'deny');
  assert.equal(evaluateAction('auto', true, 'mcp.test'), 'deny');
  assert.equal(evaluateAction('ask', true, 'read'), 'allow');
  assert.equal(evaluateAction('ask', false, 'edit'), 'ask');
  assert.equal(evaluateAction('deny', false, 'powershell'), 'deny');
});

test('project paths reject traversal and junction escapes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-path-'));
  await writeFile(join(dir, '文档.txt'), 'hello');
  assert.equal(await safeProjectPath(dir, '文档.txt'), join(dir, '文档.txt'));
  await assert.rejects(safeProjectPath(dir, '../outside'), /项目/);
  const outside = await mkdtemp(join(tmpdir(), 'pi-outside-'));
  await symlink(outside, join(dir, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(safeProjectPath(dir, 'external/new-file.txt'), /项目/);
});

test('agent path normalization rejects Pi aliases escaping the project and permits explicitly imported skill reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-agent-path-'));
  const outside = await mkdtemp(join(tmpdir(), 'pi-skill-'));
  const skill = join(outside, 'SKILL.md');
  await writeFile(skill, 'skill content');
  await assert.rejects(resolveAgentFile(root, `@${skill}`), /项目/);
  await assert.rejects(resolveAgentFile(root, '~/private.txt'), /项目/);
  await assert.rejects(resolveAgentFile(root, pathToFileURL(skill).href), /项目/);
  assert.equal(await resolveAgentFile(root, skill, [skill]), skill);
  await assert.rejects(resolveAgentFile(root, join(outside, 'other.txt'), [skill]), /项目/);
});

test('atomic metadata persists and recovers the last valid backup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-store-'));
  const store = new JsonStore(dir);
  await store.load();
  store.data.settings.theme = 'dark';
  await store.save();
  store.data.settings.theme = 'light';
  await store.save();
  const restored = new JsonStore(dir);
  await restored.load();
  assert.equal(restored.data.settings.theme, 'light');
  await writeFile(join(dir, 'desktop.json'), '{broken');
  await restored.load();
  assert.equal(restored.data.settings.theme, 'dark');
});

test('secret vault stores ciphertext only and rejects unavailable encryption', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-vault-'));
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from([...s].reverse().join('')),
    decryptString: (b: Buffer) => [...b.toString()].reverse().join(''),
  };
  const vault = new SecretVault(dir, encryption);
  await vault.set('provider', 'sk-private-key');
  assert.equal(await vault.get('provider'), 'sk-private-key');
  assert.equal((await readFile(join(dir, 'secrets.json'), 'utf8')).includes('sk-private-key'), false);
  const locked = new SecretVault(dir, { ...encryption, isEncryptionAvailable: () => false });
  await assert.rejects(locked.set('other', 'key'), /加密/);
});
