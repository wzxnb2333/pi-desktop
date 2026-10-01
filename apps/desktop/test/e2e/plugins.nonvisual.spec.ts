import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { OperationRecord } from '../../src/shared/operations.ts';
import { oauthServer } from '../fixtures/oauth-server.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
interface PluginWriteGate { waiting: boolean; release(): void; restore(): void; }
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url, { authorizeExternalTools: true }); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });
const state = () => fixture.snapshot();
const idle = async () => { await expect.poll(async () => (await state()).data.threads.find(item => item.id === 't')?.status).toBe('idle'); };
const plugin = () => state().then(value => value.data.plugins[0]);
const job = async (kind: string, status: OperationRecord['status'] = 'succeeded') => {
  await expect.poll(async () => (await state()).data.operations.filter(item => item.kind === 'plugin.' + kind).at(-1)?.status, { timeout: 45000 }).toBe(status);
};
const permission = async (approved: boolean) => { await fixture.app.evaluate(({ dialog }, value) => { dialog.showMessageBox = async () => ({ response: value ? 1 : 0, checkboxChecked: false }); }, approved); };

async function prepareOAuthPlugin(service: Awaited<ReturnType<typeof oauthServer>>) {
  const source = join(fixture.storage, 'catalog', 'oauth-plugin'); await mkdir(source, { recursive: true });
  const id = 'plugin:oauth-plugin:' + service.config.id;
  const write = async (version: string, url = service.config.url) => writeFile(join(source, 'pi-plugin.json'), JSON.stringify({
    schemaVersion: 1, id: 'oauth-plugin', name: '授权插件', version, mcp: [{ ...service.config, url }],
  }));
  await write('1.0.0');
  await fixture.app.evaluate(({ dialog, shell }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    shell.openExternal = async url => { await fetch(url); };
  }, source);
  await fixture.invoke({ op: 'plugin.pick', kind: 'directory' });
  const run = async (action: 'install' | 'enable' | 'update' | 'disable' | 'rollback' | 'uninstall', status: OperationRecord['status'] = 'succeeded') => {
    const current = await plugin();
    await fixture.invoke({ op: 'plugin.start', requestId: crypto.randomUUID(), action, pluginId: action === 'install' ? '' : 'oauth-plugin', source, hash: current?.candidate?.hash ?? current?.current.hash ?? '' });
    await job(action, status);
  };
  const login = async () => {
    const requestId = crypto.randomUUID(); await fixture.invoke({ op: 'mcp.oauthStart', id, requestId, action: 'login' });
    await expect.poll(async () => (await state()).data.operations.find(item => item.id === requestId)?.status).toBe('succeeded');
  };
  await run('install'); await run('enable');
  return { id, source, write, run, login };
}

