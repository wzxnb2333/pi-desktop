import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { mcpToolDecision, mcpToolPolicySchema } from '../src/shared/mcp-tool-policy.ts';
import { settingsSchema } from '../src/shared/contracts.ts';
import { changedWorkerSettingGroups } from '../src/main/settings-diff.ts';
import { McpConnection } from '../src/worker/mcp.ts';

test('tool policies only restrict task permissions and changes invalidate the next worker configuration', () => {
  for (const decision of ['allow', 'ask', 'review', 'deny'] as const) for (const approval of ['inherit', 'ask', 'deny'] as const) for (const enabled of [true, false]) {
    const policy = mcpToolPolicySchema.parse({ approval, enabled }); const result = mcpToolDecision(decision, policy);
    if (decision === 'deny' || !enabled || approval === 'deny') assert.equal(result, 'deny');
    else if (decision === 'ask' || approval === 'ask') assert.equal(result, 'ask'); else assert.equal(result, decision);
  }
  const previous = settingsSchema.parse({}); const next = settingsSchema.parse({ mcpToolPolicies: { server: { echo: { timeoutMs: 1000 } } } });
  assert.deepEqual(changedWorkerSettingGroups(previous, next), ['mcpToolPolicies']);
  assert.throws(() => mcpToolPolicySchema.parse({ timeoutMs: 0 })); assert.throws(() => mcpToolPolicySchema.parse({ approval: 'auto' }));
});

test('MCP discovery preserves original tool names, removes disabled tools and enforces deny and real timeouts', { timeout: 15000 }, async () => {
  const connection = new McpConnection(); const config = { id: 'policy', name: 'Policy', enabled: true, transport: 'stdio' as const, command: process.execPath, args: [fileURLToPath(new URL('./fixtures/mcp-policy-server.mjs', import.meta.url))], url: '' };
  try {
    await connection.connect(config, {}, process.cwd());
    assert.deepEqual(await connection.tools(config, { echo: mcpToolPolicySchema.parse({ enabled: false }) }), []); assert.equal(connection.discovered[0].sourceName, 'echo');
    const blocked = (await connection.tools(config, { echo: mcpToolPolicySchema.parse({ approval: 'deny' }) }))[0];
    await assert.rejects(blocked.execute('blocked', {}, new AbortController().signal, undefined, {} as ExtensionContext), /禁止调用/);
    const limited = (await connection.tools(config, { echo: mcpToolPolicySchema.parse({ timeoutMs: 1000 }) }))[0];
    const started = Date.now(); await assert.rejects(limited.execute('timeout', { wait: true }, new AbortController().signal, undefined, {} as ExtensionContext), /timeout|timed out/i);
    assert.ok(Date.now() - started < 4500); assert.equal((await connection.tools(config)).length, 1);
  } finally { await connection.close(); }
});
