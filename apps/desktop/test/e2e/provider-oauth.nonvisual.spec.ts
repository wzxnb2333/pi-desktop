import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { DesktopRequest, ModelProvider, ProviderModel, Thread } from '../../src/shared/contracts.ts';
import type { ProviderAuthStatus } from '../../src/shared/provider-auth.ts';
import { modelProviderSchema, providerModelSchema } from '../../src/shared/contracts.ts';
import { providerOAuthKey } from '../../src/main/provider-auth.ts';
import { modelCatalog } from '../../src/main/model-catalog.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

const apiKey = 'LOCAL_OAUTH_API_KEY';
const initialAccessToken = 'LOCAL_OAUTH_ACCESS_1';
const initialRefreshToken = 'LOCAL_OAUTH_REFRESH_1';
const accessToken = 'LOCAL_OAUTH_ACCESS_2';
const refreshToken = 'LOCAL_OAUTH_REFRESH_2';
const providerId = 'oauth-fixture';
const modelId = 'oauth-model';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;

test.beforeAll(async () => { development = await startDevelopmentSource({ providerOAuthMain: true }); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => {
  if (!development.mainFile) throw new Error('OAuth fixture main entry was not built');
  fixture = await acceptanceApp(development.url, { mainFile: development.mainFile, providerOAuthFixture: true });
});
test.afterEach(async () => {
  if (!fixture) return;
  const errors = [...fixture.errors];
  const sentinel = fixture.cliAuthFile ? await readFile(fixture.cliAuthFile, 'utf8') : '';
  expect(sentinel).toBe('{"fixture":"leave unchanged"}\n');
  const storage = fixture.storage;
  await fixture.close();
  await expect(access(storage)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(errors).toEqual([]);
});

function configuredProvider(authMethod: ModelProvider['authMethod'] = 'api_key', id = providerId): ModelProvider {
  return modelProviderSchema.parse({ id, name: 'OpenRouter OAuth fixture', kind: 'builtin', namespace: 'openrouter', baseUrl: '',
    api: 'openai-completions', hasKey: false, authMethod });
}

function configuredModel(provider: string = providerId): ProviderModel {
  const catalog = modelCatalog().find(entry => entry.id === 'openrouter');
  const model = catalog?.models.find(entry => entry.api === 'openai-completions' && entry.contextWindow >= 100000);
  if (!model) throw new Error('The SDK OpenRouter catalog has no large-context text model');
  return providerModelSchema.parse({ id: modelId, provider, name: 'Local OAuth fixture model', model: model.id,
    reasoning: model.reasoning, thinkingLevels: model.thinkingLevels, contextWindow: model.contextWindow, maxTokens: model.maxTokens });
}

async function configureProvider(): Promise<{ provider: ModelProvider; model: ProviderModel }> {
  const provider = configuredProvider();
  const model = configuredModel();
  const current = (await fixture.snapshot()).data.settings;
  await fixture.invoke({ op: 'settings.patch', patch: { modelProviders: [...current.modelProviders, provider], models: [...current.models, model], modelId: model.id } });
  await fixture.invoke({ op: 'provider.key', id: provider.id, key: apiKey });
  const oauthProvider = { ...provider, authMethod: 'oauth' as const, hasKey: true };
  const next = (await fixture.snapshot()).data.settings;
  await fixture.invoke({ op: 'settings.patch', patch: { modelProviders: next.modelProviders.map(item => item.id === provider.id ? oauthProvider : item) } });
  await fixture.invoke({ op: 'thread.update', id: 't', modelId: model.id });
  return { provider: oauthProvider, model };
}

async function invoke(page: Page, request: DesktopRequest): Promise<unknown> {
  return page.evaluate(request => window.desktop.invoke(request), request);
}

async function status(page: Page, id = providerId): Promise<ProviderAuthStatus> {
  return await invoke(page, { op: 'provider.oauthStatus', id }) as ProviderAuthStatus;
}

async function watchAuthEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as Window & { __providerOAuthEvents?: ProviderAuthStatus[] };
    target.__providerOAuthEvents = [];
    window.desktop.onEvent(event => { if (event.type === 'provider.auth') target.__providerOAuthEvents?.push(event.status); });
  });
}

async function authEvents(page: Page): Promise<ProviderAuthStatus[]> {
  return await page.evaluate(() => (window as Window & { __providerOAuthEvents?: ProviderAuthStatus[] }).__providerOAuthEvents ?? []);
}

