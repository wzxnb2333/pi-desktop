import { readFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const context = JSON.parse(await readFile(process.argv[2], 'utf8'));
const server = new Server({ name: 'credential-fixture', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (process.env.PI_FIXTURE_TOKEN !== context.required) throw new Error('Missing fixture credential');
  return { tools: [{ name: 'credential_probe', description: 'Check local credential delivery', inputSchema: { type: 'object' } }] };
});
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: context.label }] }));
await server.connect(new StdioServerTransport());
