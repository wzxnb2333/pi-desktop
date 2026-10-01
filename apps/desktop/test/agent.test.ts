import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { mkdtemp } from './fixtures/node-temp.ts';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { providerSchema, settingsSchema, threadSchema } from '../src/shared/contracts.ts';
import type { WorkerConfig, WorkerEvent } from '../src/shared/worker-protocol.ts';
import { DesktopAgent } from '../src/worker/agent.ts';

test(
  'Pi runtime streams, approves tools, persists, restores, forks and compacts with a local fake provider',
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-desktop-runtime-'));
    const events: WorkerEvent[] = [];
    let requests = 0;
    let callTool = true;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { messages: { role: string }[] };
      requests++;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (delta: object, finish: string | null = null) =>
        response.write(
          `data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'fake-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      send({ role: 'assistant' });
      if (callTool && !body.messages.some((m) => m.role === 'tool')) {
        callTool = false;
        send({
          tool_calls: [
            {
              index: 0,
              id: 'write-test',
              type: 'function',
              function: {
                name: 'write',
                arguments: JSON.stringify({ path: 'created.txt', content: 'approved file' }),
              },
            },
          ],
        });
        send({}, 'tool_calls');
      } else {
        send({ content: '这是本地' });
        send({ content: '假供应商的回复。' });
        send({}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const provider = providerSchema.parse({
      id: 'fake',
      name: 'Fake',
      provider: 'desktop-test',
      model: 'fake-model',
      custom: true,
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      reasoning: false,
    });
    const config: WorkerConfig = {
      thread: threadSchema.parse({
        id: 'test',
        projectId: 'project',
        title: 'Test',
        cwd: root,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        providerId: 'fake',
        thinking: 'off',
        policy: 'ask',
      }),
      trusted: false,
      provider,
      apiKey: 'fake-key',
      settings: settingsSchema.parse({}),
      mcp: [],
      agentDir: join(root, '.agent'),
      testMode: true,
    };
    const agent = new DesktopAgent((event) => {
      events.push(event);
      if (event.type === 'approval') agent.answer(event.approval.id, true);
    });
    let restored: DesktopAgent | undefined;
    try {
      await agent.init(config);
      await agent.prompt('请创建文件，然后回复。', []);
      assert.equal(await readFile(join(root, 'created.txt'), 'utf8'), 'approved file');
      assert.ok(events.some((event) => event.type === 'approval' && event.approval.tool === 'write'));
      assert.ok(
        events.some(
          (event) =>
            event.type === 'item' &&
            event.item.role === 'assistant' &&
            event.item.state === 'running' &&
            event.item.text.includes('本地'),
        ),
      );
      assert.ok(agent.sessionFile);
      const originalFile = agent.sessionFile;
      const history = agent.history();
      assert.ok(history.some((item) => item.role === 'tool' && item.state === 'done'));
      await agent.dispose();
      restored = new DesktopAgent((event) => events.push(event));
      await restored.init({ ...config, thread: { ...config.thread, sessionFile: originalFile } });
      assert.equal(restored.history().length, history.length);
      await restored.fork();
      assert.notEqual(restored.sessionFile, originalFile);
      await restored.prompt('继续。', []);
      restored.session.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 30 } });
      await restored.compact();
      assert.ok(requests >= 4);
      assert.ok(events.some((event) => event.type === 'item' && event.item.text === '上下文已压缩'));
      // Preconditions of the notice merge in src/main/application.ts: notices exist only in the
      // main process copy of the timeline, so every history() payload the worker answers with is
      // notice-free and carries fresh ids. The merge has to carry the mid-turn ones over and put
      // them back by timestamp, which only works because ids never collide with session items.
      const notices = events.filter((event) => event.type === 'item' && event.item.role === 'notice');
      assert.ok(notices.length);
      const branch = restored.history();
      assert.ok(branch.length);
      assert.ok(!branch.some((item) => item.role === 'notice'));
      const branchIds = new Set(branch.map((item) => item.id));
      const stamps: number[] = [];
      for (const event of notices) {
        assert.equal(event.type, 'item');
        if (event.type !== 'item' || event.item.role !== 'notice') continue;
        assert.equal(branchIds.has(event.item.id), false);
        stamps.push(event.item.timestamp);
      }
      assert.deepEqual(stamps, [...stamps].sort((a, b) => a - b));
    } finally {
      await restored?.dispose();
      await agent.dispose();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);

for (const mode of ['reject', 'deny', 'plan'] as const) {
  test(`Pi does not mutate files in ${mode} mode`, { timeout: 15000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-denial-'));
    let offered = false;
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) {
        /* consume the prompt */
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const delta = offered
        ? { content: '操作未执行。' }
        : {
            tool_calls: [
              {
                index: 0,
                id: 'denied',
                type: 'function',
                function: {
                  name: 'write',
                  arguments: JSON.stringify({ path: 'forbidden.txt', content: 'should not exist' }),
                },
              },
            ],
          };
      const finish = offered ? 'stop' : 'tool_calls';
      offered = true;
      for (const chunk of [
        { delta, finish_reason: null },
        { delta: {}, finish_reason: finish },
      ])
        response.write(
          `data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'fake', choices: [{ index: 0, ...chunk }] })}\n\n`,
        );
      response.end('data: [DONE]\n\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    let approvals = 0;
    const agent = new DesktopAgent((event) => {
      if (event.type === 'approval') {
        approvals++;
        agent.answer(event.approval.id, false);
      }
    });
    try {
      await agent.init({
        thread: threadSchema.parse({
          id: mode,
          projectId: 'p',
          title: mode,
          cwd: root,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          providerId: 'fake',
          thinking: 'off',
          policy: mode === 'deny' ? 'deny' : 'ask',
          planMode: mode === 'plan',
        }),
        trusted: true,
        provider: providerSchema.parse({
          id: 'fake',
          name: 'fake',
          provider: `fake-${mode}`,
          model: 'fake',
          custom: true,
          reasoning: false,
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
        }),
        settings: settingsSchema.parse({}),
        mcp: [],
        agentDir: join(root, '.agent'),
        testMode: true,
        apiKey: 'fake',
      });
      await agent.prompt('写入文件。', []);
      assert.equal(
        await access(join(root, 'forbidden.txt')).then(
          () => true,
          () => false,
        ),
        false,
      );
      assert.equal(approvals, mode === 'reject' ? 1 : 0);
    } finally {
      await agent.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
