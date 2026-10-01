import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { McpOAuth, oauthCredentialKey } from '../src/main/mcp-oauth.ts';
import { McpConnection } from '../src/worker/mcp.ts';
import { oauthServer } from './fixtures/oauth-server.ts';

function vault() { const values = new Map<string, string>(); return { values, async get(key: string) { return values.get(key); }, async set(key: string, value: string) { if (value) values.set(key, value); else values.delete(key); } }; }
const signal = () => new AbortController().signal;

test('OAuth performs real discovery, DCR and PKCE; private tokens survive restart, deduplicate refresh and revoke remotely', { timeout: 20000 }, async () => {
  const fixture = await oauthServer(); const storage = vault(); const oauth = new McpOAuth(storage, url => fixture.authorize(url));
  try {
    await oauth.login(fixture.config, signal(), () => {});
    assert.equal(fixture.counts.registration, 1); assert.equal(fixture.counts.exchange, 1);
    const initial = await oauth.token(fixture.config); assert.match(initial, /^access-/);
    const restored = new McpOAuth(storage, async () => { throw new Error('Must not open browser for refresh'); });
    assert.equal(await restored.token(fixture.config), initial);
    const tokens = await Promise.all(Array.from({ length: 8 }, () => restored.token(fixture.config, initial)));
    assert.equal(new Set(tokens).size, 1); assert.notEqual(tokens[0], initial); assert.equal(fixture.counts.refresh, 1);
    assert.equal((await restored.status(fixture.config)).state, 'connected'); assert.doesNotMatch(JSON.stringify(await restored.status(fixture.config)), /access-|refresh-/);
    await restored.revoke(fixture.config, signal()); assert.equal(fixture.counts.revoke, 2); assert.equal(storage.values.size, 0);
    assert.deepEqual(await restored.status(fixture.config), { state: 'disconnected' });
    await assert.rejects(restored.token(fixture.config), /请先/);
    await assert.rejects(fetch(fixture.redirect), /fetch failed/);
  } finally { oauth.dispose(); await fixture.close(); }
});

test('HTTP MCP retries a rejected bearer once through the real token adapter and executes an authenticated tool', { timeout: 20000 }, async () => {
  const fixture = await oauthServer(); const oauth = new McpOAuth(vault(), url => fixture.authorize(url)); const connection = new McpConnection();
  try {
    await oauth.login(fixture.config, signal(), () => {}); fixture.invalidateAccess();
    await connection.connect(fixture.config, { 'X-Fixture': 'value' }, process.cwd(), (config, token) => oauth.token(config, token));
    const tools = await connection.tools(fixture.config); assert.equal(tools.length, 1);
    const result = await tools[0].execute('echo', {}, signal(), undefined, {} as ExtensionContext);
    assert.deepEqual(result.content, [{ type: 'text', text: 'OAUTH_REAL_TOOL_OK' }]); assert.equal(fixture.counts.refresh, 1); assert.equal(fixture.counts.tool, 1);
    fixture.failRefresh(true); fixture.invalidateAccess();
    await assert.rejects(connection.tools(fixture.config), /授权已过期/);
    assert.equal((await oauth.status(fixture.config)).state, 'disconnected');
  } finally { await connection.close(); oauth.dispose(); await fixture.close(); }
});

test('cancelled and forged callbacks cannot publish credentials; listener closes and authorization can retry', { timeout: 20000 }, async () => {
  const fixture = await oauthServer(); const storage = vault(); const controller = new AbortController();
  let callback = ''; const oauth = new McpOAuth(storage, async url => {
    const auth = new URL(url); callback = auth.searchParams.get('redirect_uri')!;
    const forged = new URL(callback); forged.searchParams.set('state', 'wrong'); forged.searchParams.set('code', 'wrong');
    assert.equal((await fetch(forged)).status, 400); controller.abort();
  });
  try {
    await assert.rejects(oauth.login(fixture.config, controller.signal, () => {}), /取消或超时/); assert.equal(storage.values.size, 0); await assert.rejects(fetch(callback));
    const retry = new McpOAuth(storage, url => fixture.authorize(url)); await retry.login(fixture.config, signal(), () => {}); assert.equal((await retry.status(fixture.config)).state, 'connected');
    await assert.rejects(retry.token({ ...fixture.config, url: fixture.config.url + '/other' }), /请先/);
    await assert.rejects(retry.login({ ...fixture.config, url: 'http://example.com/mcp' }, signal(), () => {}), /HTTPS/);
    retry.dispose();
  } finally { oauth.dispose(); await fixture.close(); }
});