test('plugins require explicit trust, keep active runs stable, update and roll back real tools, and reclaim only owned versions on restart', async () => {
  test.setTimeout(150000);
  const source = join(fixture.storage, 'catalog', 'fixture-plugin'); await mkdir(join(source, 'skill'), { recursive: true });
  const write = async (version: string) => {
    await writeFile(join(source, 'pi-plugin.json'), JSON.stringify({ schemaVersion: 1, id: 'native-plugin', name: '原生测试插件', version,
      skills: [{ name: 'native-skill', path: 'skill/SKILL.md' }], extensions: [{ name: 'probe', path: 'extension.mjs' }] }));
    await writeFile(join(source, 'extension.mjs'), 'export default function(pi) { pi.registerTool({ name: "plugin_probe", label: "Plugin probe", description: "Native plugin fixture", parameters: { type: "object", properties: {} }, async execute() { return { content: [{ type: "text", text: "PLUGIN_VERSION_' + version + '" }], details: {} }; } }); }');
  };
  await write('1.0.0'); await writeFile(join(source, 'skill/SKILL.md'), '---\nname: native-skill\ndescription: Native plugin fixture\n---\nPLUGIN_SKILL_BODY');
  await fixture.page.getByRole('button', { name: 'Skills 与扩展', exact: true }).click();
  await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, source);
  await fixture.page.getByRole('button', { name: '从目录安装插件' }).click(); await job('install');
  expect((await plugin()).enabled).toBe(false); expect((await plugin()).current.approved).toBe(false);
  const card = fixture.page.locator('.plugin-card').filter({ hasText: '原生测试插件' });
  await permission(false); await card.getByRole('button', { name: '授权并启用', exact: true }).click(); await job('enable', 'failed'); expect((await plugin()).enabled).toBe(false);
  fixture.setMode('hold'); await fixture.invoke({ op: 'thread.send', id: 't', text: '继续当前运行', attachments: [] }); await expect.poll(() => fixture.calls.length).toBe(1);
  expect(fixture.calls[0].tools?.some(item => item.function.name === 'plugin_probe')).toBe(false);
  await permission(true); await card.getByRole('button', { name: '授权并启用', exact: true }).click(); await job('enable');
  expect((await state()).data.threads.find(item => item.id === 't')?.status).toBe('running'); fixture.release(); await idle();
  fixture.requestTool('plugin_probe', {}); await fixture.invoke({ op: 'thread.send', id: 't', text: '运行插件工具', attachments: [] }); await idle();
  expect(JSON.stringify(fixture.calls.at(-1)?.messages)).toContain('PLUGIN_VERSION_1.0.0');
  expect(JSON.stringify(fixture.calls.at(-1)?.messages)).toContain('native-skill');
  await write('2.0.0'); await card.getByRole('button', { name: '检查并准备更新' }).click(); await job('update');
  expect((await plugin()).current.manifest.version).toBe('1.0.0'); expect((await plugin()).candidate?.manifest.version).toBe('2.0.0');
  await card.getByRole('button', { name: '授权并启用', exact: true }).click(); await job('enable');
  fixture.requestTool('plugin_probe', {}); await fixture.invoke({ op: 'thread.send', id: 't', text: '新版工具', attachments: [] }); await idle();
  expect(JSON.stringify(fixture.calls.at(-1)?.messages)).toContain('PLUGIN_VERSION_2.0.0');
  await card.getByRole('button', { name: '回退上一版本' }).click(); await job('rollback'); expect((await plugin()).current.manifest.version).toBe('1.0.0');
  await writeFile(join(source, 'pi-plugin.json'), '{}'); await card.getByRole('button', { name: '检查并准备更新' }).click(); await job('update', 'failed');
  expect((await plugin()).enabled).toBe(true); expect((await plugin()).current.manifest.version).toBe('1.0.0');
  const installed = (await plugin()).current.path; await fixture.restart(); expect((await plugin()).enabled).toBe(true);
  await fixture.page.locator('.plugin-card').getByRole('button', { name: '卸载插件', exact: true }).click();
  await fixture.page.getByRole('dialog', { name: '卸载插件', exact: true }).getByRole('button', { name: '卸载插件', exact: true }).click(); await job('uninstall');
  await access(installed); await fixture.restart(); expect((await state()).data.plugins).toHaveLength(0);
  await expect(access(installed)).rejects.toMatchObject({ code: 'ENOENT' }); expect(await readFile(join(source, 'pi-plugin.json'), 'utf8')).toBe('{}');
});

test('catalog sources persist and install through the actual management surface without granting permission', async () => {
  const root = join(fixture.storage, 'catalog'); const source = join(root, 'listed-plugin'); await mkdir(source, { recursive: true });
  await writeFile(join(source, 'pi-plugin.json'), JSON.stringify({ schemaVersion: 1, id: 'catalog-plugin', name: '目录测试插件', version: '1.0.0' }));
  await fixture.page.getByRole('button', { name: 'Skills 与扩展', exact: true }).click();
  await fixture.page.locator('.plugin-catalogs summary').click();
  await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, root);
  await fixture.page.getByRole('button', { name: '添加插件目录源' }).click();
  await fixture.page.locator('.plugin-catalogs').getByRole('button', { name: '安装此插件' }).click(); await job('install'); expect((await plugin()).enabled).toBe(false);
  await fixture.restart(); expect((await state()).data.settings.pluginSources[0].path).toBe(root); expect((await plugin()).current.manifest.name).toBe('目录测试插件');
  await fixture.page.locator('.plugin-catalogs summary').click(); await fixture.page.getByRole('button', { name: '移除目录源' }).click();
  await expect.poll(async () => (await state()).data.settings.pluginSources.length).toBe(0); await access(source);
});

