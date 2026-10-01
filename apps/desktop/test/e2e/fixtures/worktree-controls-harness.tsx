import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { WorktreeControls } from '../../../src/renderer/src/components/panels/worktree-controls.tsx';
import { dataSchema, type DesktopBridge, type DesktopEvent, type DesktopRequest } from '../../../src/shared/contracts.ts';
import { operationSchema, type OperationRecord } from '../../../src/shared/operations.ts';
import { worktreeRecoveryIssueSchema, type WorktreeRecoveryIssue } from '../../../src/shared/worktrees.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

type Action = 'worktree.start' | 'worktree.recovery' | 'operation.cancel';
declare global { interface Window { worktreeControls: { calls: DesktopRequest[]; hold: Action[]; release(op: Action, error?: string): void; select(id: string): void; directory(id: string): void; locale(locale: 'zh-CN' | 'en-US'): void; records(records: OperationRecord[]): void; issues(issues: WorktreeRecoveryIssue[]): void; }; } }
let data = dataSchema.parse({
  settings: {}, automations: [],
  version: 3, projects: [{ id: 'p', name: 'Project', path: 'C:/project', trusted: true, createdAt: 1, directories: [{ id: 'extra', name: 'Extra', path: 'C:/extra', trusted: true }] }],
  threads: ['t1', 't2'].map(id => ({ id, projectId: 'p', title: id, cwd: 'C:/project', createdAt: 1, updatedAt: 1, modelId: '', thinking: 'off', policy: 'ask' })),
  ui: { locale: 'zh-CN', activeThreadId: 't1' },
});
const listeners = new Set<(event: DesktopEvent) => void>();
const changed = () => { for (const listener of listeners) listener({ type: 'state', data: structuredClone(data) }); };
const pending: { op: Action; finish(error?: string): void }[] = [];
window.worktreeControls = {
  calls: [], hold: [],
  release(op, error) { const index = pending.findIndex(item => item.op === op); if (index >= 0) pending.splice(index, 1)[0].finish(error); },
  select(id) { data.ui.activeThreadId = id; changed(); },
  directory(id) { data.ui = applyUiPatch(data.ui, { threadId: data.ui.activeThreadId, thread: { directoryId: id } }); changed(); },
  locale(locale) { data.ui.locale = locale; changed(); },
  records(items) { data.operations = operationSchema.array().parse(items); changed(); },
  issues(items) { data.worktreeRecoveryIssues = worktreeRecoveryIssueSchema.array().parse(items); changed(); },
};
const bridge: DesktopBridge = {
  async invoke(request) {
    const state = window.worktreeControls;
    if (request.op === 'bootstrap') return { data: structuredClone(data), approvals: [], terminals: [], version: 'worktree-controls' };
    if (request.op === 'ui.update' || request.op === 'ui.threadPatch') { data.ui = applyUiPatch(data.ui, request.op === 'ui.update' ? { frame: request.ui } : { threadId: request.threadId, thread: request.patch }); changed(); return structuredClone(data.ui); }
    if (request.op !== 'worktree.start' && request.op !== 'operation.cancel' && request.op !== 'worktree.recovery') return null;
    state.calls.push(request);
    if (state.hold.includes(request.op)) await new Promise<void>((resolve, reject) => pending.push({ op: request.op, finish: error => error ? reject(new Error(error)) : resolve() }));
    if (request.op === 'worktree.start') { const record = operationSchema.parse({ id: request.requestId, threadId: request.threadId, directoryId: request.directoryId ?? 'p', kind: 'worktree.' + request.action, status: 'running', stage: '创建 Worktree', startedAt: Date.now() }); data.operations.push(record); changed(); return record; }
    if (request.op === 'worktree.recovery') return null;
    data.operations.find(item => item.id === request.requestId)!.stage = '正在取消操作'; changed(); return null;
  },
  onEvent(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
};
window.desktop = bridge;
function Harness() { const [visible, show] = useState(true); const { fileScopeId, error } = useApp(); return <><h1>{fileScopeId}</h1><button onClick={() => show(!visible)}>Toggle panel</button>{error && <p data-global-error>{error}</p>}{visible && <WorktreeControls key={fileScopeId} />}</>; }
createRoot(document.getElementById('root')!).render(<AppProvider><Harness /></AppProvider>);
