import { createHash } from 'node:crypto';
import type { McpConfig } from '../shared/contracts.ts';
import { oauthCredentialKey } from './mcp-oauth.ts';

export function mcpCredentialReference(server: McpConfig): string {
  return createHash('sha256').update(JSON.stringify(server.transport === 'http'
    ? [server.id, server.transport, server.url] : [server.id, server.transport, server.command, server.args])).digest('hex');
}

export function retiredMcpCredentials(previous: McpConfig[], next: McpConfig[]): string[] {
  const oauth = new Set(next.map(oauthCredentialKey).filter(Boolean));
  return [...new Set(previous.flatMap(server => {
    const key = oauthCredentialKey(server);
    return [
      ...(!next.some(current => mcpCredentialReference(current) === mcpCredentialReference(server)) ? ['mcp:' + server.id] : []),
      ...(key && !oauth.has(key) ? [key] : []),
    ];
  }))];
}
