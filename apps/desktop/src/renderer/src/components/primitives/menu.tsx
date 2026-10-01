import { useLocale } from "../../hooks/use-locale.ts";
import { ReferenceIcon } from './reference-icon.tsx';
import { Check } from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  useId,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { ButtonSize } from './button.tsx';

export interface MenuOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface MenuProps {
  /** Accessible name of the trigger, e.g. "模型". Tests resolve the control with `getByLabel`. */
  label: string;
  value: string;
  options: MenuOption[];
  onChange(value: string): void;
  align?: 'start' | 'end';
  matchTriggerWidth?: boolean;
  /** Which way the list opens. The composer is anchored to the window bottom and needs `top`. */
  side?: 'top' | 'bottom';
  placeholder?: ReactNode;
  disabled?: boolean;
  size?: ButtonSize;
  className?: string;
  kind?: 'choice' | 'action';
  display?: ReactNode;
  heading?: ReactNode;
  content?: ReactNode;
  listClassName?: string;
  onOpenChange?(open: boolean): void;
}

function stepFrom(options: MenuOption[], from: number, delta: number): number {
  const count = options.length;
  if (!count) return -1;
  let next = ((from % count) + count) % count;
  for (let guard = 0; guard < count; guard += 1) {
    if (!options[next]?.disabled) return next;
    next = (((next + delta) % count) + count) % count;
  }
  return -1;
}

function edgeIndex(options: MenuOption[], delta: number): number {
  const empty = options.length === 0;
  if (empty) return -1;
  return stepFrom(options, delta > 0 ? 0 : options.length - 1, delta);
}

/**
 * One popover for every list-of-choices control, replacing the three native `<select>`s the composer
 * carries. A body portal keeps the list outside scrolling and clipped workbench regions.
 *
 * Items are real `<button role="menuitemradio">`s that take DOM focus rather than using
 * `aria-activedescendant`, so Enter and Space select through the platform's own activation behaviour
 * and cannot drift out of sync with the highlighted row.
 */
