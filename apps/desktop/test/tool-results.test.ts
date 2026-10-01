import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { mcpSchema, settingsSchema, threadSchema } from '../src/shared/contracts.ts';
import { McpConnection, mcpConfigurationKey } from '../src/worker/mcp.ts';
import { storedToolResult, resultImage, toolResultSchema, validateResultSize } from '../src/shared/tool-results.ts';
import { messageItem, eventItem } from '../src/worker/timeline.ts';
import { mergeTimelineItem } from '../src/shared/timeline.ts';
import { mcpResourceTarget } from '../src/main/mcp-resources.ts';

const config = mcpSchema.parse({ id: 'rich', name: 'Rich', transport: 'stdio', enabled: true, command: process.execPath, args: [fileURLToPath(new URL('./fixtures/mcp-rich-server.mjs', import.meta.url))] });
test('real MCP results preserve images, resources, extension blocks and error details through stream and history', { timeout: 15000 }, async () => {
  const connection = new McpConnection();
  try {
    await connection.connect(config, {}, process.cwd()); const tools = await connection.tools(config);
    const result = await tools[0].execute('rich', { fail: true }, new AbortController().signal, undefined, {} as ExtensionContext);
    const stored = storedToolResult(result.details)!;
    assert.equal(result.content[1].type, 'image');
    assert.equal(stored.result.isError, true); assert.deepEqual(stored.result.content[4], { type: 'future_panel', payload: { rows: [1, 2], content: 'UNKNOWN_BLOCK_RETAINED' } });
    assert.deepEqual(stored.result.structuredContent, { count: 2, label: 'STRUCTURED_DATA' });
    assert.equal(resultImage(stored.result.content[5]), undefined);
    const live = eventItem({ type: 'tool_execution_end', toolCallId: 'rich', toolName: tools[0].name, result, isError: true })!;
    const history = messageItem({ role: 'toolResult', toolCallId: 'rich', toolName: tools[0].name, content: result.content, details: result.details, isError: true })!;
    assert.deepEqual(history.toolResult, live.toolResult); assert.equal(history.state, 'error');
    assert.deepEqual(mergeTimelineItem({ ...history, toolResult: undefined }, live).toolResult, stored);
    assert.deepEqual(messageItem({ role: 'toolResult', content: [result.content[1]] })?.toolResult?.result.content, [result.content[1]]);
    const resource = await connection.readResource('fixture://report', new AbortController().signal, 5000);
    assert.equal((toolResultSchema.parse(resource).result.content[0].resource as { text: string }).text, 'MCP_RESOURCE_READ_OK');
    const executeSchema = (params: object) => tools[1].execute('schema', params, new AbortController().signal, undefined, {} as ExtensionContext);
    await assert.rejects(executeSchema({ missing: true }), /未返回声明/);
    await assert.rejects(executeSchema({ invalid: true }), /不符合声明/);
    assert.deepEqual(storedToolResult((await executeSchema({})).details)?.result.structuredContent, { count: 3 });
  } finally { await connection.close(); }
});

test('resource reads are bound to captured origin, current trust and restrictive tool policies', () => {
  const settings = settingsSchema.parse({ mcpServers: [config] });
  const thread = threadSchema.parse({ id: 't', projectId: 'p', title: 't', cwd: process.cwd(), modelId: 'p', thinking: 'off', policy: 'auto', createdAt: 0, updatedAt: 0,
    items: [{ id: 'call', role: 'tool', text: '', timestamp: 0, toolResult: { origin: { serverId: config.id, toolName: 'rich', configuration: mcpConfigurationKey(config) }, result: { content: [{ type: 'resource_link', uri: 'fixture://report' }] } } }] });
  assert.equal(mcpResourceTarget(thread, settings, true, 'call', 0).uri, 'fixture://report');
  assert.throws(() => mcpResourceTarget(thread, settings, true, 'other', 0), /不属于/);
  assert.throws(() => mcpResourceTarget(thread, settings, true, 'call', 1), /不属于/);
  assert.throws(() => mcpResourceTarget(thread, settings, false, 'call', 0), /权限/);
  assert.throws(() => mcpResourceTarget({ ...thread, policy: 'deny' }, settings, true, 'call', 0), /权限/);
  assert.throws(() => mcpResourceTarget({ ...thread, planMode: true }, settings, true, 'call', 0), /权限/);
  assert.throws(() => mcpResourceTarget(thread, { ...settings, mcpServers: [{ ...config, args: ['replacement'] }] }, true, 'call', 0), /已变化/);
  assert.throws(() => mcpResourceTarget(thread, { ...settings, mcpToolPolicies: { rich: { rich: { enabled: true, approval: 'deny', timeoutMs: 1000 } } } }, true, 'call', 0), /禁止/);
  assert.equal(resultImage({ type: 'image', data: 'not a base64 image', mimeType: 'image/png' }), undefined);
  assert.equal(toolResultSchema.safeParse({ result: { content: [{ type: 'unknown', undefinedValue: undefined }] } }).success, false);
  assert.throws(() => validateResultSize({ content: 'a'.repeat(16 * 1024 * 1024) }), /16 MB/);
});
