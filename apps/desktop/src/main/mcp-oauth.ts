import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { auth, type OAuthClientProvider, type OAuthDiscoveryState, selectClientAuthMethod } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthTokensSchema, type OAuthClientInformationMixed, type OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpConfig } from '../shared/contracts.ts';
import type { McpOAuthStatus } from '../shared/mcp-schema.ts';

interface Vault { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void>; }
interface Credentials { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; expiresAt?: number; discovery?: OAuthDiscoveryState; redirect: string; }
function checkedUrl(value: string | URL): URL {
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('OAuth 需要 HTTPS 或本机回环地址');
  return url;
}
export function oauthCredentialKey(config: McpConfig): string | undefined {
  if (config.transport !== 'http' || !config.oauth) return undefined;
  // Disabled, unfinished forms have no usable credential identity. Runtime operations still validate strictly.
  let url: URL;
  try { url = checkedUrl(config.url); } catch { return undefined; }
  return 'mcp-oauth:' + createHash('sha256').update(JSON.stringify([config.id, url.href, config.oauth])).digest('hex');
}
export class McpOAuth {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly logins = new Map<string, AbortController>();
  private readonly active = new Map<string, Set<AbortController>>();
  private readonly changing = new Set<string>();
  constructor(private readonly vault: Vault, private readonly open: (url: string) => Promise<void>,
    private readonly current: (config: McpConfig) => Promise<boolean> = async () => true) {}
  private key(config: McpConfig): string {
    if (config.transport === 'http' && config.oauth) checkedUrl(config.url);
    const key = oauthCredentialKey(config);
    if (!key) throw new Error('此 MCP 服务未启用 OAuth');
    return key;
  }
  private async assertCurrent(config: McpConfig, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.changing.has(this.key(config)) || !await this.current(config)) throw new Error('OAuth 配置已变化，请重新打开设置后重试。');
    signal?.throwIfAborted();
    if (this.changing.has(this.key(config))) throw new Error('OAuth 配置已变化，请重新打开设置后重试。');
  }
  private async exclusive<T>(config: McpConfig, signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const key = this.key(config);
    if (this.changing.has(key)) throw new Error('OAuth 配置已变化，请重新打开设置后重试。');
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const controllers = this.active.get(key) ?? new Set<AbortController>();
    controllers.add(controller); this.active.set(key, controllers);
    const task = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      await this.assertCurrent(config, combined);
      return action(combined);
    });
    this.queues.set(key, task);
    try { return await task; } finally {
      controllers.delete(controller); if (!controllers.size) this.active.delete(key);
      if (this.queues.get(key) === task) this.queues.delete(key);
    }
  }
  async changeConfigurations<T>(configs: McpConfig[], commit: () => Promise<T>): Promise<T> {
    const keys = [...new Set(configs.map(config => this.key(config)))];
    for (const key of keys) {
      this.changing.add(key);
      for (const controller of this.active.get(key) ?? []) controller.abort();
    }
    try {
      // Finish/abort all old writes before the vault transaction; never wait while holding its lock.
      await Promise.all(keys.map(key => this.queues.get(key)?.catch(() => {})));
      return await commit();
    } finally { for (const key of keys) this.changing.delete(key); }
  }
  private async read(key: string): Promise<Credentials> {
    const raw = await this.vault.get(key);
    if (!raw) return { redirect: 'http://127.0.0.1/' };
    const data = JSON.parse(raw) as Credentials;
    if (data.tokens) data.tokens = OAuthTokensSchema.parse(data.tokens);
    return data;
  }
  async status(config: McpConfig): Promise<McpOAuthStatus> {
    await this.assertCurrent(config);
    const key = this.key(config); const data = await this.read(key);
    return { state: this.logins.has(key) ? 'authorizing' : !data.tokens ? 'disconnected' : data.expiresAt && data.expiresAt <= Date.now() ? 'expired' : 'connected', ...(data.expiresAt === undefined ? {} : { expiresAt: data.expiresAt }) };
  }
  private fetcher(signal: AbortSignal): typeof fetch {
    return async (input, init) => {
      checkedUrl(input instanceof Request ? input.url : String(input));
      return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(20000), ...(init?.signal ? [init.signal] : [])]) });
    };
  }
  private provider(config: McpConfig, data: Credentials, redirect: (url: URL) => Promise<void>, state?: string): OAuthClientProvider {
    let verifier = '';
    return {
      redirectUrl: data.redirect,
      clientMetadata: { client_name: 'Pi Desktop', redirect_uris: [data.redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', ...(config.oauth?.scope ? { scope: config.oauth.scope } : {}) },
      state: () => state ?? '',
      clientInformation: () => data.client ?? (config.oauth?.clientId ? { client_id: config.oauth.clientId } : undefined),
      saveClientInformation: info => { data.client = info; },
      tokens: () => data.tokens,
      saveTokens: tokens => { data.tokens = tokens; data.expiresAt = tokens.expires_in === undefined ? undefined : Date.now() + tokens.expires_in * 1000; },
      redirectToAuthorization: redirect,
      saveCodeVerifier: value => { verifier = value; }, codeVerifier: () => verifier,
      discoveryState: () => data.discovery, saveDiscoveryState: value => { data.discovery = value; },
      invalidateCredentials: scope => {
        if (scope === 'all' || scope === 'client') data.client = undefined;
        if (scope === 'all' || scope === 'tokens') { data.tokens = undefined; data.expiresAt = undefined; }
        if (scope === 'all' || scope === 'discovery') data.discovery = undefined;
        if (scope === 'all' || scope === 'verifier') verifier = '';
      },
    };
  }
  async login(config: McpConfig, signal: AbortSignal, progress: (stage: string) => void): Promise<void> {
    const key = this.key(config);
    if (this.logins.has(key)) throw new Error('此服务正在等待授权');
    const controller = new AbortController(); this.logins.set(key, controller);
    const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(180000)]);
    try {
      await this.exclusive(config, combined, async combined => {
        combined.throwIfAborted(); const state = randomBytes(32).toString('hex');
        const data: Credentials = { redirect: '' };
        let resolveCode!: (code: string) => void; let rejectCode!: (reason: Error) => void;
        const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
        void code.catch(() => {});
        const server = createServer((request, response) => {
          const callback = new URL(request.url ?? '/', data.redirect || 'http://127.0.0.1');
          response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.setHeader('Cache-Control', 'no-store');
          if (request.method !== 'GET' || callback.pathname !== '/oauth/callback' || callback.searchParams.get('state') !== state || request.headers.host !== new URL(data.redirect).host) { response.writeHead(400).end('Invalid OAuth callback'); return; }
          if (callback.searchParams.has('error')) { response.end('Authorization declined. Return to Pi Desktop.'); rejectCode(new Error('OAuth 授权被拒绝，请重新登录')); }
          else if (callback.searchParams.get('code')) { response.end('Authorization received. Return to Pi Desktop.'); resolveCode(callback.searchParams.get('code')!); }
          else response.writeHead(400).end('Missing authorization code');
        });
        const abort = () => rejectCode(new Error('OAuth 授权已取消或超时'));
        combined.addEventListener('abort', abort, { once: true });
        try {
          await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
          const address = server.address(); if (!address || typeof address === 'string') throw new Error('无法启动 OAuth 回调');
          data.redirect = 'http://127.0.0.1:' + address.port + '/oauth/callback'; combined.throwIfAborted();
          const provider = this.provider(config, data, async url => { combined.throwIfAborted(); checkedUrl(url); progress('等待浏览器授权'); await this.open(url.href); }, state);
          progress('发现 OAuth 服务');
          const result = await auth(provider, { serverUrl: config.url, scope: config.oauth?.scope || undefined, fetchFn: this.fetcher(combined) });
          if (result === 'REDIRECT') {
            const authorizationCode = await code; combined.throwIfAborted(); progress('交换授权令牌');
            await auth(provider, { serverUrl: config.url, authorizationCode, fetchFn: this.fetcher(combined) });
          }
          combined.throwIfAborted(); if (!data.tokens) throw new Error('OAuth 服务未返回令牌');
          await this.assertCurrent(config, combined);
          await this.vault.set(key, JSON.stringify(data)); progress('OAuth 登录完成');
        } catch (error) {
          if (combined.aborted) throw new Error('OAuth 授权已取消或超时');
          // Provider error bodies can contain credentials. Never propagate them to the renderer.
          if (error instanceof Error && error.message === 'OAuth 授权被拒绝，请重新登录') throw error;
          throw new Error('OAuth 登录失败，请检查服务配置后重试');
        } finally {
          combined.removeEventListener('abort', abort); server.closeAllConnections();
          if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
        }
      });
    } finally { this.logins.delete(key); }
  }
  async token(config: McpConfig, rejectedToken?: string, signal = AbortSignal.timeout(45000), force = false): Promise<string> {
    const key = this.key(config);
    if (this.logins.has(key)) throw new Error('此服务正在等待授权');
    return this.exclusive(config, signal, async signal => {
      signal.throwIfAborted();
      const data = await this.read(key);
      if (!data.tokens) throw new Error('请先在 MCP 设置中登录 OAuth');
      if (!force && data.tokens.access_token !== rejectedToken && (!data.expiresAt || data.expiresAt > Date.now() + 30000)) return data.tokens.access_token;
      if (!data.tokens.refresh_token) { data.tokens = undefined; data.expiresAt = undefined; await this.assertCurrent(config, signal); await this.vault.set(key, JSON.stringify(data)); throw new Error('OAuth 授权已过期，请重新登录'); }
      try {
        await auth(this.provider(config, data, async () => { throw new Error('LOGIN_REQUIRED'); }), { serverUrl: config.url, fetchFn: this.fetcher(signal) });
        if (!data.tokens) throw new Error('LOGIN_REQUIRED');
        await this.assertCurrent(config, signal);
        await this.vault.set(key, JSON.stringify(data)); return data.tokens.access_token;
      } catch (error) {
        if (error instanceof Error && (['InvalidGrantError', 'InvalidClientError', 'UnauthorizedClientError'].includes(error.name) || error.message === 'LOGIN_REQUIRED')) {
          data.tokens = undefined; data.expiresAt = undefined; await this.assertCurrent(config, signal); await this.vault.set(key, JSON.stringify(data));
          throw new Error('OAuth 授权已过期，请重新登录');
        }
        throw new Error('OAuth 刷新失败，请检查连接或重新登录');
      }
    });
  }
  async revoke(config: McpConfig, signal: AbortSignal): Promise<void> {
    const key = this.key(config); this.logins.get(key)?.abort();
    return this.exclusive(config, signal, async signal => {
      const data = await this.read(key); let failed = false;
      try {
        const metadata = data.discovery?.authorizationServerMetadata;
        const endpoint = metadata && 'revocation_endpoint' in metadata && typeof metadata.revocation_endpoint === 'string' ? metadata.revocation_endpoint : undefined;
        const client = data.client ?? (config.oauth?.clientId ? { client_id: config.oauth.clientId } : undefined);
        if (endpoint && data.tokens && client) {
          const methods = metadata && 'revocation_endpoint_auth_methods_supported' in metadata ? metadata.revocation_endpoint_auth_methods_supported : undefined;
          const method = selectClientAuthMethod(client, Array.isArray(methods) ? methods.filter((method): method is string => typeof method === 'string') : ['client_secret_basic']);
          for (const [hint, token] of [['refresh_token', data.tokens.refresh_token], ['access_token', data.tokens.access_token]]) {
            if (!token) continue;
            const body = new URLSearchParams({ token, token_type_hint: hint! }); const headers = new Headers();
            if (method === 'client_secret_basic') headers.set('Authorization', 'Basic ' + Buffer.from(encodeURIComponent(client.client_id) + ':' + encodeURIComponent(client.client_secret ?? '')).toString('base64'));
            else { body.set('client_id', client.client_id); if (method === 'client_secret_post' && client.client_secret) body.set('client_secret', client.client_secret); }
            const response = await this.fetcher(signal)(endpoint, { method: 'POST', body, headers });
            if (!response.ok) failed = true; await response.body?.cancel();
          }
        }
      } catch { failed = true; }
      finally { await this.assertCurrent(config); await this.vault.set(key, ''); }
      if (failed) throw new Error('本机授权已清除，服务端撤销失败，请在服务网站检查授权');
    });
  }
  dispose(): void {
    for (const controller of this.logins.values()) controller.abort();
    for (const controllers of this.active.values()) for (const controller of controllers) controller.abort();
  }
}
