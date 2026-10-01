declare global {
  interface Window { pdfRecovery: { holdText: boolean; holdRender: boolean; failRender: boolean; failLoad: boolean; release(kind: 'text' | 'render'): void; }; }
}
const waits: { kind: 'text' | 'render'; resolve(): void }[] = [];
window.pdfRecovery = {
  holdText: false, holdRender: false, failRender: false, failLoad: new URLSearchParams(location.search).has('failPdf'),
  release(kind) { const index = waits.findIndex(item => item.kind === kind); if (index < 0) throw new Error('No pending PDF ' + kind); waits.splice(index, 1)[0].resolve(); },
};
Object.defineProperty(window, 'Worker', { value: class { terminate() {} } });
export const PDFWorker = { create: () => ({ destroy() {} }) };
export function getDocument() {
  if (window.pdfRecovery.failLoad) throw new Error('WORKER_SETUP_FAILED');
  return { destroy: async () => {}, onPassword: undefined,
    promise: Promise.resolve({ numPages: 2, async getPage(page: number) { return {
      getViewport: ({ scale }: { scale: number }) => ({ width: 200 * scale, height: 100 * scale }),
      render: ({ canvas }: { canvas: HTMLCanvasElement }) => {
        let cancelled = false;
        return { cancel() { cancelled = true; }, promise: (async () => {
          if (window.pdfRecovery.holdRender) await new Promise<void>(resolve => waits.push({ kind: 'render', resolve }));
          if (cancelled) throw Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' });
          if (window.pdfRecovery.failRender) throw new Error('RENDER_FAILED');
          const context = canvas.getContext('2d')!; context.fillStyle = page === 1 ? '#ff0000' : '#0000ff'; context.fillRect(0, 0, canvas.width, canvas.height);
        })() };
      },
      async getTextContent() {
        if (window.pdfRecovery.holdText) await new Promise<void>(resolve => waits.push({ kind: 'text', resolve }));
        return { items: [{ str: page === 1 ? 'Alpha first page' : 'Beta second page' }] };
      },
    }; } }),
  };
}
