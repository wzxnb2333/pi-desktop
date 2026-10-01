import { once } from 'node:events';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const mode = process.argv[2];
if (mode === 'stderr') {
  for (let n = 0; n < 256; n++) {
    if (!process.stderr.write('diagnostic'.repeat(8192))) await once(process.stderr, 'drain');
  }
}
const server = new Server({ name: 'lifecycle', version: '1' }, { capabilities: { tools: {} } });
let page = 0;
server.setRequestHandler(ListToolsRequestSchema, async () => {
  page++;
  return {
    tools: [{ name: mode === 'cursor' ? 'tool-' + page : 'echo', description: '本地回归工具', inputSchema: { type: 'object' } }],
    ...(['cursor', 'duplicate'].includes(mode) ? { nextCursor: 'repeated' } : {}),
  };
});
server.setRequestHandler(CallToolRequestSchema, async request => {
  if (request.params.arguments?.exit) process.exit(0);
  return { content: [{ type: 'text', text: 'ok' }] };
});
await server.connect(new StdioServerTransport());
