import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { mcpSchema } from '../../src/shared/contracts.ts';
import { mcpCredentialReference } from '../../src/main/mcp-credentials.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => {
  if (!fixture) return;
  const errors = [...fixture.errors];
  await fixture.close();
  await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(errors).toEqual([]);
});

test('failed mixed settings retain the live worker and all committed preferences until retry', async () => {
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '保持当前任务', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  const pid = () => fixture.app.evaluate(({ app }) => app.getAppMetrics().find(item => item.type === 'Utility' && item.name === 'Pi Agent')?.pid);
  const runningPid = await pid();
  expect(runningPid).toBeTruthy();
  const before = (await fixture.snapshot()).data.settings;
  const patch = { theme: 'dark' as const, fontSize: 17, models: before.models.map(model => ({ ...model, model: 'after-retry' })) };
  const blocked = join(fixture.storage, 'desktop.json.tmp');
  await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'settings.patch', patch })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    expect((await fixture.snapshot()).data.settings).toEqual(before);
    expect(JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')).settings).toEqual(before);
    expect(await pid()).toBe(runningPid);
    expect((await fixture.snapshot()).data.threads[0].status).toBe('running');
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.invoke({ op: 'settings.patch', patch });
  expect(await pid()).toBe(runningPid);
  fixture.release();
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '下一次使用新设置', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(2);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect(fixture.calls.map(call => call.model)).toEqual(['acceptance', 'after-retry']);
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings).toMatchObject(patch);
});