test('uninstalling a plugin removes its MCP secrets and OAuth tokens and reinstall does not revive authorization', async () => {
  const service = await oauthServer();
  try {
    const source = join(fixture.storage, 'catalog', 'oauth-plugin'); await mkdir(source, { recursive: true });
    await writeFile(join(source, 'pi-plugin.json'), JSON.stringify({ schemaVersion: 1, id: 'oauth-plugin', name: '授权插件', version: '1.0.0', mcp: [service.config] }));
    await fixture.app.evaluate(({ dialog, shell }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      shell.openExternal = async url => { await fetch(url); };
    }, source);
    await fixture.invoke({ op: 'plugin.pick', kind: 'directory' });
    const install = async () => {
      await fixture.invoke({ op: 'plugin.start', requestId: crypto.randomUUID(), action: 'install', pluginId: '', source, hash: '' }); await job('install');
      const record = await plugin();
      await fixture.invoke({ op: 'plugin.start', requestId: crypto.randomUUID(), action: 'enable', pluginId: record.id, source: '', hash: record.current.hash }); await job('enable');
    };
    await install();
    const id = 'plugin:oauth-plugin:' + service.config.id;
    await fixture.invoke({ op: 'mcp.secret', id, value: { TOKEN: 'plugin-fake-secret' } });
    await fixture.invoke({ op: 'mcp.oauthStart', id, requestId: crypto.randomUUID(), action: 'login' });
    await expect.poll(async () => (await state()).data.operations.filter(item => item.kind === 'mcp.oauth.login').at(-1)?.status).toBe('succeeded');
    expect(await fixture.invoke({ op: 'mcp.oauthStatus', id })).toMatchObject({ state: 'connected' });
    const before = JSON.parse(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')) as Record<string, string>;
    expect(Object.keys(before).filter(key => key.startsWith('mcp-oauth:'))).toHaveLength(1);
    await fixture.invoke({ op: 'plugin.start', requestId: crypto.randomUUID(), action: 'uninstall', pluginId: 'oauth-plugin', source: '', hash: '' }); await job('uninstall');
    const after = JSON.parse(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')) as Record<string, string>;
    expect(Object.keys(after).filter(key => key.startsWith('mcp-oauth:') || key === 'mcp:' + id)).toEqual([]);
    for (const [key, value] of Object.entries(before).filter(([key]) => key.startsWith('provider:'))) expect(after[key]).toBe(value);
    await install();
    expect(await fixture.invoke({ op: 'mcp.oauthStatus', id })).toMatchObject({ state: 'disconnected' });
  } finally { await service.close(); }
});

test('plugin OAuth update and rollback clear changed-target credentials and recover from a failed cleanup', async () => {
  const service = await oauthServer();
  try {
    const managed = await prepareOAuthPlugin(service); await managed.login();
    await fixture.invoke({ op: 'mcp.secret', id: managed.id, value: { TOKEN: 'v1-fake-header' } });
    const path = join(fixture.storage, 'secrets.json'); const before = await readFile(path, 'utf8');
    await managed.write('2.0.0', service.config.url + '?version=2'); await managed.run('update');
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: managed.id })).toMatchObject({ state: 'connected' });
    const blocked = join(fixture.storage, 'secrets.json.tmp'); await mkdir(blocked);
    try {
      await managed.run('enable', 'failed');
      expect((await plugin()).current.manifest.version).toBe('1.0.0');
      expect((await plugin()).candidate?.manifest.version).toBe('2.0.0');
      expect(await readFile(path, 'utf8')).toBe(before);
    } finally { await rm(blocked, { recursive: true, force: true }); }
    await fixture.restart(); await permission(true);
    await fixture.app.evaluate(({ shell }) => { shell.openExternal = async url => { await fetch(url); }; });
    expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: managed.id })).toMatchObject({ state: 'connected' });
    await managed.run('enable');
    expect((await plugin()).current.manifest.version).toBe('2.0.0');
    expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: managed.id })).toMatchObject({ state: 'disconnected' });
    const keys = Object.keys(JSON.parse(await readFile(path, 'utf8')));
    expect(keys.filter(key => key === 'mcp:' + managed.id || key.startsWith('mcp-oauth:'))).toEqual([]);
    await managed.login(); await fixture.invoke({ op: 'mcp.secret', id: managed.id, value: { TOKEN: 'v2-fake-header' } });
    await managed.run('rollback');
    expect((await plugin()).current.manifest.version).toBe('1.0.0');
    expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: managed.id })).toMatchObject({ state: 'disconnected' });
    expect(Object.keys(JSON.parse(await readFile(path, 'utf8'))).filter(key => key === 'mcp:' + managed.id || key.startsWith('mcp-oauth:'))).toEqual([]);
    expect(service.counts.revoke).toBe(0);
  } finally { await service.close(); }
});

