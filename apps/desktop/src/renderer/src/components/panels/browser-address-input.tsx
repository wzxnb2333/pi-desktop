import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BrowserHistoryEntry, BrowserHistoryPage } from '../../../../shared/browser-history.ts';
import { browserCommand } from '../../../../shared/shortcuts.ts';
import { tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';

export function BrowserAddressInput({ value, error, errorId, composing, disabled = false, onChange, onOpen, onReset }: { value: string; error: boolean; errorId: string; composing: { current: boolean }; disabled?: boolean; onChange(value: string): void; onOpen(value: string): void; onReset(): void }) {
  useLocale(); const { invoke, data } = useApp(); const api = useRef(invoke); api.current = invoke;
  const id = useId(), input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false), [ime, setIme] = useState(false), [items, setItems] = useState<BrowserHistoryEntry[]>([]), [index, setIndex] = useState(-1);
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0 });
  useEffect(() => {
    let current = true; setIndex(-1);
    if (!focused || ime || disabled) { setItems([]); return; }
    const timer = setTimeout(() => {
      void api.current({ op: 'browser.history', query: value.slice(0, 1000), offset: 0, limit: 50 }).then(result => {
        if (!current) return; const seen = new Set<string>(); setItems((result as BrowserHistoryPage).entries.filter(item => { if (seen.has(item.url)) return false; seen.add(item.url); return true; }).slice(0, 8));
      }).catch(() => { if (current) setItems([]); });
    }, 100);
    return () => { current = false; clearTimeout(timer); };
  }, [focused, value, ime, disabled]);
  const open = focused && !ime && !disabled && items.length > 0;
  useLayoutEffect(() => {
    if (!open) return; const sync = () => { const box = input.current!.getBoundingClientRect(); setBounds({ left: box.left, top: box.bottom + 4, width: box.width }); };
    sync(); window.addEventListener('resize', sync); return () => window.removeEventListener('resize', sync);
  }, [open]);
  const choose = (item: BrowserHistoryEntry) => { setFocused(false); setItems([]); onChange(item.url); onOpen(item.url); };
  return <div className="browser-address"><input ref={input} role="combobox" aria-label={tr('预览地址')} aria-autocomplete="list" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open && index >= 0 ? id + '-' + index : undefined}
    disabled={disabled} aria-invalid={error} aria-describedby={error ? errorId : undefined} placeholder={tr('搜索或输入网址')} value={value} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onChange={event => { onChange(event.target.value); setFocused(true); }}
    onCompositionStart={() => { composing.current = true; setIme(true); }} onCompositionEnd={() => { composing.current = false; setIme(false); }}
    onKeyDown={event => {
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      const command = browserCommand(event, 'address', data.settings.shortcuts);
      if (command === 'browserAddressCancel') { event.preventDefault(); event.stopPropagation(); setFocused(false); onReset(); event.currentTarget.select(); }
      else if (open && (command === 'browserAddressNext' || command === 'browserAddressPrevious')) { event.preventDefault(); event.stopPropagation(); setIndex(current => (current + (command === 'browserAddressNext' ? 1 : current < 0 ? 0 : -1) + items.length) % items.length); }
      else if (open && command === 'browserAddressChoose' && index >= 0) { event.preventDefault(); event.stopPropagation(); choose(items[index]); }
    }} />
    {open && createPortal(<div className="browser-address-suggestions" id={id} role="listbox" aria-label={tr('浏览历史建议')} style={bounds}>
      {items.map((item, itemIndex) => <button key={item.id} id={id + '-' + itemIndex} type="button" role="option" tabIndex={-1} aria-selected={index === itemIndex} onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}><strong>{item.title || item.url}</strong><span>{item.url}</span></button>)}
    </div>, document.body)}
  </div>;
}
