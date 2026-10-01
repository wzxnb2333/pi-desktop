import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BindProject } from '../../../src/renderer/src/components/composer/bind-project.tsx';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { dataSchema, defaultData, threadSchema, type DesktopBridge, type DesktopEvent, type DesktopRequest } from '../../../src/shared/contracts.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import { localizeAppError } from '../../../src/shared/localization.ts';
import '../../../src/renderer/src/styles/index.css';

declare global { interface Window { chatRecovery: { calls: DesktopRequest[]; hold: string[]; release(key: string, error?: string): void } } }
const data = dataSchema.parse({ ...defaultData(), projects: [{ id: 'p', name: 'Project', path: 'C:/project', trusted: true, createdAt: 1 }],
  threads: ['t', 'other'].map(id => ({ id, projectId: '', title: id, cwd: 'C:/chats/' + id, createdAt: 1, updatedAt: 1, modelId: '', thinking: 'off', policy: 'deny' })),
  ui: { activeThreadId: 't', threads: { t: { draft: { text: 'Original draft', attachments: ['image.png'] } }, other: { draft: { text: 'Other draft', attachments: [] } } } },
});
const listeners = new Set<(event: DesktopEvent) => void>();
const emit = () => { for (const listener of listeners) listener({ type: 'state', data: structuredClone(data) }); };
const waits: { key: string; resolve(): void; reject(error: Error): void }[] = [];
window.chatRecovery = { calls: [], hold: [], release(key, error) {
  const index = waits.findIndex(item => item.key === key); if (index < 0) throw new Error('No pending ' + key);
  const [pending] = waits.splice(index, 1); if (error) pending.reject(new Error(error)); else pending.resolve();
} };
const bridge: DesktopBridge = { async invoke(request) {
  window.chatRecovery.calls.push(request);
  if (window.chatRecovery.hold.includes(request.op)) await new Promise<void>((resolve, reject) => waits.push({ key: request.op, resolve, reject }));
  switch (request.op) {
    case 'bootstrap': return { data: structuredClone(data), approvals: [], terminals: [], version: 'chat-recovery' };
    case 'chat.create': {
      const chat = threadSchema.parse({ ...data.threads[0], id: request.requestId, title: 'New chat', projectId: '', cwd: 'C:/chats/' + request.requestId });
      data.threads.push(chat); emit(); return chat;
    }
    case 'thread.create': {
      const thread = threadSchema.parse({ ...data.threads[0], id: request.requestId, title: 'New task', projectId: request.projectId, cwd: 'C:/project' });
      data.threads.push(thread); emit(); return thread;
    }
    case 'project.add': return structuredClone(data.projects[0]);
    case 'thread.bindProject': { const thread = data.threads.find(thread => thread.id === request.id)!; Object.assign(thread, { projectId: request.projectId, directoryId: request.directoryId ?? 'p', cwd: 'C:/project' }); emit(); return thread; }
    case 'ui.update': data.ui = applyUiPatch(data.ui, { frame: request.frame ?? request.ui }); emit(); return data.ui;
    case 'ui.threadPatch': data.ui = applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }); emit(); return data.ui;
    default: return null;
  }
}, onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); } };
window.desktop = bridge;
function Surface() {
  const app = useApp(); if (!app.ready) return null;
  return <main style={{ padding: 24 }}><button onClick={() => void app.createThread('').catch(() => {})}>Create chat</button>
    <button onClick={() => void app.createThread('p').catch(() => {})}>Create project task</button>
    <button onClick={() => void app.createThread('p', true).catch(() => {})}>Create worktree task</button>
    <button onClick={() => app.selectThread(app.data.threads.find(thread => thread.id === 'other')!)}>Other chat</button>
    <button onClick={() => app.selectThread(app.data.threads.find(thread => thread.id === 't')!)}>Original chat</button>
    <button onClick={() => app.patchUi({ locale: app.ui.locale === 'zh-CN' ? 'en-US' : 'zh-CN' })}>Language</button>
    <output data-testid="active">{app.ui.activeThreadId}</output><output data-testid="count">{app.data.threads.length}</output>
    <output data-testid="original-draft">{app.ui.threads.t?.draft?.text}</output>
    <output data-testid="attachments">{JSON.stringify(app.ui.threads.t?.draft?.attachments)}</output>
    <textarea aria-label="Draft" value={app.text} onChange={event => app.setText(event.target.value)} />
    <BindProject />{app.error && <p role="alert">{localizeAppError(app.error)}</p>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><AppProvider><Surface /></AppProvider></StrictMode>);
