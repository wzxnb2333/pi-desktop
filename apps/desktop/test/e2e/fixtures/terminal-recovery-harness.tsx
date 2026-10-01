import { createRoot } from 'react-dom/client';
import { App } from '../../../src/renderer/src/App.tsx';
import { dataSchema, type DesktopBridge, type DesktopEvent, type DesktopRequest, type TerminalInfo } from '../../../src/shared/contracts.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

type Action = 'terminal.open' | 'terminal.rename' | 'terminal.close';
declare global {
  interface Window {
    terminalRecovery: {
      calls: DesktopRequest[];
      terminals: TerminalInfo[];
      hold: Action[];
      release(op: Action, error?: string): void;
      select(id: string): void;
      show(open: boolean): void;
      locale(locale: 'zh-CN' | 'en-US'): void;
      projectAction(): void;
    };
  }
}
const params = new URLSearchParams(location.search);
let data = dataSchema.parse({
  version: 3, automations: [],
  projects: [{ id: 'p', name: '终端恢复测试', path: 'C:/test/project', trusted: true, createdAt: 1 }],
  threads: ['t1', 't2'].map(id => ({ id, projectId: 'p', title: id === 't1' ? '当前任务' : '另一个任务', cwd: 'C:/test/project', createdAt: 1, updatedAt: 1, modelId: 'fake', thinking: 'off', policy: 'ask' })),
  settings: { theme: params.get('theme') || 'light', modelId: 'fake',
    modelProviders: [{ id: 'fake-provider', name: '本地测试', kind: 'builtin', namespace: 'faux', baseUrl: '', api: 'openai-completions', hasKey: false }],
    models: [{ id: 'fake', provider: 'fake-provider', name: '本地测试', model: 'fake', reasoning: false, contextWindow: 128000, maxTokens: 8192 }] },
  ui: { locale: params.get('locale') || 'zh-CN', activeThreadId: 't1', sidebarWidth: 240, reviewOpen: true, reviewWidth: 440, summaryOpen: false,
    threads: { t1: { reviewTab: 'terminal' }, t2: { reviewTab: 'terminal' } } },
});
const listeners = new Set<(event: DesktopEvent) => void>();
const emit = (event: DesktopEvent) => { for (const listener of listeners) listener(event); };
const pending: { op: Action; finish(error?: string): void }[] = [];
let created = 0;
window.terminalRecovery = {
  calls: [], hold: [],
  terminals: ['t1', 't2'].map(id => ({ id: 'pty-' + id, threadId: id, title: id === 't1' ? '第一个终端' : '第二个终端', output: id + '\r\n', exited: false })),
  release(op, error) { const index = pending.findIndex(item => item.op === op); if (index >= 0) pending.splice(index, 1)[0].finish(error); },
  select(id) { data = { ...data, ui: { ...data.ui, activeThreadId: id, reviewOpen: true } }; emit({ type: 'state', data }); },
  show(open) { data = { ...data, ui: { ...data.ui, reviewOpen: open } }; emit({ type: 'state', data }); },
  locale(locale) { data = { ...data, ui: { ...data.ui, locale } }; emit({ type: 'state', data }); },
  projectAction() {
    const terminal = { id: 'action-terminal', threadId: 't1', operationId: 'project-action', title: '项目动作', output: '', exited: false };
    this.terminals.push(terminal); emit({ type: 'terminal.created', terminal });
  },
};
const bridge: DesktopBridge = {
  async invoke(request) {
    const state = window.terminalRecovery;
    switch (request.op) {
      case 'bootstrap': return { data, approvals: [], terminals: structuredClone(state.terminals), version: 'terminal-recovery' };
      case 'ui.update': data = { ...data, ui: applyUiPatch(data.ui, { frame: request.ui }) }; emit({ type: 'state', data }); return data.ui;
      case 'ui.threadPatch': data = { ...data, ui: applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }) }; emit({ type: 'state', data }); return data.ui;
      case 'terminal.open': case 'terminal.rename': case 'terminal.close': {
        state.calls.push(request);
        if (state.hold.includes(request.op)) await new Promise<void>((resolve, reject) => pending.push({ op: request.op, finish: error => error ? reject(new Error(error)) : resolve() }));
        if (request.op === 'terminal.open') {
          const info: TerminalInfo = { id: 'created-' + (++created), threadId: request.threadId, title: 'PowerShell', exited: false, output: '' };
          state.terminals.push(info); emit({ type: 'terminal.created', terminal: structuredClone(info) }); return structuredClone(info);
        }
        const terminal = state.terminals.find(item => item.id === request.id);
        if (!terminal) throw new Error('终端不存在');
        if (request.op === 'terminal.rename') { terminal.title = request.title; return structuredClone(terminal); }
        terminal.exited = true; emit({ type: 'terminal', id: terminal.id, threadId: terminal.threadId, data: '[进程已退出：0]', exited: true }); return null;
      }
      case 'git.status': return { available: true, branch: 'main', files: [] };
      case 'git.inspect': return { branches: ['main'], remoteBranches: [], remotes: [], upstream: '', operation: '', commits: [], worktrees: [] };
      default: return null;
    }
  },
  onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
};
window.desktop = bridge;
createRoot(document.getElementById('root')!).render(<App />);
