import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mkdtemp } from './fixtures/node-temp.ts';
import { evaluateAction, resolveAgentFile } from '../src/main/policy.ts';
import { modelProviderSchema, providerModelSchema, settingsSchema, threadSchema, type Policy } from '../src/shared/contracts.ts';
import { DesktopAgent } from '../src/worker/agent.ts';
import { JsonStore } from '../src/main/store.ts';

test('permission modes persist and read-only constraints always win', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-policy-'));
  const store = new JsonStore(root); await store.load();
  for (const mode of ['ask', 'auto', 'full'] as const) {
    store.data.settings.policy = mode; await store.save();
    const reopened = new JsonStore(root); await reopened.load(); assert.equal(reopened.data.settings.policy, mode);
    assert.equal(evaluateAction(mode, true, 'powershell'), 'deny');
    assert.equal(evaluateAction(mode, false, 'read'), 'allow');
    assert.equal(evaluateAction(mode, false, 'powershell'), mode === 'ask' ? 'ask' : mode === 'auto' ? 'review' : 'allow');
  }
  assert.equal(evaluateAction('deny', false, 'write'), 'deny');
  await assert.rejects(resolveAgentFile(root, '../outside.txt'));
  assert.equal(await resolveAgentFile(root, '../outside.txt', [], true), join(root, '..', 'outside.txt'));
});

for (const mode of ['ask', 'auto', 'full', 'reject'] as const) {
  test('real agent gates file tools in ' + mode + ' mode', { timeout: 15000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-policy-agent-'));
    const project = join(root, 'project'); await mkdir(project);
    const outside = join(root, 'outside.txt'); await writeFile(outside, 'original');
    let offered = false, reviews = 0;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { messages: { role: string; content: string }[]; tools?: unknown[] };
      const reviewing = body.messages.some(message => message.role === 'system' && message.content.includes('independent permission reviewer'));
      if (reviewing) { reviews++; assert.equal(body.tools, undefined); }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const delta = reviewing ? { content: JSON.stringify({ risk: 'low', reason: 'Bounded fixture write' }) } : offered ? { content: 'completed' } : { tool_calls: [{ index: 0, id: 'permission-probe', type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: mode === 'full' ? outside : 'allowed.txt', content: mode }) } }] };
      response.write('data: ' + JSON.stringify({ id: 'faux', object: 'chat.completion.chunk', created: 1, model: 'faux', choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
      response.write('data: ' + JSON.stringify({ id: 'faux', object: 'chat.completion.chunk', created: 1, model: 'faux', choices: [{ index: 0, delta: {}, finish_reason: offered ? 'stop' : 'tool_calls' }] }) + '\n\ndata: [DONE]\n\n');
      offered = true; response.end();
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    let approvals = 0;
    const agent = new DesktopAgent(event => { if (event.type === 'approval') { approvals++; agent.answer(event.approval.id, mode !== 'reject'); } });
    try {
      await agent.init({ agentDir: join(root, 'private'), trusted: false, testMode: true, mcp: [], apiKey: 'faux',
        thread: threadSchema.parse({ id: mode, projectId: 'p', title: mode, cwd: project, createdAt: 1, updatedAt: 1, modelId: 'faux', thinking: 'off', policy: (mode === 'reject' ? 'ask' : mode) satisfies Policy }),
        model: providerModelSchema.parse({ id: 'faux', provider: 'faux-provider', name: 'faux', model: 'faux', reasoning: false }),
        modelProvider: modelProviderSchema.parse({ id: 'faux-provider', name: 'faux', kind: 'custom', namespace: 'desktop-faux-provider', baseUrl: 'http://127.0.0.1:' + address.port + '/v1' }), settings: settingsSchema.parse({}) });
      await agent.prompt('permission probe', []);
      assert.equal(approvals, mode === 'ask' || mode === 'reject' ? 1 : 0);
      assert.equal(reviews, mode === 'auto' ? 1 : 0);
      if (mode === 'reject') await assert.rejects(readFile(join(project, 'allowed.txt')));
      else assert.equal(await readFile(mode === 'full' ? outside : join(project, 'allowed.txt'), 'utf8'), mode);
      if (mode !== 'full') assert.equal(await readFile(outside, 'utf8'), 'original');
    } finally { await agent.dispose(); await new Promise<void>(done => server.close(() => done())); }
  });
}

test('auto approval never silently starts host extensions and a separate consent controls loading', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-policy-extension-'));
  const project = join(root, 'project'); await mkdir(project);
  const marker = join(root, 'host-extension.txt');
  const extension = join(root, 'extension.ts');
  await writeFile(extension, "import { writeFileSync } from 'node:fs'; export default function () { writeFileSync(" + JSON.stringify(marker) + ", 'authorized'); }");
  for (const approved of [false, true]) {
    let confirmations = 0;
    const agent = new DesktopAgent(event => {
      if (event.type !== 'approval') return;
      confirmations++;
      assert.equal(event.approval.scope, 'external-tools');
      assert.equal(event.approval.description, extension);
      agent.answer(event.approval.id, approved);
    });
    try {
      await agent.init({ agentDir: join(root, 'private'), trusted: true, testMode: true, mcp: [], apiKey: 'faux',
        thread: threadSchema.parse({ id: String(approved), projectId: 'p', title: 'extension', cwd: project, createdAt: 1, updatedAt: 1, modelId: 'faux', thinking: 'off', policy: 'auto' }),
        model: providerModelSchema.parse({ id: 'faux', provider: 'faux-provider', name: 'faux', model: 'faux', reasoning: false }),
        modelProvider: modelProviderSchema.parse({ id: 'faux-provider', name: 'faux', kind: 'custom', namespace: 'desktop-faux-provider', baseUrl: 'http://127.0.0.1:1/v1' }),
        settings: settingsSchema.parse({ resources: [{ id: 'test', name: 'test', path: extension, kind: 'extension', enabled: true }] }) });
      assert.equal(confirmations, 1);
      if (approved) assert.equal(await readFile(marker, 'utf8'), 'authorized');
      else await assert.rejects(readFile(marker));
    } finally { await agent.dispose(); }
  }
});
