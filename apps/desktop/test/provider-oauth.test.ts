import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import type { OAuthAuth, OAuthCredential, Provider } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { modelCatalog } from '../src/main/model-catalog.ts';
import { checkedProviderAuthUrl, ProviderAuth, providerOAuthKey } from '../src/main/provider-auth.ts';
import { SecretVault, type Encryption } from '../src/main/store.ts';
import { builtinProvider, customProvider, validateProvider } from '../src/shared/model-configuration.ts';
import { modelProviderSchema, modelCatalogSchema } from '../src/shared/contracts.ts';
import type { ProviderAuthStatus } from '../src/shared/provider-auth.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

const catalog = modelCatalog();
const encryption: Encryption = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value).reverse(),
  decryptString: value => Buffer.from(value).reverse().toString(),
};

test('the SDK catalog advertises only provider auth capabilities and selects a supported default', () => {
  assert.deepEqual(modelCatalogSchema.parse(catalog), catalog);
  const expected = [
    ['anthropic', true, 'Anthropic (Claude Pro/Max)', true, undefined],
    ['github-copilot', true, 'GitHub Copilot', true, undefined],
    ['kimi-coding', true, 'Kimi Code (subscription)', true, 'Sign in with Kimi Code'],
    ['meta', true, 'Meta (Muse subscription)', true, 'Sign in with Meta'],
    ['openai-codex', false, 'OpenAI (ChatGPT Plus/Pro)', true, undefined],
    ['openrouter', true, 'OpenRouter OAuth', undefined, 'Sign in with OpenRouter'],
    ['radius', true, 'Radius', undefined, undefined],
    ['xai', true, 'xAI (Grok/X subscription)', true, 'Sign in with SuperGrok or X Premium'],
  ] as const;
  assert.equal(catalog.filter(provider => expected.some(([id]) => id === provider.id)).length, expected.length);
  for (const [id, apiKey, name, isSubscription, loginLabel] of expected) {
    const provider = catalog.find(item => item.id === id);
    assert.ok(provider, id + ' is present in the SDK model catalog');
    assert.equal(provider.auth?.apiKey, apiKey, id);
    assert.equal(provider.auth?.oauth?.name, name, id);
    assert.equal(provider.auth?.oauth?.isSubscription, isSubscription, id);
    assert.equal(provider.auth?.oauth?.loginLabel, loginLabel, id);
    assert.deepEqual(Object.keys(provider).sort(), ['auth', 'id', 'models']);
    assert.deepEqual(Object.keys(provider.auth?.oauth ?? {}).sort(), ['isSubscription', 'loginLabel', 'name']);
  }

  const codex = catalog.find(provider => provider.id === 'openai-codex')!;
  const openrouter = catalog.find(provider => provider.id === 'openrouter')!;
  assert.equal(modelProviderSchema.parse({ id: 'legacy', name: 'Legacy', namespace: 'openrouter' }).authMethod, 'api_key');
  assert.equal(customProvider('custom', 'Local').authMethod, 'api_key');
  assert.equal(builtinProvider('openrouter-test', openrouter.id, catalog).authMethod, 'api_key');
  assert.equal(builtinProvider('codex-test', codex.id, catalog).authMethod, 'oauth');
  assert.doesNotThrow(() => validateProvider(builtinProvider('codex-test', codex.id, catalog), catalog));
  assert.throws(() => validateProvider({ ...builtinProvider('codex-test', codex.id, catalog), baseUrl: 'https://gateway.example' }, catalog), /OAuth.*Base URL/);
  assert.throws(() => validateProvider({ ...customProvider('custom', 'Local'), authMethod: 'oauth', baseUrl: 'http://127.0.0.1:9876/v1' }, catalog), /不支持 OAuth/);
  assert.equal(openrouter.auth?.oauth?.isSubscription, undefined);
});

