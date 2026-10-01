import { createRoot } from 'react-dom/client';
import { App } from '../../../src/renderer/src/App.tsx';
import { defaultData, projectSchema, providerSchema, threadSchema, timelineSchema, type DesktopData, type DesktopEvent, type DesktopRequest, type Thread } from '../../../src/shared/contracts.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

export const quoteText = ['第一段 重复片段。', '', '第二段 重复片段 与 **加粗内容**，还有 `const value = 1`。', '', '```typescript', 'const repeated = "重复片段";', 'console.log(repeated);', '```', '', '| 检查 | 内容 |', '| --- | --- |', '| 来源 | 表格内容 |', '', '转义：&amp; 与 \\*星号\\*。'].join('\n');
let data: DesktopData = defaultData();
const makeThread = (id: string, title: string, projectId = 'p') => threadSchema.parse({ id, title, projectId, cwd: 'C:/fixture', providerId: 'fake', thinking: 'off', policy: 'ask', createdAt: 1, updatedAt: 2, items: [timelineSchema.parse({ id: id + '-answer', role: 'assistant', timestamp: 2, text: '未读内容' })] });
data = { ...data, projects: [projectSchema.parse({ id: 'p', name: '测试项目', path: 'C:/fixture', createdAt: 1, trusted: true })], settings: { ...data.settings, theme: 'light', providers: [providerSchema.parse({ id: 'fake', name: '测试模型', provider: 'faux', model: 'fake' })] },
  threads: [makeThread('t', '主对话'), makeThread('short', '短任务'), makeThread('long', '用于测试省略的非常非常长的任务标题'), makeThread('chat', '独立聊天', '')],
  ui: { ...data.ui, activeThreadId: 't', sidebarWidth: 240, summaryOpen: true } };
data.threads[0].items = [timelineSchema.parse({ id: 'question', role: 'user', timestamp: 1, text: '核对界面' }), timelineSchema.parse({ id: 'earlier', role: 'assistant', timestamp: 2, text: '更早的内容\n\n'.repeat(45) }), timelineSchema.parse({ id: 'question-2', role: 'user', timestamp: 3, text: '引用这些片段' }), timelineSchema.parse({ id: 'answer', role: 'assistant', timestamp: 4, text: quoteText })];
data.threads[0].usage = { input: 12000, output: 4384, total: 16384, contextTokens: 16384, contextWindow: 131072, contextPercent: 12.5, cost: 0.003 };
const listeners = new Set<(event: DesktopEvent) => void>();
const calls: DesktopRequest[] = [];
let release: (() => void) | undefined, hold = false;
let projectSelection: 'cancel' | 'error' | 'project' = 'cancel';
const broadcast = () => { for (const listener of listeners) listener({ type: 'state', data }); };
declare global { interface Window { conversationUi: { patch(id: string, patch: Partial<Thread>): void; calls: DesktopRequest[]; source: string; hold(value: boolean): void; release(): void; emptyWorkspace(): void; pickProject(result: 'cancel' | 'error' | 'project'): void; }; } }
window.conversationUi = { calls, source: quoteText, hold: value => { hold = value; }, release: () => release?.(), patch: (id, patch) => { data = { ...data, threads: data.threads.map(thread => thread.id === id ? { ...thread, ...patch } : thread) }; broadcast(); },
  emptyWorkspace: () => { data = { ...data, projects: [], threads: [], ui: { ...data.ui, activeThreadId: '' } }; broadcast(); }, pickProject: result => { projectSelection = result; } };
window.desktop = {
  async invoke(request) {
    calls.push(request);
    switch (request.op) {
      case 'bootstrap': return { data, approvals: [], terminals: [], version: 'fixture' };
      case 'ui.update': data = { ...data, ui: applyUiPatch(data.ui, { frame: request.ui }) }; broadcast(); return data.ui;
      case 'ui.threadPatch': data = { ...data, ui: applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }) }; broadcast(); return data.ui;
      case 'settings.patch': data = { ...data, settings: { ...data.settings, ...request.patch } }; broadcast(); return data.settings;
      case 'project.add': {
        if (projectSelection === 'error') throw new Error('TEST_PROJECT_PICK_FAILED');
        if (projectSelection === 'cancel') return null;
        const project = projectSchema.parse({ id: 'selected', name: '选择的项目', path: 'C:/selected', trusted: true, createdAt: 1 });
        data = { ...data, projects: [...data.projects, project] }; broadcast(); return project;
      }
      case 'thread.create':
      case 'chat.create': {
        const created = threadSchema.parse({ ...makeThread('created-' + calls.length, '新聊天', request.op === 'thread.create' ? request.projectId : ''), items: [] });
        data = { ...data, threads: [...data.threads, created] }; broadcast(); return created;
      }
      case 'thread.update': { const { op: _op, id, ...patch } = request; window.conversationUi.patch(id, patch); return data.threads.find(thread => thread.id === id); }
      case 'git.status': return { available: true, branch: 'feature/conversation', files: [] };
      case 'models.catalog': return [];
      case 'composer.contextDetail': {
        if (hold) await new Promise<void>(resolve => { release = resolve; });
        const item = data.threads.find(thread => thread.id === request.threadId)?.items.find(item => item.id === request.reference.id);
        const quote = request.reference.quote;
        if (!item || !quote || item.text.slice(quote.start, quote.end) !== quote.text) throw new Error('引用版本已变化，请刷新后重试');
        return { reference: request.reference, content: quote.text, stale: false };
      }
      case 'sidechat.create': {
        const parent = data.threads.find(thread => thread.id === request.threadId)!;
        const child = threadSchema.parse({ ...parent, id: request.requestId, items: [], usage: undefined, policy: 'deny', sidechat: { parentThreadId: parent.id, parentTitle: parent.title, anchorItemId: request.anchorItemId, capturedAt: Date.now(), context: parent.items.map(item => item.text).join('\n'), temporary: true } });
        data = { ...data, threads: [...data.threads, child], ui: applyUiPatch(data.ui, { threadId: parent.id, thread: { sidechatId: child.id, reviewTab: 'sidechat' } }) };
        data.ui.reviewOpen = true; broadcast(); return child;
      }
      case 'comment.list': return [];
      default: return null;
    }
  },
  onEvent(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
createRoot(document.getElementById('root')!).render(<App />);
