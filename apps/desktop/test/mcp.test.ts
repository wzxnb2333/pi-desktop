import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TemporaryDirectories } from './fixtures/temporary-directories.ts';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpConnection } from '../src/worker/mcp.ts';

test('MCP cancellation closes real stdio processes during initialization and tool discovery', { timeout: 20000 }, async context => {
  const directories = new TemporaryDirectories(); context.after(() => directories.cleanup());
  const directory = await directories.create(join(tmpdir(), 'pi-mcp-cancel-'));
  for (const mode of ['initialize', 'tools']) {
    const marker = join(directory, mode + '.json');
    const config = { id: mode, name: mode, enabled: true, transport: 'stdio' as const, command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/mcp-wait-server.mjs', import.meta.url)), mode, marker], url: '' };
    const connection = new McpConnection(), controller = new AbortController();
    const pending = (async () => { await connection.connect(config, {}, directory, undefined, controller.signal); await connection.tools(config, {}, controller.signal); })();
    const rejected = assert.rejects(pending, /abort|closed|cancel/i);
    let evidence: { pid: number; stage: string } | undefined;
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try { evidence = JSON.parse(await readFile(marker, 'utf8')) as typeof evidence; } catch { /* Wait for the owned fixture to write its marker. */ }
        if (evidence?.stage === (mode === 'tools' ? 'tools' : 'started')) break;
        await delay(20);
      }
      assert.ok(evidence); assert.equal(evidence.stage, mode === 'tools' ? 'tools' : 'started');
      controller.abort(); await rejected;
      await Promise.all([connection.close(), connection.close()]);
      assert.throws(() => process.kill(evidence!.pid, 0), { code: 'ESRCH' });
    } finally { controller.abort(); await rejected; await connection.close(); }
  }
});

test('MCP cancels an HTTP handshake and never starts an already cancelled connection', { timeout: 10000 }, async () => {
  let begin: () => void = () => {}, ended: () => void = () => {};
  const began = new Promise<void>(resolve => { begin = resolve; });
  const disconnected = new Promise<void>(resolve => { ended = resolve; });
  let requests = 0;
  const http = createServer((_request, response) => { requests++; response.on('close', ended); begin(); });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address(); assert.ok(address && typeof address !== 'string');
  const config = { id: 'waiting-http', name: 'HTTP', enabled: true, transport: 'http' as const, command: '', args: [], url: 'http://127.0.0.1:' + address.port + '/mcp' };
  const connection = new McpConnection(), controller = new AbortController();
  try {
    const pending = connection.connect(config, {}, process.cwd(), undefined, controller.signal);
    const rejected = assert.rejects(pending, /abort|closed|cancel/i);
    await began; controller.abort(); await rejected; await connection.close(); await disconnected;
    await assert.rejects(new McpConnection().connect(config, {}, process.cwd(), undefined, controller.signal), /abort/i);
    assert.equal(requests, 1);
  } finally { controller.abort(); await connection.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); }
});

test('MCP drains verbose stderr and reports an actual service exit', { timeout: 15000 }, async () => {
  const connection = new McpConnection();
  const config = { id: 'lifecycle', name: '生命周期', enabled: true, transport: 'stdio' as const, command: process.execPath, args: [fileURLToPath(new URL('./fixtures/mcp-lifecycle-server.mjs', import.meta.url)), 'stderr'], url: '' };
  let disconnected = false;
  connection.client.onclose = () => { disconnected = true; };
  try {
    await connection.connect(config, {}, process.cwd());
    const tools = await connection.tools(config);
    assert.equal(tools[0].label, '生命周期 · echo');
    assert.equal(disconnected, false);
    await assert.rejects(tools[0].execute('exit', { exit: true }, new AbortController().signal, undefined, {} as ExtensionContext), /closed/i);
    assert.equal(disconnected, true);
    await assert.rejects(connection.tools(config), /connected/i);
  } finally { await connection.close(); }
});

test('MCP rejects repeated pagination cursors and duplicate tool names', { timeout: 15000 }, async () => {
  for (const mode of ['cursor', 'duplicate']) {
    const connection = new McpConnection();
    const config = { id: mode, name: mode, enabled: true, transport: 'stdio' as const, command: process.execPath, args: [fileURLToPath(new URL('./fixtures/mcp-lifecycle-server.mjs', import.meta.url)), mode], url: '' };
    try {
      await connection.connect(config, {}, process.cwd());
      await assert.rejects(connection.tools(config), mode === 'cursor' ? /重复分页标识/ : /重复名称/);
    } finally { await connection.close(); }
  }
});