test('failed provider and MCP removal restores credentials and retry persists their removal', async () => {
  const server = mcpSchema.parse({ id: 'local-mcp', name: '本地测试', transport: 'stdio', command: process.execPath, enabled: false });
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [server] } });
  await fixture.invoke({ op: 'provider.key', id: 'local-provider', key: 'provider-fake-secret' });
  await fixture.invoke({ op: 'mcp.secret', id: server.id, value: { TOKEN: 'mcp-fake-secret' } });
  const before = (await fixture.snapshot()).data.settings;
  const encrypted = await readFile(join(fixture.storage, 'secrets.json'), 'utf8');
  const blocked = join(fixture.storage, 'desktop.json.tmp');
  await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'settings.patch', patch: { modelProviders: [], models: [], mcpServers: [] } })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    expect((await fixture.snapshot()).data.settings).toEqual(before);
    expect(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')).toBe(encrypted);
    await expect(access(join(fixture.storage, 'secrets-removal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.invoke({ op: 'thread.send', id: 't', text: '失败后仍可使用原密钥', attachments: [] });
  await expect.poll(() => fixture.authorizations.at(-1)).toBe('Bearer provider-fake-secret');
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  await fixture.invoke({ op: 'settings.patch', patch: { modelProviders: [], models: [], mcpServers: [] } });
  expect(JSON.parse(await readFile(join(fixture.storage, 'secrets.json'), 'utf8'))).toEqual({});
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings).toMatchObject({ modelProviders: [], models: [], mcpServers: [] });
});

test('credential write failures retain the UI draft and preference saves do not require decryption', async () => {
  await fixture.invoke({ op: 'provider.key', id: 'local-provider', key: 'old-fake-key' });
  const encrypted = await readFile(join(fixture.storage, 'secrets.json'), 'utf8');
  await fixture.page.keyboard.press('Control+,');
  await fixture.page.getByLabel(/^API Key/).fill('new-fake-key');
  await expect(fixture.page.getByLabel(/^API Key/)).toHaveValue('new-fake-key');
  const blocked = join(fixture.storage, 'secrets.json.tmp');
  await mkdir(blocked);
  try {
    await expect(fixture.page.getByLabel(/^API Key/)).toHaveValue('new-fake-key');
    await fixture.page.getByRole('button', { name: '保存设置' }).click();
    await expect(fixture.page.locator('.settings-footer [role=status]')).toHaveAttribute('data-error', 'true');
    await expect(fixture.page.getByLabel(/^API Key/)).toHaveValue('new-fake-key');
    expect(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')).toBe(encrypted);
    // A failed write must not poison subsequent reads through the vault queue.
    await fixture.invoke({ op: 'thread.send', id: 't', text: '使用原密钥', attachments: [] });
    await expect.poll(() => fixture.authorizations.at(-1)).toBe('Bearer old-fake-key');
    await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.locator('.settings-footer [role=status]')).toHaveText('设置已保存');
  await expect(fixture.page.getByLabel(/^API Key/)).toHaveValue('');
  await fixture.app.evaluate(({ safeStorage }) => { safeStorage.isEncryptionAvailable = () => false; });
  await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark', followUpMode: 'steer' } });
  expect((await fixture.snapshot()).data.settings).toMatchObject({ theme: 'dark', followUpMode: 'steer' });
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings.modelProviders[0].hasKey).toBe(true);
  await fixture.invoke({ op: 'thread.send', id: 't', text: '重启后使用新密钥', attachments: [] });
  await expect.poll(() => fixture.authorizations.at(-1)).toBe('Bearer new-fake-key');
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
});

test('stale model and MCP forms cannot create orphan credentials', async () => {
  await fixture.invoke({ op: 'provider.key', id: 'local-provider', key: 'existing-fake-key' });
  const before = await readFile(join(fixture.storage, 'secrets.json'), 'utf8');
  await expect(fixture.invoke({ op: 'provider.key', id: 'removed-provider', key: 'orphan-fake-key' })).rejects.toThrow(/模型提供商已不存在/);
  await expect(fixture.invoke({ op: 'mcp.secret', id: 'removed-mcp', value: { TOKEN: 'orphan-fake-secret' } })).rejects.toThrow(/保存 MCP 配置/);
  expect(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')).toBe(before);
});

test('Electron restart reconciles interrupted credential removal against the saved configuration', async () => {
  await fixture.invoke({ op: 'provider.key', id: 'local-provider', key: 'recovery-fake-key' });
  const path = join(fixture.storage, 'secrets.json');
  const entries = JSON.parse(await readFile(path, 'utf8')) as Record<string, string>;
  const journal = JSON.stringify({ version: 1, entries });
  expect(journal).not.toContain('recovery-fake-key');
  // Stage the actual crash boundary: secrets removed, configuration still committed to the old model.
  await writeFile(join(fixture.storage, 'secrets-removal.json'), journal);
  await writeFile(path, '{}');
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings.modelProviders[0].hasKey).toBe(true);
  await fixture.invoke({ op: 'thread.send', id: 't', text: '恢复后使用模型', attachments: [] });
  await expect.poll(() => fixture.authorizations.at(-1)).toBe('Bearer recovery-fake-key');
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  await fixture.invoke({ op: 'settings.patch', patch: { modelProviders: [], models: [] } });
  // A stale encrypted recovery copy must not restore a credential removed by committed settings.
  await writeFile(path, JSON.stringify(entries));
  await writeFile(join(fixture.storage, 'secrets-removal.json'), journal);
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings.modelProviders).toEqual([]);
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({});
  await expect(access(join(fixture.storage, 'secrets-removal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('reconfigured provider and MCP forms reject stale credential targets without overwriting existing secrets', async () => {
  const server = mcpSchema.parse({ id: 'local-mcp', name: '本地测试', transport: 'stdio', command: process.execPath, enabled: false });
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [server] } });
  const provider = (await fixture.snapshot()).data.settings.modelProviders[0];
  await fixture.invoke({ op: 'provider.key', id: provider.id, key: 'existing-fake-key', base: provider });
  await fixture.invoke({ op: 'mcp.secret', id: server.id, value: { TOKEN: 'existing-mcp-secret' }, base: server });
  const updated = { ...provider, name: '重命名后的验收模型' }; const changedServer = { ...server, args: ['different-server.js'] };
  await fixture.invoke({ op: 'settings.patch', patch: { modelProviders: [updated], mcpServers: [changedServer] } });
  // Saving the reconfigured server retires the credential of its previous target, so the stale
  // writes below are compared against what the vault holds after that save.
  const before = await readFile(join(fixture.storage, 'secrets.json'), 'utf8');
  await expect(fixture.invoke({ op: 'provider.key', id: provider.id, key: 'stale-key', base: provider })).rejects.toThrow(/其他位置修改/);
  await expect(fixture.invoke({ op: 'mcp.secret', id: server.id, value: { TOKEN: 'stale-secret' }, base: server })).rejects.toThrow(/其他位置修改/);
  expect(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')).toBe(before);
  // Presence metadata can change after another credential save without changing the target.
  await fixture.invoke({ op: 'provider.key', id: provider.id, key: 'updated-fake-key', base: { ...updated, hasKey: false } });
  await fixture.invoke({ op: 'mcp.secret', id: server.id, value: { TOKEN: 'updated-secret' }, base: changedServer });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '使用新配置', attachments: [] });
  await expect.poll(() => fixture.authorizations.at(-1)).toBe('Bearer updated-fake-key');
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
});

