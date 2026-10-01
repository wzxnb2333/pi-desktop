import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { type DesktopRequest, type Thread, defaultData, threadSchema } from '../../../src/shared/contracts.ts';
import { Settings } from '../../../src/renderer/src/Settings.tsx';
import { applySettingsPatch } from '../../../src/shared/settings-updates.ts';
import type { OperationRecord } from '../../../src/shared/operations.ts';
import { setLocale } from '../../../src/shared/localization.ts';
import '../../../src/renderer/src/styles/index.css';

interface McpHarness {
  hold(op: string, enabled: boolean): void;
  pending(op: string): { id: number; request: DesktopRequest }[];
  complete(id: number, options?: { error?: string; value?: unknown }): void;
  changeThread(patch: Partial<Thread>): void;
  operations(records: OperationRecord[]): void;
  mount(visible: boolean): void;
  calls(): DesktopRequest[];
  locale(value: 'zh-CN' | 'en-US'): void;
}
declare global { interface Window { __mcp: McpHarness; } }
let data = defaultData();
data.settings.mcpServers = [{ id: 'm', name: '本地 MCP', enabled: true, transport: 'stdio', command: 'node', args: [], url: '' }];
const params = new URLSearchParams(window.location.search);
if (params.has('oauth')) data.settings.mcpServers = [{ id: 'm', name: '本地 OAuth', enabled: true, transport: 'http', command: '', args: [], url: 'http://127.0.0.1:12345/mcp', oauth: { clientId: '', scope: '' } }];
data.threads = [threadSchema.parse({ id: 't', title: '已有任务', projectId: 'p', cwd: 'C:/project', providerId: '', thinking: 'off', policy: 'auto', createdAt: 1, updatedAt: 2,
  mcp: [{ id: 'm', state: 'disconnected', tools: [{ name: 'mcp_echo', label: '本地 MCP · echo', description: '工具描述' }] }] })];
const calls: DesktopRequest[] = [];
const held = new Set<string>();
if (params.has('holdStatus')) held.add('mcp.oauthStatus');
const pending = new Map<number, { request: DesktopRequest; resolve(value: unknown): void; reject(error: Error): void }>();
let sequence = 0;
let visible = true;
const root = createRoot(document.getElementById('root')!);
const result = (request: DesktopRequest): unknown => {
  if (request.op === 'models.catalog') return [{ id: 'local', models: [] }];
  if (request.op === 'settings.save') { data = { ...data, settings: request.settings }; render(); return null; }
  if (request.op === 'settings.patch') { data = { ...data, settings: applySettingsPatch(data.settings, request.patch, request.base) }; render(); return data.settings; }
  if (request.op === 'mcp.test') return [{ name: 'mcp_echo', label: '本地 MCP · echo', description: '工具描述' }];
  if (request.op === 'mcp.oauthStatus') return { state: 'disconnected' };
  if (request.op === 'mcp.oauthCancel') {
    data = { ...data, operations: data.operations.map(item => item.id === request.requestId ? { ...item, status: 'cancelled', endedAt: Date.now() } : item) };
    render(); return null;
  }
  if (request.op === 'mcp.retry') {
    const mcp = [{ id: 'm', state: 'connected' as const, tools: [{ name: 'mcp_echo', label: '本地 MCP · echo', description: '工具描述' }] }];
    data = { ...data, threads: data.threads.map(thread => ({ ...thread, mcp })) }; render(); return mcp;
  }
  return null;
};
const invoke = async (request: DesktopRequest): Promise<unknown> => {
  calls.push(request);
  if (held.has(request.op)) return new Promise((resolve, reject) => pending.set(++sequence, { request, resolve, reject }));
  return result(request);
};
function render() { root.render(<StrictMode>{visible && <Settings data={data} category="mcp" invoke={invoke} />}</StrictMode>); }
window.__mcp = {
  hold: (op, enabled) => { if (enabled) held.add(op); else held.delete(op); },
  pending: op => [...pending].filter(([, item]) => item.request.op === op).map(([id, item]) => ({ id, request: item.request })),
  complete: (id, options = {}) => {
    const item = pending.get(id);
    if (!item) throw new Error('Missing pending request');
    pending.delete(id);
    if (options.error) item.reject(new Error(options.error));
    else item.resolve('value' in options ? options.value : result(item.request));
  },
  changeThread: patch => { data = { ...data, threads: data.threads.map(thread => ({ ...thread, ...patch })) }; render(); },
  operations: records => { data = { ...data, operations: records }; render(); },
  mount: next => { visible = next; render(); },
  calls: () => calls,
  locale: setLocale,
};
render();
