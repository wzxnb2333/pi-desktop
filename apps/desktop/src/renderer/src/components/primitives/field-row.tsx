import { useLocale } from "../../hooks/use-locale.ts";
import type { ReactNode } from 'react';

export interface FieldRowProps {
  label: string;
  /** `id` of the control this row drives. Omit it for rows whose control is a group of buttons. */
  htmlFor?: string;
  description?: ReactNode;
  children: ReactNode;
}

/**
 * The label / control / helper-text row used by the settings and management pages. The title and hint
 * are spans rather than `strong`/`small` because element selectors in other sheets would outrank this
 * component's class on the same node.
 */
export function FieldRow({ label, htmlFor, description, children }: FieldRowProps) {
  useLocale();
  return (
    <div className="field-row">
      <label className="field-row-label" htmlFor={htmlFor}>
        <span className="field-row-title">{label}</span>
        {description && <span className="field-row-hint">{description}</span>}
      </label>
      <div className="field-row-control">{children}</div>
    </div>
  );
}