test('disabling a plugin cancels pending authorization but preserves committed credentials through restart and re-enable', async () => {
  const service = await oauthServer();
  try {
    const managed = await prepareOAuthPlugin(service); await managed.login();
    const path = join(fixture.storage, 'secrets.json'); const before = await readFile(path, 'utf8');
    await fixture.app.evaluate(({ shell }) => { shell.openExternal = async url => { (globalThis as typeof globalThis & { pluginOAuthUrl?: string }).pluginOAuthUrl = url; }; });
    const requestId = crypto.randomUUID();
    await fixture.invoke({ op: 'mcp.oauthStart', id: managed.id, requestId, action: 'login' });
    const opened = () => fixture.app.evaluate(() => (globalThis as typeof globalThis & { pluginOAuthUrl?: string }).pluginOAuthUrl);
    await expect.poll(opened).toBeTruthy();
    const callback = new URL((await opened())!).searchParams.get('redirect_uri')!;
    await managed.run('disable');
    await expect.poll(async () => (await state()).data.operations.find(item => item.id === requestId)?.status).toBe('cancelled');
    await expect(fetch(callback)).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(before);
    await fixture.restart(); expect((await plugin()).enabled).toBe(false);
    expect(await readFile(path, 'utf8')).toBe(before);
    await managed.run('enable');
    expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: managed.id })).toMatchObject({ state: 'connected' });
    expect(service.counts.exchange).toBe(1);
  } finally { await service.close(); }
});

test('startup prunes historical MCP orphans while retaining disabled plugin authorization and other credentials', async () => {
  const service = await oauthServer();
  try {
    const managed = await prepareOAuthPlugin(service); await managed.login();
    await fixture.invoke({ op: 'mcp.secret', id: managed.id, value: { TOKEN: 'owned-plugin-header' } });
    await managed.run('disable');
    const path = join(fixture.storage, 'secrets.json');
    const before = JSON.parse(await readFile(path, 'utf8')) as Record<string, string>;
    const oauth = Object.keys(before).find(key => key.startsWith('mcp-oauth:'))!;
    const orphan = 'mcp-oauth:' + 'f'.repeat(64);
    const pending = { [oauth]: before[oauth], ['mcp:' + managed.id]: before['mcp:' + managed.id] };
    const interrupted = { ...before, [orphan]: before[oauth], 'mcp:plugin:removed:old': before[oauth], 'provider:unrelated': before[oauth] };
    for (const key of Object.keys(pending)) delete interrupted[key];
    await writeFile(path, JSON.stringify(interrupted));
    await writeFile(join(fixture.storage, 'secrets-removal.json'), JSON.stringify({ version: 1, entries: pending }));
    await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [{ ...service.config, enabled: false, url: '' }] } });
    await fixture.restart();
    const after = JSON.parse(await readFile(path, 'utf8'));
    expect(after[orphan]).toBeUndefined(); expect(after['mcp:plugin:removed:old']).toBeUndefined();
    expect(after[oauth]).toBe(before[oauth]); expect(after['provider:unrelated']).toBe(before[oauth]);
    expect(after['mcp:' + managed.id]).toBe(before['mcp:' + managed.id]);
    await expect(access(join(fixture.storage, 'secrets-removal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await state()).data.settings.mcpServers[0].url).toBe('');
    await managed.run('enable');
    expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: managed.id })).toMatchObject({ state: 'connected' });
  } finally { await service.close(); }
});

