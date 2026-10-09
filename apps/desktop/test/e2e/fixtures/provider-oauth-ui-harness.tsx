import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type { DesktopEvent, DesktopRequest, ModelCatalog, ModelProvider, ProviderAuthStatus } from '../../../src/shared/contracts.ts';
import { ModelSettings } from '../../../src/renderer/src/ModelSettings.tsx';
import { setLocale } from '../../../src/shared/localization.ts';
import '../../../src/renderer/src/styles/index.css';

interface ProviderAuthHarnessApi {
  calls(): DesktopRequest[];
  order(): string[];
  providers(): ModelProvider[];
  changeProvider(id: string, patch: Partial<ModelProvider>): void;
  clearTimeline(): void;
  emit(status: ProviderAuthStatus): void;
  status(status: ProviderAuthStatus): void;
  startStatus(): ProviderAuthStatus | null;
  holdStart(enabled: boolean): void;
  releaseStart(status?: ProviderAuthStatus): void;
  queueStart(status: ProviderAuthStatus): void;
  holdAnswer(enabled: boolean): void;
  releaseAnswer(value: unknown): void;
  holdStatus(enabled: boolean): void;
  releaseStatus(id: string, error?: string): void;
  openResult(result: unknown): void;
  statusFailure(message: string): void;
  persistResult(result: boolean): void;
  locale(locale: 'zh-CN' | 'en-US'): void;
}

declare global { interface Window { providerAuthUi: ProviderAuthHarnessApi; } }

const catalog: ModelCatalog = [
  { id: 'dual', auth: { apiKey: true, oauth: { name: 'Dual OAuth', loginLabel: 'Dual Account', isSubscription: true } }, models: [] },
  { id: 'oauth-only', auth: { apiKey: false, oauth: { name: 'Orbit OAuth', loginLabel: 'Orbit Account' } }, models: [] },
  { id: 'api-only', auth: { apiKey: true }, models: [] },
];
const initialProviders: ModelProvider[] = [
  { id: 'dual', name: 'Dual', kind: 'builtin', namespace: 'dual', baseUrl: '', api: 'openai-completions', hasKey: false, authMethod: 'api_key' },
  { id: 'oauth-legacy', name: 'Legacy OAuth', kind: 'builtin', namespace: 'oauth-only', baseUrl: '', api: 'openai-completions', hasKey: false, authMethod: 'api_key' },
  { id: 'key-only', name: 'Key Only', kind: 'builtin', namespace: 'api-only', baseUrl: '', api: 'openai-completions', hasKey: false, authMethod: 'api_key' },
];
const calls: DesktopRequest[] = [];
const actions: string[] = [];
const timeline: string[] = [];
const statuses = new Map<string, ProviderAuthStatus>();
const listeners = new Set<(event: DesktopEvent) => void>();
const statusErrors = new Map<string, string>();
let providers = structuredClone(initialProviders);
let replaceProviders: (next: ModelProvider[]) => void = () => {};
let heldStart = false;
let persistSucceeds = true;
let openResponse: unknown = null;
let latestStart: ProviderAuthStatus | null = null;
let eventRevision = 0;
let heldStarts: { id: string; resolve(value: unknown): void; eventsAtStart: number }[] = [];
let heldAnswers: ((value: unknown) => void)[] = [];
let heldAnswer = false;
let heldStatus = new URLSearchParams(window.location.search).has('holdStatus');
let heldStatusReads: { id: string; resolve(value: unknown): void; reject(error: Error): void }[] = [];
const startQueue: ProviderAuthStatus[] = [];
let sequence = 0;

const uuid = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
const idle = (id: string): ProviderAuthStatus => ({ id, connected: false, phase: 'idle' });
for (const provider of providers) statuses.set(provider.id, idle(provider.id));

function publish(status: ProviderAuthStatus, notify = true) {
  statuses.set(status.id, structuredClone(status));
  if (!notify) return;
  eventRevision++;
  for (const listener of listeners) listener({ type: 'provider.auth', status: structuredClone(status) });
}

