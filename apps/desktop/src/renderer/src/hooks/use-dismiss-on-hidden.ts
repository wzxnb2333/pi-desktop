import { type RefObject, useLayoutEffect } from 'react';

/** Portals must close when their owning disclosure becomes hidden or inert. */
export function useDismissOnHidden<T extends HTMLElement>(ref: RefObject<T | null>, open: boolean, dismiss: () => void) {
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const check = () => { if (ref.current?.closest('[inert], [hidden], [aria-hidden="true"]')) dismiss(); };
    const observer = new MutationObserver(check);
    for (let node: HTMLElement | null = ref.current; node; node = node.parentElement) {
      observer.observe(node, { attributes: true, attributeFilter: ['inert', 'hidden', 'aria-hidden'] });
    }
    check();
    return () => observer.disconnect();
  }, [ref, open, dismiss]);
}
