import { createHash, randomUUID } from 'node:crypto';
import { createModels, type AuthPrompt, type AuthEvent, type Credential, type CredentialStore, type OAuthCredential, type Provider } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { raceWithAbortSignal } from '@earendil-works/pi-ai/utils/abort';
import { z } from 'zod';
import type { ModelProvider } from '../shared/contracts.ts';
import { runtimeOAuthSnapshotSchema, type ProviderAuthStatus, type RuntimeOAuthSnapshot } from '../shared/provider-auth.ts';

interface Vault { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void>; }
const credentialSchema = z.object({ type: z.literal('oauth'), refresh: z.string(), access: z.string(), expires: z.number() }).catchall(z.unknown());

// Authentication mode/name do not change account identity: both credential types survive mode switches.
export function providerOAuthKey(config: ModelProvider): string {
  return 'provider-oauth:' + createHash('sha256').update(JSON.stringify([config.id, config.kind, config.namespace, config.baseUrl.trim(), config.kind === 'custom' ? config.api : ''])).digest('hex');
}
export function checkedProviderAuthUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))))
    throw new Error('OAuth 授权链接必须使用 HTTPS 或本机回环地址');
  return url.href;
}

interface Login {
  config: ModelProvider; owner: number; controller: AbortController; status: ProviderAuthStatus;
  done: Promise<void>; answer?: { id: string; resolve: (value: string) => void; reject: (error: Error) => void };
}

export class ProviderAuth {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly active = new Map<string, Set<AbortController>>();
  private readonly changing = new Set<string>();
  private readonly logins = new Map<string, Login>();
  private readonly states = new Map<string, ProviderAuthStatus>();
  private readonly lifetime = new AbortController();
  constructor(private readonly vault: Vault, private readonly open: (url: string) => Promise<void>,
    private readonly current: (config: ModelProvider) => boolean,
    private readonly publish: (owner: number, status: ProviderAuthStatus) => void,
    private readonly providers: () => readonly Provider[] = builtinProviders) {}

