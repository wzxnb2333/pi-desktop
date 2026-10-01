import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { type DesktopEvent, type DesktopRequest, type Settings, type Thread, bootstrapSchema, defaultData, threadSchema } from '../../../src/shared/contracts.ts';
import { AppProvider } from '../../../src/renderer/src/state/app.tsx';
import { applySettingsPatch } from '../../../src/shared/settings-updates.ts';
import { SkillsPage } from '../../../src/renderer/src/components/management/skills-page.tsx';
import '../../../src/renderer/src/styles/index.css';

interface ResourceHarness {
  hold(op: string, enabled: boolean): void;
  pending(op: string): { id: number; request: DesktopRequest }[];
  complete(id: number, options?: { error?: string; value?: unknown }): void;
  changeResources(resources: Settings['resources']): void;
  changeThread(patch: Partial<Thread>): void;
  theme(value: Settings['theme']): void;
  locale(value: 'zh-CN' | 'en-US'): void;
  calls(): DesktopRequest[];
}
declare global { interface Window { __resources: ResourceHarness; } }
let data = defaultData();
data.settings.resources = [
  { id: 'alpha', name: 'Alpha', kind: 'skill', path: 'C:/shared/alpha/SKILL.md', enabled: true },
  { id: 'beta', name: 'Beta', kind: 'skill', path: 'C:/shared/beta/SKILL.md', enabled: true },
  { id: 'extension', name: '扩展', kind: 'extension', path: 'C:/shared/extension.mjs', enabled: true },
];
data.threads = [threadSchema.parse({ id: 't', title: '有加载错误的任务', projectId: 'p', cwd: 'C:/project', providerId: '', thinking: 'off', policy: 'auto', createdAt: 1, updatedAt: 2, resourceLoad: { checkedAt: 5, diagnostics: [{ kind: 'extension', type: 'error', path: 'C:/shared/extension.mjs', message: 'RUNTIME_EXTENSION_FAILURE' }] } })];
data.ui.activeThreadId = 't';
const listeners = new Set<(event: DesktopEvent) => void>();
const calls: DesktopRequest[] = [];
const held = new Set<string>(location.search.includes('hold-check') ? ['resource.inspect'] : []);
const pending = new Map<number, { request: DesktopRequest; resolve(value: unknown): void; reject(error: Error): void }>();
let sequence = 0;
const broadcast = () => listeners.forEach(listener => listener({ type: 'state', data }));
const result = (request: DesktopRequest): unknown => {
  if (request.op === 'bootstrap') return bootstrapSchema.parse({ data, approvals: [], terminals: [], version: 'resources-test' });
  if (request.op === 'ui.update') { data = { ...data, ui: request.ui }; broadcast(); return data.ui; }
  if (request.op === 'settings.save') { data = { ...data, settings: request.settings }; broadcast(); return null; }
  if (request.op === 'settings.patch') { data = { ...data, settings: applySettingsPatch(data.settings, request.patch, request.base) }; broadcast(); return data.settings; }
  if (request.op === 'resource.open') return request.reveal ? null : request.id.toUpperCase() + '_BODY';
  if (request.op === 'resource.inspect') return { checkedAt: 1, directory: 'C:/shared', descriptions: Object.fromEntries(data.settings.resources.map(resource => [resource.id, '描述 ' + resource.id])), diagnostics: [] };
  if (request.op === 'resource.refresh') return data.settings.resources;
  if (request.op === 'resource.create') {
    const resource = { id: 'created', name: request.name, kind: 'skill' as const, path: 'C:/shared/created/SKILL.md', enabled: true };
    data = { ...data, settings: { ...data.settings, resources: [...data.settings.resources, resource] } }; broadcast(); return resource;
  }
  return null;
};
window.desktop = {
  invoke: async request => {
    calls.push(request);
    if (held.has(request.op)) return new Promise((resolve, reject) => pending.set(++sequence, { request, resolve, reject }));
    return result(request);
  },
  onEvent: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
window.__resources = {
  hold: (op, enabled) => { if (enabled) held.add(op); else held.delete(op); },
  pending: op => [...pending].filter(([, item]) => item.request.op === op).map(([id, item]) => ({ id, request: item.request })),
  complete: (id, options = {}) => {
    const item = pending.get(id);
    if (!item) throw new Error('Missing pending request');
    pending.delete(id);
    if (options.error) item.reject(new Error(options.error));
    else item.resolve('value' in options ? options.value : result(item.request));
  },
  changeResources: resources => { data = { ...data, settings: { ...data.settings, resources } }; broadcast(); },
  changeThread: patch => { data = { ...data, threads: data.threads.map(thread => ({ ...thread, ...patch })) }; broadcast(); },
  theme: theme => { data = { ...data, settings: { ...data.settings, theme } }; broadcast(); },
  locale: locale => { data = { ...data, ui: { ...data.ui, locale } }; broadcast(); },
  calls: () => calls,
};
createRoot(document.getElementById('root')!).render(<StrictMode><AppProvider><SkillsPage /></AppProvider></StrictMode>);
