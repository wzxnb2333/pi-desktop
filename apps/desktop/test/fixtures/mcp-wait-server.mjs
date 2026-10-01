import { writeFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const [mode, marker] = process.argv.slice(2);
await writeFile(marker, JSON.stringify({ pid: process.pid, stage: 'started' }));
// Test process deliberately keeps running after EOF to exercise transport shutdown.
const keepAlive = setInterval(() => {}, 1000);
if (mode === 'initialize') {
  process.stdin.resume();
} else {
  const server = new Server({ name: 'wait-fixture', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    await writeFile(marker, JSON.stringify({ pid: process.pid, stage: 'tools' }));
    if (mode === 'tools') await new Promise(resolve => extra.signal.addEventListener('abort', resolve, { once: true }));
    return { tools: [{ name: 'probe', description: 'Local cancellation fixture', inputSchema: { type: 'object' } }] };
  });
  server.onclose = () => { if (mode === 'ready') clearInterval(keepAlive); };
  await server.connect(new StdioServerTransport());
}
