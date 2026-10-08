import { createRoot } from 'react-dom/client';
import { BrowserSettings } from '../../../src/renderer/src/BrowserSettings.tsx';
import { PreviewPanel } from '../../../src/renderer/src/components/panels/preview-panel.tsx';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { dataSchema, type DesktopEvent, type DesktopRequest } from '../../../src/shared/contracts.ts';
import type { ChromeBridgeStatus } from '../../../src/shared/browser-bridge.ts';
import { setLocale } from '../../../src/shared/localization.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import '../../../src/renderer/src/styles/index.css';

declare global {
  interface Window {
    bridgeHarness: {
      calls: DesktopRequest[];
      hold: boolean;
      holdStatus: boolean;
      release(error?: string): void;
      releaseStatus(): void;
      emit(state: 'tabs' | 'connected' | 'disconnected'): void;
      disconnect(): void;
      select(threadId: string): void;
    };
  }
}
const params = new URLSearchParams(location.search);
setLocale(params.get('locale') === 'en-US' ? 'en-US' : 'zh-CN');
document.documentElement.dataset.theme = params.get('theme') || 'light';
const thread = { projectId: 'project', cwd: 'C:/project', createdAt: 1, updatedAt: 1, modelId: 'model', thinking: 'high', policy: 'auto' };
const data = dataSchema.parse({ version: 3, projects: [], automations: [], settings: { theme: params.get('theme') || 'light' }, ui: { locale: params.get('locale') || 'zh-CN', activeThreadId: 'main' }, threads: [
  { ...thread, id: 'main', title: 'Main task' },
  { ...thread, id: 'other', title: 'Other task' },
  { ...thread, id: 'plan', title: 'Plan task', planMode: true },
  { ...thread, id: 'deny', title: 'Denied task', policy: 'deny' },
  { ...thread, id: 'child', title: 'Child task', subtaskId: '00000000-0000-4000-8000-000000000001' },
  { ...thread, id: 'archive', title: 'Archived task', archived: true },
] });
let status: ChromeBridgeStatus = { running: true, protocol: 2, port: 23456, pairing: null, sessions: [{
  id: 'session', version: '0.2.0', connectedAt: 1, expiresAt: Date.now() + 86400000,
  tabs: [
    { tabId: 'session/1', title: 'Main page', url: 'https://main.example', ownerThreadId: 'main' },
    { tabId: 'session/2', title: 'Other page', url: 'https://other.example', ownerThreadId: 'other' },
    { tabId: 'session/3', title: 'Unassigned page', url: 'https://free.example' },
    { tabId: 'session/4', title: 'Plan page', url: 'https://plan.example', ownerThreadId: 'plan' },
  ],
}] };
const pending: { resolve(): void; reject(error: Error): void }[] = [];
const statusReads: Array<() => void> = [];
const listeners = new Set<(event: DesktopEvent) => void>();
window.bridgeHarness = { calls: [], hold: false, holdStatus: false, release(error) {
  const item = pending.shift(); if (!item) throw new Error('No pending bridge command');
  if (error) item.reject(new Error(error)); else item.resolve();
}, releaseStatus() {
  const resolve = statusReads.shift(); if (!resolve) throw new Error('No pending status read'); resolve();
}, emit(state) {
  for (const listener of listeners) listener({ type: 'browser.bridge', sessionId: 'session', state });
}, disconnect() {
  status = { ...status, sessions: [] };
  window.bridgeHarness.emit('disconnected');
}, select(threadId) {
  data.ui = { ...data.ui, activeThreadId: threadId };
  for (const listener of listeners) listener({ type: 'state', data: structuredClone(data) });
} };
async function invoke(request: DesktopRequest) {
  window.bridgeHarness.calls.push(request);
  if (request.op === 'bootstrap') return { data, approvals: [], terminals: [], version: 'browser-bridge-fixture' };
  if (request.op === 'ui.update') { data.ui = applyUiPatch(data.ui, { frame: request.frame ?? request.ui }); return data.ui; }
  if (request.op === 'ui.threadPatch') { data.ui = applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch }); return data.ui; }
  if (request.op === 'browser.downloads') return [];
  if (request.op === 'browser.bridge.status' || request.op === 'browser.bridge.tabs') {
    const snapshot = request.op === 'browser.bridge.status' ? structuredClone(status) : status.sessions.flatMap(session => session.tabs.filter(tab => tab.ownerThreadId === request.threadId).map(tab => ({ ...tab, sessionId: session.id, backend: 'chrome' })));
    if (window.bridgeHarness.holdStatus) await new Promise<void>(resolve => statusReads.push(resolve));
    return snapshot;
  }
  if (window.bridgeHarness.hold) await new Promise<void>((resolve, reject) => pending.push({ resolve, reject }));
  if (request.op === 'browser.bridge.pair') status = { ...status, port: 34567, pairing: { code: 'ABC123', expiresAt: Date.now() + 300000 } };
  if (request.op === 'browser.bridge.disconnect') status = { ...status, sessions: request.sessionId ? status.sessions.filter(item => item.id !== request.sessionId) : [] };
  if (request.op === 'browser.bridge.grant') status = { ...status, sessions: status.sessions.map(session => ({ ...session, tabs: session.tabs.map(tab => tab.tabId === request.tabId ? { ...tab, ownerThreadId: request.allowed ? request.threadId : undefined } : tab) })) };
  return null;
}
window.desktop = { invoke, onEvent(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
function PanelHarness() {
  const { ready } = useApp();
  return ready && <><input aria-label="Chat draft" /><PreviewPanel launcher={<span>Browser panel ready</span>} /></>;
}
createRoot(document.getElementById('root')!).render(params.get('mode') === 'panel'
  ? <AppProvider><PanelHarness /></AppProvider>
  : <div className="settings-content"><BrowserSettings data={data} invoke={invoke} /></div>);
