import { useLayoutEffect, useState } from 'react';

const EXIT_DURATION_MS = 100;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function useMotionPresence(open: boolean): boolean {
  const [present, setPresent] = useState(open);

  useLayoutEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!present) return;

    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    if (reducedMotion.matches) {
      setPresent(false);
      return;
    }

    let active = true;
    const finish = () => {
      if (active) setPresent(false);
    };
    const timer = window.setTimeout(finish, EXIT_DURATION_MS);
    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      window.clearTimeout(timer);
      finish();
    };
    reducedMotion.addEventListener('change', onMotionPreferenceChange);

    return () => {
      active = false;
      window.clearTimeout(timer);
      reducedMotion.removeEventListener('change', onMotionPreferenceChange);
    };
  }, [open, present]);

  return open || present;
}
