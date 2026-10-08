import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { BrowserTools } from '../src/main/browser-tools.ts';
import type { PreviewService } from '../src/main/preview.ts';
import { browserSiteOrigin } from '../src/shared/browser-tools.ts';

function policyFixture() {
  let policy: 'ask' | 'allow' | 'deny' = 'allow', executions = 0, navigations = 0;
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => 'https://example.org/private', isDestroyed: () => false, isCrashed: () => false, stop() {},
    loadURL: async () => { navigations++; },
    executeJavaScriptInIsolatedWorld: async () => { executions++; return { text: 'PRIVATE_PAGE' }; },
  }) as unknown as ReturnType<PreviewService['agentContents']>;
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const preview = {
    agentFocus: () => () => {},
    agentTabs: () => [{ tabId: 'page', url: 'https://example.org/private', title: 'Fixture' }],
    agentContents: () => contents,
    capture: async () => { entered(); await gate; return { isEmpty: () => false, toPNG: () => Buffer.from('PRIVATE_IMAGE') }; },
  } as unknown as PreviewService;
  const tools = new BrowserTools(preview, () => policy);
  return { tools, ready, release, setPolicy(value: typeof policy) { policy = value; }, deny() { policy = 'deny'; }, get executions() { return executions; }, get navigations() { return navigations; } };
}

test('denying a website during a browser wait prevents the subsequent DOM inspection', async () => {
  const fixture = policyFixture(); let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const result = fixture.tools.run('t', { action: 'wait', tabId: 'page', milliseconds: 20 }, {} as BrowserWindow, new AbortController().signal, async () => {}, stage => { if (stage === '正在操作浏览器') started(); });
  const rejected = assert.rejects(result, /已被拒绝|尚未授权|页面地址已变化/);
  await waiting; fixture.deny(); await rejected;
  assert.equal(fixture.executions, 0, 'Revocation must precede page access, not merely reject its returned result');
});

test('denying a website during screenshot capture prevents delivery of its image', async () => {
  const fixture = policyFixture();
  const result = fixture.tools.run('t', { action: 'screenshot', tabId: 'page' }, {} as BrowserWindow, new AbortController().signal, async () => {}, () => {});
  const rejected = assert.rejects(result, /已被拒绝|尚未授权|页面地址已变化/);
  await fixture.ready; fixture.deny(); fixture.release(); await rejected;
});

test('website input normalizes only an origin and never widens a path into a site grant', () => {
  assert.equal(browserSiteOrigin('  https://EXAMPLE.org:443/  '), 'https://example.org');
  assert.equal(browserSiteOrigin('http://localhost:8080'), 'http://localhost:8080');
  for (const raw of ['https://example.org/private', 'https://example.org/?q=1', 'https://example.org/#private']) assert.throws(() => browserSiteOrigin(raw), /不包含路径/);
  for (const raw of ['', 'file:///C:/private', 'javascript:alert(1)', 'https://user:password@example.org']) assert.throws(() => browserSiteOrigin(raw), /不含用户名和密码/);
});

test('website denial while authorization completes prevents starting navigation', async () => {
  const fixture = policyFixture();
  await assert.rejects(fixture.tools.run('t', { action: 'navigate', url: 'https://example.org/private' }, {} as BrowserWindow, new AbortController().signal, async () => { fixture.deny(); }, () => {}), /已被拒绝/);
  assert.equal(fixture.navigations, 0); assert.equal(fixture.executions, 0);
});

test('closing a browser tab targets only the existing tab and skips website authorization', async () => {
  let authorized = false;
  let closed: { threadId: string; tabId: string; action: string } | undefined;
  const preview = {
    agentFocus: () => () => {},
    agentContents: () => ({ getURL: () => 'https://example.org/' } as ReturnType<PreviewService['agentContents']>),
    action: async (threadId: string, tabId: string, action: string) => { closed = { threadId, tabId, action }; },
  } as unknown as PreviewService;
  const tools = new BrowserTools(preview, () => 'allow');
  const result = await tools.run('t', { action: 'close', tabId: 'page' }, {} as BrowserWindow, new AbortController().signal, async () => { authorized = true; }, () => {});
  assert.deepEqual(closed, { threadId: 't', tabId: 'page', action: 'close' });
  assert.equal(authorized, false);
  assert.deepEqual(result.result.content, [{ type: 'text', text: JSON.stringify({ backend: 'in-app', tabId: 'page', status: 'closed' }) }]);
});

test('a denied operation releases the tab and one-time approval still works without a saved allow rule', async () => {
  const fixture = policyFixture(); fixture.deny();
  await assert.rejects(fixture.tools.run('t', { action: 'inspect', tabId: 'page' }, {} as BrowserWindow, new AbortController().signal, async () => {}, () => {}), /已被拒绝/);
  fixture.setPolicy('ask');
  const result = await fixture.tools.run('t', { action: 'inspect', tabId: 'page' }, {} as BrowserWindow, new AbortController().signal, async () => {}, () => {});
  assert.equal(fixture.executions, 1); assert.match(String(result.result.content[0].text), /PRIVATE_PAGE/);
});

test('a new in-app tab needs separate consent even when its website is allowed', async () => {
  const fixture = policyFixture(); const scopes: Array<string | undefined> = [];
  await assert.rejects(fixture.tools.run('t', { action: 'open', url: 'https://example.org/private' }, {} as BrowserWindow, new AbortController().signal, async (_url, scope) => {
    scopes.push(scope); if (scope === 'tab') throw new Error('TAB_CONSENT_DENIED');
  }, () => {}), /TAB_CONSENT_DENIED/);
  assert.deepEqual(scopes, [undefined, 'tab']); assert.equal(fixture.navigations, 0); assert.equal(fixture.executions, 0);
  scopes.length = 0;
  await fixture.tools.run('t', { action: 'navigate', tabId: 'page', url: 'https://example.org/private' }, {} as BrowserWindow, new AbortController().signal, async (_url, scope) => { scopes.push(scope); }, () => {});
  assert.deepEqual(scopes, [undefined]); assert.equal(fixture.navigations, 1);
});
