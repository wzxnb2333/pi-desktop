import { useLocale } from "../../hooks/use-locale.ts";
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface TabItem<Value extends string> {
  id: Value;
  label: ReactNode;
  /** Count bubble, e.g. the number of changed files on the Changes tab. */
  trailing?: ReactNode;
  closeLabel?: string;
}

export interface TabsProps<Value extends string> {
  value: Value;
  onChange(next: Value): void;
  onClose?(value: Value): void;
  items: TabItem<Value>[];
  ariaLabel: string;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  /** Trailing controls that share the strip, e.g. the refresh button. */
  children?: ReactNode;
}

/**
 * Shared roving focus: horizontal strips use Left/Right; vertical settings lists use Up/Down.
 * Home/End, wrapping and click-then-focus are identical in both orientations. A filtered list
 * keeps one keyboard entry point without pretending that the first result is already selected.
 */
export function Tabs<Value extends string>({
  value,
  onChange,
  onClose,
  items,
  ariaLabel,
  className,
  orientation = 'horizontal',
  children,
}: TabsProps<Value>) {
  useLocale();
  const strip = useRef<HTMLDivElement>(null);
  const closingFocus = useRef<Element | null>(null);
  const close = (id: Value, element: HTMLElement) => {
    if (element.closest('.tab-item')?.contains(document.activeElement)) closingFocus.current = document.activeElement;
    onClose?.(id);
  };
  useLayoutEffect(() => {
    if (!closingFocus.current || closingFocus.current.isConnected) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) strip.current?.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')?.focus();
      closingFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  });
  useEffect(() => { strip.current?.querySelector('[role=tab][aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [value]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const backward = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const forward = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const keys = [backward, forward, 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(
      event.currentTarget.closest('[role=tablist]')!.querySelectorAll<HTMLButtonElement>('[role=tab]'),
    );
    const index = tabs.indexOf(event.currentTarget);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === forward ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click();
    tabs[next].focus();
  };

  return (
    <div ref={strip} className={['tabs', className ?? ''].filter(Boolean).join(' ')} role="tablist" aria-label={ariaLabel} aria-orientation={orientation}>
      {items.map((item, index) => { const button = (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          tabIndex={value === item.id || index === 0 && !items.some(candidate => candidate.id === value) ? 0 : -1}
          className={value === item.id ? 'active' : ''}
          onClick={() => onChange(item.id)}
          onKeyDown={onKeyDown}
        >
          {item.label}
          {item.trailing}
        </button>
      ); return onClose ? <span key={item.id} className="tab-item" data-selected={value === item.id}
        onMouseDown={event => { if (event.button === 1) event.preventDefault(); }}
        onAuxClick={event => { if (event.button === 1) { event.preventDefault(); close(item.id, event.currentTarget); } }}>
        {button}<button type="button" className="tab-close" aria-label={item.closeLabel} title={item.closeLabel} onClick={event => close(item.id, event.currentTarget)}><X size={12} aria-hidden="true" /></button>
      </span> : button; })}
      {children}
    </div>
  );
}
