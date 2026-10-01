import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { oauthServer } from '../fixtures/oauth-server.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
let service: Awaited<ReturnType<typeof oauthServer>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url, { authorizeExternalTools: true }); service = await oauthServer(); });
test.afterEach(async () => { const errors = [...(fixture?.errors ?? [])]; try { await fixture?.close(); } finally { await service?.close(); } if (fixture) await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); });
const job = async (action: string, status = 'succeeded') => { await expect.poll(async () => { const operation = (await fixture.snapshot()).data.operations.filter(item => item.kind === 'mcp.oauth.' + action).at(-1); return { status: operation?.status, ...(operation?.error ? { error: operation.error } : {}) }; }).toMatchObject({ status }); };
const idle = async () => { await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === 't')?.status).toBe('idle'); };
const open = async (authorize = true) => {
  await fixture.app.evaluate(({ shell }, authorize) => { shell.openExternal = async url => { if (authorize) { const response = await fetch(url); if (!response.ok) throw new Error('AUTH_FIXTURE_FAILED'); } }; }, authorize);
};

test('native OAuth UI signs in during a run, uses private worker tokens, refreshes after 401, restores encrypted credentials and revokes', async () => {
  test.setTimeout(150000); await open();
  fixture.setMode('hold'); await fixture.invoke({ op: 'thread.send', id: 't', text: '保持运行', attachments: [] }); await expect.poll(() => fixture.calls.length).toBe(1);
  await fixture.page.keyboard.press('Control+,'); await fixture.page.getByRole('button', { name: 'MCP', exact: true }).click();
  await fixture.page.getByRole('button', { name: '添加', exact: true }).click(); await fixture.page.getByLabel('名称', { exact: true }).fill(service.config.name);
  await fixture.page.getByLabel(/^传输/).selectOption('http'); await fixture.page.getByLabel(/^URL/).fill(service.config.url);
  await fixture.page.getByLabel('使用 OAuth 登录', { exact: true }).check(); await fixture.page.getByLabel(/^启用/).check();
  await fixture.page.getByRole('button', { name: '保存并登录' }).click(); await job('login');
  expect(service.counts.exchange).toBe(1); expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')?.status).toBe('running');
  const config = (await fixture.snapshot()).data.settings.mcpServers[0];
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: config.id })).toMatchObject({ state: 'connected' });
  fixture.release(); await idle(); service.invalidateAccess();
  await fixture.invoke({ op: 'thread.send', id: 't', text: '加载授权工具', attachments: [] }); await idle();
  const tool = fixture.calls.at(-1)?.tools?.find(item => item.function.name.endsWith('_oauth_echo'))?.function.name; expect(tool).toBeTruthy();
  fixture.requestTool(tool!, {}); await fixture.invoke({ op: 'thread.send', id: 't', text: '执行真实 OAuth 工具', attachments: [] }); await idle();
  expect(service.counts.tool).toBe(1); expect(service.counts.refresh).toBe(1);
  const tokens = service.seen.filter(Boolean).map(header => header.replace(/^Bearer /, ''));
  const renderer = JSON.stringify(await fixture.snapshot()); const disk = await readFile(join(fixture.storage, 'desktop.json'), 'utf8'); const encrypted = await readFile(join(fixture.storage, 'secrets.json'), 'utf8');
  for (const token of tokens) { expect(renderer).not.toContain(token); expect(disk).not.toContain(token); expect(encrypted).not.toContain(token); expect(JSON.stringify(fixture.calls)).not.toContain(token); }
  await fixture.restart(); expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: config.id })).toMatchObject({ state: 'connected' });
  await fixture.page.getByRole('button', { name: 'MCP', exact: true }).click();
  await fixture.page.getByRole('button', { name: '刷新授权', exact: true }).click(); await job('refresh'); expect(service.counts.refresh).toBe(2);
  await fixture.page.getByRole('button', { name: '撤销授权', exact: true }).click(); await job('revoke'); expect(service.counts.revoke).toBe(2);
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: config.id })).toMatchObject({ state: 'disconnected' });
  expect(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')).not.toContain('mcp-oauth:');
});

test('native OAuth cancellation and application restart close loopback listeners and retain a recoverable operation', async () => {
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [service.config] } }); await open(false);
  await fixture.page.keyboard.press('Control+,'); await fixture.page.getByRole('button', { name: 'MCP', exact: true }).click();
  await fixture.page.getByRole('button', { name: '保存并登录', exact: true }).click();
  await expect(fixture.page.getByRole('button', { name: '取消授权' })).toBeVisible(); await fixture.page.getByRole('button', { name: '取消授权' }).click(); await job('login', 'cancelled');
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: service.config.id })).toMatchObject({ state: 'disconnected' });
  await fixture.page.getByRole('button', { name: '保存并登录', exact: true }).click(); await expect(fixture.page.getByRole('button', { name: '取消授权' })).toBeVisible();
  await fixture.restart(); await job('login', 'cancelled'); await open();
  await fixture.page.getByRole('button', { name: 'MCP', exact: true }).click(); await fixture.page.getByRole('button', { name: '保存并登录', exact: true }).click(); await job('login');
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: service.config.id })).toMatchObject({ state: 'connected' });
});

