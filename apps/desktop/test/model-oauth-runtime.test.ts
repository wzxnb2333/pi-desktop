import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { InMemoryCredentialStore, type Api, type AssistantMessage, type Model, type Provider } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { requestSchema, type ModelProvider, type ProviderModel } from '../src/shared/contracts.ts';
import { generateMemories } from '../src/main/memory-generation.ts';
import { registerConfiguredModel } from '../src/shared/model-runtime.ts';
import { providerAuthStatusSchema, type ModelAuthResolver, type RuntimeOAuthSnapshot } from '../src/shared/provider-auth.ts';
import { workerConfigSchema } from '../src/shared/worker-protocol.ts';
import { reviewAction } from '../src/worker/action-review.ts';

const oauthProviderIds = [
  'anthropic', 'github-copilot', 'kimi-coding', 'meta', 'openai-codex', 'openrouter', 'radius', 'xai',
];

function snapshot(token: string, expires = Date.now() + 3_600_000): RuntimeOAuthSnapshot {
  return {
    credential: { type: 'oauth', refresh: '', access: token, expires,
      accountId: 'test-account', enterpriseUrl: 'https://github.example', availableModelIds: ['gpt-4o'] },
    auth: { apiKey: token },
  };
}

function providerConfig(id: string): ModelProvider {
  return { id, name: id, kind: 'builtin', namespace: id, baseUrl: '', api: 'openai-completions', hasKey: false, authMethod: 'oauth' };
}

function modelConfig(providerId: string, model: { id: string; name: string; reasoning: boolean; contextWindow: number; maxTokens: number }): ProviderModel {
  return { id: model.id, provider: providerId, model: model.id, name: model.name,
    reasoning: model.reasoning, contextWindow: model.contextWindow, maxTokens: model.maxTokens };
}

test('keeps OAuth snapshots private and rejects malformed snapshots at shared boundaries', () => {
  const valid = snapshot('private-access');
  const workerOAuthSchema = workerConfigSchema.shape.oauth;
  assert.equal(workerOAuthSchema.safeParse(valid).success, true);
  assert.equal(workerOAuthSchema.safeParse({
    ...valid, credential: { ...valid.credential, refresh: 'private-refresh' },
  }).success, false);
  assert.equal(workerOAuthSchema.safeParse({
    ...valid, credential: { ...valid.credential, unexpected: 'private-extra' },
  }).success, false);

  const publicStatus = { id: 'anthropic', connected: true, phase: 'idle' };
  for (const key of ['access', 'credential', 'auth'] as const) {
    assert.equal(providerAuthStatusSchema.safeParse({ ...publicStatus, [key]: valid }).success, false, key);
  }

  assert.equal(requestSchema.safeParse({ op: 'model.auth' }).success, false);
  assert.equal(requestSchema.safeParse({ op: 'provider.oauthStatus', id: 'anthropic', snapshot: valid }).success, false);
  assert.equal(requestSchema.safeParse({ op: 'provider.oauthStart', id: 'anthropic', credential: valid.credential }).success, false);
});

async function runtime(): Promise<ModelRuntime> {
  return ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
}

test('keeps native OAuth capabilities for every SDK OAuth provider', async () => {
  const providers = builtinProviders().filter(provider => provider.auth.oauth);
  assert.deepEqual(providers.map(provider => provider.id).sort(), [...oauthProviderIds].sort());

  for (const provider of providers) {
    const instance = await runtime();
    const native = instance.getProvider(provider.id);
    assert.ok(native);
    assert.ok(native.auth.oauth);
    const selected = native.getModels()[0];
    assert.ok(selected, `${provider.id} has a native catalog model`);
    const initial = snapshot(provider.id);
    const resolve: ModelAuthResolver = async () => initial;

    await registerConfiguredModel(instance, providerConfig(provider.id), modelConfig(provider.id, selected), undefined,
      ['text', 'image'], initial, resolve);

    const registered = instance.getProvider(provider.id);
    assert.equal(instance.isUsingOAuth(provider.id), true);
    assert.strictEqual(registered?.getModels, native.getModels);
    assert.strictEqual(registered?.filterModels, native.filterModels);
    assert.equal(registered?.auth.oauth?.isSubscription, native.auth.oauth.isSubscription);
    assert.equal(instance.isUsingSubscription(provider.id), native.auth.oauth.isSubscription === true);
    assert.ok(instance.getModel(provider.id, selected.id));
  }
});

