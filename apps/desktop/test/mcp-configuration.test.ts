import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mcpSchema, mcpToolSchema } from '../src/shared/contracts.ts';
import { mcpConfigurationErrors, mcpSecretEntries, parseMcpSecrets, validateMcpConfiguration } from '../src/shared/mcp-configuration.ts';
import { pluginSchema, resolvePluginMcpServer } from '../src/shared/plugins.ts';

test('MCP validates enabled configurations and validates disabled services before a connection test', () => {
  const disabled = mcpSchema.parse({ id: 'm', name: 'MCP', enabled: false, transport: 'stdio' });
  assert.doesNotThrow(() => validateMcpConfiguration(disabled));
  assert.deepEqual(mcpConfigurationErrors(disabled, true), { command: '请填写启动命令' });
  assert.throws(() => validateMcpConfiguration({ ...disabled, enabled: true }), /启动命令/);
  assert.deepEqual(mcpConfigurationErrors({ ...disabled, name: '  ' }), { name: '请填写服务名称' });
  for (const url of ['http://localhost:123/mcp', 'https://example.test/mcp'])
    assert.doesNotThrow(() => validateMcpConfiguration({ ...disabled, transport: 'http', url }, true));
  for (const url of ['', 'localhost:123', 'file:///mcp', 'javascript:alert(1)'])
    assert.ok(mcpConfigurationErrors({ ...disabled, transport: 'http', url }, true).url);
});

test('MCP secret edits preserve blanks, allow explicit clearing and never echo invalid input', () => {
  assert.equal(parseMcpSecrets('   '), undefined);
  assert.deepEqual(parseMcpSecrets('{}'), {});
  assert.deepEqual(parseMcpSecrets('{"TOKEN":"value","EMPTY":""}'), { TOKEN: 'value', EMPTY: '' });
  for (const secret of ['SECRET_INVALID_JSON', '{"TOKEN":42}', 'null', '[]', '"SECRET"'])
    assert.throws(() => parseMcpSecrets(secret), { message: '加密环境变量需为字符串值的 JSON 对象' });
});

test('MCP tool reports validate mapped names and optional display labels', () => {
  assert.deepEqual(mcpToolSchema.parse({ name: 'mcp_call', label: '服务 · 原始工具名', description: '说明' }), { name: 'mcp_call', label: '服务 · 原始工具名', description: '说明' });
  assert.equal(mcpToolSchema.safeParse({ name: 42, description: 'bad' }).success, false);
  assert.equal(mcpToolSchema.safeParse({ name: 'valid', description: 'bad', secret: 'unexpected' }).success, false);
});

test('credential rows validate names, bound values and reject duplicates without reflecting secret input', () => {
  assert.deepEqual(mcpSecretEntries([[' API_TOKEN ', 'private'], ['EMPTY', '']], 'stdio'), { API_TOKEN: 'private', EMPTY: '' });
  assert.deepEqual(mcpSecretEntries([['X-Api-Key', 'private']], 'http'), { 'X-Api-Key': 'private' });
  assert.deepEqual(mcpSecretEntries([], 'http'), {});
  const invalid: Array<Array<[string, string]>> = [[['', 'private']], [['TOKEN', 'first'], ['token', 'private']], [['TOKEN', 'private'.repeat(3000)]], [['TOKEN', 'private' + String.fromCharCode(0)]]];
  for (const transport of ['stdio', 'http'] as const) for (const entries of invalid)
    assert.throws(() => mcpSecretEntries(entries, transport), error => error instanceof Error && !error.message.includes('private'));
  assert.throws(() => mcpSecretEntries([['TOKEN', 'private' + String.fromCharCode(10)]], 'http'), /凭据值/);
  assert.throws(() => mcpSecretEntries([['X-Api-Key', 'private']], 'stdio'), /凭据名称/);
  assert.throws(() => mcpSecretEntries(Array.from({ length: 101 }, (_, index) => ['KEY_' + index, 'private']), 'stdio'), /100/);
});

test('plugin MCP form configuration resolves the same runtime paths without changing the manifest', () => {
  const plugin = pluginSchema.parse({ id: 'test-plugin', source: 'C:/source', enabled: true, current: {
    revision: 'eeac195e-a0d8-4310-9a62-005d3f45b9d9', path: 'C:/installed/content', hash: 'a'.repeat(64), installedAt: 1, approved: true,
    manifest: { schemaVersion: 1, id: 'test-plugin', name: 'Test', version: '1.0.0', mcp: [{ id: 'tools', name: 'Tools', enabled: true, transport: 'stdio', command: '{pluginRoot}/node.exe', args: ['{pluginRoot}/server.mjs'] }] },
  } });
  const server = plugin.current.manifest.mcp[0]; const before = structuredClone(server);
  assert.deepEqual(resolvePluginMcpServer(plugin, server), { ...server, id: 'plugin:test-plugin:tools', command: 'C:/installed/content/node.exe', args: ['C:/installed/content/server.mjs'] });
  assert.deepEqual(server, before);
});
