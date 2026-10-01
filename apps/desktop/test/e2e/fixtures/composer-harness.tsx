import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  type DesktopBridge,
  type DesktopData,
  type DesktopEvent,
  type DesktopRequest,
  dataSchema,
} from '../../../src/shared/contracts.ts';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { Composer } from '../../../src/renderer/src/components/composer/composer.tsx';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

/*
 * Test-only mount point for the composer, in the shape `primitives.spec.ts` established: a real browser
 * drives the real component instead of Electron driving the whole workbench.
 *
 * The composer reads everything through `useApp()`, so the only way to mount it is to mount the provider
 * too. That makes the fake `window.desktop` below the interesting part: it mirrors the main process,
 * including the echo (`thread.update` answers with a fresh `state` event, so a control that kept its own
 * copy of the value would still be caught) and the refusal to change runtime fields while a task runs
 * (`main/application.ts:365`).
 *
 * Query flags select a scenario: `?shortcut=ctrl-enter` and `?noprovider=1`.
 */
const params = new URLSearchParams(window.location.search);

/** What the fake bridge answered last, so the spec can assert the request actually left the renderer. */
const log = { update: 'none', send: 'none', context: '[]' };
let catalogRequests = 0;
const contextRequests: Array<(error?: string) => void> = [];
declare global {
  interface Window {
    __composerContext: { pending(): number; finish(error?: string): void; switchThread(id: string): void };
  }
}

let data: DesktopData = dataSchema.parse({
  version: 2,
  projects: [{ id: 'p1', name: 'pi', path: 'C:/work/pi', trusted: true, createdAt: 1 }],
  threads: [
    {
      id: 't1',
      projectId: 'p1',
      title: '测试任务',
      cwd: 'C:/work/pi',
      createdAt: 1,
      updatedAt: 1,
      providerId: params.has('noprovider') ? '' : 'fast',
      thinking: 'medium',
      policy: 'ask',
    },
  ],
  settings: {
    promptTemplates: [{ id: 'boundary', name: '边界检查', text: '检查边界与失败恢复' }],
    theme: params.get('theme') === 'dark' ? 'dark' : 'light',
    sendShortcut: params.get('shortcut') === 'ctrl-enter' ? 'ctrl-enter' : 'enter',
    providers: [
      { id: 'fast', name: '快速模型', provider: 'faux', model: 'fastr', hasKey: true },
      { id: 'deep', name: '深度模型特别长以便测试省略号', provider: 'faux', model: 'deep', hasKey: true },
    ],
  },
  automations: [],
  ui: { activeThreadId: 't1', locale: params.get('locale') === 'en-US' ? 'en-US' : 'zh-CN' },
});

const listeners = new Set<(event: DesktopEvent) => void>();
function publish() {
  for (const listener of listeners) listener({ type: 'state', data });
}
function withThread(id: string, patch: Partial<DesktopData['threads'][number]>) {
  data = { ...data, threads: data.threads.map((item) => (item.id === id ? { ...item, ...patch } : item)) };
}

