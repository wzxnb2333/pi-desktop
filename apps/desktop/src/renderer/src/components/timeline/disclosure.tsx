import { useLocale } from "../../hooks/use-locale.ts";
import { ChevronRight } from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../../state/app.tsx';

/** Pi disclosure adaptation; explicit choices override defaults and retain keyboard focus. */
export function Disclosure({ foldKey, label, summary, children, defaultOpen = false, forceOpen = false, icon, accessory, variant = 'default', busy = false }: {
  foldKey: string; label?: string; summary: ReactNode; children: ReactNode; defaultOpen?: boolean; forceOpen?: boolean;
  icon?: ReactNode; accessory?: ReactNode; variant?: 'default' | 'group' | 'process' | 'thinking' | 'plan'; busy?: boolean;
}) {
  useLocale();
  const { threadUi, setFold, timelineRef, followRef, activeId } = useApp();
  const persisted = threadUi.folds?.[foldKey];
  const [choice, setChoice] = useState<{ thread: string; key: string; value: boolean }>();
  useEffect(() => setChoice(undefined), [activeId, foldKey, persisted]);
  const selected = choice?.thread === activeId && choice.key === foldKey ? choice.value : persisted;
  const expanded = forceOpen || (selected ?? defaultOpen);
  const [phase, setPhase] = useState(expanded ? 'expanded' : 'collapsed');
  const id = useId();
  const header = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  const lastExpanded = useRef(expanded);
  useLayoutEffect(() => {
    if (lastExpanded.current === expanded) return;
    lastExpanded.current = expanded;
    if (!expanded && body.current?.contains(document.activeElement)) header.current?.focus({ preventScroll: true });
    setPhase(expanded ? 'opening' : 'closing');
    const frame = requestAnimationFrame(() => setPhase(expanded ? 'expanded' : 'closing'));
    const timer = setTimeout(() => { anchor.current = null; setPhase(expanded ? 'expanded' : 'collapsed'); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [expanded]);
  useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      const scroll = timelineRef.current;
      if (!scroll) return;
      if (followRef.current) scroll.scrollTop = scroll.scrollHeight;
      else if (anchor.current !== null && header.current) scroll.scrollTop += header.current.getBoundingClientRect().top - anchor.current;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [followRef, timelineRef]);
  return <div className={'disclosure disclosure-' + variant} data-disclosure={foldKey} data-phase={phase}>
    <div className="disclosure-header">
      <button ref={header} type="button" className="disclosure-toggle" aria-label={label} aria-labelledby={label ? undefined : id + '-label'} aria-controls={id} aria-expanded={expanded}
        onClick={() => {
          if (forceOpen) return;
          anchor.current = header.current?.getBoundingClientRect().top ?? null;
          setChoice({ thread: activeId, key: foldKey, value: !expanded }); setFold(foldKey, !expanded);
        }} />
      <span className="disclosure-summary">{icon}<span id={id + '-label'} className={'disclosure-label' + (busy ? ' activity-busy' : '')}>{summary}</span></span>
      {accessory}<ChevronRight aria-hidden="true" className="disclosure-chevron" size={20} strokeWidth={1.5} data-icon-origin="pi-adaptation" />
    </div>
    <div ref={body} id={id} className="disclosure-motion" data-expanded={expanded} aria-hidden={!expanded} inert={!expanded}>
      <div className="disclosure-clip"><div className="disclosure-content">{expanded || phase !== 'collapsed' ? children : null}</div></div>
    </div>
  </div>;
}

/** Active summaries are throttled to 1s; completed summaries are committed immediately. */
export function ActivitySummary({ text, live }: { text: string; live: boolean }) {
  useLocale();
  const [visible, setVisible] = useState(text);
  const changedAt = useRef(Date.now());
  useEffect(() => {
    if (!live || visible === text) return;
    const timer = setTimeout(() => { changedAt.current = Date.now(); setVisible(text); }, Math.max(0, 1000 - (Date.now() - changedAt.current)));
    return () => clearTimeout(timer);
  }, [live, text, visible]);
  return <>{live ? visible : text}</>;
}
