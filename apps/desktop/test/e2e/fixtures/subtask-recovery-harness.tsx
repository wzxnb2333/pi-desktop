import { createRoot } from 'react-dom/client';
import { App } from '../../../src/renderer/src/App.tsx';
import { dataSchema, type DesktopBridge, type DesktopData, type DesktopEvent, type DesktopRequest } from '../../../src/shared/contracts.ts';
import type { Subtask } from '../../../src/shared/subtasks.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

declare global { interface Window { subtaskRecovery: {
  calls: DesktopRequest[]; snapshot(): DesktopData;
  locale(value: 'zh-CN' | 'en-US'): void; selectThread(id: string): void;
  update(index: number, status: Subtask['status'], text?: string): void;
  question(index: number, answer?: string): void;
}; } }
const params = new URLSearchParams(location.search);
const children = ['Agent A', 'Agent B', 'Queued agent', 'Finished agent'];
const ids = children.map(() => crypto.randomUUID());
const thread = { projectId: 'p', cwd: 'C:/project', createdAt: 1, updatedAt: 1, modelId: '', thinking: 'off', policy: 'deny' };
const data = dataSchema.parse({ version: 3, projects: [{ id: 'p', name: 'Observer project', path: 'C:/project', trusted: true, createdAt: 1 }], automations: [],
  threads: [
    { ...thread, id: 't', title: 'Main agent', items: [
      { id: 'u', role: 'user', text: 'Delegate inspection', timestamp: 1, state: 'done' },
      ...(params.has('history') ? [] : children.map((title, index) => ({ id: 'create' + index, role: 'tool', toolName: 'manage_subtasks', args: JSON.stringify({ action: 'subtasks.create', definition: { title } }), text: JSON.stringify({ id: ids[index] }), timestamp: 2 + index, state: 'done' }))),
      { id: 'a', role: 'assistant', text: 'Created the inspection agents.', timestamp: 10, state: 'done', stopReason: 'stop' },
    ] },
    { ...thread, id: 'other', title: 'Other parent' },
    ...children.map((title, index) => ({ ...thread, id: 'child' + index, title, subtaskId: ids[index], status: index < 2 ? 'running' : 'idle', items: [{ id: 'a' + index, role: 'assistant', text: title + ' output', timestamp: 3, state: index < 2 ? 'running' : 'done' }] })),
  ],
  subtasks: children.map((title, index) => ({ id: ids[index], parentThreadId: 't', parentItemId: params.has('history') ? undefined : 'u', childThreadId: 'child' + index, definition: { title, prompt: 'Read only: ' + title, environment: 'local', policy: 'deny' }, context: '', status: index < 2 ? 'running' : index === 2 ? 'queued' : 'succeeded', stage: '', createdAt: 2, result: index === 3 ? 'Verified result' : undefined })),
  settings: { subtasksEnabled: true, theme: params.get('theme') || 'light' }, ui: { locale: params.get('locale') || 'zh-CN', activeThreadId: params.get('legacy') ? 'child0' : 't', summaryOpen: true, reviewOpen: false, threads: { t: { draft: { text: 'Main draft remains', attachments: [] } } } },
});
const listeners = new Set<(event: DesktopEvent) => void>();
const emit = () => { for (const listener of listeners) listener({ type: 'state', data: structuredClone(data) }); };
window.subtaskRecovery = {
  calls: [], snapshot: () => structuredClone(data),
  locale(locale) { data.ui.locale = locale; emit(); },
  selectThread(id) { data.ui.activeThreadId = id; emit(); },
  question(index, answer) { data.subtasks[index].questions = [{ id: crypto.randomUUID(), question: 'Which file should I inspect?', createdAt: 1, status: answer ? 'answered' : 'pending', answer }]; emit(); },
  update(index, status, text) { data.subtasks[index].status = status; const child = data.threads.find(item => item.id === 'child' + index)!; child.status = status === 'running' ? 'running' : 'idle'; if (text !== undefined) child.items[0].text = text; emit(); },
};
const bridge: DesktopBridge = {
  async invoke(request) {
    window.subtaskRecovery.calls.push(request);
    switch (request.op) {
      case 'bootstrap': return { data: structuredClone(data), approvals: [], terminals: [], version: 'subagent-observer' };
      case 'ui.update': data.ui = applyUiPatch(data.ui, { frame: request.frame ?? request.ui }); emit(); return data.ui;
      case 'ui.threadPatch': data.ui = applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }); emit(); return data.ui;
      case 'git.status': return { available: true, branch: 'main', files: [] };
      case 'models.catalog': return [];
      case 'comment.list': return [];
      default: return null;
    }
  },
  onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
};
window.desktop = bridge;
createRoot(document.getElementById('root')!).render(<App />);
