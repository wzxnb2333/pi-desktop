import { REVIEW_WIDTH, SIDEBAR_WIDTH, TERMINAL_HEIGHT } from '../../../shared/contracts.ts';

export type ResizeKey = 'sidebarWidth' | 'reviewWidth' | 'terminalHeight';

/** Effective sizes preserve a usable conversation without overwriting the saved wide-window layout. */
export function workspaceSizes(
  width: number,
  height: number,
  sidebar: number,
  review: number,
  terminal: number,
  summary = false,
) {
  // The 1000px reference docks a 407px review beside a 240px sidebar. Use the
  // actual available width; a wider saved sidebar can still require a drawer.
  const conversationMin = summary ? 560 : 320;
  const overlay = width - sidebar - 1 < conversationMin + REVIEW_WIDTH.min;
  const sidebarWidth = sidebar
    ? Math.min(sidebar, Math.max(SIDEBAR_WIDTH.min, width - 1 - 320 - (review && !overlay ? REVIEW_WIDTH.min : 0)))
    : 0;
  const reviewWidth = review ? Math.min(review, Math.max(REVIEW_WIDTH.min, width - sidebarWidth - 1 - (overlay ? 24 : conversationMin))) : 0;
  const terminalHeight = Math.min(terminal, Math.max(TERMINAL_HEIGHT.min, height - 36 - 46 - 240));
  return { sidebarWidth, reviewWidth, terminalHeight, reviewOverlay: overlay };
}

/** Float the summary before shrinking the conversation; stack above tools only when necessary. */
export function summaryPlacement(available: number, review: number, reviewOverlay: boolean) {
  const stacked = review > 0 && reviewOverlay && available - review < 334;
  return { overlay: available - review < 560 + 318, stacked, right: stacked ? 0 : review };
}

/** The reference clamps the sidebar against the live window width, not a fixed maximum. */
export function layoutBounds(key: ResizeKey, viewportWidth: number) {
  if (key === 'sidebarWidth')
    return { min: SIDEBAR_WIDTH.min, max: Math.min(SIDEBAR_WIDTH.max, viewportWidth - 320) };
  if (key === 'reviewWidth') return { min: REVIEW_WIDTH.min, max: REVIEW_WIDTH.max };
  return { min: TERMINAL_HEIGHT.min, max: TERMINAL_HEIGHT.max };
}

export function clampLayout(key: ResizeKey, value: number, viewportWidth: number): number {
  const { min, max } = layoutBounds(key, viewportWidth);
  // A window narrower than min + 320 leaves no room; keep it at the floor instead of inverting.
  return Math.round(Math.max(min, Math.min(Math.max(min, max), value)));
}

export function resizeStep(key: ResizeKey, value: number, direction: -1 | 1, viewportWidth: number): number {
  return clampLayout(key, value + direction * 10, viewportWidth);
}
