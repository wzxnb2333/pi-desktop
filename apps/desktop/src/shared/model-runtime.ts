import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { type Api, type AssistantMessage, type Model, type OAuthCredential, type Provider } from '@earendil-works/pi-ai';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { thinkingSchema, type ModelProvider, type ProviderModel } from './contracts.ts';
import type { ModelAuthResolver, RuntimeOAuthSnapshot } from './provider-auth.ts';

function rememberOAuthSecrets(snapshot: RuntimeOAuthSnapshot, secrets: Set<string>): void {
  for (const value of [snapshot.credential.access, snapshot.auth.apiKey, ...Object.values(snapshot.auth.headers ?? {})])
    if (value) secrets.add(value);
}

function redactOAuthStrings(value: unknown, secrets: Set<string>): unknown {
  if (typeof value === 'string') {
    return [...secrets].filter(secret => secret.length > 0).sort((a, b) => b.length - a.length)
      .reduce((text, secret) => text.replaceAll(secret, '[redacted]'), value);
  }
  if (Array.isArray(value)) return value.map(item => redactOAuthStrings(item, secrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactOAuthStrings(item, secrets)]));
  return value;
}

function oauthFailureMessage(model: Model<Api>, error: unknown, secrets: Set<string>): AssistantMessage {
  const message = error instanceof Error ? error.message || error.name : String(error);
  const stopReason = error instanceof Error && error.name === 'AbortError' ? 'aborted' : 'error';
  return {
    role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason, errorMessage: redactOAuthStrings(message, secrets) as string, timestamp: Date.now(),
  };
}

function redactOAuthFailure(message: AssistantMessage, secrets: Set<string>): AssistantMessage {
  return message.stopReason === 'error' || message.stopReason === 'aborted' || message.errorMessage
    ? redactOAuthStrings(message, secrets) as AssistantMessage : message;
}

function filterOAuthErrorStream(
  model: Model<Api>,
  create: () => AssistantMessageEventStream,
  secrets: Set<string>,
): AssistantMessageEventStream {
  let source: AssistantMessageEventStream;
  try { source = create(); }
  catch (error) {
    const failure = oauthFailureMessage(model, error, secrets);
    const stream = new AssistantMessageEventStream();
    stream.push({ type: 'error', reason: failure.stopReason === 'aborted' ? 'aborted' : 'error', error: failure });
    stream.end(failure);
    return stream;
  }

  const filtered = new AssistantMessageEventStream();
  void (async () => {
    try {
      for await (const event of source) {
        if (event.type === 'error') filtered.push({ ...event, error: redactOAuthFailure(event.error, secrets) });
        else if (event.type === 'done') filtered.push({ ...event, message: redactOAuthFailure(event.message, secrets) });
        else filtered.push(event);
      }
      const result = await source.result();
      filtered.end(redactOAuthFailure(result, secrets));
    } catch (error) {
      const failure = oauthFailureMessage(model, error, secrets);
      filtered.push({ type: 'error', reason: failure.stopReason === 'aborted' ? 'aborted' : 'error', error: failure });
      filtered.end(failure);
    }
  })();
  return filtered;
}

function oauthRuntimeProvider(
  provider: Provider,
  initial: RuntimeOAuthSnapshot,
  resolver: ModelAuthResolver,
): Provider {
  let latestSnapshot = initial;
  const resolveSnapshot = async (signal?: AbortSignal): Promise<RuntimeOAuthSnapshot> => {
    const snapshot = await resolver(signal);
    latestSnapshot = snapshot;
    return snapshot;
  };
  const requestSecrets = (options?: { apiKey?: string; headers?: Record<string, string | null> }): Set<string> => {
    const secrets = new Set<string>();
    rememberOAuthSecrets(latestSnapshot, secrets);
    if (options?.apiKey) secrets.add(options.apiKey);
    for (const value of Object.values(options?.headers ?? {})) if (value) secrets.add(value);
    return secrets;
  };

  return {
    ...provider,
    auth: {
      ...provider.auth,
      oauth: {
        ...provider.auth.oauth!,
        login: async ({ signal }) => {
          signal.throwIfAborted();
          return initial.credential;
        },
        refresh: async (_credential: OAuthCredential, signal: AbortSignal) => (await resolveSnapshot(signal)).credential,
        toAuth: async (_credential: OAuthCredential) => (await resolveSnapshot()).auth,
      },
    },
    stream: (model, context, options) => {
      return filterOAuthErrorStream(model, () => provider.stream(model, context, options), requestSecrets(options));
    },
    streamSimple: (model, context, options) => {
      return filterOAuthErrorStream(model, () => provider.streamSimple(model, context, options), requestSecrets(options));
    },
  };
}

/**
 * Register one configured model on a pi runtime. A custom provider owns its endpoint and protocol;
 * a built-in one only overrides the endpoint when the user set a Base URL (proxy or gateway).
 */
export async function registerConfiguredModel(
  runtime: ModelRuntime,
  provider: ModelProvider,
  model: ProviderModel,
  apiKey: string | undefined,
  input: ('text' | 'image')[] = ['text', 'image'],
  oauth?: RuntimeOAuthSnapshot,
  resolveOAuth?: ModelAuthResolver,
): Promise<void> {
  if (provider.authMethod === 'oauth') {
    if (!oauth || !resolveOAuth) throw new Error('模型 OAuth 尚未初始化');
    if (provider.kind !== 'builtin' || provider.baseUrl.trim()) throw new Error('OAuth 仅支持 SDK 内置提供商');
  } else if (oauth) throw new Error('API Key 提供商不能接收 OAuth 凭据');
  const resolver = resolveOAuth;
  if (provider.kind === 'custom') {
    if (!provider.baseUrl) throw new Error('自定义提供商必须填写 Base URL');
    const url = new URL(provider.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL 必须使用 HTTP(S)');
    runtime.registerProvider(provider.namespace, {
      baseUrl: provider.baseUrl,
      api: provider.api,
      apiKey: 'desktop-runtime',
      models: [{
        id: model.model,
        name: model.name,
        reasoning: model.reasoning,
        thinkingLevelMap: model.thinkingLevels ? Object.fromEntries(
          thinkingSchema.options.map((level) => [level,
            model.thinkingLevels?.includes(level) ? (level === 'off' ? undefined : level) : null]),
        ) : undefined,
        input,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }],
    });
  } else if (provider.baseUrl.trim())
    runtime.registerProvider(provider.namespace, { baseUrl: provider.baseUrl.trim() });
  if (oauth) {
    if (!resolver) throw new Error('模型 OAuth 尚未初始化');
    const native = runtime.getProvider(provider.namespace);
    const nativeOAuth = native?.auth.oauth;
    if (!native || !nativeOAuth) throw new Error(`提供商 ${provider.namespace} 不支持 OAuth`);
    const oauthProvider = oauthRuntimeProvider(native, oauth, resolver);
    runtime.registerNativeProvider(oauthProvider);
    await runtime.login(provider.namespace, 'oauth', {
      signal: new AbortController().signal,
      prompt: async () => { throw new Error('OAuth 登录需在 Pi Desktop 主进程完成'); },
      notify: () => {},
    });
  } else if (apiKey) await runtime.setRuntimeApiKey(provider.namespace, apiKey);
}
