import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { providerSchema } from '../src/shared/contracts.ts';
import { generateMemories } from '../src/main/memory-generation.ts';

test('memory extraction uses an isolated protocol request and rejects incomplete or tool-bearing output', async () => {
  const requests: { messages: { role: string; content: string }[]; tools?: unknown }[] = [];
  const expected = { memories: [{ text: 'Use local tests', messageIds: ['u1'] }] };
  let finish = 'stop', tool = false;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString())); response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta: object, finish_reason: string | null) => response.write('data: ' + JSON.stringify({ id: 'memory', object: 'chat.completion.chunk', created: 1, model: 'memory', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
    send({ content: JSON.stringify(expected) }, null);
    if (tool) send({ tool_calls: [{ index: 0, id: 'unexpected-tool', type: 'function', function: { name: 'write', arguments: '{}' } }] }, null);
    send({}, finish); response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const provider = providerSchema.parse({ id: 'memory', name: 'Memory', provider: 'memory', model: 'memory', custom: true, reasoning: false, baseUrl: 'http://127.0.0.1:' + address.port + '/v1' });
  const input = { threadId: 't', fingerprint: 'h', messages: [{ id: 'u1', text: 'Use local tests' }] };
  try {
    assert.deepEqual(await generateMemories(provider, undefined, input, new AbortController().signal), expected);
    assert.equal(requests[0].tools, undefined); assert.deepEqual(requests[0].messages.map(message => message.role), ['system', 'user']); assert.deepEqual(JSON.parse(requests[0].messages[1].content), input.messages);
    finish = 'length'; await assert.rejects(generateMemories(provider, undefined, input, new AbortController().signal), /有效记忆/);
    finish = 'stop'; tool = true; await assert.rejects(generateMemories(provider, undefined, input, new AbortController().signal), /有效记忆/);
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
