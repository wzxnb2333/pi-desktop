import {
  useCallback,
  useEffect,
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
  /** Last observed scroll position; a change away from the bottom is what detaches follow. */
  const previous = useRef(-1);
  /** True while the reader is scrolling: never yank the view out from under a live gesture. */
  const interacting = useRef(false);
  const gestureTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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

  // Wheel, touch, scrollbar drags and paging keys all mean "the reader is here now". Following
  // resumes on its own once the gesture ends and the position is back at the bottom.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const begin = () => {
      interacting.current = true;
      clearTimeout(gestureTimer.current);
      gestureTimer.current = setTimeout(() => { interacting.current = false; }, 250);
    };
    const pageKeys = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (pageKeys.has(event.key)) begin();
    };
    for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown'] as const) element.addEventListener(type, begin, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(gestureTimer.current);
      interacting.current = false;
      for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown'] as const) element.removeEventListener(type, begin);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [scrollRef, threadId]);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    // A streamed answer grows *under* a stationary scroll position, and its scroll event can arrive
    // one frame late: the position is unchanged while the distance to the bottom has already grown.
    // Only a position that actually moved away from the bottom is the reader scrolling, so growth
    // keeps following; anything that lands near the bottom re-attaches.
    const moved = previous.current >= 0 && element.scrollTop !== previous.current;
    const following = distance < FOLLOW_RANGE ? true : moved ? false : followRef.current;
    // Landing at the bottom also ends the gesture: following resumes from there.
    if (distance < FOLLOW_RANGE) { interacting.current = false; clearTimeout(gestureTimer.current); }
    followRef.current = following;
    setPinned(following);
    // Content can outgrow one frame of corrections; re-pin so following is not a race. A live
    // gesture keeps the position the reader chose.
    if (following && distance >= FOLLOW_RANGE && !interacting.current) element.scrollTop = element.scrollHeight;
    previous.current = element.scrollTop;
    offsets.current.set(threadId, element.scrollTop);
    const top = element.getBoundingClientRect().top;
    const anchor = [...element.querySelectorAll<HTMLElement>('[data-turn-key]')].find(item => item.getBoundingClientRect().bottom > top);
    const value = { itemId: anchor?.dataset.turnKey ?? '', offset: anchor ? anchor.getBoundingClientRect().top - top : element.scrollTop, follow: following };
    pending.current = { threadId, value };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 150);
  }, [followRef, scrollRef, threadId, flush]);

  const scrollToLatest = useCallback(() => {
    // An explicit re-pin is not a gesture to protect from: drop any in-flight gesture window so the
    // next streamed frame tracks immediately.
    clearTimeout(gestureTimer.current);
    interacting.current = false;
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
      if (followRef.current && !interacting.current) element.scrollTop = element.scrollHeight;
      previous.current = element.scrollTop;
      setPinned(followRef.current);
    },
    [followRef, scrollRef, threadId, ...deps],
  );

  return { pinned, onScroll, scrollToLatest };
}
