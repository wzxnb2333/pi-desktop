import { createRoot } from 'react-dom/client';
import { SidechatPanel } from '../../../src/renderer/src/components/panels/sidechat-panel.tsx';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { dataSchema, type DesktopBridge, type DesktopEvent, type DesktopRequest } from '../../../src/shared/contracts.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

declare global { interface Window { sidechatRecovery: {
  calls: DesktopRequest[]; hold: string[]; release(key: string, error?: string): void;
  locale(value: 'zh-CN' | 'en-US'): void; selectThread(id: string): void;
}; } }
const params = new URLSearchParams(location.search);
const parents = ['t', 'other'].map(id => ({ id, projectId: '', title: id, cwd: 'C:/project', createdAt: 1, updatedAt: 1, providerId: 'model', thinking: 'off', policy: 'deny' }));
const data = dataSchema.parse({ version: 2, projects: [], automations: [],
  threads: [...parents, ...parents.filter(parent => !params.has('empty') || parent.id !== 't').map(parent => ({ ...parent, id: 'side-' + parent.id,
    sidechat: { parentThreadId: parent.id, parentTitle: parent.title, anchorItemId: '', capturedAt: 1, temporary: true, context: '[]' },
    items: [{ id: 'answer', role: 'assistant', text: 'Side answer ' + parent.id, state: 'done', timestamp: 1 }],
  }))],
  settings: { theme: params.get('theme') || 'light' }, ui: { reviewOpen: true, locale: params.get('locale') || 'zh-CN', activeThreadId: 't', threads: {
    t: { sidechatId: params.has('empty') ? '' : 'side-t', draft: { text: 'Parent draft', attachments: [] } }, other: { sidechatId: 'side-other' },
    'side-t': { draft: { text: 'Side draft', attachments: [] } }, 'side-other': { draft: { text: 'Other draft', attachments: [] } },
  } },
});
const listeners = new Set<(event: DesktopEvent) => void>();
const emit = () => { for (const listener of listeners) listener({ type: 'state', data: structuredClone(data) }); };
const waits: { key: string; resolve(): void; reject(error: Error): void }[] = [];
window.sidechatRecovery = {
  calls: [], hold: [],
  release(key, error) { const index = waits.findIndex(item => item.key === key); if (index < 0) throw new Error('No pending ' + key); const [pending] = waits.splice(index, 1); if (error) pending.reject(new Error(error)); else pending.resolve(); },
  locale(locale) { data.ui.locale = locale; emit(); }, selectThread(id) { data.ui.activeThreadId = id; emit(); },
};
const bridge: DesktopBridge = {
  async invoke(request) {
    if (request.op === 'sidechat.create' || request.op === 'sidechat.keep' || request.op === 'sidechat.append' || request.op === 'thread.send') {
      window.sidechatRecovery.calls.push(request);
      if (window.sidechatRecovery.hold.includes(request.op)) await new Promise<void>((resolve, reject) => waits.push({ key: request.op, resolve, reject }));
      if (request.op === 'sidechat.create') {
        const parent = data.threads.find(thread => thread.id === request.threadId)!;
        const side = { ...structuredClone(parent), id: request.requestId!, items: [], sidechat: { parentThreadId: parent.id, parentTitle: parent.title, anchorItemId: '', capturedAt: 1, temporary: true, context: '[]' } };
        data.threads.push(side); data.ui.threads[parent.id].sidechatId = side.id; emit(); return side;
      }
      if (request.op === 'thread.send') return null;
      const side = data.threads.find(thread => thread.id === request.threadId)!;
      if (request.op === 'sidechat.keep') { side.sidechat!.temporary = false; data.ui.threads[side.sidechat!.parentThreadId].sidechatId = ''; emit(); return side; }
      if (!side.sidechat!.appendedItemIds?.includes(request.itemId)) {
        side.sidechat!.appendedItemIds = [request.itemId]; data.ui.threads[side.sidechat!.parentThreadId].draft!.text += '\n\n' + side.items[0].text;
      }
      emit(); return data.ui;
    }
    switch (request.op) {
      case 'bootstrap': return { data: structuredClone(data), approvals: [], terminals: [], version: 'sidechat-recovery' };
      case 'ui.update': data.ui = applyUiPatch(data.ui, { frame: request.frame ?? request.ui }); emit(); return data.ui;
      case 'ui.threadPatch': data.ui = applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }); emit(); return data.ui;
      default: return null;
    }
  }, onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
};
window.desktop = bridge;
function Surface() {
  const { ready, data, ui } = useApp();
  return <><output data-testid="draft">{data.ui.threads.t?.draft?.text}</output><output data-testid="active">{ui.activeThreadId}</output>
    <aside style={{ display: 'flex', width: 'min(440px, 100vw)', height: 'calc(100vh - 40px)' }}>{ready && ui.reviewOpen && <SidechatPanel />}</aside></>;
}
createRoot(document.getElementById('root')!).render(<AppProvider><Surface /></AppProvider>);