test('cancelling a plugin change queued behind a credential save leaves the approved version enabled', async () => {
  const service = await oauthServer(); let pending: Promise<unknown> | undefined;
  try {
    const managed = await prepareOAuthPlugin(service); await managed.login();
    const path = join(fixture.storage, 'secrets.json.tmp');
    await fixture.app.evaluate((_, target) => {
      const fileSystem = process.getBuiltinModule('fs/promises'); const original = fileSystem.writeFile;
      const { syncBuiltinESMExports } = process.getBuiltinModule('module');
      let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
      const gate: PluginWriteGate = { waiting: false, release, restore: () => { fileSystem.writeFile = original; syncBuiltinESMExports(); } };
      (globalThis as typeof globalThis & { pluginWriteGate?: PluginWriteGate }).pluginWriteGate = gate;
      fileSystem.writeFile = async (...args: Parameters<typeof original>) => {
        if (String(args[0]) === target && !gate.waiting) { gate.waiting = true; await blocked; }
        return original(...args);
      };
      syncBuiltinESMExports();
    }, path);
    pending = fixture.invoke({ op: 'mcp.secret', id: managed.id, value: { TOKEN: 'new-fake-header' } });
    await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { pluginWriteGate?: PluginWriteGate }).pluginWriteGate?.waiting)).toBe(true);
    const requestId = crypto.randomUUID();
    await fixture.invoke({ op: 'plugin.start', requestId, action: 'disable', pluginId: 'oauth-plugin', source: '', hash: '' });
    await fixture.invoke({ op: 'plugin.cancel', requestId });
    await fixture.app.evaluate(() => { const gate = (globalThis as typeof globalThis & { pluginWriteGate?: PluginWriteGate }).pluginWriteGate; gate?.release(); gate?.restore(); });
    await pending; await job('disable', 'cancelled');
    expect((await plugin()).enabled).toBe(true);
    expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: managed.id })).toMatchObject({ state: 'connected' });
    await managed.run('disable'); expect((await plugin()).enabled).toBe(false);
  } finally {
    await fixture.app.evaluate(() => { const root = globalThis as typeof globalThis & { pluginWriteGate?: PluginWriteGate }; root.pluginWriteGate?.release(); root.pluginWriteGate?.restore(); delete root.pluginWriteGate; });
    await pending?.catch(() => {}); await service.close();
  }
});

