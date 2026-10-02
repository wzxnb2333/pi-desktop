import { useId, type ReactNode } from 'react';

/** Shared settings grouping; preserves the reference's quiet header and bordered rows. */
export function SettingsSection({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  const heading = useId();
  return <section className="settings-section" aria-labelledby={heading}>
    {/* `action` is the section's own entry point (a list's add button), kept on the header line. */}
    <header className="section-heading"><div><h2 id={heading}>{title}</h2>{description && <p className="hint">{description}</p>}</div>{action}</header>
    <div className="field-stack">{children}</div>
  </section>;
}
