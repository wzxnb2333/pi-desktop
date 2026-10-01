import assert from 'node:assert/strict';
import { mkdtemp } from './fixtures/node-temp.ts';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type ModelProvider, type Thread, modelProviderSchema, providerModelSchema, settingsSchema, threadSchema } from '../src/shared/contracts.ts';
import type { WorkerConfig, WorkerEvent } from '../src/shared/worker-protocol.ts';
import { DesktopAgent } from '../src/worker/agent.ts';

const cases: { api: ModelProvider['api']; thinking: Thread['thinking'] }[] = [
  ...(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'] as const)
    .map((api) => ({ api, thinking: 'off' as const })),
  ...(['low', 'high', 'xhigh', 'max'] as const).flatMap((thinking) =>
    (['openai-completions', 'openai-responses'] as const).map((api) => ({ api, thinking }))),
];
for (const { api, thinking } of cases) {
  test('provider protocol streams and restores: ' + api + ' / ' + thinking, { timeout: 20000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-protocol-'));
    const events: WorkerEvent[] = [];
    const received: { path: string; body: string; authenticated: boolean }[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push({ path: request.url || '', body: Buffer.concat(chunks).toString(), authenticated: Object.values(request.headers).some((value) => String(value).includes('protocol-test-key')) });
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (frame: { type?: string; [key: string]: unknown }) => {
        if (api === 'anthropic-messages') response.write('event: ' + frame.type + '\n');
        response.write('data: ' + JSON.stringify(frame) + '\n\n');
      };
      if (api === 'openai-completions') {
        send({ id: 'reply', object: 'chat.completion.chunk', model: 'model', choices: [{ index: 0, delta: { role: 'assistant', content: 'PROTOCOL_ACCEPTANCE' }, finish_reason: null }] });
        send({ id: 'reply', object: 'chat.completion.chunk', model: 'model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        response.write('data: [DONE]\n\n');
      } else if (api === 'openai-responses') {
        const item = { id: 'msg', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'PROTOCOL_ACCEPTANCE', annotations: [] }] };
        send({ type: 'response.created', response: { id: 'reply', status: 'in_progress', output: [] } });
        send({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
        send({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg', delta: 'PROTOCOL_ACCEPTANCE' });
        send({ type: 'response.output_item.done', output_index: 0, item });
        send({ type: 'response.completed', response: { id: 'reply', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } });
      } else if (api === 'anthropic-messages') {
        send({ type: 'message_start', message: { id: 'reply', type: 'message', role: 'assistant', model: 'model', content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
        send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
        send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'PROTOCOL_ACCEPTANCE' } });
        send({ type: 'content_block_stop', index: 0 });
        send({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } });
        send({ type: 'message_stop' });
      } else {
        send({ candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'PROTOCOL_ACCEPTANCE' }] } }] });
        send({ candidates: [{ index: 0, content: { role: 'model', parts: [] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } });
      }
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const config: WorkerConfig = {
      thread: threadSchema.parse({ id: 't', projectId: 'p', title: 'Protocol', cwd: root, createdAt: 1, updatedAt: 1, modelId: 'test', thinking, policy: 'deny' }),
      model: providerModelSchema.parse({ id: 'test', provider: 'test-provider', name: api, model: 'model',
        reasoning: thinking !== 'off', thinkingLevels: thinking === 'off' ? undefined : ['low', 'high', 'xhigh', 'max'] }),
      modelProvider: modelProviderSchema.parse({ id: 'test-provider', name: api, kind: 'custom', namespace: 'desktop-test-provider', api,
        baseUrl: 'http://127.0.0.1:' + address.port + '/v1' }),
      trusted: false, apiKey: 'protocol-test-key', settings: settingsSchema.parse({}), mcp: [], agentDir: join(root, 'agent'), testMode: true,
    };
    const agent = new DesktopAgent((event) => events.push(event));
    let restored: DesktopAgent | undefined;
    try {
      await agent.init(config);
      assert.equal(agent.session.thinkingLevel, thinking);
      await agent.prompt('PROTOCOL_PROMPT', []);
      assert.equal(received.length, 1);
      assert.ok(received[0].authenticated);
      assert.ok(received[0].body.includes('PROTOCOL_PROMPT'));
      if (thinking !== 'off') {
        const payload = JSON.parse(received[0].body) as { reasoning_effort?: string; reasoning?: { effort?: string } };
        assert.equal(api === 'openai-completions' ? payload.reasoning_effort : payload.reasoning?.effort, thinking);
      }
      const assistant = agent.history().find((item) => item.role === 'assistant');
      assert.equal(assistant?.text, 'PROTOCOL_ACCEPTANCE');
      assert.equal(assistant?.state, 'done');
      assert.ok(events.some((event) => event.type === 'item' && event.item.state === 'running' && event.item.role === 'assistant'));
      const sessionFile = agent.sessionFile;
      await agent.dispose();
      restored = new DesktopAgent(() => {});
      await restored.init({ ...config, thread: { ...config.thread, sessionFile } });
      assert.equal(restored.session.thinkingLevel, thinking);
      assert.equal(restored.history().filter((item) => item.role === 'assistant').length, 1);
      await restored.prompt('CONTINUE_PROMPT', []);
      assert.equal(received.length, 2);
      assert.ok(received[1].body.includes('PROTOCOL_ACCEPTANCE'));
      assert.equal(restored.history().filter((item) => item.role === 'assistant').length, 2);
    } finally {
      await restored?.dispose();
      await agent.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
