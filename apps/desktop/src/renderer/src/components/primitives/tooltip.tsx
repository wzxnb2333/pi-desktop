import { useLocale } from "../../hooks/use-locale.ts";
import {
  cloneElement,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type TooltipTarget = { 'aria-describedby'?: string };

export interface TooltipProps {
  label: ReactNode;
  /** Pointer delay in ms. Keyboard focus ignores it deliberately; see below. */
  delay?: number;
  children: ReactElement<TooltipTarget>;
}

/**
 * Wraps a control that has no native description. The target is cloned rather than wrapped in an extra
 * interactive element so the accessible tree the e2e specs walk stays unchanged.
 *
 * `aria-describedby` is only attached while the tooltip is in the tree: a permanent reference to an id
 * that is usually absent makes screen readers announce a silent description.
 */
export function Tooltip({ label, delay = 200, children }: TooltipProps) {
  useLocale();
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [side, setSide] = useState<'top' | 'bottom'>('top');

  useLayoutEffect(() => {
    if (!visible) return;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const tip = tipRef.current?.getBoundingClientRect();
      if (!anchor || !tip) return;
      const above = anchor.top - tip.height - 2 >= 8;
      setSide(above ? 'top' : 'bottom');
      setPosition({
        left: Math.max(
          8,
          Math.min(anchor.x + (anchor.width - tip.width) / 2, window.innerWidth - tip.width - 8),
        ),
        top: Math.max(
          8,
          Math.min(
            above ? anchor.top - tip.height - 2 : anchor.bottom + 2,
            window.innerHeight - tip.height - 8,
          ),
        ),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    if (anchorRef.current) observer.observe(anchorRef.current);
    if (tipRef.current) observer.observe(tipRef.current);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [visible]);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!visible) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') { clearTimeout(timer.current); setVisible(false); } };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [visible]);
  useEffect(() => {
    const dismiss = () => {
      clearTimeout(timer.current);
      setVisible(false);
    };
    window.addEventListener('blur', dismiss);
    return () => window.removeEventListener('blur', dismiss);
  }, []);

  const cancel = () => {
    clearTimeout(timer.current);
    setVisible(false);
  };

  return (
    <span
      className="tooltip-anchor"
      ref={anchorRef}
      onMouseEnter={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setVisible(true), delay);
      }}
      // A keyboard user already chose to focus the control, so making them sit through the pointer
      // delay would only slow them down; the tooltip appears with the focus ring.
      onFocus={() => {
        clearTimeout(timer.current);
        setVisible(true);
      }}
      onBlur={cancel}
      onMouseLeave={cancel}
      onClick={cancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancel();
      }}
    >
      {cloneElement(children, visible ? { 'aria-describedby': id } : {})}
      {visible &&
        createPortal(
          <div role="tooltip" id={id} ref={tipRef} className="tooltip" data-side={side} style={position}>
            <div className="tooltip-content">
              <div className="tooltip-label">{label}</div>
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
