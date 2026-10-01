import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { BrowserSites } from '../../../src/renderer/src/components/panels/browser-sites.tsx';
import { dataSchema, type DesktopBridge, type DesktopEvent, type DesktopRequest } from '../../../src/shared/contracts.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

declare global {
  interface Window { sitesHarness: { calls: DesktopRequest[]; hold: boolean; release(error?: string): void; locale(locale: 'zh-CN' | 'en-US'): void; }; }
}
const params = new URLSearchParams(location.search);
let data = dataSchema.parse({ version: 2, projects: [], threads: [], automations: [],
  settings: { theme: params.get('theme') || 'light', browserSitePolicies: { 'https://existing.example': 'deny' } },
  ui: { locale: params.get('locale') || 'zh-CN' },
});
const listeners = new Set<(event: DesktopEvent) => void>();
const emit = () => { for (const listener of listeners) listener({ type: 'state', data }); };
const pending: { resolve(): void; reject(error: Error): void }[] = [];
window.sitesHarness = {
  calls: [], hold: false,
  release(error) { const item = pending.shift(); if (!item) throw new Error('No pending rule'); if (error) item.reject(new Error(error)); else item.resolve(); },
  locale(locale) { data = { ...data, ui: { ...data.ui, locale } }; emit(); },
};
const bridge: DesktopBridge = {
  async invoke(request) {
    switch (request.op) {
      case 'bootstrap': return { data, approvals: [], terminals: [], version: 'site-recovery' };
      case 'ui.update': data = { ...data, ui: applyUiPatch(data.ui, { frame: request.ui }) }; emit(); return data.ui;
      case 'browser.site': {
        window.sitesHarness.calls.push(request);
        if (window.sitesHarness.hold) await new Promise<void>((resolve, reject) => pending.push({ resolve, reject }));
        const rules = { ...data.settings.browserSitePolicies };
        if (request.policy === 'ask') delete rules[request.origin]; else rules[request.origin] = request.policy;
        data = { ...data, settings: { ...data.settings, browserSitePolicies: rules } }; emit(); return data.settings;
      }
      default: return null;
    }
  },
  onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
};
window.desktop = bridge;
function Surface() {
  const { ready } = useApp(), [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>Open sites</button>{ready && open && <BrowserSites url={params.get('url') || ''} onClose={() => setOpen(false)} />}</>;
}
createRoot(document.getElementById('root')!).render(<AppProvider><Surface /></AppProvider>);
