import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { type Bootstrap, type DesktopRequest, defaultData, modelProviderSchema, providerModelSchema, threadSchema } from '../../../src/shared/contracts.ts';

export interface CapturedPrompt {
  model?: string;
  messages: { role: string; content: unknown }[];
  reasoning_effort?: string;
  tools?: { function: { name: string } }[];
}

/** All provider requests terminate on loopback; no account credentials are used. */
export async function acceptanceApp(rendererUrl: string, options: { args?: string[]; authorizeExternalTools?: boolean } = {}) {
  const storage = await mkdtemp(join(tmpdir(), 'pi-acceptance-'));
  let server: Server | undefined;
  let application: ElectronApplication;
  const held = new Set<ServerResponse>();
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      const failures: unknown[] = [];
      for (const response of held) response.destroy();
      held.clear();
      try {
        await application?.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
        await application?.close();
      } catch (error) { failures.push(error); }
      try {
        if (server) {
          server.closeAllConnections();
          if (server.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
        }
      } catch (error) { failures.push(error); }
      try {
        // Chromium can release Windows file handles shortly after its process exits.
        await rm(storage, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
      } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, 'Acceptance cleanup failed: ' + storage);
    })();
    return closing;
  };
  try {
    const project = join(storage, 'project');
    const home = join(storage, 'home');
    await mkdir(project);
    await mkdir(home);
    execFileSync('git', ['init', '-b', 'main', project]);
    execFileSync('git', ['-C', project, 'config', 'core.autocrlf', 'false']);
    execFileSync('git', ['-C', project, 'config', 'user.name', 'Acceptance Test']);
    execFileSync('git', ['-C', project, 'config', 'user.email', 'test@example.invalid']);
    await writeFile(join(project, 'README.md'), '# Acceptance\n');
    execFileSync('git', ['-C', project, 'add', '--', 'README.md']);
    execFileSync('git', ['-C', project, 'commit', '-m', 'initial']);
    const calls: CapturedPrompt[] = [];
    const reviews: CapturedPrompt[] = [];
    let reviewMode: 'low' | 'high' | 'uncertain' | 'invalid' | 'fail' | 'hold' = 'low';
    const heldReviews = new Set<ServerResponse>();
    const authorizations: (string | undefined)[] = [];
    let mode: 'reply' | 'hold' | 'fail' = 'reply';
    let holdUserText: string | undefined;
    let nextTool: { name: string; args: Record<string, unknown> } | undefined;
    const scopedTools: { name: string; args: Record<string, unknown>; userText: string }[] = [];
    let reasoning = false;
    let reply = '验收回复完成。';
    const send = (response: ServerResponse, delta: object, finish: string | null = null) =>
      response.write('data: ' + JSON.stringify({ id: 'acceptance', object: 'chat.completion.chunk', created: 1, model: 'acceptance', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
    const finish = (response: ServerResponse) => {
      if (response.destroyed || response.writableEnded) return;
      send(response, { content: reply });
      send(response, {}, 'stop');
      response.end('data: [DONE]\n\n');
    };
    server = createServer(async (request, response) => {
      if (request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<title>Acceptance preview</title><p>本地预览</p>');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const captured = JSON.parse(Buffer.concat(chunks).toString()) as CapturedPrompt;
      if (captured.messages.some(message => message.role === 'system' && typeof message.content === 'string' && message.content.includes('independent permission reviewer'))) {
        reviews.push(captured);
        if (reviewMode === 'fail') { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'REVIEW_FIXTURE_ERROR' } })); return; }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (reviewMode === 'hold') { heldReviews.add(response); response.on('close', () => heldReviews.delete(response)); return; }
        send(response, { content: reviewMode === 'invalid' ? 'not a verdict' : JSON.stringify({ risk: reviewMode, reason: reviewMode === 'high' ? '此操作可能删除现有文件。' : reviewMode === 'uncertain' ? '无法确认脚本的实际作用。' : 'Bounded local fixture operation' }) });
        send(response, {}, 'stop'); response.end('data: [DONE]\n\n'); return;
      }
      calls.push(captured);
      authorizations.push(request.headers.authorization);
      if (mode === 'fail') {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'ACCEPTANCE_PROVIDER_ERROR', type: 'invalid_request_error' } }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (reasoning) send(response, { reasoning_content: '先读取实际文件，再验证修改。' });
      send(response, { role: 'assistant', content: '验收流式内容。' });
      const scopedIndex = scopedTools.findIndex(tool => captured.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes(tool.userText)));
      if (nextTool || scopedIndex >= 0) {
        const tool = nextTool ?? scopedTools.splice(scopedIndex, 1)[0];
        nextTool = undefined;
        send(response, { tool_calls: [{ index: 0, id: 'acceptance-tool-' + calls.length, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] });
        send(response, {}, 'tool_calls');
        response.end('data: [DONE]\n\n');
        return;
      }
      if (mode === 'hold' || holdUserText && captured.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes(holdUserText!))) {
        held.add(response);
        response.on('close', () => held.delete(response));
      } else finish(response);
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No acceptance server');
    const url = 'http://127.0.0.1:' + address.port;
    const data = defaultData();
    data.projects.push({ id: 'p', name: '验收项目', path: project, trusted: true, createdAt: 1 });
    data.settings.modelProviders.push(modelProviderSchema.parse({ id: 'local-provider', name: '验收模型', kind: 'custom', namespace: 'desktop-local-provider', baseUrl: url + '/v1' }));
    data.settings.models.push(providerModelSchema.parse({ id: 'local', provider: 'local-provider', name: '验收模型', model: 'acceptance', reasoning: false }));
    data.settings.modelId = 'local';
    data.settings.keepInTray = false;
    data.settings.editor = 'system';
    data.settings.thinking = 'off';
    data.settings.theme = 'light';
    data.settings.shortcuts = { quickChat: '' };
    data.threads.push(threadSchema.parse({ id: 't', projectId: 'p', title: '验收任务', cwd: project, createdAt: 1, updatedAt: 1, modelId: 'local', thinking: 'off', policy: 'auto' }));
    data.ui.activeThreadId = 't';
    await writeFile(join(storage, 'desktop.json'), JSON.stringify(data));
    const env = { ...process.env, HOME: home, USERPROFILE: home, PI_DESKTOP_USER_DATA: storage, ELECTRON_RENDERER_URL: rendererUrl } as Record<string, string>;
    delete env.ELECTRON_RUN_AS_NODE;
    let page: Page;
    const errors: string[] = [];
    const start = async () => {
      application = await electron.launch({ args: [resolve('out/main/index.js'), ...(options.args ?? [])], env });
      const observed = new WeakSet<Page>();
      const observe = (target: Page) => { if (!observed.has(target)) { observed.add(target); target.on('pageerror', error => errors.push(error.message)); } };
      application.on('window', observe);
      application.windows().forEach(observe);
      page = await application.firstWindow();
      observe(page);
      await page.locator('.desktop').waitFor();
      // Integration tests may explicitly consent to their own local fixtures. Product approvals
      // still travel through real IPC; file/command approvals are never answered by this helper.
      if (options.authorizeExternalTools) await page.evaluate(() => {
        const answered = new Set<string>();
        window.desktop.onEvent(event => {
          if (event.type !== 'approvals') return;
          for (const approval of event.approvals) {
            if (approval.scope !== 'external-tools' || answered.has(approval.id)) continue;
            answered.add(approval.id);
            void window.desktop.invoke({ op: 'approval.reply', id: approval.id, approved: true });
          }
        });
      });
    };
    await start();
    return {
      storage, project, home, url, calls, reviews, authorizations, errors,
      setReview(next: typeof reviewMode) { reviewMode = next; },
      releaseReviews() { for (const response of heldReviews) { send(response, { content: '{"risk":"low","reason":"late fixture approval"}' }); send(response, {}, 'stop'); response.end('data: [DONE]\n\n'); } heldReviews.clear(); },
      get app() { return application; },
      get page() { return page; },
      setMode(next: typeof mode) { mode = next; },
      holdFor(userText: string) { holdUserText = userText; },
      requestTool(name: string, args: Record<string, unknown>) { nextTool = { name, args }; },
      requestScopedTool(name: string, args: Record<string, unknown>, userText: string) { scopedTools.push({ name, args, userText }); },
      setReasoning(value: boolean) { reasoning = value; },
      setReply(value: string) { reply = value; },
      releaseTool(name: string, args: Record<string, unknown>) {
        const responses = [...held];
        held.clear();
        for (const response of responses) {
          send(response, { tool_calls: [{ index: 0, id: 'acceptance-tool-' + calls.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
          send(response, {}, 'tool_calls');
          response.end('data: [DONE]\n\n');
        }
      },
      release() { mode = 'reply'; holdUserText = undefined; for (const response of held) finish(response); held.clear(); },
      async invoke(request: DesktopRequest): Promise<unknown> { return page.evaluate((request) => window.desktop.invoke(request), request); },
      async snapshot(): Promise<Bootstrap> { return page.evaluate(async () => await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap); },
      async restart() { await application.close(); await start(); },
      close,
    };
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Acceptance startup and cleanup failed'); }
    throw error;
  }
}
