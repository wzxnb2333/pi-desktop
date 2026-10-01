import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { BrowserAnnotationsPanel } from '../../../src/renderer/src/components/panels/browser-annotations.tsx';
import { annotationSelection, type AnnotationCapture, type BrowserAnnotation } from '../../../src/shared/browser-annotations.ts';
import { dataSchema, type DesktopBridge, type DesktopEvent, type DesktopRequest } from '../../../src/shared/contracts.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

declare global {
  interface Window { annotationsHarness: {
    calls: DesktopRequest[]; hold: string[]; failReads: number;
    release(key: string, error?: string): void;
    locale(locale: 'zh-CN' | 'en-US'): void;
    selectThread(id: string): void;
    markDeleting(): void;
  }; }
}
const params = new URLSearchParams(location.search);
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const page = { url: 'https://example.com/' + 'long/path/'.repeat(30), title: 'A saved page', width: 800, height: 600, scrollX: 0, scrollY: 0, fingerprint: 'a'.repeat(64), elements: [{ id: 0, tag: 'button', label: 'Save', selector: 'button', rect: { x: 10, y: 20, width: 100, height: 40 } }] };
const saved: BrowserAnnotation = { id: crypto.randomUUID(), createdAt: 1, tabId: 'page', url: page.url, title: page.title, fingerprint: page.fingerprint, viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0 }, mode: 'region', rect: { x: 10, y: 20, width: 100, height: 40 }, comment: 'Existing annotation' };
let data = dataSchema.parse({ version: 2, projects: [], automations: [],
  threads: ['t', 'other'].map(id => ({ id, projectId: '', cwd: '.', title: id, createdAt: 1, updatedAt: 1, providerId: '', policy: 'deny', thinking: 'off', browserAnnotations: id === 't' ? [saved] : [] })),
  settings: { theme: params.get('theme') || 'light' },
  ui: { locale: params.get('locale') || 'zh-CN', activeThreadId: 't', threads: { t: { draft: { text: 'Existing draft', attachments: [] } } } },
});
const listeners = new Set<(event: DesktopEvent) => void>();
const emit = () => { for (const listener of listeners) listener({ type: 'state', data: structuredClone(data) }); };
const captures = new Map<string, AnnotationCapture>();
const pending: { key: string; resolve(): void; reject(error: Error): void }[] = [];
window.annotationsHarness = {
  calls: [], hold: [], failReads: 0, selectThread() {},
  release(key, error) { const index = pending.findIndex(item => item.key === key); if (index < 0) throw new Error('No pending ' + key); const [item] = pending.splice(index, 1); if (error) item.reject(new Error(error)); else item.resolve(); },
  locale(locale) { data = { ...data, ui: { ...data.ui, locale } }; emit(); },
  markDeleting() { data.threads[0].browserAnnotations![0].deleting = true; emit(); },
};
const bridge: DesktopBridge = {
  async invoke(request) {
    const harness = window.annotationsHarness;
    if (request.op.startsWith('browser.annotation')) {
      harness.calls.push(request);
      const key = request.op === 'browser.annotation' ? request.action : request.op;
      if (harness.hold.includes(key)) await new Promise<void>((resolve, reject) => pending.push({ key, resolve, reject }));
    }
    switch (request.op) {
      case 'bootstrap': return { data: structuredClone(data), approvals: [], terminals: [], version: 'annotation-recovery' };
      case 'ui.update': data = { ...data, ui: applyUiPatch(data.ui, { frame: request.ui }) }; emit(); return data.ui;
      case 'ui.threadPatch': data = { ...data, ui: applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }) }; emit(); return data.ui;
      case 'browser.annotationCapture': {
        const capture = { id: crypto.randomUUID(), page: { ...page, title: request.threadId }, image }; captures.set(capture.id, capture); return capture;
      }
      case 'browser.annotationDiscard': captures.delete(request.captureId); return null;
      case 'browser.annotationSave': {
        const capture = captures.get(request.captureId); if (!capture) throw new Error('标注截图已失效，请重新截图');
        const item: BrowserAnnotation = { ...saved, ...annotationSelection(capture.page, request.selection), id: capture.id, title: capture.page.title };
        const thread = data.threads.find(item => item.id === request.threadId)!;
        if (!thread.browserAnnotations?.some(record => record.id === item.id)) thread.browserAnnotations = [...(thread.browserAnnotations ?? []), item];
        emit(); return item;
      }
      case 'browser.annotation': {
        const thread = data.threads.find(item => item.id === request.threadId)!;
        const item = thread.browserAnnotations?.find(item => item.id === request.annotationId);
        if (request.action === 'remove') { thread.browserAnnotations = thread.browserAnnotations?.filter(item => item.id !== request.annotationId); emit(); return null; }
        if (!item) throw new Error('网页标注不存在');
        if (request.action === 'read') { if (harness.failReads > 0) { harness.failReads--; throw new Error('无法读取网页标注信息'); } return { item, image, stale: false }; }
        return { path: 'C:/annotations/' + item.id + '.png', item, stale: false };
      }
      default: return null;
    }
  },
  onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
};
window.desktop = bridge;
function Surface() {
  const { ready, data } = useApp(), [open, setOpen] = useState(true), [thread, setThread] = useState('t');
  window.annotationsHarness.selectThread = setThread;
  return <><button onClick={() => setOpen(true)}>Open annotations</button><output data-testid="draft">{JSON.stringify(data.ui.threads[thread]?.draft)}</output>
    {ready && open && <BrowserAnnotationsPanel threadId={thread} tabId="page" create={params.get('create') !== 'false'} onClose={() => setOpen(false)} />}</>;
}
createRoot(document.getElementById('root')!).render(<AppProvider><Surface /></AppProvider>);
