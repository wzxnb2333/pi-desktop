import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultData, type DesktopBridge, type DesktopEvent, type DesktopRequest, type McpConfig } from '../../../src/shared/contracts.ts';
import { pluginSchema } from '../../../src/shared/plugins.ts';
import type { OperationRecord } from '../../../src/shared/operations.ts';
import { applySettingsPatch } from '../../../src/shared/settings-updates.ts';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { setLocale } from '../../../src/shared/localization.ts';
import { PluginsSection } from '../../../src/renderer/src/components/management/plugins-section.tsx';
import '../../../src/renderer/src/styles/index.css';

let data = defaultData();
data.ui.view = 'skills';
data.plugins = [pluginSchema.parse({ id: 'fixture-plugin', source: 'C:/fixture/plugin', enabled: false, current: {
  revision: crypto.randomUUID(), path: 'C:/fixture/installed/content', hash: 'a'.repeat(64), installedAt: 1, approved: false,
  manifest: { schemaVersion: 1, id: 'fixture-plugin', name: '测试插件', version: '1.0.0' },
} })];
if (new URLSearchParams(window.location.search).has('policies')) {
  data.plugins[0].enabled = true; data.plugins[0].current.approved = true;
  data.plugins[0].current.manifest.mcp = [{ id: 'tools', name: '插件工具', enabled: true, transport: 'stdio', command: 'node', args: [], url: '' }];
}
const listeners = new Set<(event: DesktopEvent) => void>();
const calls: DesktopRequest[] = [], held = new Set<string>();
const pending = new Map<number, { request: DesktopRequest; resolve(value: unknown): void; reject(reason: Error): void }>();
let sequence = 0;
const secretIds = new Set<string>();
const publish = () => { for (const listener of listeners) listener({ type: 'state', data }); };
const result = (request: DesktopRequest): unknown => {
  if (request.op === 'bootstrap') return { data, approvals: [], terminals: [], version: 'harness' };
  if (request.op === 'ui.update') { data = { ...data, ui: request.ui }; publish(); return null; }
  if (request.op === 'plugin.start') {
    const operation: OperationRecord = { id: request.requestId, threadId: '', directoryId: request.pluginId, kind: 'plugin.' + request.action, status: 'running', stage: '读取并验证插件', startedAt: Date.now() };
    data = { ...data, operations: [...data.operations, operation] }; publish(); return operation;
  }
  if (request.op === 'plugin.cancel') {
    data = { ...data, operations: data.operations.map(item => item.id === request.requestId ? { ...item, status: 'cancelled', endedAt: Date.now() } : item) };
    publish(); return null;
  }
  if (request.op === 'settings.patch') { data = { ...data, settings: applySettingsPatch(data.settings, request.patch, request.base) }; publish(); return data.settings; }
  if (request.op === 'mcp.secretStatus') return { configured: secretIds.has(request.id) };
  if (request.op === 'mcp.secret') { if (Object.keys(request.value).length) secretIds.add(request.id); else secretIds.delete(request.id); return null; }
  if (request.op === 'plugin.catalog') return [{ sourceId: 'source', path: 'C:/fixture/plugin', manifest: data.plugins[0].current.manifest }];
  return null;
};
const bridge: DesktopBridge = {
  async invoke(request) {
    calls.push(request);
    if (held.has(request.op)) return new Promise((resolve, reject) => pending.set(++sequence, { request, resolve, reject }));
    return result(request);
  },
  onEvent(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
};
interface PluginHarness {
  hold(op: string, enabled: boolean): void;
  pending(op: string): { id: number; request: DesktopRequest }[];
  complete(id: number, options?: { error?: string; value?: unknown }): void;
  operations(records: OperationRecord[]): void;
  configure(patch: Partial<McpConfig>): void;
  locale(value: 'zh-CN' | 'en-US'): void;
  calls(): DesktopRequest[];
}
declare global { interface Window { __plugins: PluginHarness; } }
window.desktop = bridge;
window.__plugins = {
  hold: (op, enabled) => { if (enabled) held.add(op); else held.delete(op); },
  pending: op => [...pending].filter(([, item]) => item.request.op === op).map(([id, item]) => ({ id, request: item.request })),
  complete(id, options = {}) {
    const item = pending.get(id); if (!item) throw new Error('Missing pending plugin request'); pending.delete(id);
    if (options.error) item.reject(new Error(options.error)); else item.resolve('value' in options ? options.value : result(item.request));
  },
  operations: records => { data = { ...data, operations: records }; publish(); },
  configure: patch => { data = { ...data, plugins: data.plugins.map(plugin => ({ ...plugin, current: { ...plugin.current, manifest: { ...plugin.current.manifest, mcp: plugin.current.manifest.mcp.map(server => ({ ...server, ...patch })) } } })) }; publish(); },
  locale: setLocale,
  calls: () => calls,
};
function Harness() {
  const { view, setView } = useApp();
  return <><button onClick={() => setView('thread')}>离开插件页</button>{view === 'skills' ? <PluginsSection /> : <p>已离开插件页</p>}</>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><AppProvider><Harness /></AppProvider></StrictMode>);