test('isolates same-namespace credentials and keeps GitHub Copilot model filtering', async () => {
  const first = await runtime();
  const second = await runtime();
  const copilot = first.getProvider('github-copilot');
  assert.ok(copilot);
  const models = copilot.getModels();
  assert.ok(models.length > 1);
  const selected = models[0];
  const onlySelected = { ...snapshot('copilot'), credential: {
    ...snapshot('copilot').credential, availableModelIds: [selected.id],
  } };
  const firstSnapshot = snapshot('first-runtime');
  const secondSnapshot = snapshot('second-runtime');

  await registerConfiguredModel(first, providerConfig('anthropic'), modelConfig('anthropic', first.getProvider('anthropic')!.getModels()[0]!),
    undefined, ['text'], firstSnapshot, async () => firstSnapshot);
  await registerConfiguredModel(second, providerConfig('anthropic'), modelConfig('anthropic', second.getProvider('anthropic')!.getModels()[0]!),
    undefined, ['text'], secondSnapshot, async () => secondSnapshot);
  assert.equal((await first.getAuth('anthropic'))?.auth.apiKey, 'first-runtime');
  assert.equal((await second.getAuth('anthropic'))?.auth.apiKey, 'second-runtime');

  const copilotRuntime = await runtime();
  await registerConfiguredModel(copilotRuntime, providerConfig('github-copilot'), modelConfig('github-copilot', selected),
    undefined, ['text'], onlySelected, async () => onlySelected);
  assert.deepEqual((await copilotRuntime.getAvailable('github-copilot')).map(model => model.id), [selected.id]);
});

test('refreshes expired OAuth through the resolver and fails closed without it', async () => {
  const instance = await runtime();
  const expired = snapshot('expired', Date.now() + 1000);
  const fresh = snapshot('fresh');
  let resolverCalls = 0;
  let refreshHadSignal = false;
  const resolve: ModelAuthResolver = async signal => {
    resolverCalls++;
    if (signal) refreshHadSignal = true;
    return fresh;
  };
  const native = instance.getProvider('anthropic');
  assert.ok(native);
  const selected = native.getModels()[0];
  assert.ok(selected);
  await registerConfiguredModel(instance, providerConfig('anthropic'), modelConfig('anthropic', selected), undefined,
    ['text'], expired, resolve);
  assert.equal((await instance.getAuth('anthropic'))?.auth.apiKey, 'fresh');
  assert.equal(refreshHadSignal, true);
  assert.equal(resolverCalls, 2);

  const missingResolverRuntime = await runtime();
  await assert.rejects(registerConfiguredModel(missingResolverRuntime, providerConfig('anthropic'), modelConfig('anthropic', selected),
    'must-not-fallback', ['text'], expired), /OAuth 尚未初始化/u);
  await assert.rejects(registerConfiguredModel(missingResolverRuntime,
    { ...providerConfig('anthropic'), baseUrl: 'https://override.example' }, modelConfig('anthropic', selected), undefined,
    ['text'], expired, resolve), /OAuth 仅支持 SDK 内置提供商/u);

  const whitespaceRuntime = await runtime();
  const originalBaseUrl = whitespaceRuntime.getProvider('anthropic')?.baseUrl;
  await registerConfiguredModel(whitespaceRuntime,
    { ...providerConfig('anthropic'), baseUrl: '   ' }, modelConfig('anthropic', selected), undefined,
    ['text'], expired, resolve);
  assert.equal(whitespaceRuntime.getProvider('anthropic')?.baseUrl, originalBaseUrl);
});

test('review and memory generation propagate failures from the same OAuth resolver', async () => {
  const native = builtinProviders().find(provider => provider.id === 'anthropic');
  assert.ok(native);
  const selected = native.getModels()[0];
  assert.ok(selected);
  const config = providerConfig('anthropic');
  const model = modelConfig('anthropic', selected);
  const expired = snapshot('expired', Date.now() + 1000);
  let resolverCalls = 0;
  const rejectResolver: ModelAuthResolver = async () => {
    resolverCalls++;
    throw new Error('fake local provider-auth failure');
  };

  const review = await reviewAction(config, model, undefined,
    { tool: 'write', arguments: { path: 'a.txt' }, cwd: 'C:\\project', userRequest: 'write a file' },
    new AbortController().signal, expired, rejectResolver);
  assert.equal(review.risk, 'uncertain');
  await assert.rejects(generateMemories(config, model, undefined,
    { threadId: 'thread', fingerprint: 'fingerprint', messages: [{ id: 'message', text: 'durable preference' }] },
    new AbortController().signal, expired, rejectResolver), /记忆生成失败/u);
  assert.equal(resolverCalls >= 2, true);
});

