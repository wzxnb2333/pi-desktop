import { createRoot } from 'react-dom/client';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { Disclosure, ActivitySummary } from '../../../src/renderer/src/components/timeline/disclosure.tsx';
import { ToolActivity, EditDiff } from '../../../src/renderer/src/components/timeline/activity.tsx';
import { Timeline } from '../../../src/renderer/src/components/timeline/timeline.tsx';
import { dataSchema, defaultData, threadSchema, timelineSchema, type DesktopBridge, type DesktopEvent } from '../../../src/shared/contracts.ts';
import '../../../src/renderer/src/styles/index.css';

const params = new URLSearchParams(location.search);
const scene = params.get('scene');
const initial = defaultData();
const data = dataSchema.parse({ ...initial, settings: { ...initial.settings, theme: params.get('theme') || 'light' }, threads: [threadSchema.parse({ id: 't', projectId: 'p', title: '动作 A', cwd: '.', createdAt: 1, updatedAt: 1, providerId: '', thinking: 'off', policy: 'auto' }), threadSchema.parse({ id: 't2', projectId: 'p', title: '任务二', cwd: '.', createdAt: 1, updatedAt: 1, providerId: '', thinking: 'off', policy: 'auto' })], ui: { ...initial.ui, activeThreadId: 't', threads: JSON.parse(localStorage.getItem('folds') || '{}') } });
let listener: ((event: DesktopEvent) => void) | undefined;
const bridge: DesktopBridge = {
  async invoke(request) {
    if (request.op === 'bootstrap') return { data, approvals: [], terminals: [], version: 'activity-test' };
    if (request.op === 'ui.threadUpdate') { data.ui.threads[request.threadId] = request.thread; localStorage.setItem('folds', JSON.stringify(data.ui.threads)); }
    if (request.op === 'ui.update') data.ui = applyUiPatch(data.ui, { frame: request.ui });
    if (request.op === 'ui.threadPatch') { data.ui = applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }); localStorage.setItem('folds', JSON.stringify(data.ui.threads)); }
    listener?.({ type: 'state', data: structuredClone(data) });
    return structuredClone(data.ui);
  },
  onEvent(callback) { listener = callback; return () => { listener = undefined; }; },
};
window.desktop = bridge;
window.addEventListener('fixture:update', event => {
  const update = (event as CustomEvent<Record<string, unknown>>).detail;
  data.threads[0] = threadSchema.parse({ ...data.threads[0], ...update });
  listener?.({ type: 'state', data: structuredClone(data) });
});
const file = timelineSchema.parse({ id: 'file', timestamp: 0, role: 'tool', toolName: 'read', args: JSON.stringify({ path: 'src/app.ts' }), text: 'export const value = 1;', state: 'done' });
const harness = timelineSchema.parse({ id: 'harness', timestamp: 0, role: 'tool', toolName: 'get_harness', args: '{}', text: '{\"session\":{}}', state: 'done' });
const diff = { ...file, toolName: 'edit', details: { diff: '-1 old\n+1 new' } };
function Harness() {
  const { ready, thread, selectThread, data: current } = useApp();
  if (!ready) return null;
  return <main data-activity-ready="true">
    {scene === 'behavior' ? <><button onClick={() => selectThread(current.threads[1])}>切换任务二</button><button onClick={() => selectThread(current.threads[0])}>切换任务一</button><div style={{ height: 500, display: 'flex' }}><Timeline /></div></> :
      <div style={{ width: 'min(768px, calc(100vw - 64px))', margin: '32px auto' }}>
        {scene === 'row' && <Disclosure foldKey="row" summary="读取文件" defaultOpen><span>工具输出</span></Disclosure>}
        {scene === 'group' && <Disclosure foldKey="group" summary="2 次读取、1 次搜索" variant="group" defaultOpen><span>已读取 app.ts</span><span>已搜索 export</span></Disclosure>}
        {scene === 'file' && <ToolActivity item={file} />}
        {scene === 'harness' && <ToolActivity item={harness} />}
        {scene === 'diff' && <EditDiff item={diff} />}
        {scene === 'summary' && <output><ActivitySummary text={thread?.title ?? ''} live={thread?.status === 'running'} /></output>}
        {scene === 'focus' && <><Disclosure foldKey="focus" summary="父项" defaultOpen><button>内部按钮</button><Disclosure foldKey="child" summary="子项"><button>隐藏按钮</button></Disclosure></Disclosure><button>后续按钮</button></>}
      </div>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<AppProvider><Harness /></AppProvider>);
