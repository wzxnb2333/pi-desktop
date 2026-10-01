import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArtifactAnnotations } from '../../../src/renderer/src/components/panels/artifact-annotations.tsx';
import { ArtifactPreviewPanel } from '../../../src/renderer/src/components/panels/artifact-preview.tsx';
import { PdfPreview } from '../../../src/renderer/src/components/panels/pdf-preview.tsx';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { dataSchema, type DesktopBridge, type DesktopEvent, type DesktopRequest } from '../../../src/shared/contracts.ts';
import type { ArtifactAnnotation, ArtifactCapture, ArtifactStatus } from '../../../src/shared/artifacts.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

declare global {
  interface Window { artifactRecovery: {
    calls: DesktopRequest[]; hold: string[]; failReads: number; pdfCaptures: { page: number; image: string }[];
    release(key: string, error?: string): void; locale(value: 'zh-CN' | 'en-US'): void;
    selectPath(path: string): void; markDeleting(): void;
  }; }
}
const params = new URLSearchParams(location.search), mode = params.get('surface') || 'annotations';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const capture: ArtifactCapture = { id: crypto.randomUUID(), image, width: 800, height: 600, page: 2 };
const saved: ArtifactAnnotation = { id: crypto.randomUUID(), createdAt: 1, directoryId: 'p', root: 'C:/project', path: 'document.pdf', kind: 'pdf', version: 'a'.repeat(64), resources: {}, imageHash: 'b'.repeat(64), page: 2, width: 800, height: 600, scrollX: 0, scrollY: 0, rect: { x: 10, y: 20, width: 50, height: 40 }, comment: 'Existing artifact' };
let data = dataSchema.parse({ version: 3, projects: [{ id: 'p', name: 'Project', path: 'C:/project', trusted: true, createdAt: 1 }], automations: [],
  threads: [{ id: 't', projectId: 'p', title: 'Artifacts', cwd: 'C:/project', createdAt: 1, updatedAt: 1, modelId: '', policy: 'deny', thinking: 'off', artifactAnnotations: [saved] }],
  settings: { theme: params.get('theme') || 'light' }, ui: { locale: params.get('locale') || 'zh-CN', activeThreadId: 't', threads: { t: { draft: { text: 'Existing draft', attachments: [] } } } },
});
const listeners = new Set<(event: DesktopEvent) => void>();
const emit = () => { for (const listener of listeners) listener({ type: 'state', data: structuredClone(data) }); };
const waits: { key: string; resolve(): void; reject(error: Error): void }[] = [];
const states = new Map<string, ArtifactStatus>();
window.artifactRecovery = {
  calls: [], hold: params.has('holdOpen') ? ['artifact.open'] : [], failReads: 0, pdfCaptures: [], selectPath() {},
  release(key, error) { const index = waits.findIndex(item => item.key === key); if (index < 0) throw new Error('No pending ' + key); const [item] = waits.splice(index, 1); if (error) item.reject(new Error(error)); else item.resolve(); },
  locale(locale) { data = { ...data, ui: { ...data.ui, locale } }; emit(); },
  markDeleting() { data.threads[0].artifactAnnotations![0].deleting = true; emit(); },
};
const bridge: DesktopBridge = {
  async invoke(request) {
    const harness = window.artifactRecovery;
    if (request.op.startsWith('artifact.')) {
      harness.calls.push(request);
      const key = request.op === 'artifact.annotation' ? request.action : request.op;
      if (harness.hold.includes(key)) await new Promise<void>((resolve, reject) => waits.push({ key, resolve, reject }));
    }
    switch (request.op) {
      case 'bootstrap': return { data: structuredClone(data), approvals: [], terminals: [], version: 'artifact-recovery' };
      case 'ui.update': data.ui = applyUiPatch(data.ui, { frame: request.ui }); emit(); return data.ui;
      case 'ui.threadPatch': data.ui = applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }); emit(); return data.ui;
      case 'artifact.open': states.set(request.requestId, { loading: false, blocked: ['https://example.com'], allowed: [] }); return { id: request.requestId, path: request.path, kind: 'html', version: 'a'.repeat(64) };
      case 'artifact.status': return states.get(request.previewId) ?? { loading: false, blocked: [], allowed: [] };
      case 'artifact.network': states.set(request.previewId, { loading: false, blocked: request.allowed ? [] : [request.origin], allowed: request.allowed ? [request.origin] : [] }); return null;
      case 'artifact.capture': return { ...capture, id: crypto.randomUUID() };
      case 'artifact.annotationSave': {
        const item = { ...saved, id: request.captureId, rect: request.rect, comment: request.comment };
        if (!data.threads[0].artifactAnnotations!.some(record => record.id === item.id)) data.threads[0].artifactAnnotations!.push(item);
        emit(); return item;
      }
      case 'artifact.annotation': {
        const item = data.threads[0].artifactAnnotations!.find(item => item.id === request.annotationId);
        if (request.action === 'remove') { data.threads[0].artifactAnnotations = data.threads[0].artifactAnnotations!.filter(item => item.id !== request.annotationId); emit(); return null; }
        if (!item) throw new Error('产物标注不存在');
        if (request.action === 'read') { if (harness.failReads > 0) { harness.failReads--; throw new Error('标注截图已损坏，原始记录仍保留'); } return { item, image, stale: false }; }
        return { item, path: 'C:/annotations/' + item.id + '.png', stale: false };
      }
      default: return null;
    }
  },
  onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
};
window.desktop = bridge;
function Surface() {
  const { ready, data } = useApp(), [path, setPath] = useState(mode === 'preview' ? 'first.html' : 'document.pdf'), [open, setOpen] = useState(true);
  window.artifactRecovery.selectPath = setPath;
  return <><output data-testid="draft">{JSON.stringify(data.ui.threads.t?.draft)}</output><div style={{ height: '90vh', display: 'flex' }}>
    {ready && mode === 'preview' && <ArtifactPreviewPanel path={path} />}
    {ready && mode === 'annotations' && open && <ArtifactAnnotations threadId="t" directoryId="p" path={path} capture={params.has('savedOnly') ? undefined : capture} onClose={() => setOpen(false)} />}
    {ready && mode === 'pdf' && <PdfPreview document={{ id: 'pdf', path, kind: 'pdf', version: 'a'.repeat(64), data: btoa('%PDF-') }} identity={path} onCapture={value => { window.artifactRecovery.pdfCaptures.push(value); }} />}
  </div></>;
}
createRoot(document.getElementById('root')!).render(<AppProvider><Surface /></AppProvider>);
