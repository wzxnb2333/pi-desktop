import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../../src/renderer/src/App.tsx';
import { dataSchema, threadSchema, type DesktopBridge, type DesktopEvent, type DesktopRequest, type UiState } from '../../../src/shared/contracts.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import { applySettingsPatch } from '../../../src/shared/settings-updates.ts';
import '../../../src/renderer/src/styles/index.css';

declare global {
  interface Window {
    formNavigationTest: {
      requests: DesktopRequest[];
      holdSave: boolean;
      ui(): UiState;
      finish(error?: string): void;
    };
  }
}
const params = new URLSearchParams(location.search);
let data = dataSchema.parse({
  version: 2,
  projects: [{ id: 'p', name: '表单测试', path: 'C:/test/forms', trusted: true, createdAt: 1 }, { id: 'p2', name: '另一个项目', path: 'C:/test/other', trusted: true, createdAt: 1 }],
  threads: [{ id: 't', projectId: 'p', title: '已有任务', cwd: 'C:/test/forms', providerId: 'local', thinking: 'off', policy: 'ask', createdAt: 1, updatedAt: 1 }],
  automations: [],
  settings: { theme: params.get('theme') || 'light', providers: [{ id: 'local', name: '本地模型', provider: 'openai', model: 'gpt-4.1' }], mcpServers: [{ id: 'm', name: 'MCP fixture', transport: 'stdio', command: 'node', enabled: true }] },
  ui: { locale: params.get('locale') || 'zh-CN', view: params.get('view') || 'settings', activeThreadId: 't', summaryOpen: false, reviewOpen: false, sidebarWidth: 240 },
});
let complete: ((error?: string) => void) | undefined;
window.formNavigationTest = { requests: [], holdSave: false, ui: () => data.ui, finish: error => { const next = complete; complete = undefined; next?.(error); } };
const listeners = new Set<(event: DesktopEvent) => void>();
const emit = () => { for (const listener of listeners) listener({ type: 'state', data }); };
const bridge: DesktopBridge = {
  async invoke(request) {
    window.formNavigationTest.requests.push(request);
    if (window.formNavigationTest.holdSave && ['settings.save', 'settings.patch', 'automation.save', 'resource.create'].includes(request.op)) {
      await new Promise<void>((resolve, reject) => { complete = error => error ? reject(new Error(error)) : resolve(); });
    }
    switch (request.op) {
      case 'bootstrap': return { data, approvals: [], terminals: [], version: 'form-navigation' };
      case 'ui.update': data = { ...data, ui: applyUiPatch(data.ui, { frame: request.ui }) }; emit(); return data.ui;
      case 'ui.threadPatch': data = { ...data, ui: applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }) }; emit(); return data.ui;
      case 'models.catalog': return [{ id: 'openai', models: [{ id: 'gpt-4.1', name: 'GPT 4.1', api: 'openai-responses', reasoning: false, thinkingLevels: ['off'], contextWindow: 128000, maxTokens: 8192 }] }];
      case 'memory.list': return { revision: 0, entries: [] };
      case 'voice.status': return { directory: 'C:/test/offline-models', models: [] };
      case 'settings.save': data = { ...data, settings: structuredClone(request.settings) }; emit(); return null;
      case 'settings.patch': data = { ...data, settings: applySettingsPatch(data.settings, request.patch, request.base) }; emit(); return data.settings;
      case 'automation.save': data = { ...data, automations: [...data.automations.filter(job => job.id !== request.automation.id), request.automation] }; emit(); return null;
      case 'thread.create': {
        const created = threadSchema.parse({ id: 'created-' + data.threads.length, title: '新建测试任务', projectId: request.projectId, cwd: 'C:/test/forms', createdAt: 1, updatedAt: 1, providerId: 'local', thinking: 'off', policy: 'ask' });
        data = { ...data, threads: [...data.threads, created] }; emit(); return created;
      }
      case 'resource.inspect': return { checkedAt: 1, diagnostics: [], directory: 'C:/test/skills', descriptions: {} };
      case 'git.status': return { available: true, branch: 'main', files: [] };
      case 'git.inspect': return { branches: ['main'], remoteBranches: [], remotes: [], upstream: '', operation: '', commits: [], worktrees: [] };
      default: return null;
    }
  },
  onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
};
window.desktop = bridge;
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
