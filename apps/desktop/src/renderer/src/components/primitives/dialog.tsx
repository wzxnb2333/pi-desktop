import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './button.tsx';

export interface ConfirmDialogProps {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Renders the confirm action with the `danger` variant; the op itself stays with the caller. */
  danger?: boolean;
  presentation?: 'confirmation' | 'palette' | 'panel';
  initialFocus?: 'confirm' | 'cancel';
  pending?: boolean;
  confirmDisabled?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

const FOCUSABLE = ':is(button, [href], input, select, textarea, [tabindex]):not(:disabled):not([tabindex="-1"])';

/**
 * The renderer's own confirmations — reverting a file, removing an automation, discarding unsaved
 * settings — all three of which already have a backing op. The main process keeps using
 * `dialog.showMessageBox` for trust and MCP prompts, which are privileged and must not be spoofable
 * from the page.
 *
 * Confirmation backdrops deliberately do not dismiss a potentially lossy action. The palette
 * and panel presentations delegate unsaved-change checks to the caller when dismissed.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = tr("取消"),
  danger,
  presentation = 'confirmation',
  initialFocus = 'confirm',
  pending = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useLocale();
  const base = useId();
  const titleId = `${base}-title`;
  const descriptionId = `${base}-description`;
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    const input = panelRef.current?.querySelector<HTMLElement>('[data-dialog-autofocus]');
    (input ?? confirmRef.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current)?.focus();
    return () => {
      // The trigger is usually still there — a row that survived a cancelled revert — so focus goes
      // back where it came from instead of landing on <body>.
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (pending) panel.focus();
    else if (document.activeElement === panel)
      (panel.querySelector<HTMLElement>('[data-dialog-autofocus]:not(:disabled)') ?? panel.querySelector<HTMLElement>(FOCUSABLE))?.focus();
  }, [pending]);

  return createPortal(
    <div className={presentation === 'palette' ? 'dialog-backdrop command-backdrop' : 'dialog-backdrop'}
      onMouseDown={event => { if (!pending && presentation !== 'confirmation' && event.target === event.currentTarget) onCancel(); }}>
      <div
        className={presentation === 'palette' ? 'dialog command-palette' : presentation === 'panel' ? 'dialog dialog-panel' : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-busy={pending || undefined}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            if (!pending) onCancel();
            return;
          }
          if (event.key !== 'Tab' || !panelRef.current) return;
          const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
          if (!focusable.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          const active = document.activeElement;
          if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        {presentation !== 'confirmation' ? <>
          <h2 id={titleId} className="command-title">{title}</h2>
          <div id={descriptionId}>{description}</div>
        </> : <div className="dialog-body">
          <div className="dialog-section">
            <div className="dialog-header">
              <div className="dialog-heading">
                <div className="dialog-title"><h2 id={titleId}>{title}</h2></div>
                {description && <div className="dialog-description"><p id={descriptionId}>{description}</p></div>}
              </div>
            </div>
          </div>
          <div className="dialog-section">
            <div className="dialog-actions">
              <Button data-dialog-autofocus={initialFocus === 'cancel' || undefined} disabled={pending} onClick={onCancel}>{cancelLabel}</Button>
              <Button ref={confirmRef} variant={danger ? 'danger' : 'primary'} size="md" disabled={pending || confirmDisabled} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </div>
          </div>
        </div>}
        {presentation === 'confirmation' && <button className="dialog-close" aria-label={tr("关闭对话框")} disabled={pending} onClick={onCancel}>
          <X size={16} strokeWidth={1.5} aria-hidden="true" data-icon-origin="pi-adaptation" />
        </button>}
      </div>
    </div>,
    document.body,
  );
}
