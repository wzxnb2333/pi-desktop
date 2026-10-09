import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useMotionPresence } from '../../hooks/use-motion-presence.ts';
import { IconButton } from './icon-button.tsx';

const FOCUSABLE = ':is(button, [href], input, select, textarea, [tabindex]):not(:disabled):not([tabindex="-1"])';

export function Drawer({
  open,
  title,
  description,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  onClose(): void;
}) {
  useLocale();
  const present = useMotionPresence(open);
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !present) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = document.getElementById('root');
    const wasInert = background?.inert;
    if (background) background.inert = true;
    const frame = requestAnimationFrame(() =>
      (
        panelRef.current?.querySelector<HTMLElement>('[data-drawer-autofocus]') ??
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      )?.focus({ preventScroll: true }),
    );
    return () => {
      cancelAnimationFrame(frame);
      if (background) background.inert = wasInert ?? false;
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    };
  }, [open, present]);

  if (!present) return null;
  return createPortal(
    <div
      className="drawer-backdrop"
      data-open={open}
      aria-hidden={!open}
      inert={!open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        ref={panelRef}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== 'Tab' || !panelRef.current) return;
          const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
          if (!focusable.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first || !panelRef.current.contains(document.activeElement))
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="drawer-header">
          <div className="drawer-heading">
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <IconButton label={tr('关闭抽屉')} size="sm" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        </header>
        <div className="drawer-content">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