async function fakeAuthServer() {
  const seen: string[] = [];
  let pageLoads = 0;
  const server = createServer((request, response) => {
    if (request.url === '/authorize') { pageLoads++; response.writeHead(200).end('LOCAL_OAUTH_PAGE'); return; }
    if (request.url === '/model') { seen.push(String(request.headers.authorization ?? '')); response.writeHead(200).end('LOCAL_MODEL_OK'); return; }
    response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = 'http://127.0.0.1:' + address.port;
  return {
    baseUrl,
    seen,
    get pageLoads() { return pageLoads; },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

function fixtureProvider(url: string, state: { refreshes: number; failRefresh: boolean }, delayedLogin?: Promise<OAuthCredential>): Provider {
  const original = builtinProviders().find(provider => provider.id === 'openrouter');
  assert.ok(original);
  const oauth: OAuthAuth = {
    name: 'Local OAuth fixture',
    async login(interaction) {
      interaction.notify({ type: 'device_code', userCode: 'FIXTURE-CODE', verificationUri: url + '/authorize', expiresInSeconds: 60 });
      if (delayedLogin) return delayedLogin;
      assert.equal(await interaction.prompt({ type: 'secret', message: 'Fixture confirmation', placeholder: 'continue' }), 'continue');
      return { type: 'oauth', access: 'fixture-access-1', refresh: 'fixture-refresh-1', expires: Date.now() + 60 * 60 * 1000 };
    },
    async refresh(credential) {
      state.refreshes++;
      if (state.failRefresh) throw new Error('FIXTURE_REFRESH_SECRET');
      return { ...credential, access: 'fixture-access-2', refresh: 'fixture-refresh-2', expires: Date.now() + 60 * 60 * 1000 };
    },
    async toAuth(credential) { return { headers: { Authorization: 'Bearer ' + credential.access } }; },
  };
  return { ...original, auth: { ...original.auth, oauth } };
}

const config = () => modelProviderSchema.parse({
  id: 'oauth-fixture', name: 'Local OAuth fixture', kind: 'builtin', namespace: 'openrouter', authMethod: 'oauth',
});

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  throw new Error('OAuth fixture did not reach the expected state');
}

test('local provider OAuth logs in, restores encrypted credentials, resolves runtime auth, refreshes once and logs out', { timeout: 20000 }, async () => {
  const dir = await mkdtemp('pi-provider-oauth-');
  const server = await fakeAuthServer();
  const vault = new SecretVault(dir, encryption);
  const fixture = { refreshes: 0, failRefresh: false };
  const provider = fixtureProvider(server.baseUrl, fixture);
  const statuses: ProviderAuthStatus[] = [];
  const oauth = new ProviderAuth(vault, async url => { const response = await fetch(url); assert.equal(response.status, 200); }, () => true,
    (_owner, status) => statuses.push(structuredClone(status)), () => [provider]);
  const providerConfig = config();
  try {
    const started = await oauth.start(providerConfig, 1);
    assert.equal(started.phase, 'logging_in');
    const waiting = await until(() => oauth.status(providerConfig, 1), status => !!status.prompt);
    assert.equal(waiting.userCode, 'FIXTURE-CODE');
    assert.equal(waiting.prompt?.type, 'secret');
    const otherOwner = await oauth.status(providerConfig, 2);
    assert.equal(otherOwner.prompt, undefined);
    assert.throws(() => oauth.answer(providerConfig, 2, waiting.operationId!, waiting.prompt!.id, 'continue'), /其他窗口/);
    oauth.answer(providerConfig, 1, waiting.operationId!, waiting.prompt!.id, 'continue');
    const connected = await until(() => oauth.status(providerConfig, 1), status => status.phase !== 'logging_in');
    assert.deepEqual({ connected: connected.connected, phase: connected.phase }, { connected: true, phase: 'idle' });
    await until(async () => server.pageLoads, count => count === 1);
    assert.doesNotMatch(JSON.stringify(statuses), /fixture-access|fixture-refresh/);

    const key = providerOAuthKey(providerConfig);
    const rawBeforeRestart = await readFile(join(dir, 'secrets.json'), 'utf8');
    assert.doesNotMatch(rawBeforeRestart, /fixture-access|fixture-refresh/);
    const stored = JSON.parse((await vault.get(key))!);
    assert.equal(stored.access, 'fixture-access-1');
    assert.equal(stored.refresh, 'fixture-refresh-1');

    const restored = new ProviderAuth(vault, async () => { throw new Error('A restored session must not open login'); }, () => true, () => {}, () => [provider]);
    try {
      assert.equal((await restored.status(providerConfig, 2)).connected, true);
      const first = await restored.resolve(providerConfig);
      assert.equal(first.auth.headers?.Authorization, 'Bearer fixture-access-1');
      assert.equal(first.credential.access, 'fixture-access-1');
      assert.equal(first.credential.refresh, '');
      const firstResponse = await fetch(server.baseUrl + '/model', { headers: first.auth.headers });
      assert.equal(await firstResponse.text(), 'LOCAL_MODEL_OK');
      assert.deepEqual(server.seen, ['Bearer fixture-access-1']);

      await vault.set(key, JSON.stringify({ ...stored, expires: Date.now() - 1 }));
      fixture.failRefresh = true;
      await assert.rejects(restored.resolve(providerConfig), /OAuth 认证或刷新失败/);
      assert.equal(fixture.refreshes, 1);
      fixture.failRefresh = false;
      const refreshed = await Promise.all(Array.from({ length: 8 }, () => restored.resolve(providerConfig)));
      assert.equal(fixture.refreshes, 2);
      assert.ok(refreshed.every(snapshot => snapshot.auth.headers?.Authorization === 'Bearer fixture-access-2'));
      assert.ok(refreshed.every(snapshot => snapshot.credential.refresh === ''));
      const response = await fetch(server.baseUrl + '/model', { headers: refreshed[0].auth.headers });
      assert.equal(await response.text(), 'LOCAL_MODEL_OK');
      assert.deepEqual(server.seen, ['Bearer fixture-access-1', 'Bearer fixture-access-2']);
      assert.doesNotMatch(await readFile(join(dir, 'secrets.json'), 'utf8'), /fixture-access|fixture-refresh/);

      await restored.logout(providerConfig, 2);
      assert.deepEqual(await restored.status(providerConfig, 2), { id: providerConfig.id, connected: false, phase: 'idle' });
      await assert.rejects(restored.resolve(providerConfig), /OAuth 认证或刷新失败/);
      assert.equal(await vault.get(key), undefined);
    } finally { await restored.dispose(); }
  } finally { await oauth.dispose(); await server.close(); }
});

test('cancelled and reconfigured provider logins cannot publish a late credential', { timeout: 20000 }, async () => {
  const dir = await mkdtemp('pi-provider-oauth-cancel-');
  const server = await fakeAuthServer();
  const vault = new SecretVault(dir, encryption);
  const provider = fixtureProvider(server.baseUrl, { refreshes: 0, failRefresh: false });
  let current = true;
  const oauth = new ProviderAuth(vault, async url => { await fetch(url); }, () => current, () => {}, () => [provider]);
  const providerConfig = config();
  try {
    const started = await oauth.start(providerConfig, 7);
    const waiting = await until(() => oauth.status(providerConfig, 7), status => !!status.prompt);
    await oauth.changeConfigurations([providerConfig], async () => { current = false; });
    await until(async () => oauth.pending(providerConfig.id), pending => !pending);
    assert.equal(oauth.pending(providerConfig.id), false);
    assert.equal(await vault.get(providerOAuthKey(providerConfig)), undefined);
    await assert.rejects(Promise.resolve().then(() => oauth.answer(providerConfig, 7, started.operationId!, waiting.prompt!.id, 'continue')));
  } finally { await oauth.dispose(); await server.close(); }
});

test('an owner can cancel an OAuth prompt without leaving a credential', { timeout: 20000 }, async () => {
  const dir = await mkdtemp('pi-provider-oauth-cancel-');
  const server = await fakeAuthServer();
  const vault = new SecretVault(dir, encryption);
  const provider = fixtureProvider(server.baseUrl, { refreshes: 0, failRefresh: false });
  const oauth = new ProviderAuth(vault, async () => {}, () => true, () => {}, () => [provider]);
  const providerConfig = config();
  try {
    const started = await oauth.start(providerConfig, 9);
    const waiting = await until(() => oauth.status(providerConfig, 9), status => !!status.prompt);
    oauth.cancel(providerConfig, 9, started.operationId!);
    await until(async () => oauth.pending(providerConfig.id), pending => !pending);
    assert.equal(await vault.get(providerOAuthKey(providerConfig)), undefined);
    assert.equal((await oauth.status(providerConfig, 9)).phase, 'error');
    assert.equal(waiting.prompt?.type, 'secret');
  } finally { await oauth.dispose(); await server.close(); }
});

test('closing the owner cancels login immediately and a provider that ignores abort cannot write late', { timeout: 20000 }, async () => {
  const dir = await mkdtemp('pi-provider-oauth-late-');
  const server = await fakeAuthServer();
  const vault = new SecretVault(dir, encryption);
  let finishLateLogin!: (credential: OAuthCredential) => void;
  const delayedLogin = new Promise<OAuthCredential>(resolve => { finishLateLogin = resolve; });
  const provider = fixtureProvider(server.baseUrl, { refreshes: 0, failRefresh: false }, delayedLogin);
  const statuses: ProviderAuthStatus[] = [];
  const oauth = new ProviderAuth(vault, async () => {}, () => true, (_owner, status) => statuses.push(structuredClone(status)), () => [provider]);
  const providerConfig = config();
  try {
    const started = await oauth.start(providerConfig, 10);
    await until(() => oauth.status(providerConfig, 10), status => !!status.link);
    await assert.rejects(oauth.start(providerConfig, 10), /正在登录/);
    oauth.closeOwner(10);
    await until(async () => oauth.pending(providerConfig.id), pending => !pending);
    assert.equal(await vault.get(providerOAuthKey(providerConfig)), undefined);
    finishLateLogin({ type: 'oauth', access: 'late-access-token', refresh: 'late-refresh-token', expires: Date.now() + 60_000 });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(await vault.get(providerOAuthKey(providerConfig)), undefined);
    assert.equal(statuses.some(status => status.connected), false);
    assert.ok(started.operationId);
  } finally { finishLateLogin({ type: 'oauth', access: 'late-access-token', refresh: 'late-refresh-token', expires: Date.now() + 60_000 }); await oauth.dispose(); await server.close(); }
});

test('provider auth schemas and catalog selection reject unsupported OAuth and endpoint overrides', () => {
  assert.equal(modelProviderSchema.parse({ id: 'old', name: 'Old', namespace: 'openrouter' }).authMethod, 'api_key');
  assert.equal(builtinProvider('codex', 'openai-codex', catalog).authMethod, 'oauth');
  assert.throws(() => modelProviderSchema.parse({ ...customProvider('custom', 'Local'), authMethod: 'password' }));
  assert.throws(() => validateProvider({ ...builtinProvider('plain', 'openai', catalog), authMethod: 'oauth' }, catalog), /不支持 OAuth/);
});

test('two configurations of one brand keep independent accounts and mode switches preserve both credential types', async () => {
  const values = new Map<string, string>();
  const vault = {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: string) => { if (value) values.set(key, value); else values.delete(key); },
  };
  const first = config(), second = { ...config(), id: 'oauth-fixture-second' };
  const firstCredential: OAuthCredential = { type: 'oauth', access: 'first-account-access', refresh: 'first-account-refresh', expires: Date.now() + 3600000 };
  const secondCredential: OAuthCredential = { ...firstCredential, access: 'second-account-access', refresh: 'second-account-refresh' };
  await vault.set(providerOAuthKey(first), JSON.stringify(firstCredential));
  await vault.set(providerOAuthKey(second), JSON.stringify(secondCredential));
  await vault.set('provider:' + first.id, 'first-api-key');
  let active = first;
  const native = fixtureProvider('http://127.0.0.1', { refreshes: 0, failRefresh: false });
  const oauth = new ProviderAuth(vault, async () => {}, candidate => candidate.id === second.id || candidate.authMethod === active.authMethod,
    () => {}, () => [native]);
  try {
    const snapshots = await Promise.all([oauth.resolve(first), oauth.resolve(second)]);
    assert.deepEqual(snapshots.map(snapshot => snapshot.auth.headers?.Authorization), ['Bearer first-account-access', 'Bearer second-account-access']);
    assert.notEqual(providerOAuthKey(first), providerOAuthKey(second));
    await oauth.changeConfigurations([first], async () => { active = { ...first, authMethod: 'api_key' }; });
    assert.equal(providerOAuthKey(active), providerOAuthKey(first));
    assert.equal(await vault.get('provider:' + first.id), 'first-api-key');
    assert.equal(await vault.get(providerOAuthKey(first)), JSON.stringify(firstCredential));
    await assert.rejects(oauth.resolve(first), /OAuth 认证或刷新失败/);
    await oauth.changeConfigurations([active], async () => { active = first; });
    assert.equal((await oauth.resolve(first)).credential.access, firstCredential.access);
    await oauth.logout(first, 1);
    assert.equal(await vault.get(providerOAuthKey(first)), undefined);
    assert.equal(await vault.get('provider:' + first.id), 'first-api-key');
    assert.equal((await oauth.resolve(second)).credential.access, secondCredential.access);
  } finally { await oauth.dispose(); }
});

test('failed login, refresh persistence and logout retain the durable credential and redact errors', async () => {
  const providerConfig = config(), key = providerOAuthKey(providerConfig);
  const values = new Map<string, string>();
  let writesFail = false;
  const vault = {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: string) => {
      if (writesFail) throw new Error('PRIVATE_STORAGE_SECRET ' + value);
      if (value) values.set(key, value); else values.delete(key);
    },
  };
  const original: OAuthCredential = { type: 'oauth', access: 'original-account-access', refresh: 'original-account-refresh', expires: Date.now() + 3600000 };
  const serialized = JSON.stringify(original);
  await vault.set(key, serialized);
  const fixture = { refreshes: 0, failRefresh: false };
  const native = fixtureProvider('http://127.0.0.1', fixture);
  assert.ok(native.auth.oauth);
  const completed: ProviderAuthStatus[] = [];
  let loginFails = false;
  const provider: Provider = { ...native, auth: { ...native.auth, oauth: { ...native.auth.oauth,
    login: async () => {
      if (loginFails) throw new Error('PRIVATE_LOGIN_SECRET original-account-refresh');
      return { ...original, access: 'replacement-access', refresh: 'replacement-refresh' };
    },
  } } };
  const oauth = new ProviderAuth(vault, async () => {}, () => true, (_owner, status) => completed.push(structuredClone(status)), () => [provider]);
  try {
    loginFails = true;
    await oauth.start(providerConfig, 1);
    const loginError = await until(() => oauth.status(providerConfig, 1), status => status.phase === 'error');
    assert.equal(loginError.connected, true);
    assert.equal(await vault.get(key), serialized);
    loginFails = false; writesFail = true;
    await oauth.start(providerConfig, 1);
    await until(async () => oauth.pending(providerConfig.id), pending => !pending);
    assert.equal(await vault.get(key), serialized);
    assert.equal((await oauth.status(providerConfig, 1)).connected, true);
    await assert.rejects(oauth.logout(providerConfig, 1), error => error instanceof Error && /退出 OAuth 失败/.test(error.message) && !error.message.includes('PRIVATE_STORAGE_SECRET'));
    assert.equal(await vault.get(key), serialized);
    writesFail = false;
    const expired = JSON.stringify({ ...original, expires: 0 });
    await vault.set(key, expired);
    writesFail = true;
    await assert.rejects(oauth.resolve(providerConfig), error => error instanceof Error && /OAuth 认证或刷新失败/.test(error.message) && !error.message.includes('PRIVATE_STORAGE_SECRET'));
    assert.equal(await vault.get(key), expired);
    assert.equal(fixture.refreshes, 1);
    assert.doesNotMatch(JSON.stringify(completed), /PRIVATE_|original-account|replacement-/);
    writesFail = false;
    assert.equal((await oauth.resolve(providerConfig)).credential.access, 'fixture-access-2');
    await oauth.logout(providerConfig, 1);
    assert.equal(await vault.get(key), undefined);
  } finally { writesFail = false; await oauth.dispose(); }
});

test('authorization URLs reject external insecure schemes and userinfo before opening a browser', async () => {
  for (const url of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'data:text/html,unsafe', 'http://example.com/auth', 'https://user:password@example.com/auth'])
    assert.throws(() => checkedProviderAuthUrl(url));
  for (const url of ['https://example.com/auth', 'http://127.0.0.1/auth', 'http://localhost/auth', 'http://[::1]/auth'])
    assert.equal(checkedProviderAuthUrl(url), url);
  const vault = { get: async () => undefined, set: async () => { throw new Error('Unsafe login must never write'); } };
  const native = fixtureProvider('http://127.0.0.1', { refreshes: 0, failRefresh: false });
  assert.ok(native.auth.oauth);
  const provider: Provider = { ...native, auth: { ...native.auth, oauth: { ...native.auth.oauth,
    login: async interaction => {
      interaction.notify({ type: 'auth_url', url: 'file:///C:/Windows/System32/calc.exe' });
      throw new Error('Unsafe login must stop before this point');
    },
  } } };
  let opened = false;
  const oauth = new ProviderAuth(vault, async () => { opened = true; }, () => true, () => {}, () => [provider]);
  try {
    await oauth.start(config(), 1);
    await until(async () => oauth.pending(config().id), pending => !pending);
    assert.equal(opened, false);
    assert.equal((await oauth.status(config(), 1)).connected, false);
  } finally { await oauth.dispose(); }
});

test('an SDK prompt timeout releases its form and expired answers cannot finish login', async () => {
  const native = fixtureProvider('http://127.0.0.1', { refreshes: 0, failRefresh: false });
  assert.ok(native.auth.oauth);
  const provider: Provider = { ...native, auth: { ...native.auth, oauth: { ...native.auth.oauth,
    login: async interaction => {
      await interaction.prompt({ type: 'manual_code', message: 'Temporary callback form', signal: AbortSignal.timeout(20) });
      throw new Error('Expired form must not finish login');
    },
  } } };
  const vault = { get: async () => undefined, set: async () => { throw new Error('Expired form must not write'); } };
  const oauth = new ProviderAuth(vault, async () => {}, () => true, () => {}, () => [provider]);
  try {
    await oauth.start(config(), 1);
    const waiting = await until(() => oauth.status(config(), 1), status => !!status.prompt);
    await until(async () => oauth.pending(config().id), pending => !pending);
    assert.equal((await oauth.status(config(), 1)).phase, 'error');
    assert.throws(() => oauth.answer(config(), 1, waiting.operationId!, waiting.prompt!.id, 'late-code'), /过期/);
  } finally { await oauth.dispose(); }
});