test('plugin credential forms configure real stdio and HTTP tools, retain encrypted state across restart and clear only the selected server', async () => {
  test.setTimeout(90000);
  const service = await oauthServer();
  try {
    service.acceptAccessToken('fixture-header-token');
    const source = join(fixture.storage, 'catalog', 'credential-plugin'); await mkdir(source, { recursive: true });
    await writeFile(join(source, 'context.json'), JSON.stringify({ required: 'fixture-env-token', label: 'ENV_CREDENTIAL_REAL_TOOL_OK' }));
    await writeFile(join(source, 'pi-plugin.json'), JSON.stringify({ schemaVersion: 1, id: 'credential-plugin', name: '连接凭据插件', version: '1.0.0', mcp: [
      { id: 'env', name: '环境变量服务', transport: 'stdio', enabled: true, command: process.execPath, args: [resolve('test/fixtures/mcp-credentials-server.mjs'), '{pluginRoot}/context.json'] },
      { ...service.config, id: 'headers', name: '请求头服务', oauth: undefined },
    ] }));
    await fixture.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }, source);
    await fixture.page.getByRole('button', { name: 'Skills 与扩展', exact: true }).click();
    await fixture.page.getByRole('button', { name: '从目录安装插件', exact: true }).click(); await job('install');
    const envId = 'plugin:credential-plugin:env', httpId = 'plugin:credential-plugin:headers';
    await expect(fixture.invoke({ op: 'mcp.secretStatus', id: envId })).rejects.toThrow(/请先保存 MCP 配置/);
    await expect(fixture.invoke({ op: 'mcp.secret', id: envId, value: { TOKEN: 'unapproved' } })).rejects.toThrow(/请先保存 MCP 配置/);
    await fixture.page.getByRole('button', { name: '授权并启用', exact: true }).click(); await job('enable');
    for (const item of [{ name: '环境变量服务', key: 'PI_FIXTURE_TOKEN', value: 'fixture-env-token', tool: 'credential_probe' }, { name: '请求头服务', key: 'Authorization', value: 'Bearer fixture-header-token', tool: 'oauth_echo' }]) {
      const section = fixture.page.getByRole('region', { name: 'MCP · ' + item.name, exact: true });
      const credentials = section.locator('.mcp-secret-settings'); await credentials.locator('summary').click();
      await credentials.getByLabel('凭据名称 1', { exact: true }).fill(item.key);
      await credentials.getByLabel('凭据值 1', { exact: true }).fill(item.value);
      await credentials.getByRole('button', { name: '保存连接凭据', exact: true }).click();
      await expect(credentials.getByRole('status')).toHaveText('连接凭据已保存');
      await expect(credentials.getByLabel('凭据值 1', { exact: true })).toHaveValue('');
      const policies = section.locator('.mcp-tool-policies'); await policies.locator('summary').click();
      await policies.getByRole('button', { name: '读取工具列表', exact: true }).click();
      await expect(policies.getByRole('status')).toContainText('已发现 1');
      await expect(policies.locator('legend')).toHaveText(item.tool);
    }
    const stored = await readFile(join(fixture.storage, 'secrets.json'), 'utf8');
    expect(stored).not.toContain('fixture-env-token'); expect(stored).not.toContain('fixture-header-token');
    expect(await fixture.invoke({ op: 'mcp.secretStatus', id: envId })).toEqual({ configured: true });
    expect(await fixture.invoke({ op: 'mcp.secretStatus', id: httpId })).toEqual({ configured: true });
    const current = (await plugin()).current.manifest.mcp.find(server => server.id === 'headers')!;
    const stale = { ...current, id: httpId, url: service.config.url + '?stale' };
    await expect(fixture.invoke({ op: 'mcp.secretStatus', id: httpId, base: stale })).rejects.toThrow(/设置已在其他位置修改/);
    await expect(fixture.invoke({ op: 'mcp.secret', id: httpId, value: { Authorization: 'stale-value' }, base: stale })).rejects.toThrow(/设置已在其他位置修改/);
    expect(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')).toBe(stored);
    await fixture.invoke({ op: 'thread.resume', id: 't' });
    await expect.poll(async () => (await state()).data.threads.find(item => item.id === 't')?.mcp?.find(server => server.id === envId)?.state).toBe('connected');
    const thread = (await state()).data.threads.find(item => item.id === 't')!;
    const envTool = thread.mcp!.find(server => server.id === envId)!.tools[0];
    fixture.requestTool(envTool.name, {}); await fixture.invoke({ op: 'thread.send', id: 't', text: '验证插件环境变量', attachments: [] }); await idle();
    expect(JSON.stringify(fixture.calls.at(-1)?.messages)).toContain('ENV_CREDENTIAL_REAL_TOOL_OK');
    const httpTool = thread.mcp!.find(server => server.id === httpId)!.tools[0];
    fixture.requestTool(httpTool.name, {}); await fixture.invoke({ op: 'thread.send', id: 't', text: '验证插件请求头', attachments: [] }); await idle();
    expect(service.counts.tool).toBeGreaterThan(0); expect(service.seen).toContain('Bearer fixture-header-token');
    await fixture.restart();
    await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    expect(await fixture.invoke({ op: 'mcp.secretStatus', id: envId })).toEqual({ configured: true });
    const section = fixture.page.getByRole('region', { name: 'MCP · 环境变量服务', exact: true });
    const credentials = section.locator('.mcp-secret-settings'); await credentials.locator('summary').click();
    await expect(credentials.getByLabel('凭据值 1', { exact: true })).toHaveValue('');
    await credentials.getByRole('button', { name: '清除连接凭据', exact: true }).click();
    await fixture.page.getByRole('dialog').getByRole('button', { name: '清除连接凭据', exact: true }).click();
    await expect(credentials.getByRole('status')).toHaveText('连接凭据已清除');
    expect(await fixture.invoke({ op: 'mcp.secretStatus', id: envId })).toEqual({ configured: false });
    expect(await fixture.invoke({ op: 'mcp.secretStatus', id: httpId })).toEqual({ configured: true });
    await expect(fixture.invoke({ op: 'mcp.test', id: envId })).rejects.toThrow(/Missing fixture credential/);
    await fixture.restart();
    expect(await fixture.invoke({ op: 'mcp.secretStatus', id: envId })).toEqual({ configured: false });
    expect(await fixture.invoke({ op: 'mcp.secretStatus', id: httpId })).toEqual({ configured: true });
  } finally { await service.close(); }
});
