import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mcpSchema } from '../../src/shared/contracts.ts';

export async function oauthServer() {
  const clients = new Map<string, string>(); const codes = new Map<string, { challenge: string; redirect: string; client: string }>();
  const access = new Set<string>(); const refresh = new Set<string>(); const transports = new Set<StreamableHTTPServerTransport>();
  const counts = { registration: 0, authorization: 0, exchange: 0, refresh: 0, revoke: 0, tool: 0, denied: 0 };
  const seen: string[] = []; let base = ''; let invalidGrant = false; let lifetime = 3600; let redirect = '';
  const http = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', base); const json = (status: number, value: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
      const body = async () => { let text = ''; for await (const chunk of request) text += String(chunk); return text; };
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json(200, { resource: base + '/mcp', authorization_servers: [base], scopes_supported: ['tools'] });
      if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) return json(200, { issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', registration_endpoint: base + '/register', revocation_endpoint: base + '/revoke', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'] });
      if (url.pathname === '/register') { counts.registration++; const data = JSON.parse(await body()) as { redirect_uris: string[] }; const client = crypto.randomUUID(); clients.set(client, data.redirect_uris[0]); return json(201, { client_id: client, redirect_uris: data.redirect_uris, token_endpoint_auth_method: 'none' }); }
      if (url.pathname === '/authorize') {
        counts.authorization++; const client = url.searchParams.get('client_id') ?? ''; redirect = url.searchParams.get('redirect_uri') ?? '';
        if (clients.get(client) !== redirect || url.searchParams.get('code_challenge_method') !== 'S256' || !url.searchParams.get('state')) return json(400, { error: 'bad_authorization' });
        const code = crypto.randomUUID(); codes.set(code, { challenge: url.searchParams.get('code_challenge')!, redirect, client });
        const callback = new URL(redirect); callback.searchParams.set('code', code); callback.searchParams.set('state', url.searchParams.get('state')!);
        response.writeHead(302, { Location: callback.href }); response.end(); return;
      }
      if (url.pathname === '/token') {
        const params = new URLSearchParams(await body()); const client = params.get('client_id') ?? '';
        if (params.get('grant_type') === 'authorization_code') {
          const code = params.get('code') ?? ''; const saved = codes.get(code); codes.delete(code);
          if (!saved || saved.client !== client || saved.redirect !== params.get('redirect_uri') || saved.challenge !== createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url')) return json(400, { error: 'invalid_grant', error_description: 'SECRET_MUST_NOT_LEAK' });
          counts.exchange++;
        } else {
          counts.refresh++; const token = params.get('refresh_token') ?? '';
          if (invalidGrant || !refresh.delete(token)) return json(400, { error: 'invalid_grant', error_description: 'SECRET_MUST_NOT_LEAK' });
        }
        const token = 'access-' + crypto.randomUUID(); const refreshToken = 'refresh-' + crypto.randomUUID(); access.add(token); refresh.add(refreshToken);
        return json(200, { access_token: token, token_type: 'Bearer', refresh_token: refreshToken, expires_in: lifetime, scope: 'tools' });
      }
      if (url.pathname === '/revoke') { counts.revoke++; const params = new URLSearchParams(await body()); access.delete(params.get('token')!); refresh.delete(params.get('token')!); response.writeHead(200).end(); return; }
      if (url.pathname === '/mcp') {
        const header = String(request.headers.authorization ?? ''); seen.push(header);
        if (!access.has(header.replace(/^Bearer /, ''))) { counts.denied++; response.writeHead(401, { 'WWW-Authenticate': 'Bearer resource_metadata="' + base + '/.well-known/oauth-protected-resource"' }).end(); return; }
        if (request.method !== 'POST') { response.writeHead(405).end(); return; }
        const protocol = new Server({ name: 'OAuth fixture', version: '1' }, { capabilities: { tools: {} } });
        protocol.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'oauth_echo', description: 'Offline OAuth protocol fixture', inputSchema: { type: 'object' } }] }));
        protocol.setRequestHandler(CallToolRequestSchema, async () => { counts.tool++; return { content: [{ type: 'text', text: 'OAUTH_REAL_TOOL_OK' }] }; });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }); transports.add(transport);
        response.on('close', () => { transports.delete(transport); void protocol.close(); }); await protocol.connect(transport); await transport.handleRequest(request, response); return;
      }
      json(404, {});
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end('FIXTURE_FAILURE'); });
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve)); const address = http.address(); if (!address || typeof address === 'string') throw new Error('No fixture address'); base = 'http://127.0.0.1:' + address.port;
  return {
    config: mcpSchema.parse({ id: 'oauth-local', name: '本机 OAuth', transport: 'http', enabled: true, url: base + '/mcp', oauth: {} }), counts, seen,
    get redirect() { return redirect; },
    acceptAccessToken(value: string) { access.add(value); },
    setLifetime(value: number) { lifetime = value; }, failRefresh(value: boolean) { invalidGrant = value; }, invalidateAccess() { access.clear(); },
    async authorize(url: string) { const result = await fetch(url); if (!result.ok) throw new Error('Fixture authorization failed'); },
    async close() { for (const transport of transports) await transport.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); },
  };
}
