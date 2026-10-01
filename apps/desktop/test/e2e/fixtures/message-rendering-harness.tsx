import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { Timeline } from '../../../src/renderer/src/components/timeline/timeline.tsx';
import { dataSchema, defaultData, threadSchema, type DesktopBridge, type DesktopEvent, type TimelineItem } from '../../../src/shared/contracts.ts';
import { applyUiPatch } from '../../../src/shared/ui-patches.ts';
import { conversationSources, findConversation } from '../../../src/renderer/src/lib/conversation-search.ts';
import { focusConversationMatch } from '../../../src/renderer/src/lib/conversation-search-dom.ts';
import '../../../src/renderer/src/styles/index.css';

const params = new URLSearchParams(location.search), initial = defaultData();
const data = dataSchema.parse({ ...initial, settings: { ...initial.settings, theme: params.get('theme') || 'light' },
  threads: [threadSchema.parse({ id: 't', projectId: 'p', title: 'Messages', cwd: '.', createdAt: 1, updatedAt: 1, providerId: '', thinking: 'off', policy: 'deny' })],
  ui: { ...initial.ui, locale: params.get('locale') || 'zh-CN', activeThreadId: 't' } });
let listener: ((event: DesktopEvent) => void) | undefined;
const bridge: DesktopBridge = {
  async invoke(request) {
    if (request.op === 'bootstrap') return { data, approvals: [], terminals: [], version: 'message-benchmark' };
    if (request.op === 'ui.threadPatch') data.ui = applyUiPatch(data.ui, { threadId: request.threadId, thread: request.patch });
    if (request.op === 'ui.threadUpdate') data.ui.threads[request.threadId] = request.thread;
    if (request.op === 'ui.update') data.ui = applyUiPatch(data.ui, { frame: request.frame ?? request.ui });
    listener?.({ type: 'state', data: structuredClone(data) }); return structuredClone(data.ui);
  },
  onEvent(callback) { listener = callback; return () => { listener = undefined; }; },
};
window.desktop = bridge;
export interface MessageBenchmark {
  commits: number[];
  update(items?: TimelineItem[]): void;
  search(query: string): Promise<boolean>;
}
declare global { interface Window { messageBenchmark: MessageBenchmark; } }
window.messageBenchmark = { commits: [], update(items) { if (items) data.threads[0].items = items; listener?.({ type: 'state', data: structuredClone(data) }); }, search: async () => false };
function Harness() {
  const { ready, thread, timelineRef, followRef, patchThread } = useApp();
  if (!ready) return null;
  window.messageBenchmark.search = async query => {
    if (!thread || !timelineRef.current) return false;
    const match = findConversation(conversationSources(thread.items, false), query).matches[0]; if (!match) return false;
    followRef.current = false; patchThread({ folds: Object.fromEntries(match.folds.map(key => [key, true])) });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return focusConversationMatch(timelineRef.current, match, query, new AbortController().signal);
  };
  return <div data-message-ready style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}><Profiler id="timeline" onRender={(_id, _phase, duration) => window.messageBenchmark.commits.push(duration)}><Timeline /></Profiler></div>;
}
createRoot(document.getElementById('root')!).render(<AppProvider><Harness /></AppProvider>);
