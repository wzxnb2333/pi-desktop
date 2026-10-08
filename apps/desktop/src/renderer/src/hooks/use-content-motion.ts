import { type RefObject, useLayoutEffect, useRef } from 'react';

/** Animate identity changes without remounting editors or moving measured browser/terminal bounds. */
export function useContentMotion<T extends HTMLElement>(ref: RefObject<T | null>, identity: string) {
  const previous = useRef(identity);
  useLayoutEffect(() => {
    if (previous.current === identity) return;
    previous.current = identity;
    const element = ref.current;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    if (!element || preference.matches) return;
    const animation = element.animate([{ opacity: .25 }, { opacity: 1 }], {
      duration: 180, easing: getComputedStyle(element).getPropertyValue('--ease-out').trim() || 'cubic-bezier(.16, 1, .3, 1)',
    });
    const stop = () => { if (preference.matches) animation.cancel(); };
    preference.addEventListener('change', stop);
    return () => { animation.cancel(); preference.removeEventListener('change', stop); };
  }, [ref, identity]);
}
