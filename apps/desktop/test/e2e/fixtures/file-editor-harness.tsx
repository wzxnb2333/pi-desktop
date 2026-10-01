import { createRoot } from 'react-dom/client';
import { App } from '../../../src/renderer/src/App.tsx';
import { dataSchema, type DesktopBridge, type DesktopEvent, type DesktopRequest, type FileContent } from '../../../src/shared/contracts.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

type Write = Extract<DesktopRequest, { op: 'file.write' }>;
declare global {
  interface Window {
    fileEditorTest: {
      files: Record<string, FileContent>;
      directoryFiles: Record<string, FileContent>;
      writes: Write[];
      dirty: boolean;
      holdReads: boolean;
      releaseRead(error?: string): void;
      releaseWrite(error?: string): void;
      selectContext(threadId: string, directoryId: string): void;
    };
  }
}
const reads: ((error?: string) => void)[] = [];
const writes: ((error?: string) => void)[] = [];
window.fileEditorTest = {
  files: Object.fromEntries(['first.txt', 'second.txt'].map(path => [path, { path, kind: 'text', content: path === 'first.txt' ? '原始内容\n' : '第二个文件\n', version: 'v1', writable: true, truncated: false }])),
  directoryFiles: { 'first.txt': { path: 'first.txt', kind: 'text', content: '附加目录原文', version: 'v1', writable: true, truncated: false } },
  writes: [], dirty: false, holdReads: false,
  releaseRead(error) { reads.shift()?.(error); },
  releaseWrite(error) { writes.shift()?.(error); },
  selectContext(threadId, directoryId) {
    data.ui = applyUiPatch(data.ui, { frame: { activeThreadId: threadId } });
    data.ui = applyUiPatch(data.ui, { threadId, thread: { directoryId } });
    emit();
  },
};
const params = new URLSearchParams(location.search);
if (params.has('staleDirty')) window.fileEditorTest.dirty = true;
let data = dataSchema.parse({
  version: 2,
  automations: [],
  projects: [{ id: 'p', name: '文件编辑测试', path: 'C:/test/project', trusted: true, createdAt: 1, directories: params.has('directories') ? [{ id: 'extra', name: '附加目录', path: 'C:/test/extra', trusted: true }] : [] }],
  threads: ['t1', 't2'].map(id => ({ id, projectId: 'p', title: id === 't1' ? '当前任务' : '另一个任务', cwd: 'C:/test/project', createdAt: 1, updatedAt: 1, providerId: 'fake', thinking: 'off', policy: 'ask' })),
  settings: { theme: params.get('theme') || 'light', providers: [{ id: 'fake', name: '本地测试', provider: 'faux', model: 'fake' }] },
  ui: { locale: params.get('locale') || 'zh-CN', activeThreadId: 't1', sidebarWidth: 240, reviewOpen: true, reviewWidth: 520, summaryOpen: false, threads: { t1: { reviewTab: 'files', selectedPath: 'first.txt', openFiles: ['first.txt', 'second.txt'] }, t2: { reviewTab: 'files', selectedPath: 'second.txt', openFiles: ['second.txt'] } } },
});
if (params.has('directories')) for (const id of ['t1', 't2']) data.ui.threads[id].directoryViews = { extra: { selectedPath: 'first.txt', openFiles: ['first.txt'] } };
const listeners = new Set<(event: DesktopEvent) => void>();
const emit = () => { for (const listener of listeners) listener({ type: 'state', data }); };
const bridge: DesktopBridge = {
  async invoke(request) {
    const test = window.fileEditorTest;
    switch (request.op) {
      case 'bootstrap': return { data, approvals: [], terminals: [], version: 'file-editor-test' };
      case 'ui.update': data = { ...data, ui: applyUiPatch(data.ui, { frame: request.ui }) }; emit(); return data.ui;
      case 'ui.threadPatch': data = { ...data, ui: applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }) }; emit(); return data.ui;
      case 'thread.update': return data.threads.find(thread => thread.id === request.id);
      case 'file.list': return Object.keys(request.directoryId === 'extra' ? test.directoryFiles : test.files).map(path => ({ path, name: path, directory: false }));
      case 'file.read': {
        const snapshot = structuredClone((request.directoryId === 'extra' ? test.directoryFiles : test.files)[request.path]);
        if (test.holdReads) await new Promise<void>((resolve, reject) => reads.push(error => error ? reject(new Error(error)) : resolve()));
        if (!snapshot) throw new Error('File not found');
        return snapshot;
      }
      case 'file.write': {
        const files = request.directoryId === 'extra' ? test.directoryFiles : test.files;
        test.writes.push(request);
        await new Promise<void>((resolve, reject) => writes.push(error => error ? reject(new Error(error)) : resolve()));
        if (files[request.path]?.version !== request.version) throw new Error('文件已在外部修改，请重新加载后再保存');
        const saved = { ...files[request.path], content: request.content, version: 'v' + (Number(request.version.slice(1)) + 1) };
        files[request.path] = saved;
        return structuredClone(saved);
      }
      case 'file.dirty': test.dirty = request.dirty; return null;
      case 'git.status': return { available: true, branch: 'main', files: [] };
      case 'git.inspect': return { branches: ['main'], remoteBranches: [], remotes: [], upstream: '', operation: '', commits: [], worktrees: [] };
      default: return null;
    }
  },
  onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
};
window.desktop = bridge;
createRoot(document.getElementById('root')!).render(<App />);
