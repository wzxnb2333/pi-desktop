import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { mkdtemp } from './fixtures/node-temp.ts';
import { modelProviderSchema, providerModelSchema, settingsSchema, threadSchema } from '../src/shared/contracts.ts';
import type { WorkerConfig, WorkerEvent } from '../src/shared/worker-protocol.ts';
import { DesktopAgent } from '../src/worker/agent.ts';

for (const stage of ['approval', 'initialize', 'tools']) test('disposing initialization cancels ' + stage + ' and closes owned MCP processes', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-agent-cancel-'));
  const marker = join(root, 'marker.json');
  const events: WorkerEvent[] = [];
  const agent = new DesktopAgent(event => events.push(event));
  const config: WorkerConfig = {
    thread: threadSchema.parse({ id: 't', projectId: 'p', title: 'test', cwd: root, createdAt: 1, updatedAt: 1,
      modelId: 'fake', thinking: 'off', policy: stage === 'approval' ? 'ask' : 'full' }),
    trusted: true,
    model: providerModelSchema.parse({ id: 'fake', provider: 'fake-provider', name: 'fake', model: 'fake', reasoning: false }),
    modelProvider: modelProviderSchema.parse({ id: 'fake-provider', name: 'fake', kind: 'custom', namespace: 'desktop-fake-provider', baseUrl: 'http://127.0.0.1:1/v1' }),
    settings: settingsSchema.parse({}), agentDir: join(root, '.agent'), testMode: true,
    mcp: [{ config: { id: 'm', name: 'wait', enabled: true, transport: 'stdio', command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/mcp-wait-server.mjs', import.meta.url)), stage, marker], url: '' }, secrets: {} }],
  };
  // Observe rejection immediately; disposal and initialization settle concurrently.
  const initialized = agent.init(config).then(() => undefined, (error: unknown) => error);
  let pid: number | undefined;
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (stage === 'approval' && events.some(event => event.type === 'approval')) break;
      if (stage !== 'approval') {
        const value = await readFile(marker, 'utf8').then(text => JSON.parse(text) as { pid: number; stage: string }).catch(() => undefined);
        if (value?.stage === (stage === 'initialize' ? 'started' : 'tools')) { pid = value.pid; break; }
      }
      await setTimeout(20);
    }
    if (stage === 'approval') assert.ok(events.some(event => event.type === 'approval'));
    else assert.ok(pid, 'the actual MCP subprocess reached its pending stage');
    const first = agent.dispose(), second = agent.dispose();
    assert.equal(first, second);
    await first;
    assert.ok(await initialized instanceof Error);
    assert.equal(agent.sessionFile, undefined);
    assert.equal(events.some(event => event.type === 'mcp' && event.connection.state === 'connected'), false);
    if (pid) assert.throws(() => process.kill(pid!, 0));
    else await assert.rejects(readFile(marker), { code: 'ENOENT' });
  } finally { await agent.dispose(); }
});
