import { createRoot } from 'react-dom/client';
import { App } from '../../../src/renderer/src/App.tsx';
import { dataSchema, type DesktopBridge, type DesktopEvent, type DesktopRequest } from '../../../src/shared/contracts.ts';
import { projectEnvironmentSchema, type ProjectEnvironment } from '../../../src/shared/project-environment.ts';
import { operationSchema, type OperationRecord } from '../../../src/shared/operations.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

type Action = 'project.environment' | 'project.action' | 'operation.cancel';
declare global {
  interface Window {
    projectActionRecovery: {
      calls: DesktopRequest[]; hold: Action[];
      release(op: Action, error?: string): void;
      select(id: string): void; directory(id: string): void;
      locale(locale: 'zh-CN' | 'en-US'): void;
      environment(next: ProjectEnvironment): void;
      records(items: OperationRecord[]): void;
    };
  }
}
let data = dataSchema.parse({
  version: 3, automations: [],
  projects: [
    { id: 'p', name: '项目动作测试', path: 'C:/project', trusted: true, createdAt: 1,
      directories: [{ id: 'extra', name: '附加目录', path: 'C:/extra', trusted: true }],
      environment: projectEnvironmentSchema.parse({ actions: [{ id: 'check', name: '检查', command: 'echo ORIGINAL' }] }) },
    { id: 'other', name: '其他项目', path: 'C:/other', trusted: true, createdAt: 1 },
  ],
  threads: ['t1', 't2', 't3'].map(id => ({ id, projectId: id === 't3' ? 'other' : 'p', title: id, cwd: id === 't3' ? 'C:/other' : 'C:/project', createdAt: 1, updatedAt: 1, modelId: 'fake', thinking: 'off', policy: 'ask' })),
  settings: { theme: 'light', modelId: 'fake',
    modelProviders: [{ id: 'fake-provider', name: '本地测试', kind: 'builtin', namespace: 'faux', baseUrl: '', api: 'openai-completions', hasKey: false }],
    models: [{ id: 'fake', provider: 'fake-provider', name: '本地测试', model: 'fake', reasoning: false, contextWindow: 128000, maxTokens: 8192 }] },
  ui: { locale: 'zh-CN', activeThreadId: 't1', sidebarWidth: 240, reviewOpen: false, summaryOpen: false },
});
const listeners = new Set<(event: DesktopEvent) => void>();
const changed = () => { for (const listener of listeners) listener({ type: 'state', data: structuredClone(data) }); };
const pending: { op: Action; finish(error?: string): void }[] = [];
window.projectActionRecovery = {
  calls: [], hold: [],
  release(op, error) { const index = pending.findIndex(item => item.op === op); if (index >= 0) pending.splice(index, 1)[0].finish(error); },
  select(id) { data.ui.activeThreadId = id; changed(); },
  directory(id) { data.ui = applyUiPatch(data.ui, { threadId: data.ui.activeThreadId, thread: { directoryId: id } }); changed(); },
  locale(locale) { data.ui.locale = locale; changed(); },
  environment(next) { data.projects[0].environment = projectEnvironmentSchema.parse(next); changed(); },
  records(items) { data.operations = operationSchema.array().parse(items); changed(); },
};
const bridge: DesktopBridge = {
  async invoke(request) {
    const state = window.projectActionRecovery;
    switch (request.op) {
      case 'bootstrap': return { data: structuredClone(data), approvals: [], terminals: [], version: 'project-actions' };
      case 'ui.update': data.ui = applyUiPatch(data.ui, { frame: request.ui }); changed(); return structuredClone(data.ui);
      case 'ui.threadPatch': data.ui = applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }); changed(); return structuredClone(data.ui);
      case 'project.environment': case 'project.action': case 'operation.cancel': {
        state.calls.push(request);
        if (state.hold.includes(request.op)) await new Promise<void>((resolve, reject) => pending.push({ op: request.op, finish: error => error ? reject(new Error(error)) : resolve() }));
        if (request.op === 'project.environment') {
          const project = data.projects.find(item => item.id === request.projectId)!;
          project.environment = structuredClone(request.environment); changed(); return project;
        }
        if (request.op === 'project.action') {
          const record = operationSchema.parse({ id: request.requestId, threadId: request.threadId, directoryId: request.directoryId ?? 'p', kind: 'environment.' + request.kind + (request.actionId ? '.' + request.actionId : ''), status: 'running', stage: '正在运行项目动作', startedAt: Date.now() });
          data.operations.push(record); changed(); return structuredClone(record);
        }
        const record = data.operations.find(item => item.id === request.requestId)!;
        record.stage = '正在取消操作'; changed(); return null;
      }
      case 'git.status': return { available: true, branch: 'main', files: [] };
      case 'git.inspect': return { branches: ['main'], remoteBranches: [], remotes: [], upstream: '', operation: '', commits: [], worktrees: [] };
      default: return null;
    }
  },
  onEvent(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
};
window.desktop = bridge;
createRoot(document.getElementById('root')!).render(<App />);