test('expired tokens refresh silently and authorization errors never expose provider error bodies', { timeout: 20000 }, async () => {
  const fixture = await oauthServer(); fixture.setLifetime(1); const oauth = new McpOAuth(vault(), url => fixture.authorize(url));
  try {
    await oauth.login(fixture.config, signal(), () => {}); await oauth.token(fixture.config); assert.equal(fixture.counts.refresh, 1);
    fixture.failRefresh(true); await assert.rejects(oauth.token(fixture.config), error => error instanceof Error && /授权已过期/.test(error.message) && !error.message.includes('SECRET_MUST_NOT_LEAK'));
  } finally { oauth.dispose(); await fixture.close(); }
});

test('configuration removal drains an in-flight credential write and rejects old queued refreshes', { timeout: 20000 }, async () => {
  const fixture = await oauthServer(); const storage = vault();
  let current = true; let blocked = false; let started!: () => void; let release!: () => void;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  const releasePromise = new Promise<void>(resolve => { release = resolve; });
  const oauth = new McpOAuth({ get: storage.get, async set(key, value) {
    if (blocked) { started(); await releasePromise; }
    await storage.set(key, value);
  } }, url => fixture.authorize(url), async () => current);
  try {
    await oauth.login(fixture.config, signal(), () => {});
    const initial = await oauth.token(fixture.config);
    blocked = true;
    const refresh = oauth.token(fixture.config, initial);
    await startedPromise;
    const queued = assert.rejects(oauth.token(fixture.config, initial));
    let committed = false;
    const removal = oauth.changeConfigurations([fixture.config], async () => { current = false; storage.values.clear(); committed = true; });
    assert.equal(committed, false);
    await assert.rejects(oauth.token(fixture.config), /配置已变化/);
    release(); await Promise.all([refresh, queued, removal]);
    assert.equal(committed, true); assert.equal(storage.values.size, 0);
    const calls = fixture.counts.refresh;
    await assert.rejects(oauth.token(fixture.config), /配置已变化/);
    assert.equal(fixture.counts.refresh, calls);
  } finally { release(); oauth.dispose(); await fixture.close(); }
});

test('a failed configuration commit cancels pending login but preserves prior credentials and permits retry', { timeout: 20000 }, async () => {
  const fixture = await oauthServer(); const storage = vault(); let hold = false; let callback = ''; let opened!: () => void;
  const openedPromise = new Promise<void>(resolve => { opened = resolve; });
  const oauth = new McpOAuth(storage, async url => {
    if (!hold) return fixture.authorize(url);
    callback = new URL(url).searchParams.get('redirect_uri')!; opened();
  });
  try {
    await oauth.login(fixture.config, signal(), () => {});
    const initial = await oauth.token(fixture.config); const before = [...storage.values];
    hold = true;
    const login = assert.rejects(oauth.login(fixture.config, signal(), () => {}), /取消或超时/);
    await openedPromise;
    await assert.rejects(oauth.changeConfigurations([fixture.config], async () => { throw new Error('SAVE_FAILED'); }), /SAVE_FAILED/);
    await login; await assert.rejects(fetch(callback));
    assert.deepEqual([...storage.values], before); assert.equal(await oauth.token(fixture.config), initial);
    hold = false; await oauth.login(fixture.config, signal(), () => {});
    assert.equal((await oauth.status(fixture.config)).state, 'connected');
    assert.notEqual(await oauth.token(fixture.config), initial);
  } finally { oauth.dispose(); await fixture.close(); }
});

test('credential identity follows server, endpoint and OAuth settings, independent of display and enabled state', async () => {
  const fixture = await oauthServer();
  try {
    const key = oauthCredentialKey(fixture.config);
    assert.equal(oauthCredentialKey({ ...fixture.config, name: 'Renamed', enabled: false }), key);
    for (const change of [{ id: 'another' }, { url: fixture.config.url + '?v=2' }, { oauth: { clientId: 'another', scope: '' } }, { oauth: { clientId: '', scope: 'new' } }])
      assert.notEqual(oauthCredentialKey({ ...fixture.config, ...change }), key);
    assert.equal(oauthCredentialKey({ ...fixture.config, oauth: undefined }), undefined);
  } finally { await fixture.close(); }
});
