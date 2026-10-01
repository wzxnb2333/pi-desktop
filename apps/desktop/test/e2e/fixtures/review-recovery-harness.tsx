import { createRoot } from 'react-dom/client';
import { App } from '../../../src/renderer/src/App.tsx';
import { dataSchema, threadSchema, type DesktopBridge, type DesktopEvent, type DesktopRequest } from '../../../src/shared/contracts.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

declare global {
  interface Window {
    reviewRecovery: {
      hold: string[];
      calls: DesktopRequest[];
      release(op: string, error?: string): void;
      select(threadId: string, directoryId?: string): void;
      show(open: boolean): void;
      appearance(locale: 'zh-CN' | 'en-US', theme: 'light' | 'dark'): void;
    };
  }
}
const source = { path: 'same.txt', version: 'v1', lines: 2, deleted: false, binary: false };
const task = { projectId: 'p', directoryId: 'p', cwd: 'C:/project', createdAt: 1, updatedAt: 1, modelId: 'fake', thinking: 'off', policy: 'ask' };
const params = new URLSearchParams(location.search);
let data = dataSchema.parse({
  version: 3, automations: [], projects: [{ id: 'p', name: '主目录', path: 'C:/project', trusted: true, createdAt: 1, directories: [{ id: 'extra', name: '附加目录', path: 'C:/extra', trusted: true }] }],
  threads: [
    { ...task, id: 't1', title: '当前任务', comments: ['p', 'extra'].map(directoryId => ({ id: 'comment-' + directoryId, directoryId, path: 'same.txt', version: 'v1', line: 1, endLine: 1, body: directoryId === 'p' ? '主目录评论' : '附加目录评论', excerpt: 'line', createdAt: 1 })) },
    { ...task, id: 't2', title: '另一个任务' },
    ...['r1', 'r2'].map((id, index) => ({ ...task, id, title: id, review: { parentThreadId: 't1', scope: 'uncommitted', ref: id, instructions: '', capturedAt: index, base: 'base', target: '', files: [source], phase: 'complete', summary: id, findings: [{ id: id + '-finding', path: source.path, line: 1, endLine: 1, title: id + ' issue', body: id + ' description', priority: 1, ignored: false, feedback: [] }] } })),
  ],
  settings: { theme: params.get('theme') || 'light', modelId: 'fake',
    modelProviders: [{ id: 'fake-provider', name: '测试模型', kind: 'builtin', namespace: 'faux', baseUrl: '', api: 'openai-completions', hasKey: false }],
    models: [{ id: 'fake', provider: 'fake-provider', name: '测试模型', model: 'fake', reasoning: false, contextWindow: 128000, maxTokens: 8192 }] },
  ui: { locale: params.get('locale') || 'zh-CN', activeThreadId: 't1', reviewOpen: true, reviewWidth: 480, summaryOpen: false, threads: { t1: { reviewTab: 'review' }, t2: { reviewTab: 'review' } } },
});
const listeners = new Set<(event: DesktopEvent) => void>();
const emit = () => { for (const listener of listeners) listener({ type: 'state', data: structuredClone(data) }); };
const pending: Array<{ op: string; finish(error?: string): void }> = [];
const result = (request: DesktopRequest): unknown => {
  switch (request.op) {
    case 'bootstrap': return { data, approvals: [], terminals: [], version: 'review-recovery' };
    case 'ui.update': data.ui = applyUiPatch(data.ui, { frame: request.ui }); emit(); return data.ui;
    case 'ui.threadPatch': data.ui = applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }); emit(); return data.ui;
    case 'git.status': return { available: true, branch: 'main', files: [] };
    case 'git.inspect': return { branches: ['main'], remoteBranches: [], remotes: [], upstream: '', operation: '', commits: [], worktrees: [] };
    case 'review.inspect': return [{ ...source, stale: false }];
    case 'review.file': return { path: source.path, content: request.threadId + ' captured' };
    case 'review.locate': return { directoryId: 'p', path: source.path, line: 1, id: request.threadId };
    case 'comment.list': return (data.threads.find(item => item.id === request.threadId)?.comments ?? []).map(comment => ({ ...comment, stale: false }));
    case 'comment.remove': {
      const thread = data.threads.find(item => item.id === request.threadId)!;
      thread.comments = thread.comments?.filter(item => item.id !== request.commentId); emit(); return null;
    }
    case 'review.finding': {
      const finding = data.threads.find(item => item.id === request.threadId)!.review!.findings.find(item => item.id === request.findingId)!;
      if (request.feedback) finding.feedback.push(request.feedback);
      if (request.ignored !== undefined) finding.ignored = request.ignored;
      emit(); return null;
    }
    case 'review.start': {
      const run = threadSchema.parse({ ...task, id: 'started', title: '新的审查', review: { parentThreadId: request.threadId, scope: request.scope, ref: request.ref, instructions: request.instructions, capturedAt: 5, base: '', target: '', files: [], phase: 'capturing' } });
      data.threads.unshift(run); emit(); return run;
    }
    case 'review.cancel': data.threads.find(item => item.id === request.threadId)!.review!.phase = 'cancelled'; emit(); return null;
    default: return null;
  }
};
window.reviewRecovery = {
  hold: [], calls: [],
  release(op, error) { const index = pending.findIndex(item => item.op === op); if (index < 0) throw new Error('No pending ' + op); pending.splice(index, 1)[0].finish(error); },
  select(threadId, directoryId = 'p') { data.ui = applyUiPatch(data.ui, { frame: { activeThreadId: threadId } }); data.ui = applyUiPatch(data.ui, { threadId, thread: { directoryId } }); emit(); },
  show(open) { data.ui = applyUiPatch(data.ui, { frame: { reviewOpen: open } }); emit(); },
  appearance(locale, theme) { data.ui.locale = locale; data.settings.theme = theme; emit(); },
};
const bridge: DesktopBridge = {
  async invoke(request) {
    window.reviewRecovery.calls.push(request);
    if (window.reviewRecovery.hold.includes(request.op)) await new Promise<void>((resolve, reject) => pending.push({ op: request.op, finish(error) { if (error) reject(new Error(error)); else resolve(); } }));
    return result(request);
  },
  onEvent(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
window.desktop = bridge;
createRoot(document.getElementById('root')!).render(<App />);