test('removing an MCP configuration clears its local OAuth credentials without affecting another service', async () => {
  await open();
  const other = { ...service.config, id: 'other-service', name: '保留的服务' };
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [service.config, other] } });
  for (const config of [service.config, other]) {
    await fixture.invoke({ op: 'mcp.oauthStart', id: config.id, requestId: crypto.randomUUID(), action: 'login' });
    await job('login');
  }
  const before = JSON.parse(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')) as Record<string, string>;
  expect(Object.keys(before).filter(key => key.startsWith('mcp-oauth:'))).toHaveLength(2);
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [other] } });
  const remaining = JSON.parse(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')) as Record<string, string>;
  expect(Object.keys(remaining).filter(key => key.startsWith('mcp-oauth:'))).toHaveLength(1);
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: other.id })).toMatchObject({ state: 'connected' });
  await fixture.restart();
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: other.id })).toMatchObject({ state: 'connected' });
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [other, service.config] } });
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: service.config.id })).toMatchObject({ state: 'disconnected' });
});

test('changing an authorizing MCP endpoint cancels the old callback and permits a new login', async () => {
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [service.config] } });
  await fixture.app.evaluate(({ shell }) => {
    shell.openExternal = async url => { (globalThis as typeof globalThis & { oauthUrl: string }).oauthUrl = url; };
  });
  await fixture.invoke({ op: 'mcp.oauthStart', id: service.config.id, requestId: crypto.randomUUID(), action: 'login' });
  const opened = () => fixture.app.evaluate(() => (globalThis as typeof globalThis & { oauthUrl?: string }).oauthUrl);
  await expect.poll(opened).toBeTruthy();
  const authorization = new URL((await opened())!);
  const callback = authorization.searchParams.get('redirect_uri')!;
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [{ ...service.config, url: service.config.url + '?new=1' }] } });
  await job('login', 'cancelled');
  await expect(fetch(callback)).rejects.toThrow();
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: service.config.id })).toMatchObject({ state: 'disconnected' });
  await open();
  await fixture.invoke({ op: 'mcp.oauthStart', id: service.config.id, requestId: crypto.randomUUID(), action: 'login' });
  await job('login');
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: service.config.id })).toMatchObject({ state: 'connected' });
});

test('stale OAuth forms cannot log in, refresh or revoke a reconfigured service', async () => {
  await open();
  const changed = { ...service.config, url: service.config.url + '?new=1' };
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [changed] } });
  const before = (await fixture.snapshot()).data.operations.length;
  for (const action of ['login', 'refresh', 'revoke'] as const)
    await expect(fixture.invoke({ op: 'mcp.oauthStart', id: changed.id, requestId: crypto.randomUUID(), action, base: service.config })).rejects.toThrow(/配置已变化/);
  expect((await fixture.snapshot()).data.operations).toHaveLength(before);
  expect(service.counts.registration).toBe(0); expect(service.counts.refresh).toBe(0); expect(service.counts.revoke).toBe(0);
  await fixture.invoke({ op: 'mcp.oauthStart', id: changed.id, requestId: crypto.randomUUID(), action: 'login', base: changed });
  await job('login');
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: changed.id })).toMatchObject({ state: 'connected' });
});

test('OAuth identity changes remove old tokens only after a durable save and preserve display-only edits', async () => {
  await open();
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [service.config] } });
  await fixture.invoke({ op: 'mcp.oauthStart', id: service.config.id, requestId: crypto.randomUUID(), action: 'login' });
  await job('login');
  const renamed = { ...service.config, name: '重命名的服务', enabled: false };
  const changed = { ...renamed, oauth: { clientId: 'another-client', scope: '' } };
  const path = join(fixture.storage, 'secrets.json');
  const before = await readFile(path, 'utf8');
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [renamed] } });
  expect(await readFile(path, 'utf8')).toBe(before);
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: renamed.id })).toMatchObject({ state: 'connected' });
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [changed] } })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    expect((await fixture.snapshot()).data.settings.mcpServers).toEqual([renamed]);
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: renamed.id })).toMatchObject({ state: 'connected' });
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.restart();
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: renamed.id })).toMatchObject({ state: 'connected' });
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [changed] } });
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({});
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: changed.id })).toMatchObject({ state: 'disconnected' });
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [renamed] } });
  expect(await fixture.invoke({ op: 'mcp.oauthStatus', id: renamed.id })).toMatchObject({ state: 'disconnected' });
  expect(service.counts.revoke).toBe(0);
});
