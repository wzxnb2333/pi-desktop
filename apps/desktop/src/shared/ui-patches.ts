import type { UiState, UiThread } from './contracts.ts';
import { uiThreadSchema } from './contracts.ts';

export type UiPatch = { frame: Partial<UiState> } | { threadId: string; thread: Partial<UiThread> };
export function applyUiPatch(ui: UiState, patch: UiPatch): UiState {
  if ('frame' in patch) return { ...ui, ...patch.frame, threads: ui.threads };
  const previous = ui.threads[patch.threadId] ?? uiThreadSchema.parse({});
  return { ...ui, threads: { ...ui.threads, [patch.threadId]: {
    ...previous, ...patch.thread, folds: { ...previous.folds, ...patch.thread.folds },
  } } };
}