  private provider(config: ModelProvider): Provider {
    if (config.kind !== 'builtin' || config.baseUrl.trim()) throw new Error('OAuth 仅允许 SDK 官方端点，请清空 Base URL');
    const provider = this.providers().find(provider => provider.id === config.namespace);
    if (!provider?.auth.oauth) throw new Error('此提供商不支持 OAuth');
    return provider;
  }
  private assertCurrent(config: ModelProvider, signal?: AbortSignal): void {
    signal?.throwIfAborted();
    if (this.lifetime.signal.aborted || this.changing.has(providerOAuthKey(config)) || !this.current(config)) throw new Error('提供商配置已变化，请重新打开设置');
  }
  private async exclusive<T>(config: ModelProvider, signal: AbortSignal, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.assertCurrent(config, signal);
    const key = providerOAuthKey(config), controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal, this.lifetime.signal]);
    const active = this.active.get(key) ?? new Set<AbortController>(); active.add(controller); this.active.set(key, active);
    const task = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => { this.assertCurrent(config, combined); return run(combined); });
    this.queues.set(key, task);
    try { return await task; } finally {
      active.delete(controller); if (!active.size) this.active.delete(key);
      if (this.queues.get(key) === task) this.queues.delete(key);
    }
  }
  private async read(config: ModelProvider): Promise<OAuthCredential | undefined> {
    const raw = await this.vault.get(providerOAuthKey(config));
    return raw ? credentialSchema.parse(JSON.parse(raw)) : undefined;
  }
  async status(config: ModelProvider, owner: number): Promise<ProviderAuthStatus> {
    try {
    this.assertCurrent(config);
    const login = this.logins.get(config.id), connected = !!await this.read(config);
    if (login?.owner === owner) return { ...login.status, connected };
    return { id: config.id, connected, phase: login ? 'logging_in' : this.states.get(config.id)?.phase ?? 'idle',
      ...(!login && this.states.get(config.id)?.error ? { error: this.states.get(config.id)!.error } : {}) };
    } catch { throw new Error('无法读取 OAuth 状态，请检查配置与加密存储'); }
  }
  async start(config: ModelProvider, owner: number): Promise<ProviderAuthStatus> {
    this.assertCurrent(config); const provider = this.provider(config);
    if (config.authMethod !== 'oauth') throw new Error('请先选择 OAuth 认证');
    if (this.logins.has(config.id)) throw new Error('此提供商正在登录');
    const login: Login = { config: structuredClone(config), owner, controller: new AbortController(),
      status: { id: config.id, connected: false, phase: 'logging_in', operationId: randomUUID() }, done: Promise.resolve() };
    this.logins.set(config.id, login);
    const signal = AbortSignal.any([login.controller.signal, this.lifetime.signal, AbortSignal.timeout(600000)]);
    login.done = this.exclusive(config, signal, async signal => {
      login.status.connected = !!await this.read(config); this.assertCurrent(config, signal); this.publish(owner, { ...login.status });
      const credential = await raceWithAbortSignal(provider.auth.oauth!.login({ signal,
        prompt: prompt => this.prompt(login, prompt, signal), notify: event => this.notify(login, event, signal) }), signal);
      this.assertCurrent(config, signal);
      await this.vault.set(providerOAuthKey(config), JSON.stringify(credentialSchema.parse(credential)));
      login.status = { id: config.id, connected: true, phase: 'idle', operationId: login.status.operationId };
    }).catch(async () => {
      let connected = login.status.connected;
      try { connected = !!await this.read(config); } catch { /* Retain last durable status when storage is unavailable. */ }
      login.status = { id: config.id, connected, phase: 'error', operationId: login.status.operationId, error: signal.aborted ? 'OAuth 登录已取消或超时' : 'OAuth 登录失败，请检查连接与加密存储后重试' };
    }).finally(() => {
      login.answer?.reject(new Error('OAuth 交互已结束')); login.answer = undefined;
      if (this.logins.get(config.id) !== login) return;
      this.logins.delete(config.id);
      if (this.lifetime.signal.aborted || this.changing.has(providerOAuthKey(config)) || !this.current(config)) return;
      this.states.set(config.id, login.status); this.publish(owner, { ...login.status });
    });
    return { ...login.status };
  }
  private prompt(login: Login, prompt: AuthPrompt, signal: AbortSignal): Promise<string> {
    const combined = prompt.signal ? AbortSignal.any([signal, prompt.signal]) : signal;
    combined.throwIfAborted(); const id = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = () => {
        combined.removeEventListener('abort', abort);
        if (login.answer?.id === id) {
          login.answer = undefined; login.status.prompt = undefined;
          if (!combined.aborted && !this.changing.has(providerOAuthKey(login.config)) && this.current(login.config)) this.publish(login.owner, { ...login.status });
        }
      };
      const abort = () => { finish(); reject(new Error('OAuth 交互已取消')); };
      login.answer = { id, resolve: value => { finish(); resolve(value); }, reject: error => { finish(); reject(error); } };
      login.status.prompt = { id, type: prompt.type, message: prompt.message,
        ...('placeholder' in prompt ? { placeholder: prompt.placeholder } : {}),
        ...(prompt.type === 'select' ? { options: prompt.options.map(({ id, label }) => ({ id, label })) } : {}) };
      combined.addEventListener('abort', abort, { once: true }); this.publish(login.owner, { ...login.status });
    });
  }
  private notify(login: Login, event: AuthEvent, signal: AbortSignal): void {
    this.assertCurrent(login.config, signal);
    const link = event.type === 'auth_url' ? event.url : event.type === 'device_code' ? event.verificationUri : undefined;
    if (link) {
      login.status.link = checkedProviderAuthUrl(link);
      login.status.instructions = event.type === 'auth_url' ? event.instructions : '请在浏览器中输入设备码';
      login.status.userCode = event.type === 'device_code' ? event.userCode : undefined;
      const url = login.status.link;
      void this.open(url).catch(() => {
        if (signal.aborted || this.logins.get(login.config.id) !== login) return;
        login.status.error = '无法打开系统浏览器，请手动打开授权链接'; this.publish(login.owner, { ...login.status });
      });
    } else if (event.type === 'progress' || event.type === 'info') login.status.instructions = event.message;
    this.publish(login.owner, { ...login.status });
  }
  private operation(config: ModelProvider, owner: number, operationId: string): Login {
    this.assertCurrent(config); const login = this.logins.get(config.id);
    if (!login || login.owner !== owner || login.status.operationId !== operationId || login.controller.signal.aborted) throw new Error('OAuth 交互已过期或属于其他窗口');
    return login;
  }
  answer(config: ModelProvider, owner: number, operationId: string, promptId: string, value: string): void {
    const login = this.operation(config, owner, operationId), prompt = login.status.prompt;
    if (!prompt || prompt.id !== promptId || login.answer?.id !== promptId) throw new Error('OAuth 表单已过期');
    if (prompt.type === 'select' && !prompt.options?.some(option => option.id === value)) throw new Error('请选择有效的登录方法');
    login.answer.resolve(value);
  }
  cancel(config: ModelProvider, owner: number, operationId: string): void { this.operation(config, owner, operationId).controller.abort(); }
  async openLink(config: ModelProvider, owner: number, operationId: string): Promise<void> {
    const login = this.operation(config, owner, operationId);
    if (!login.status.link) throw new Error('授权链接尚未就绪');
    try { await this.open(checkedProviderAuthUrl(login.status.link)); } catch { throw new Error('无法打开系统浏览器，请手动打开授权链接'); }
  }
  pending(id: string): boolean { return this.logins.has(id); }
  async resolve(config: ModelProvider, signal = AbortSignal.timeout(45000)): Promise<RuntimeOAuthSnapshot> {
    if (this.pending(config.id)) throw new Error('此提供商正在登录，请等待登录完成');
    const provider = this.provider(config);
    try {
      return await this.exclusive(config, signal, async signal => {
        if (!await this.read(config)) throw new Error('LOGIN_REQUIRED');
        // The outer per-configuration queue also serializes SDK store.modify and lifecycle changes.
        const store: CredentialStore = {
          read: async id => id === provider.id ? this.read(config) : undefined,
          list: async () => await this.read(config) ? [{ providerId: provider.id, type: 'oauth' }] : [],
          modify: async (id, fn, options) => {
            if (id !== provider.id) throw new Error('Unknown credential identity');
            this.assertCurrent(config, options?.signal); const current = await this.read(config), next: Credential | undefined = await fn(current);
            this.assertCurrent(config, signal); options?.signal?.throwIfAborted();
            if (next) await this.vault.set(providerOAuthKey(config), JSON.stringify(credentialSchema.parse(next)));
            return next ?? current;
          },
          delete: async () => { throw new Error('Use provider logout'); },
        };
        const runtime = createModels({ credentials: store, authContext: { env: async () => undefined, fileExists: async () => false } });
        runtime.setProvider(provider);
        const result = await runtime.getAuth(provider.id, { signal }); this.assertCurrent(config, signal);
        const credential = await this.read(config);
        if (!result || !credential) throw new Error('LOGIN_REQUIRED');
        return runtimeOAuthSnapshotSchema.parse({ auth: result.auth, credential: {
          type: 'oauth', refresh: '', access: credential.access, expires: credential.expires,
          accountId: credential.accountId, enterpriseUrl: credential.enterpriseUrl, availableModelIds: credential.availableModelIds,
        } });
      });
    } catch { throw new Error('OAuth 认证或刷新失败，请检查连接、加密存储或重新登录'); }
  }
  async logout(config: ModelProvider, owner: number): Promise<ProviderAuthStatus> {
    try {
      const login = this.logins.get(config.id); login?.controller.abort(); await login?.done;
      await this.exclusive(config, AbortSignal.timeout(45000), async signal => { this.assertCurrent(config, signal); await this.vault.set(providerOAuthKey(config), ''); });
    } catch { throw new Error('退出 OAuth 失败，请检查配置与加密存储后重试'); }
    const status: ProviderAuthStatus = { id: config.id, connected: false, phase: 'idle' };
    this.states.set(config.id, status); this.publish(owner, status); return status;
  }
  async changeConfigurations<T>(configs: ModelProvider[], commit: () => Promise<T>): Promise<T> {
    const keys = [...new Set(configs.map(providerOAuthKey))];
    for (const config of configs) { this.logins.get(config.id)?.controller.abort(); this.states.delete(config.id); }
    for (const key of keys) { this.changing.add(key); for (const controller of this.active.get(key) ?? []) controller.abort(); }
    try {
      await Promise.all(configs.map(config => this.logins.get(config.id)?.done));
      await Promise.all(keys.map(key => this.queues.get(key)?.catch(() => {}))); return await commit();
    }
    finally { for (const key of keys) this.changing.delete(key); }
  }
  closeOwner(owner: number): void { for (const login of this.logins.values()) if (login.owner === owner) login.controller.abort(); }
  async dispose(): Promise<void> { this.lifetime.abort(); await Promise.all([...this.logins.values()].map(login => login.done)); await Promise.allSettled([...this.queues.values()]); }
}