export function Menu({
  label,
  value,
  options,
  onChange,
  align = 'start',
  matchTriggerWidth,
  side = 'bottom',
  placeholder,
  disabled,
  size,
  className,
  kind = 'choice',
  display: displayOverride,
  heading,
  content,
  listClassName,
  onOpenChange,
}: MenuProps) {
  useLocale();
  const base = useId();
  const triggerId = `${base}-trigger`;
  const listId = `${base}-list`;
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [triggerWidth, setTriggerWidth] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: window.innerHeight - 12 });
  const [placedSide, setPlacedSide] = useState(side);

  const itemList = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []);

  const show = (index: number) => {
    pendingRef.current = index;
    if (matchTriggerWidth && triggerRef.current) setTriggerWidth(triggerRef.current.offsetWidth);
    setOpen(true);
    onOpenChange?.(true);
  };

  const hide = (restoreFocus: boolean) => {
    setOpen(false);
    onOpenChange?.(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  // The list only exists in the frame after `open` flips, so the requested row is focused post-layout.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const list = listRef.current;
      if (!anchor || !list) return;
      const gap = 1;
      const edge = 6;
      const below = window.innerHeight - anchor.bottom - gap - edge;
      const above = anchor.top - gap - edge;
      const style = getComputedStyle(list);
      const naturalHeight = Array.from(list.children).reduce((height, item) => height + item.getBoundingClientRect().height, 0) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const top =
        side === 'top' ? above >= naturalHeight || above > below : below < naturalHeight && above > below;
      const maxHeight = Math.max(0, (top ? above : below) - 2);
      const height = Math.min(naturalHeight, maxHeight);
      const width = list.getBoundingClientRect().width;
      setPlacedSide(top ? 'top' : 'bottom');
      if (matchTriggerWidth) setTriggerWidth(anchor.width);
      setPosition({
        left: Math.max(
          edge,
          Math.min(align === 'end' ? anchor.right - width - 2 : anchor.left, window.innerWidth - width - edge - 2),
        ),
        top: top ? anchor.top - gap - height - 2 : anchor.bottom + gap,
        maxHeight,
      });
    };
    place();
    const items = itemList();
    (content ? listRef.current?.querySelector<HTMLElement>('[data-popover-autofocus]:not(:disabled)') ?? listRef.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)') : items[pendingRef.current] ?? items[0])?.focus();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (listRef.current) observer.observe(listRef.current);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, side, align, matchTriggerWidth, options.length, !!content]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      // The trigger lives inside the container, so a click on it must not read as "outside": the
      // pointerdown would close the list and the click that follows would immediately reopen it.
      if (
        containerRef.current?.contains(event.target as Node) ||
        listRef.current?.contains(event.target as Node)
      )
        return;
      hide(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onOpenChange]);

  useEffect(() => { if (disabled && open) hide(false); }, [disabled, open]);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const current = selectedIndex === -1 ? undefined : options[selectedIndex];
  const display = displayOverride ?? current?.label ?? placeholder ?? '';

  const focusItem = (index: number) => {
    if (index >= 0) itemList()[index]?.focus();
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (content && event.key === 'Tab') {
      const controls = Array.from(listRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
      if (event.target === (event.shiftKey ? controls[0] : controls.at(-1))) hide(true);
      return;
    }
    if (content && event.key !== 'Escape') return;
    const from = itemList().indexOf(event.target as HTMLButtonElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(stepFrom(options, from === -1 ? 0 : from + 1, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(stepFrom(options, from === -1 ? options.length - 1 : from - 1, -1));
        break;
      case 'Home':
        event.preventDefault();
        focusItem(edgeIndex(options, 1));
        break;
      case 'End':
        event.preventDefault();
        focusItem(edgeIndex(options, -1));
        break;
      case 'Escape':
        event.preventDefault();
        hide(true);
        break;
      case 'Tab':
        // Focus is allowed to leave, but an open popover must not be left behind.
        hide(true);
        break;
    }
  };

  return (
    <div className="menu" ref={containerRef}>
      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        className={['menu-trigger', size ? `btn-${size}` : '', className ?? ''].filter(Boolean).join(' ')}
        aria-label={label}
        title={typeof current?.label === 'string' ? current.label : label}
        aria-haspopup={content ? 'dialog' : 'menu'}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() =>
          open ? hide(true) : show(selectedIndex === -1 ? edgeIndex(options, 1) : selectedIndex)
        }
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show(edgeIndex(options, event.key === 'ArrowDown' ? 1 : -1));
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            hide(true);
          }
        }}
      >
        <span className="menu-trigger-label">{display}</span>
        <ReferenceIcon name="down" size={14} />
      </button>
      {open &&
        createPortal(
          <div
            id={listId}
            ref={listRef}
            className={['menu-list', listClassName].filter(Boolean).join(' ')}
            role={content ? 'dialog' : 'menu'}
            aria-labelledby={triggerId}
            data-align={align}
            data-side={placedSide}
            style={{
              position: 'fixed',
              ...position,
              bottom: 'auto',
              right: 'auto',
              width: matchTriggerWidth && triggerWidth ? triggerWidth : undefined,
              maxWidth: 'calc(100vw - 14px)',
            }}
            onKeyDown={onListKeyDown}
            onBlur={event => { if (content && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !containerRef.current?.contains(event.relatedTarget)) hide(false); }}
          >
            {heading && <div className="menu-heading">{heading}</div>}
            {content ?? options.map((option) => (
              <button
                key={option.value}
                type="button"
                role={kind === 'action' ? 'menuitem' : 'menuitemradio'}
                tabIndex={-1}
                className="menu-item"
                aria-checked={kind === 'action' ? undefined : option.value === value}
                aria-disabled={option.disabled || undefined}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.value);
                  hide(true);
                }}
              >
                <div className="menu-item-content">
                  <div className="menu-item-copy"><span className="menu-item-label">{option.label}</span></div>
                  <span className="menu-item-indicator" aria-hidden="true">
                    {option.value === value && <Check size={18} strokeWidth={1.5} data-icon-origin="pi-adaptation" />}
                  </span>
                </div>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
