import { createRoot } from 'react-dom/client';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import { App } from '../../../src/renderer/src/App.tsx';
import {
  dataSchema,
  threadSchema,
  type Approval,
  type DesktopBridge,
  type DesktopData,
  type DesktopEvent,
  type DesktopRequest,
  type TerminalInfo,
} from '../../../src/shared/contracts.ts';
import '../../../src/renderer/src/styles/index.css';
const params = new URLSearchParams(location.search);
if (params.has('locale')) localStorage.setItem('pi.desktop.locale', params.get('locale')!);
type Reply = Extract<DesktopRequest, { op: 'approval.reply' }>;
declare global {
  interface Window {
    referenceStates: {
      replies: Reply[];
      releaseBootstrap(error?: string): void;
      releaseReply(error?: string): void;
    };
  }
}
window.referenceStates = { replies: [], releaseBootstrap() {}, releaseReply() {} };
const bootstrapGate = params.has('loading') ? new Promise<void>((resolve, reject) => {
  window.referenceStates.releaseBootstrap = error => error ? reject(new Error(error)) : resolve();
}) : Promise.resolve();
const approvalKind = params.get('approval');
let approvals: Approval[] = approvalKind === 'action' || approvalKind === 'confirm' || approvalKind === 'input' || approvalKind === 'select' ? [{
  id: 'reference-approval', threadId: 't1', tool: 'write', kind: approvalKind,
  description: params.has('longapproval') ? Array.from({ length: 40 }, (_, index) => '操作 ' + index + '：C:/工作区/' + '中文长路径'.repeat(30) + '/settings.json').join('\n') : '将更新工作区中的设置文件。',
  ...(approvalKind === 'select' ? { options: ['保留当前配置', '使用工作区配置'] } : {}),
  ...(params.has('risk') ? { review: { risk: params.get('risk') === 'high' ? 'high' as const : 'uncertain' as const,
    reason: params.get('risk') === 'high' ? '操作将删除现有文件。' : '独立审查失败或返回无效结果，需要你手动批准。', model: 'Fixture reviewer' } } : {}),
}] : [];
let data: DesktopData = dataSchema.parse({
  version: 2,
  projects: params.has('empty') ? [] : [
    { id: 'p1', name: params.has('longproject') ? '用于验证超长中文目录名不会撑破欢迎页布局的测试项目'.repeat(3) : '参考项目', path: 'C:/temporary/project', trusted: true, createdAt: 1 },
    ...(params.has('migration') ? [{ id: 'p2', name: '第二项目', path: 'C:/temporary/second', trusted: true, createdAt: 2 }] : []),
  ],
  threads: params.has('empty') ? [] : Array.from({ length: params.has('overflow') ? 20 : 2 }, (_, index) => index + 1).map((id) => ({
    id: 't' + id,
    projectId: 'p1',
    title: '任务' + id,
    cwd: 'C:/temporary/project',
    createdAt: id,
    updatedAt: id,
    providerId: params.has('setup') ? '' : 'fake',
    thinking: 'medium',
    policy: 'ask',
    ...(params.has('interrupted') && id === 1 ? { status: 'interrupted', error: '上次运行已中断，可以继续此任务。' } : {}),
    ...(params.has('usage') ? { usage: { input: 400, output: 100, total: 500, contextPercent: 2.5, contextTokens: 500, contextWindow: 20000 } } : {}),
    ...(params.has('workspace') && id === 1 ? { plan: Array.from({ length: 18 }, (_, index) => ({ text: '验证步骤 ' + (index + 1) + '：检查保存与重启恢复', status: index < 5 ? 'completed' : index === 5 ? 'in_progress' : 'pending' })) } : {}),
    ...((params.has('conversation') || params.has('workspace') || approvals.length > 0) && id === 1 ? { items: [
      { id: 'visual-user', role: 'user', timestamp: 1700000000000, text: '请检查设置保存流程，并说明如何验证。' },
      ...(params.has('workspace') ? [
        { id: 'visual-notice', role: 'notice', timestamp: 1700000001000, text: '设置已恢复，可以继续检查当前工作区。' },
        { id: 'visual-tool', role: 'tool', toolName: 'read', args: '{"path":"src/settings.ts"}', timestamp: 1700000002000, text: 'export const save = () => persistSettings();' },
      ] : []),
      { id: 'visual-answer', role: 'assistant', timestamp: 1700000004000, text: [
        '## 验证结果', '', '设置已保存，重启后恢复选择。保留中文文案及 **键盘导航**。', '',
        '| 检查项目 | 状态 |', '| --- | --- |', '| 保存与重启 | 已通过 |', '| 中文输入 | 已通过 |', '',
        '运行以下命令进行检查：', '', '```powershell', 'npm run desktop:check', '```', '',
        '- 确认主题与布局恢复', '- 检查模型选择和输入框',
      ].join('\n') },
    ] } : {}),
  })),
  automations: [],
  settings: {
    theme: params.get('theme') || 'light',
    providers: params.has('setup') ? [] : [{ id: 'fake', name: '本地测试', provider: 'faux', model: 'fake' }],
  },
  ui: {
    locale: params.get('locale') || 'zh-CN',
    activeThreadId: params.has('empty') ? '' : 't1',
    openThreads: params.has('empty') ? [] : ['t1'],
    ...(params.has('pinned') ? { sidebarWidth: 240 } : {}),
    reviewOpen: params.has('wide'),
    ...(params.has('wide')
      ? { sidebarWidth: 520, reviewWidth: 760, terminalHeight: 800, threads: { t1: { terminalOpen: true } } }
      : {}),
  },
});
const listeners = new Set<(event: DesktopEvent) => void>();
const terminals: TerminalInfo[] = [];
const emit = () => {
  for (const listener of listeners) listener({ type: 'state', data });
};
const bridge: DesktopBridge = {
  async invoke(request) {
    switch (request.op) {
      case 'bootstrap':
        await bootstrapGate;
        return { data, approvals, terminals, version: 'reference-test' };
      case 'terminal.open': {
        const terminal: TerminalInfo = { id: 'visual-terminal', threadId: request.threadId, title: 'PowerShell', exited: false, output: 'PS C:\u005ctemporary\u005cproject> npm run desktop:check\r\nType check completed.\r\nPS C:\u005ctemporary\u005cproject> ' };
        terminals.push(terminal);
        return terminal;
      }
      case 'approval.reply':
        window.referenceStates.replies.push(request);
        if (params.has('holdReply')) await new Promise<void>((resolve, reject) => {
          window.referenceStates.releaseReply = error => error ? reject(new Error(error)) : resolve();
        });
        approvals = approvals.filter(approval => approval.id !== request.id);
        for (const listener of listeners) listener({ type: 'approvals', approvals });
        return null;
      case 'models.catalog':
        return [{ id: 'faux', models: [{ id: 'fake', name: '本地测试', api: 'openai-completions', reasoning: true, thinkingLevels: ['off', 'low', 'medium', 'high'], contextWindow: 128000, maxTokens: 8192 }] }];
      case 'browser.downloads':
        return [];
      case 'browser.history': return { entries: [], total: 0 };
      case 'browser.tab': {
        const current = data.ui.threads[request.threadId];
        const tabs = current.browserTabs ?? [];
        const created = { id: crypto.randomUUID(), title: '新标签', url: '' };
        const next = request.action === 'close' ? tabs.filter(tab => tab.id !== request.tabId) : [...tabs, created];
        data = { ...data, ui: applyUiPatch(data.ui, { threadId: request.threadId, thread: {
          browserTabs: next, activeBrowserTab: request.action === 'close' ? current.activeBrowserTab === request.tabId ? next.at(-1)?.id : current.activeBrowserTab : created.id,
        } }) };
        emit(); return data.ui;
      }
      case 'ui.update':
        data = { ...data, ui: applyUiPatch(data.ui, { frame: request.ui }) };
        emit();
        return data.ui;
      case 'ui.threadPatch':
        data = { ...data, ui: applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }) };
        emit();
        return data.ui;
      case 'ui.threadUpdate':
        data = {
          ...data,
          ui: { ...data.ui, threads: { ...data.ui.threads, [request.threadId]: request.thread } },
        };
        emit();
        return data;
      case 'settings.save':
        data = { ...data, settings: request.settings };
        emit();
        return data;
      case 'settings.patch':
        data = { ...data, settings: { ...data.settings, ...request.patch } };
        emit();
        return data.settings;
      case 'thread.update': {
        const { op: _op, id, ...patch } = request;
        data = { ...data, threads: data.threads.map(thread => thread.id === id ? { ...thread, ...patch } : thread) };
        emit();
        return data.threads.find(thread => thread.id === id);
      }
      case 'thread.create': {
        const project = data.projects.find(item => item.id === request.projectId);
        if (!project) throw new Error('测试项目不存在');
        const thread = threadSchema.parse({ id: 'created-' + data.threads.length, projectId: project.id, cwd: project.path, title: '新任务', createdAt: Date.now(), updatedAt: Date.now(), providerId: data.settings.providers[0]?.id ?? '', thinking: 'medium', policy: 'ask', ...(request.worktree ? { worktreeBranch: 'task/test-worktree' } : {}) });
        data = { ...data, threads: [...data.threads, thread] };
        emit();
        return thread;
      }
      case 'thread.send': {
        data = { ...data, threads: data.threads.map(thread => thread.id === request.id ? threadSchema.parse({ ...thread, status: 'running', items: [...thread.items, { id: 'sent-' + thread.items.length, role: 'user', text: request.text, timestamp: Date.now() }] }) : thread) };
        emit();
        return { id: request.requestId ?? crypto.randomUUID(), fingerprint: JSON.stringify(request), at: Date.now(), status: 'accepted' };
      }
      case 'composer.preflight':
        return { issues: [], estimatedTokens: Math.ceil(request.payload.text.length / 2), contextWindow: 128000, images: 0 };
      case 'attachment.inspect':
        return { path: request.path, name: request.path.replaceAll(String.fromCharCode(92), '/').split('/').at(-1), bytes: 100, kind: 'text', version: 'fixture', preview: 'Harness attachment', truncated: false };
      case 'git.status':
        return { available: true, branch: 'main', files: params.has('review') ? [{ path: 'src/feature.ts', status: ' M', staged: false }, { path: 'src/feature.test.ts', status: '??', staged: false }] : [] };
      case 'git.inspect':
        return { branches: ['main'], remoteBranches: [], remotes: [], upstream: '', operation: '', commits: [], worktrees: [] };
      case 'git.diff':
        return ['diff --git a/' + request.path + ' b/' + request.path, '--- a/' + request.path, '+++ b/' + request.path, '@@ -1 +1,2 @@', '-const enabled = false;', '+const enabled = true;', '+export { enabled };'].join(String.fromCharCode(10));
      case 'file.list':
        return [];
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
createRoot(document.getElementById('root')!).render(<App />);