async function login(page: Page, id = providerId): Promise<void> {
  await invoke(page, { op: 'provider.oauthStart', id });
  await expect.poll(async () => status(page, id)).toMatchObject({ connected: false, phase: 'logging_in', prompt: { type: 'secret' } });
  const pending = await status(page, id);
  if (!pending.operationId || !pending.prompt) throw new Error('Local OAuth prompt was not published');
  await invoke(page, { op: 'provider.oauthAnswer', id, operationId: pending.operationId, promptId: pending.prompt.id, value: 'LOCAL_FIXTURE_APPROVED' });
  await expect.poll(async () => status(page, id)).toMatchObject({ connected: true, phase: 'idle' });
}

async function readVault(): Promise<Record<string, string>> {
  return JSON.parse(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')) as Record<string, string>;
}

interface OAuthFixtureState { refreshes: number; openedUrls: string[]; authTokens: string[] }

async function oauthFixtureState(): Promise<OAuthFixtureState> {
  return await fixture.app.evaluate(() => (globalThis as typeof globalThis & { providerOAuthFixtureState: OAuthFixtureState }).providerOAuthFixtureState);
}

async function assertNoCredential(key: string): Promise<void> {
  expect(await readVault()).not.toHaveProperty(key);
}

async function assertBusyGuards(provider: ModelProvider): Promise<void> {
  await expect(fixture.invoke({ op: 'provider.oauthStart', id: provider.id })).rejects.toThrow(/推理/);
  await expect(fixture.invoke({ op: 'provider.oauthLogout', id: provider.id })).rejects.toThrow(/推理/);
  const settings = (await fixture.snapshot()).data.settings;
  await expect(fixture.invoke({ op: 'settings.patch', patch: {
    modelProviders: settings.modelProviders.map(item => item.id === provider.id ? { ...item, authMethod: 'api_key' } : item),
  } })).rejects.toThrow(/推理/);
}

async function waitForRound(): Promise<void> {
  await expect.poll(async () => {
    const thread = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't');
    return thread?.status === 'idle' && !thread.roundSnapshots?.some(snapshot => snapshot.state === 'running');
  }).toBe(true);
}

