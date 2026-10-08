import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

/** Keep the sidebar through its closing transition; its contents stay at their full width. */
export function SidebarPane({ open, width, resizing = false, children }: {
  open: boolean; width: number; resizing?: boolean; children: ReactNode;
}) {
  const previous = useRef(open);
  const [present, setPresent] = useState(open);
  const [transitioning, setTransitioning] = useState(false);
  useLayoutEffect(() => {
    if (previous.current === open) return;
    previous.current = open;
    setPresent(true);
    setTransitioning(true);
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const finish = () => { setTransitioning(false); setPresent(open); };
    if (preference.matches) { finish(); return; }
    // The fallback also handles a transition cancelled by resizing or a missing stylesheet.
    const timer = setTimeout(finish, 260);
    const stop = () => { if (preference.matches) finish(); };
    preference.addEventListener('change', stop);
    return () => { clearTimeout(timer); preference.removeEventListener('change', stop); };
  }, [open]);
  return <div className="workspace-sidebar" style={{ width: open ? width : 0 }}
    data-open={open} data-transitioning={previous.current !== open || transitioning}
    data-resizing={resizing || undefined} aria-hidden={!open} inert={!open}
    onTransitionEnd={event => {
      if (event.target !== event.currentTarget || event.propertyName !== 'width') return;
      setTransitioning(false); setPresent(open);
    }}>
    {(open || present) && children}
  </div>;
}
