import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { BrowserHistoryPanel } from '../../../src/renderer/src/components/panels/browser-history.tsx';
import { dataSchema, type DesktopBridge, type DesktopEvent, type DesktopRequest } from '../../../src/shared/contracts.ts';
import type { BrowserHistoryEntry } from '../../../src/shared/browser-history.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

type Action = 'browser.history' | 'browser.data' | 'browser.open' | 'browser.clear' | 'browser.clearCancel';
declare global {
  interface Window {
    historyHarness: {
      calls: DesktopRequest[]; hold: Action[]; entries: BrowserHistoryEntry[];
      release(op: Action, error?: string, value?: unknown): void;
      select(id: string): void; locale(locale: 'zh-CN' | 'en-US'): void;
    };
  }
}
const params = new URLSearchParams(location.search);
let data = dataSchema.parse({
  version: 3, projects: [], automations: [],
  threads: ['t1', 't2'].map(id => ({ id, projectId: '', title: id, cwd: '', createdAt: 1, updatedAt: 1, modelId: '', thinking: 'off', policy: 'ask' })),
  settings: { theme: params.get('theme') || 'light' }, ui: { locale: params.get('locale') || 'zh-CN', activeThreadId: 't1' },
});
const listeners = new Set<(event: DesktopEvent) => void>();
const emit = () => { for (const listener of listeners) listener({ type: 'state', data }); };
const pending: { op: Action; resolve(value: unknown): void; reject(error: Error): void }[] = [];
window.historyHarness = {
  calls: [], hold: [],
  entries: Array.from({ length: 60 }, (_, i) => ({ id: crypto.randomUUID(), url: 'https://example.org/' + i, title: '页面 ' + i, visitedAt: 10000 + i })),
  release(op, error, value) { const index = pending.findIndex(item => item.op === op); if (index < 0) throw new Error('No pending ' + op); const item = pending.splice(index, 1)[0]; if (error) item.reject(new Error(error)); else item.resolve(value); },
  select(id) { data = { ...data, ui: { ...data.ui, activeThreadId: id } }; emit(); },
  locale(locale) { data = { ...data, ui: { ...data.ui, locale } }; emit(); },
};
const bridge: DesktopBridge = {
  async invoke(request) {
    const state = window.historyHarness;
    if (['browser.history', 'browser.data', 'browser.open', 'browser.clear', 'browser.clearCancel'].includes(request.op)) {
      state.calls.push(request);
      if (state.hold.includes(request.op as Action)) {
        const value = await new Promise<unknown>((resolve, reject) => pending.push({ op: request.op as Action, resolve, reject }));
        if (value !== undefined) return value;
      }
    }
    switch (request.op) {
      case 'bootstrap': return { data, approvals: [], terminals: [], version: 'history-recovery' };
      case 'ui.update': data = { ...data, ui: applyUiPatch(data.ui, { frame: request.ui }) }; emit(); return data.ui;
      case 'browser.history': {
        const entries = state.entries.filter(item => (item.url + item.title).includes(request.query));
        return { entries: entries.slice(request.offset, request.offset + request.limit), total: entries.length };
      }
      case 'browser.data': return { count: request.range === 'hour' ? 3 : 60, origins: ['https://example.org'], cacheBytes: 1048576 };
      case 'browser.clear':
        data = { ...data, operations: [...data.operations, { id: request.requestId, kind: 'browser.clear', threadId: '', directoryId: 'browser', status: 'running', stage: '等待清理确认', startedAt: 1 }] }; emit(); return null;
      case 'browser.clearCancel':
        data = { ...data, operations: data.operations.map(item => item.id === request.requestId ? { ...item, status: 'succeeded', result: { cancelled: true } } : item) }; emit(); return null;
      default: return null;
    }
  },
  onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
};
window.desktop = bridge;
function Surface() {
  const { ready, activeId } = useApp(); const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>Open history</button>{ready && open && <BrowserHistoryPanel key={activeId} threadId={activeId} tabId="" clear onClose={() => setOpen(false)} />}</>;
}
createRoot(document.getElementById('root')!).render(<AppProvider><Surface /></AppProvider>);