test('new OpenAI Codex drafts wait for saving before status reads and new OAuth drafts can save and log in', async () => {
  const page = fixture.page;
  await page.getByRole('button', { name: '文件菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '添加提供商', exact: true }).click();
  await page.getByLabel('供应商', { exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'openai-codex', exact: true }).click();
  await page.getByRole('button', { name: '创建提供商', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存并登录', exact: true })).toBeEnabled();
  expect((await fixture.snapshot()).data.settings.modelProviders.some(provider => provider.namespace === 'openai-codex')).toBe(false);
  await expect(page.locator('.provider-auth [role=alert]')).toHaveCount(0);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.locator('.settings-footer')).toContainText('设置已保存');
  const provider = (await fixture.snapshot()).data.settings.modelProviders.find(provider => provider.namespace === 'openai-codex');
  expect(provider).toMatchObject({ authMethod: 'oauth' });
  await expect(page.locator('.provider-auth-status')).toContainText('未连接');
  await expect(page.locator('.provider-auth [role=alert]')).toHaveCount(0);
  expect(await status(page, provider!.id)).toMatchObject({ connected: false, phase: 'idle' });

  // Use the local OAuth fixture to exercise save-and-login without a real account or network.
  await page.getByRole('button', { name: '添加提供商', exact: true }).click();
  await page.getByLabel('供应商', { exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'openrouter', exact: true }).click();
  await page.getByRole('button', { name: '创建提供商', exact: true }).click();
  await page.getByRole('radio', { name: 'Sign in with OpenRouter', exact: true }).check();
  await page.getByRole('button', { name: '保存并登录', exact: true }).click();
  const prompt = page.getByLabel('本地 OAuth 验收确认', { exact: true });
  await expect(prompt).toBeEnabled();
  await prompt.fill('LOCAL_FIXTURE_APPROVED');
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.locator('.provider-auth-status')).toContainText('已连接');
  await expect(page.locator('.provider-auth [role=alert]')).toHaveCount(0);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

test('OAuth owner closure cancels login, restart restores encrypted credentials, and identity changes remove both credentials', async () => {
  const { provider } = await configureProvider();
  await watchAuthEvents(fixture.page);

  const secondaryThread = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  await fixture.invoke({ op: 'window.open', kind: 'task', threadId: secondaryThread.id });
  await expect.poll(() => fixture.app.windows().length).toBe(2);
  const secondary = fixture.app.windows().find(page => page !== fixture.page)!;
  await secondary.locator('.desktop').waitFor();
  await watchAuthEvents(secondary);
  await invoke(secondary, { op: 'provider.oauthStart', id: provider.id });
  await expect.poll(async () => status(secondary)).toMatchObject({ connected: false, phase: 'logging_in', prompt: { type: 'secret' } });
  const nonOwnerStatus = await status(fixture.page);
  expect(nonOwnerStatus).toEqual({ id: provider.id, connected: false, phase: 'logging_in' });
  await expect.poll(async () => authEvents(fixture.page)).toContainEqual(nonOwnerStatus);
  expect(Object.keys(nonOwnerStatus).sort()).toEqual(['connected', 'id', 'phase']);
  expect(nonOwnerStatus.userCode).toBeUndefined();
  await secondary.close();
  await expect.poll(() => fixture.app.windows().length).toBe(1);
  await expect.poll(async () => status(fixture.page)).toMatchObject({ connected: false, phase: 'error' });
  await assertNoCredential(providerOAuthKey(provider));

  await login(fixture.page);
  const connectedEvents = await authEvents(fixture.page);
  expect(JSON.stringify(connectedEvents)).not.toContain(accessToken);
  const openUrl = (await oauthFixtureState()).openedUrls[0];
  expect(openUrl).toBeTruthy();
  expect(new URL(openUrl).hostname).toBe('127.0.0.1');
  const authorizePage = await fetch(openUrl);
  expect(authorizePage.ok).toBe(true);
  expect(await authorizePage.text()).toContain('本地预览');
  const vault = await readVault();
  const oauthKey = providerOAuthKey(provider);
  expect(vault).toHaveProperty('provider:' + provider.id);
  expect(vault).toHaveProperty(oauthKey);
  expect(JSON.stringify(vault)).not.toContain(apiKey);
  expect(JSON.stringify(vault)).not.toContain(initialAccessToken);
  expect(JSON.stringify(vault)).not.toContain(initialRefreshToken);
  expect(JSON.stringify(vault)).not.toContain(accessToken);
  expect(JSON.stringify(vault)).not.toContain(refreshToken);
  expect(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')).not.toContain(accessToken);
  expect(JSON.stringify(await fixture.snapshot())).not.toContain(accessToken);

  await fixture.restart();
  await expect.poll(async () => status(fixture.page)).toMatchObject({ connected: true, phase: 'idle' });
  expect(await readFile(fixture.cliAuthFile!, 'utf8')).toBe('{"fixture":"leave unchanged"}\n');

  const settings = (await fixture.snapshot()).data.settings;
  await fixture.invoke({ op: 'settings.patch', patch: { modelProviders: settings.modelProviders.map(item => item.id === provider.id ? { ...item, authMethod: 'api_key' } : item) } });
  expect(await status(fixture.page)).toMatchObject({ connected: true, phase: 'idle' });
  const apiMode = (await fixture.snapshot()).data.settings.modelProviders.find(item => item.id === provider.id)!;
  expect(apiMode.hasKey).toBe(true);
  await fixture.invoke({ op: 'settings.patch', patch: { modelProviders: (await fixture.snapshot()).data.settings.modelProviders.map(item => item.id === provider.id ? { ...item, authMethod: 'oauth' } : item) } });
  await fixture.invoke({ op: 'provider.oauthLogout', id: provider.id });
  await expect.poll(async () => status(fixture.page)).toMatchObject({ connected: false, phase: 'idle' });
  expect(await readVault()).toHaveProperty('provider:' + provider.id);
  await assertNoCredential(oauthKey);

  await login(fixture.page);
  await fixture.invoke({ op: 'provider.key', id: provider.id, key: 'LOCAL_OAUTH_API_KEY_RENEWED' });
  const renamed = configuredProvider('oauth', 'oauth-fixture-renamed');
  const current = (await fixture.snapshot()).data.settings;
  await fixture.invoke({ op: 'settings.patch', patch: {
    modelProviders: current.modelProviders.map(item => item.id === provider.id ? renamed : item),
    models: current.models.map(item => item.provider === provider.id ? { ...item, provider: renamed.id } : item),
  } });
  await assertNoCredential('provider:' + provider.id);
  await assertNoCredential(oauthKey);

  await fixture.invoke({ op: 'provider.key', id: renamed.id, key: 'LOCAL_OAUTH_API_KEY_NEW_ID' });
  await login(fixture.page, renamed.id);
  const beforeDelete = (await fixture.snapshot()).data.settings;
  await fixture.invoke({ op: 'settings.patch', patch: {
    modelProviders: beforeDelete.modelProviders.filter(item => item.id !== renamed.id),
    models: beforeDelete.models.filter(item => item.provider !== renamed.id),
  } });
  await assertNoCredential('provider:' + renamed.id);
  await assertNoCredential(providerOAuthKey(renamed));
  await expect(fixture.invoke({ op: 'provider.oauthStatus', id: renamed.id })).rejects.toThrow(/不存在/);
});

test('real worker requests, compaction, memory and independent action review use OAuth and block credential changes while active', async () => {
  test.setTimeout(240000);
  const { provider, model } = await configureProvider();
  await login(fixture.page);
  await watchAuthEvents(fixture.page);

  fixture.setMode('hold');
  const firstSend = fixture.invoke({ op: 'thread.send', id: 't', text: '等待中的本地 OAuth 聊天', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await assertBusyGuards(provider);
  fixture.release();
  await firstSend;
  await waitForRound();
  expect(fixture.authorizations[0]).toBe('Bearer ' + accessToken);
  await expect.poll(async () => fixture.app.evaluate(() => (globalThis as typeof globalThis & { providerOAuthFixtureState?: { refreshes: number } }).providerOAuthFixtureState?.refreshes ?? 0)).toBeGreaterThan(0);

  const largeTurn = 'OAuth compaction integration fixture. '.repeat(2300);
  expect(largeTurn.length).toBeLessThan(100000);
  fixture.setReply('短回复');
  await fixture.invoke({ op: 'thread.send', id: 't', text: largeTurn, attachments: [] });
  await waitForRound();
  await fixture.invoke({ op: 'thread.send', id: 't', text: largeTurn, attachments: [] });
  await waitForRound();
  const beforeCompact = fixture.calls.length;
  fixture.setReply('本地压缩摘要');
  fixture.setMode('hold');
  const compact = fixture.invoke({ op: 'thread.compact', id: 't' });
  await expect.poll(() => fixture.calls.length).toBeGreaterThan(beforeCompact);
  await assertBusyGuards(provider);
  fixture.release();
  await compact;
  expect(fixture.authorizations.at(-1)).toBe('Bearer ' + accessToken);

  const user = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.items.findLast(item => item.role === 'user');
  if (!user) throw new Error('The OAuth chat did not persist a user message for memory generation');
  fixture.setReply(JSON.stringify({ memories: [{ text: '仅用于本地 OAuth 验收的记忆', messageIds: [user.id] }] }));
  fixture.setMode('hold');
  const beforeMemory = fixture.calls.length;
  await fixture.invoke({ op: 'memory.generate', threadId: 't', scope: { kind: 'project', projectId: 'p' }, requestId: crypto.randomUUID() });
  await expect.poll(() => fixture.calls.length).toBe(beforeMemory + 1);
  await assertBusyGuards(provider);
  fixture.release();
  await expect.poll(async () => (await fixture.snapshot()).data.operations.filter(item => item.kind === 'memory.generate').at(-1)?.status).toBe('succeeded');
  expect(fixture.authorizations.at(-1)).toBe('Bearer ' + accessToken);

  await writeFile(join(fixture.project, 'README.md'), '# OAuth action review fixture\n');
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'auto' });
  fixture.requestTool('write', { path: 'oauth-review-fixture.txt', content: 'reviewed local fixture' });
  fixture.setReview('hold');
  const reviewSend = fixture.invoke({ op: 'thread.send', id: 't', text: '请将审查文件写入本地 fixture', attachments: [] });
  await expect.poll(() => fixture.reviewAuthorizations.length).toBe(1);
  expect(fixture.reviewAuthorizations[0]).toBe('Bearer ' + accessToken);
  await assertBusyGuards(provider);
  fixture.setMode('reply');
  fixture.releaseReviews();
  await reviewSend;
  await waitForRound();
  fixture.setReview('low');

  const beforeFailure = fixture.calls.length;
  fixture.setMode('fail');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '检查 OAuth 错误脱敏', attachments: [] }).catch(() => {});
  await expect.poll(() => fixture.calls.length).toBe(beforeFailure + 1);
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.error).toContain('ACCEPTANCE_PROVIDER_ERROR');
  const snapshot = await fixture.snapshot();
  const sessionFile = snapshot.data.threads.find(thread => thread.id === 't')?.sessionFile;
  const sessionText = sessionFile ? await readFile(sessionFile, 'utf8').catch(() => '') : '';
  expect(sessionText).toContain('ACCEPTANCE_PROVIDER_ERROR');
  expect(sessionText).toContain('[redacted]');
  const logText = await readFile(join(fixture.storage, 'logs', 'desktop.log'), 'utf8').catch(() => '');
  const exposed = JSON.stringify({ snapshot, events: await authEvents(fixture.page), html: await fixture.page.locator('body').innerText(), errors: fixture.errors, sessionText, logText });
  expect(exposed).not.toContain(accessToken);
  expect(exposed).not.toContain(refreshToken);
  expect(fixture.authorizations.at(-1)).toBe('Bearer ' + accessToken);
  expect(model.contextWindow).toBeGreaterThanOrEqual(100000);
});