test(
  'MCP stdio tools map to valid provider tool names and execute through the bridge',
  { timeout: 15000 },
  async () => {
    const connection = new McpConnection();
    const config = {
      id: crypto.randomUUID(),
      name: 'Test MCP',
      enabled: true,
      transport: 'stdio' as const,
      command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url))],
      url: '',
    };
    try {
      await connection.connect(config, {}, process.cwd());
      const tools = await connection.tools(config);
      assert.equal(tools.length, 1);
      assert.ok(tools[0].name.length <= 64);
      assert.match(tools[0].name, /^[a-zA-Z0-9_-]+$/);
      const result = await tools[0].execute(
        'test',
        { message: 'hello' },
        new AbortController().signal,
        undefined,
        {} as ExtensionContext,
      );
      assert.deepEqual(result.content, [{ type: 'text', text: 'echo:hello' }]);
    } finally {
      await connection.close();
    }
  },
);

test('MCP HTTP preserves headers, paginates tools, reports errors and cancels calls', { timeout: 15000 }, async () => {
  const protocol = new Server({ name: 'http-acceptance', version: '1' }, { capabilities: { tools: {} } });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
  const requests: string[] = [];
  let started: (() => void) | undefined;
  let cancelled: (() => void) | undefined;
  const began = new Promise<void>((resolve) => { started = resolve; });
  const aborted = new Promise<void>((resolve) => { cancelled = resolve; });
  protocol.setRequestHandler(ListToolsRequestSchema, async (request) => ({
    tools: [{ name: request.params?.cursor ? 'second-tool' : 'first-tool', inputSchema: { type: 'object' } }],
    ...(request.params?.cursor ? {} : { nextCursor: 'page-2' }),
  }));
  protocol.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.arguments?.wait) {
      started?.();
      await new Promise<void>((resolve) => extra.signal.addEventListener('abort', () => { cancelled?.(); resolve(); }, { once: true }));
    }
    return { content: [{ type: 'text', text: request.params.arguments?.fail ? 'MCP_EXPECTED_ERROR' : 'HTTP_TOOL_OK' }], isError: !!request.params.arguments?.fail };
  });
  await protocol.connect(transport);
  const http = createServer((request, response) => {
    requests.push(String(request.headers['x-acceptance']));
    if (request.headers['x-acceptance'] !== 'local-secret') { response.writeHead(403); response.end('MCP_AUTH_REJECTED'); return; }
    void transport.handleRequest(request, response);
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing MCP address');
  const config = { id: 'http', name: 'HTTP', enabled: true, transport: 'http' as const, command: '', args: [], url: 'http://127.0.0.1:' + address.port + '/mcp' };
  const connection = new McpConnection();
  const denied = new McpConnection();
  try {
    await assert.rejects(denied.connect(config, {}, process.cwd()), /MCP_AUTH_REJECTED/);
    await connection.connect(config, { 'X-Acceptance': 'local-secret' }, process.cwd());
    const definitions = await connection.tools(config);
    assert.equal(definitions.length, 2);
    assert.equal(new Set(definitions.map((tool) => tool.name)).size, 2);
    const execute = (params: object, signal = new AbortController().signal) => definitions[0].execute('call', params, signal, undefined, {} as ExtensionContext);
    assert.deepEqual((await execute({})).content, [{ type: 'text', text: 'HTTP_TOOL_OK' }]);
    const failure = await execute({ fail: true });
    assert.deepEqual(failure.content, [{ type: 'text', text: 'MCP_EXPECTED_ERROR' }]);
    assert.equal((failure.details as { toolResult: { result: { isError: boolean } } }).toolResult.result.isError, true);
    const controller = new AbortController();
    const pending = execute({ wait: true }, controller.signal);
    const rejection = assert.rejects(pending, /abort|cancel/i);
    await began;
    controller.abort();
    await rejection;
    await aborted;
    assert.ok(requests.slice(1).every((header) => header === 'local-secret'));
  } finally {
    await denied.close();
    await connection.close();
    await protocol.close();
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
