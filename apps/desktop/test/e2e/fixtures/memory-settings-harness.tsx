import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultData, threadSchema, type DesktopRequest } from '../../../src/shared/contracts.ts';
import { memoryEntrySchema, type MemorySnapshot } from '../../../src/shared/memories.ts';
import type { OperationRecord } from '../../../src/shared/operations.ts';
import { applySettingsPatch } from '../../../src/shared/settings-updates.ts';
import { setLocale } from '../../../src/shared/localization.ts';
import { Settings } from '../../../src/renderer/src/Settings.tsx';
import type { RegisterViewGuard } from '../../../src/renderer/src/components/primitives/unsaved-navigation.tsx';
import '../../../src/renderer/src/styles/index.css';

let data = defaultData();
data.threads = [threadSchema.parse({ id: 't', title: '记忆来源聊天', projectId: 'p', cwd: 'C:/project', modelId: '', thinking: 'off', policy: 'auto', createdAt: 1, updatedAt: 2 })];
data.ui.activeThreadId = 't';
let snapshot: MemorySnapshot = { revision: 0, entries: [] };
const held = new Set<string>(location.search.includes('hold-list') ? ['memory.list'] : []);
const calls: DesktopRequest[] = [];
const pending = new Map<number, { request: DesktopRequest; resolve(value: unknown): void; reject(reason: Error): void }>();
let sequence = 0, active = true, left = false;
let guard: Parameters<RegisterViewGuard>[0] | undefined;
const root = createRoot(document.getElementById('root')!);
const registerViewGuard: RegisterViewGuard = next => { guard = next; return () => { if (guard === next) guard = undefined; }; };
const changed = () => { data = { ...data, memoryRevision: snapshot.revision }; render(); };
const result = (request: DesktopRequest): unknown => {
  if (request.op === 'models.catalog') return [];
  if (request.op === 'settings.patch') { data = { ...data, settings: applySettingsPatch(data.settings, request.patch, request.base) }; render(); return data.settings; }
  if (request.op === 'memory.list') return structuredClone(snapshot);
  if (request.op === 'memory.save') {
    const previous = snapshot.entries.find(item => item.id === request.id);
    if (request.id && (!previous || previous.revision !== request.revision)) throw new Error('记忆已被修改或删除，请刷新后重试');
    const entry = memoryEntrySchema.parse({ id: previous?.id ?? crypto.randomUUID(), revision: (previous?.revision ?? 0) + 1, scope: request.scope, text: request.text, enabled: request.enabled, status: 'approved', source: previous?.source ?? { kind: 'manual', createdAt: 1 }, createdAt: 1, updatedAt: snapshot.revision + 2 });
    snapshot = { revision: snapshot.revision + 1, entries: [...snapshot.entries.filter(item => item.id !== entry.id), entry] }; changed(); return entry;
  }
  if (request.op === 'memory.delete' || request.op === 'memory.clear') {
    const previous = request.op === 'memory.delete' ? snapshot.entries.find(item => item.id === request.id) : undefined;
    if (request.op === 'memory.clear' ? snapshot.revision !== request.revision : !previous || previous.revision !== request.revision) throw new Error('记忆已被修改或删除，请刷新后重试');
    snapshot = { revision: snapshot.revision + 1, entries: request.op === 'memory.clear' ? [] : snapshot.entries.filter(item => item.id !== request.id) }; changed(); return null;
  }
  if (request.op === 'operation.cancel') { data = { ...data, operations: data.operations.map(item => item.id === request.requestId ? { ...item, status: 'cancelled', endedAt: 3 } : item) }; render(); return null; }
  return null;
};
const invoke = async (request: DesktopRequest): Promise<unknown> => {
  calls.push(request);
  if (held.has(request.op)) return new Promise((resolve, reject) => pending.set(++sequence, { request, resolve, reject }));
  return result(request);
};
interface MemoryHarness {
  hold(op: string, value: boolean): void; pending(op: string): { id: number; request: DesktopRequest }[];
  complete(id: number, options?: { error?: string; value?: unknown }): void;
  changeSnapshot(value: MemorySnapshot): void; snapshot(): MemorySnapshot; operations(value: OperationRecord[]): void;
  active(value: boolean): void; leave(): void; left(): boolean; calls(): DesktopRequest[];
  locale(value: 'zh-CN' | 'en-US', theme: 'light' | 'dark'): void;
}
declare global { interface Window { __memories: MemoryHarness; } }
window.__memories = {
  hold: (op, value) => { if (value) held.add(op); else held.delete(op); },
  pending: op => [...pending].filter(([, item]) => item.request.op === op).map(([id, item]) => ({ id, request: item.request })),
  complete(id, options = {}) { const item = pending.get(id); if (!item) throw new Error('Missing pending request'); pending.delete(id); if (options.error) item.reject(new Error(options.error)); else item.resolve('value' in options ? options.value : result(item.request)); },
  changeSnapshot: value => { snapshot = value; changed(); }, snapshot: () => structuredClone(snapshot),
  operations: value => { data = { ...data, operations: value }; render(); },
  active: value => { active = value; render(); },
  leave: () => { const proceed = () => { left = true; render(); }; if (guard) guard(proceed, () => {}); else proceed(); },
  left: () => left, calls: () => calls,
  locale(value, theme) { setLocale(value); document.documentElement.dataset.theme = theme; render(); },
};
function render() { root.render(<StrictMode>{!left && <Settings data={data} category={active ? 'memories' : 'general'} invoke={invoke} registerViewGuard={registerViewGuard} />}</StrictMode>); }
render();