const bridge: DesktopBridge = {
  async invoke(request: DesktopRequest): Promise<unknown> {
    switch (request.op) {
      case 'bootstrap':
        return { data, approvals: [], terminals: [], version: 'harness' };
      case 'thread.update': {
        const thread = data.threads.find((item) => item.id === request.id);
        if (!thread) throw new Error('任务不存在');
        const { op: _op, id: _id, ...patch } = request;
        const runtime =
          request.providerId !== undefined ||
          request.thinking !== undefined ||
          request.policy !== undefined ||
          request.planMode !== undefined;
        if (runtime && ['running', 'waiting'].includes(thread.status)) throw new Error('请停止任务后修改运行配置');
        if (request.providerId !== undefined) log.update = `providerId:${request.providerId}`;
        if (request.thinking !== undefined) log.update = `thinking:${request.thinking}`;
        if (request.policy !== undefined) log.update = `policy:${request.policy}`;
        if (request.planMode !== undefined) log.update = `planMode:${String(request.planMode)}`;
        withThread(request.id, patch);
        publish();
        return thread;
      }
      case 'thread.send': {
        log.send = request.queue ?? 'direct';
        log.context = JSON.stringify(request.context ?? []);
        withThread(request.id, { status: 'running' });
        publish();
        return { id: request.requestId ?? crypto.randomUUID(), fingerprint: JSON.stringify(request), at: Date.now(), status: 'accepted' };
      }
      case 'composer.preflight':
        return { issues: [], estimatedTokens: Math.ceil(request.payload.text.length / 2), contextWindow: 128000, images: 0 };
      case 'composer.contextDetail': {
        const detail = { reference: request.reference, content: 'Harness context for ' + request.reference.id, stale: false };
        if (!params.has('contextdelay')) return detail;
        return new Promise((resolve, reject) => contextRequests.push(error => error ? reject(new Error(error)) : resolve(detail)));
      }
      case 'attachment.inspect':
        return { path: request.path, name: request.path.split('/').at(-1), bytes: 100, kind: 'text', version: 'fixture', preview: 'Harness attachment', truncated: false };
      case 'composer.contextSearch': {
        const files = [{ kind: 'file', id: 'README.md', label: 'README.md' }, { kind: 'file', id: 'src/main.ts', label: 'main.ts' }, { kind: 'folder', id: 'src', label: 'src' }];
        return { matches: files.filter(file => file.id.toLowerCase().includes(request.query.toLowerCase())).map(file => ({ ...file, directoryId: 'p1', description: file.id })), limited: false, unreadable: 0 };
      }
      case 'thread.stop':
        withThread(request.id, { status: 'idle' });
        publish();
        return null;
      case 'attachment.pick':
        return ['/work/notes.txt', '/work/diagram.png'];
      case 'ui.threadPatch':
        data = { ...data, ui: applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }) };
        publish();
        return data.ui;
      case 'ui.update':
        data = { ...data, ui: request.ui };
        publish();
        return data.ui;
      case 'input.catalog': {
        // StrictMode mounts effects twice; both initial requests fail before the explicit retry.
        if (params.has('catalogerror') && catalogRequests++ < 1) throw new Error('CATALOG_RETRY_PROOF');
        const running = data.threads[0].status === 'running';
        return { commands: [{ id: 'plan', enabled: !running }, { id: 'compact', enabled: !running }, { id: 'stop', enabled: running }, { id: 'skills', enabled: true }], references: [
          { kind: 'skill', id: 'design', label: 'UI Design', description: '界面设计与布局' },
          { kind: 'skill', id: 'review', label: 'Code Review', description: '代码审查' },
          { kind: 'tool', id: 'test/read', label: 'read_file', description: '读取项目文件' },
        ] };
      }
      case 'file.list':
        return request.path === 'src' ? [{ name: 'main.ts', path: 'src/main.ts', directory: false }] : [{ name: 'README.md', path: 'README.md', directory: false }, { name: 'src', path: 'src', directory: true }];
      default:
        return null;
    }
  },
  onEvent(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  },
};

window.desktop = bridge;
window.__composerContext = {
  pending: () => contextRequests.length,
  finish(error) {
    const complete = contextRequests.shift();
    if (!complete) throw new Error('No context request is waiting');
    complete(error);
  },
  switchThread(id) {
    if (!data.threads.some(thread => thread.id === id)) data = { ...data, threads: [...data.threads, { ...data.threads[0], id, title: id, status: 'idle' }] };
    data = { ...data, ui: { ...data.ui, activeThreadId: id } };
    publish();
  },
};

/** The provider's own view of the task, so the spec asserts on the echo rather than on local state. */
function Probe() {
  const { running, threadUi } = useApp();
  return (
    <>
      <p data-testid="status">{running ? 'running' : 'idle'}</p>
      <p data-testid="last-update">{log.update}</p>
      <p data-testid="last-send">{log.send}</p>
      <p data-testid="last-context">{log.context}</p>
      <p data-testid="context-references">{JSON.stringify(threadUi.contextReferences ?? [])}</p>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      {/*
       * In the app the composer is the last row of a flex column and sits against the bottom of the
       * window, which is what makes its menus have to open upward. The spacer reproduces that so the
       * geometry assertion in the spec is about the popover, not about a page with no room below.
       */}
      <div style={{ height: '60vh' }} />
      <Composer home={params.has('home')} />
      <Probe />
    </AppProvider>
  </StrictMode>,
);
