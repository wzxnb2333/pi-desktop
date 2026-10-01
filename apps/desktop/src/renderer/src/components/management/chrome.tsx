import { useLocale } from "../../hooks/use-locale.ts";
import { Search } from 'lucide-react';
import type { ReactNode, Ref } from 'react';

export function ManagementSearch({ label, placeholder, value, onChange, inputRef, children }: { label: string; placeholder: string; value: string; onChange(value: string): void; inputRef?: Ref<HTMLInputElement>; children?: ReactNode }) {
  useLocale();
  return <div className="management-search-row"><label className="management-search-field"><Search size={18} aria-hidden="true" /><input ref={inputRef} type="search" aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} /></label>{children}</div>;
}

export function ManagementEmpty({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children?: ReactNode }) {
  useLocale();
  return <div className="management-empty"><div className="management-empty-content">{icon}<div className="management-empty-text"><h3>{title}</h3><p>{description}</p></div>{children && <div className="management-empty-actions">{children}</div>}</div></div>;
}

export function ManagementFilters<T extends string>({ label, value, onChange, options, disabled = false }: { label: string; value: T; onChange(value: T): void; options: readonly { value: T; label: string }[]; disabled?: boolean }) {
  useLocale();
  return <div className="management-filter-row"><div className="management-filters" role="group" aria-label={label}>{options.map(option => <button key={option.value} type="button" disabled={disabled} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div></div>;
}