test('a concurrent provider change keeps the UI key draft and refuses silent reassignment after saving preferences', async () => {
  await fixture.invoke({ op: 'provider.key', id: 'local-provider', key: 'old-fake-key' });
  const before = await readFile(join(fixture.storage, 'secrets.json'), 'utf8');
  await fixture.page.keyboard.press('Control+,');
  const input = fixture.page.getByLabel(/^API Key/);
  await input.fill('unsaved-fake-key'); await expect(input).toHaveValue('unsaved-fake-key');
  const stored = (await fixture.snapshot()).data.settings;
  const provider = stored.modelProviders[0];
  await fixture.invoke({ op: 'settings.patch', patch: {
    modelProviders: [{ ...provider, name: '并发修改的验收模型' }],
    models: stored.models.map(model => ({ ...model, model: 'new-model' })),
  } });
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.locator('.settings-footer [role=status]')).toContainText('其他位置修改');
  await expect(input).toHaveValue('unsaved-fake-key');
  expect(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')).toBe(before);
  await expect(fixture.page.getByLabel('显示名称', { exact: true })).toHaveValue('并发修改的验收模型');
  await expect(fixture.page.locator('.model-row-id')).toHaveText('new-model');
  // The user can review the now-visible configuration before explicitly retrying.
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.locator('.settings-footer [role=status]')).toHaveText('设置已保存');
  await expect(input).toHaveValue('');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '显式重试后使用新密钥', attachments: [] });
  await expect.poll(() => fixture.authorizations.at(-1)).toBe('Bearer unsaved-fake-key');
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
});

test('changing an MCP target clears old headers and failed persistence retains them for the original endpoint', async () => {
  const original = mcpSchema.parse({ id: 'headers', name: '本地请求头', transport: 'http', url: fixture.url + '/one', enabled: false });
  const next = { ...original, url: fixture.url + '/two' };
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [original] } });
  await fixture.invoke({ op: 'mcp.secret', id: original.id, value: { TOKEN: 'fake-endpoint-header' } });
  const path = join(fixture.storage, 'secrets.json'); const before = await readFile(path, 'utf8');
  const encrypted = JSON.parse(before) as Record<string, string>;
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [next] } })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    expect((await fixture.snapshot()).data.settings.mcpServers).toEqual([original]);
    expect(await readFile(path, 'utf8')).toBe(before);
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [next] } });
  expect(JSON.parse(await readFile(path, 'utf8'))['mcp:' + original.id]).toBeUndefined();
  await writeFile(join(fixture.storage, 'secrets-removal.json'), JSON.stringify({ version: 1, entries: { ['mcp:' + original.id]: encrypted['mcp:' + original.id] }, references: { ['mcp:' + original.id]: mcpCredentialReference(original) } }));
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings.mcpServers).toEqual([next]);
  expect(JSON.parse(await readFile(path, 'utf8'))['mcp:' + original.id]).toBeUndefined();
});