function result(request: DesktopRequest): unknown {
  if (request.op === 'provider.oauthStatus') {
    if (heldStatus) return new Promise((resolve, reject) => heldStatusReads.push({ id: request.id, resolve, reject }));
    const failure = statusErrors.get(request.id);
    if (failure) throw new Error(failure);
    return structuredClone(statuses.get(request.id) ?? idle(request.id));
  }
  if (request.op === 'provider.oauthStart') {
    const operationId = uuid();
    latestStart = startQueue.shift() ?? { id: request.id, connected: false, phase: 'logging_in', operationId };
    if (heldStart) {
      return new Promise(resolve => heldStarts.push({ id: request.id, resolve, eventsAtStart: eventRevision }));
    }
    publish(latestStart);
    return structuredClone(latestStart);
  }
  if (request.op === 'provider.oauthCancel') {
    const next: ProviderAuthStatus = { id: request.id, connected: false, phase: 'idle', operationId: request.operationId };
    publish(next);
    return null;
  }
  if (request.op === 'provider.oauthLogout') {
    publish(idle(request.id));
    return null;
  }
  if (request.op === 'provider.oauthOpen') return openResponse;
  if (request.op === 'provider.oauthAnswer') {
    if (heldAnswer) return new Promise(resolve => heldAnswers.push(resolve));
    const next: ProviderAuthStatus = { id: request.id, connected: false, phase: 'logging_in', operationId: request.operationId };
    publish(next);
    return null;
  }
  return null;
}

const invoke = async (request: DesktopRequest): Promise<unknown> => {
  calls.push(structuredClone(request));
  timeline.push(request.op);
  return result(request);
};

function Harness() {
  const [modelProviders, setModelProviders] = useState<ModelProvider[]>(structuredClone(initialProviders));
  const [selected, setSelected] = useState('dual');
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [savedProviderIds, setSavedProviderIds] = useState(initialProviders.map(provider => provider.id));
  replaceProviders = setModelProviders;
  return <ModelSettings providers={modelProviders} models={[]} defaultId="" selected={selected} keys={keys}
    savedProviderIds={savedProviderIds}
    catalog={catalog} catalogError="" invoke={invoke} persist={async () => {
      actions.push('persist'); timeline.push('persist');
      if (persistSucceeds) setSavedProviderIds(providers.map(provider => provider.id));
      return persistSucceeds;
    }}
    onSelect={setSelected}
    onAddProvider={provider => { providers = [...providers, provider]; setModelProviders(providers); setSelected(provider.id); }}
    onChange={patch => changeProvider(selected, patch, setModelProviders)}
    onRetry={() => {}}
    onKey={(id, value) => setKeys(previous => ({ ...previous, [id]: value }))}
    onAddModel={() => {}} onModelChange={() => {}} onModelDelete={() => {}}
    onDeleteProvider={id => { providers = providers.filter(provider => provider.id !== id); setModelProviders(providers); }} />;
}

function changeProvider(id: string, patch: Partial<ModelProvider>, update: (value: ModelProvider[]) => void = replaceProviders) {
  providers = providers.map(provider => provider.id === id ? { ...provider, ...patch } : provider);
  update(providers);
}

const root = createRoot(document.getElementById('root')!);
window.desktop = {
  invoke,
  onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
};
window.providerAuthUi = {
  calls: () => structuredClone(calls),
  order: () => [...timeline],
  providers: () => structuredClone(providers),
  clearTimeline: () => { calls.length = 0; actions.length = 0; timeline.length = 0; },
  changeProvider: (id, patch) => changeProvider(id, patch),
  emit: status => publish(status),
  status: status => publish(status, false),
  startStatus: () => latestStart && structuredClone(latestStart),
  holdStart: enabled => { heldStart = enabled; },
  releaseStart: response => {
    const pending = heldStarts.shift();
    if (!pending) throw new Error('No held OAuth start');
    const next = response ?? latestStart;
    if (!next) throw new Error('Missing OAuth start response');
    if (eventRevision === pending.eventsAtStart) publish(next, false);
    pending.resolve(structuredClone(next));
  },
  queueStart: status => { startQueue.push(structuredClone(status)); },
  holdAnswer: enabled => { heldAnswer = enabled; },
  releaseAnswer: value => {
    const resolve = heldAnswers.shift();
    if (!resolve) throw new Error('No held OAuth answer');
    resolve(value);
  },
  holdStatus: enabled => { heldStatus = enabled; },
  releaseStatus: (id, error) => {
    const index = heldStatusReads.findLastIndex(read => read.id === id);
    if (index === -1) throw new Error('No held OAuth status read');
    const [pending] = heldStatusReads.splice(index, 1);
    if (error) pending.reject(new Error(error));
    else pending.resolve(structuredClone(statuses.get(id) ?? idle(id)));
  },
  openResult: result => { openResponse = result; },
  statusFailure: message => {
    if (message) statusErrors.set('dual', message);
    else statusErrors.delete('dual');
  },
  persistResult: result => { persistSucceeds = result; },
  locale: setLocale,
};
root.render(<Harness />);
