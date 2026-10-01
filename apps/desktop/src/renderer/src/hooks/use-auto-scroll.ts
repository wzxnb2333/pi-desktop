import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type DependencyList,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { UiThread } from '../../../shared/contracts.ts';

/** Distance from the bottom that still counts as following the stream, as before the split. */
const FOLLOW_RANGE = 100;

export interface AutoScrollOptions {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Follow state lives in the app provider, so it survives this component remounting. */
  followRef: MutableRefObject<boolean>;
  threadId: string;
  /** Values that grow the timeline: item list and pending approvals. */
  deps: DependencyList;
  saved?: UiThread['scroll'];
  onSave?(threadId: string, scroll: NonNullable<UiThread['scroll']>): void;
}

export interface AutoScroll {
  pinned: boolean;
  onScroll(): void;
  scrollToLatest(): void;
}

/** Follow the stream while retaining a per-task message anchor for readers who scroll away. */
export function useAutoScroll({ scrollRef, followRef, threadId, deps, saved, onSave }: AutoScrollOptions): AutoScroll {
  // Seeded from followRef so a StrictMode remount or a view swap does not silently re-pin a reader
  // who had scrolled away.
  const [pinned, setPinned] = useState(() => followRef.current);
  const offsets = useRef(new Map<string, number>());
  const lastThread = useRef<string | undefined>(undefined);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<{ threadId: string; value: NonNullable<UiThread['scroll']> } | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const snapshot = pending.current;
    pending.current = undefined;
    if (snapshot) saveRef.current?.(snapshot.threadId, snapshot.value);
  }, []);

  useLayoutEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [threadId, flush]);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const following = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_RANGE;
    followRef.current = following;
    setPinned(following);
    offsets.current.set(threadId, element.scrollTop);
    const top = element.getBoundingClientRect().top;
    const anchor = [...element.querySelectorAll<HTMLElement>('[data-turn-key]')].find(item => item.getBoundingClientRect().bottom > top);
    const value = { itemId: anchor?.dataset.turnKey ?? '', offset: anchor ? anchor.getBoundingClientRect().top - top : element.scrollTop, follow: following };
    pending.current = { threadId, value };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 150);
  }, [followRef, scrollRef, threadId, flush]);

  const scrollToLatest = useCallback(() => {
    followRef.current = true;
    setPinned(true);
    const element = scrollRef.current;
    // Instant, not smooth: an animated jump reports intermediate positions and would immediately
    // un-pin itself as "scrolled away" while the thread is still growing.
    if (element) element.scrollTop = element.scrollHeight;
  }, [followRef, scrollRef]);

  useLayoutEffect(
    () => {
      const element = scrollRef.current;
      if (!element) return;
      if (lastThread.current !== threadId) {
        lastThread.current = threadId;
        followRef.current = saved?.follow ?? true;
        setPinned(followRef.current);
        // In-memory offsets preserve an immediate switch; persisted anchors survive a restart.
        const offset = followRef.current ? undefined : offsets.current.get(threadId);
        if (offset !== undefined) element.scrollTop = offset;
        else if (saved && !saved.follow) {
          const anchor = [...element.querySelectorAll<HTMLElement>('[data-turn-key]')].find(item => item.dataset.turnKey === saved.itemId);
          element.scrollTop = anchor ? element.scrollTop + anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.offset : saved.offset;
        }
      }
      if (followRef.current) element.scrollTop = element.scrollHeight;
    },
    [followRef, scrollRef, threadId, ...deps],
  );

  return { pinned, onScroll, scrollToLatest };
}
