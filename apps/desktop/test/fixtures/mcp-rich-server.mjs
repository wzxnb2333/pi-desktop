import { appendFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const server = new Server({ name: 'rich-fixture', version: '1' }, { capabilities: { tools: {}, resources: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'rich', description: 'Rich results fixture', inputSchema: { type: 'object' } },
  { name: 'schema', description: 'Output schema fixture', inputSchema: { type: 'object' }, outputSchema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] } },
] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  if (request.params.name === 'schema') return { content: [{ type: 'text', text: 'schema' }], ...(request.params.arguments?.missing ? {} : { structuredContent: { count: request.params.arguments?.invalid ? 'bad' : 3 } }) };
  return { content: [
    { type: 'text', text: 'RICH_TEXT_RESULT' },
    { type: 'image', mimeType: 'image/png', data: png },
    { type: 'resource_link', uri: 'fixture://report', name: '报告', description: 'Read from the original MCP server', mimeType: 'text/plain' },
    { type: 'resource', resource: { uri: 'fixture://inline', mimeType: 'text/html', text: '<script>window.UNSAFE=true</script><p>INLINE_RESOURCE</p>' } },
    { type: 'image', mimeType: 'image/svg+xml', data: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64') },
    { type: 'resource_link', uri: 'javascript:alert(1)', name: '不安全链接' },
    { type: 'resource_link', uri: 'fixture://wait', name: '慢速资源' },
  ], structuredContent: { count: 2, label: 'STRUCTURED_DATA' }, isError: !!request.params.arguments?.fail, _meta: { fixture: true } };
});
server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
  if (process.argv[2]) await appendFile(process.argv[2], request.params.uri + '\n');
  if (request.params.uri === 'fixture://wait') await new Promise(resolve => {
    const timer = setTimeout(resolve, 30000);
    extra.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  if (!['fixture://report', 'fixture://wait'].includes(request.params.uri)) throw new Error('UNKNOWN_RESOURCE');
  return { contents: [{ uri: request.params.uri, mimeType: 'text/plain', text: 'MCP_RESOURCE_READ_OK' }] };
});
// Inject a future block on the wire after the fixture SDK validates its current\n+// protocol version. This exercises a newer server without weakening production parsing.
const transport = new StdioServerTransport();
const send = transport.send.bind(transport);
transport.send = async message => {
  if (message.result?.structuredContent?.label === 'STRUCTURED_DATA') message.result.content.splice(4, 0,
    { type: 'future_panel', payload: { rows: [1, 2], content: 'UNKNOWN_BLOCK_RETAINED' } });
  return send(message);
};
await server.connect(transport);