test('redacts OAuth secrets from provider errors before session persistence while preserving normal content', async () => {
  const instance = await runtime();
  const native = instance.getProvider('anthropic');
  assert.ok(native);
  const selected = native.getModels()[0];
  assert.ok(selected);

  const access = 'oauth-access-secret';
  const apiKey = 'oauth-api-key-secret';
  const header = 'Bearer oauth-header-secret';
  const initial: RuntimeOAuthSnapshot = {
    credential: { type: 'oauth', refresh: '', access, expires: Date.now() + 3_600_000 },
    auth: { apiKey, headers: { authorization: header } },
  };
  let fail = true;
  let doneWithError = false;
  const fakeStream = (model: Model<Api>, options?: { apiKey?: string; headers?: Record<string, string | null> }): AssistantMessageEventStream => {
    const stream = new AssistantMessageEventStream();
    queueMicrotask(() => {
      const message: AssistantMessage = {
        role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: fail ? 'error' : 'stop',
        ...(fail || doneWithError ? {
          errorMessage: `failure ${access} ${options?.apiKey} ${options?.headers?.authorization}`,
          diagnostics: [{ type: 'fake-provider', timestamp: Date.now(), error: {
            message: `response contained ${apiKey}`, stack: `header ${header}`,
          }, details: { access, apiKey, header } }],
        } : { content: [{ type: 'text', text: `normal ${access}` }] }),
        timestamp: Date.now(),
      };
      if (fail) stream.push({ type: 'error', reason: 'error', error: message });
      else stream.push({ type: 'done', reason: 'stop', message });
    });
    return stream;
  };
  const fakeNative: Provider = {
    ...native,
    stream: (model, _context, options) => fakeStream(model, options),
    streamSimple: (model, _context, options) => fakeStream(model, options),
  };
  instance.registerNativeProvider(fakeNative);
  const config = providerConfig('anthropic');
  await registerConfiguredModel(instance, config, modelConfig('anthropic', selected), undefined,
    ['text'], initial, async () => initial);

  const tempDir = await mkdtemp(join(tmpdir(), 'pi-oauth-session-'));
  let session: Awaited<ReturnType<typeof createAgentSessionFromServices>>['session'] | undefined;
  try {
    const services = await createAgentSessionServices({
      cwd: tempDir,
      agentDir: tempDir,
      modelRuntime: instance,
      settingsManager: SettingsManager.inMemory(),
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true },
    });
    const created = await createAgentSessionFromServices({
      services, sessionManager: SessionManager.inMemory(tempDir), model: selected, tools: [],
    });
    session = created.session;
    const emitted: unknown[] = [];
    session.subscribe(event => emitted.push(event));

    await session.prompt('trigger the fake provider error');
    const stored = JSON.stringify({ messages: session.messages, entries: session.sessionManager.getEntries(), emitted });
    for (const secret of [access, apiKey, header, 'oauth-header-secret']) assert.equal(stored.includes(secret), false);
    assert.match(stored, /\[redacted\]/u);
    const fullStreamError = await instance.complete(selected, {
      messages: [{ role: 'user', content: 'also test provider.stream', timestamp: Date.now() }],
    });
    assert.equal(fullStreamError.stopReason, 'error');
    const fullStreamOutput = JSON.stringify(fullStreamError);
    for (const secret of [access, apiKey, header, 'oauth-header-secret']) assert.equal(fullStreamOutput.includes(secret), false);

    fail = false;
    doneWithError = true;
    const doneStream = instance.streamSimple(selected, {
      messages: [{ role: 'user', content: 'test terminal done event', timestamp: Date.now() }],
    });
    const doneEvents: unknown[] = [];
    for await (const event of doneStream) doneEvents.push(event);
    const doneOutput = JSON.stringify({ events: doneEvents, result: await doneStream.result() });
    for (const secret of [access, apiKey, header, 'oauth-header-secret']) assert.equal(doneOutput.includes(secret), false);
    assert.match(doneOutput, /\[redacted\]/u);

    doneWithError = false;
    const response = await instance.completeSimple(selected, {
      messages: [{ role: 'user', content: 'return a normal response', timestamp: Date.now() }],
    });
    assert.equal(response.content[0]?.type, 'text');
    if (response.content[0]?.type === 'text') assert.equal(response.content[0].text, `normal ${access}`);
  } finally {
    session?.dispose();
    await rm(tempDir, { recursive: true, force: true });
  }
});
