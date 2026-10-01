import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'desktop-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'a_very_long_tool_name_for_testing_provider_function_name_limits_and_uniqueness',
      description: 'Echo test',
      inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: 'text', text: `echo:${request.params.arguments.message}` }],
}));
await server.connect(new StdioServerTransport());
