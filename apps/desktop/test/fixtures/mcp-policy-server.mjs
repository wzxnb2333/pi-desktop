import { appendFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'policy-fixture', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', description: 'Policy fixture', inputSchema: { type: 'object' } }] }));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  if (process.argv[2]) await appendFile(process.argv[2], 'call\n');
  if (request.params.arguments?.wait) await new Promise(resolve => {
    const timer = setTimeout(resolve, 10000);
    extra.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  return { content: [{ type: 'text', text: 'POLICY_TOOL_CALLED' }] };
});
await server.connect(new StdioServerTransport());
