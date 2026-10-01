import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GoalPanel } from '../../../src/renderer/src/components/panels/goal-panel.tsx';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { dataSchema, type DesktopBridge, type DesktopEvent, type DesktopRequest } from '../../../src/shared/contracts.ts';
import { goalSchema, type Goal } from '../../../src/shared/goals.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

declare global { interface Window { goalRecovery: {
  calls: DesktopRequest[]; hold: string[]; release(key: string, error?: string): void;
  locale(value: 'zh-CN' | 'en-US'): void; selectThread(id: string): void; replaceGoal(remove?: boolean): void;
}; } }
const params = new URLSearchParams(location.search);
function goal(objective: string): Goal { return goalSchema.parse({ id: crypto.randomUUID(), revision: 1, objective, criteria: [{ id: crypto.randomUUID(), text: 'Verify the result', completed: false, evidence: '' }], status: 'paused', reason: '', createdAt: 1, updatedAt: 1, rounds: 0, consecutiveFailures: 0, noProgress: 0, burstRounds: 0, history: [] }); }
const data = dataSchema.parse({ version: 2, projects: [], automations: [],
  threads: ['t', 'other'].map(id => ({ id, projectId: '', title: id, cwd: 'C:/project', createdAt: 1, updatedAt: 1, providerId: '', thinking: 'off', policy: 'deny', goal: id === 't' && params.has('empty') ? undefined : goal(id === 't' ? 'Existing objective' : 'Other objective') })),
  settings: { theme: params.get('theme') || 'light' }, ui: { locale: params.get('locale') || 'zh-CN', activeThreadId: 't', threads: { t: { draft: { text: 'Chat draft', attachments: [] } } } },
});
const listeners = new Set<(event: DesktopEvent) => void>();
const emit = () => { for (const listener of listeners) listener({ type: 'state', data: structuredClone(data) }); };
const waits: { key: string; resolve(): void; reject(error: Error): void }[] = [];
window.goalRecovery = {
  calls: [], hold: [],
  release(key, error) { const index = waits.findIndex(item => item.key === key); if (index < 0) throw new Error('No pending ' + key); const [pending] = waits.splice(index, 1); if (error) pending.reject(new Error(error)); else pending.resolve(); },
  locale(locale) { data.ui.locale = locale; emit(); },
  selectThread(id) { data.ui.activeThreadId = id; emit(); },
  replaceGoal(remove) { data.threads.find(thread => thread.id === data.ui.activeThreadId)!.goal = remove ? undefined : goal('Replaced objective'); emit(); },
};
const bridge: DesktopBridge = {
  async invoke(request) {
    if (request.op === 'goal.save' || request.op === 'goal.control') {
      window.goalRecovery.calls.push(request);
      const key = request.op === 'goal.save' ? 'save' : request.action;
      if (window.goalRecovery.hold.includes(key)) await new Promise<void>((resolve, reject) => waits.push({ key, resolve, reject }));
      const thread = data.threads.find(thread => thread.id === request.threadId)!;
      if (request.op === 'goal.save') {
        thread.goal = { ...goal(request.definition.objective), id: thread.goal?.id ?? crypto.randomUUID(), revision: (thread.goal?.revision ?? 0) + 1, criteria: request.definition.criteria.map(item => ({ ...item, completed: false, evidence: '' })), status: request.start ? 'active' : 'paused' };
      } else if (request.action === 'clear') delete thread.goal;
      else { thread.goal!.status = request.action === 'resume' ? 'active' : 'paused'; thread.goal!.revision++; }
      emit(); return thread.goal ?? null;
    }
    switch (request.op) {
      case 'bootstrap': return { data: structuredClone(data), approvals: [], terminals: [], version: 'goal-recovery' };
      case 'ui.update': data.ui = applyUiPatch(data.ui, { frame: request.ui }); emit(); return data.ui;
      case 'ui.threadPatch': data.ui = applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }); emit(); return data.ui;
      default: return null;
    }
  },
  onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
};
window.desktop = bridge;
function Surface() {
  const { ready, data } = useApp(), [open, setOpen] = useState(true);
  return <><output data-testid="draft">{data.ui.threads.t?.draft?.text}</output>{ready && open && <GoalPanel close={() => setOpen(false)} />}</>;
}
createRoot(document.getElementById('root')!).render(<AppProvider><Surface /></AppProvider>);
