import { useId, type ReactNode } from 'react';

/** Shared settings grouping; preserves the reference's quiet header and bordered rows. */
export function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const heading = useId();
  return <section className="settings-section" aria-labelledby={heading}>
    <header className="section-heading"><div><h2 id={heading}>{title}</h2>{description && <p className="hint">{description}</p>}</div></header>
    <div className="field-stack">{children}</div>
  </section>;
}
