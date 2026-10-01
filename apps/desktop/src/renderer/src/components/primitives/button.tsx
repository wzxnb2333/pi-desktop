import { useLocale } from "../../hooks/use-locale.ts";
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Tooltip } from './tooltip.tsx';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'subtle' | 'ghost';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * `default` emits no class: the element rule in `base.css` already is the default skin. The other four
 * names are the class names surfaces were applying by hand before this component existed, so an
 * untouched `<button className="primary">` and `<Button variant="primary">` stay visually identical.
 */
export function buttonClass(variant: ButtonVariant, size: ButtonSize, extra?: string): string {
  return ['btn', `btn-${size}`, variant === 'default' ? '' : variant, extra ?? ''].filter(Boolean).join(' ');
}

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = 'default',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  useLocale();
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

export interface IconButtonProps {
  label: string;
  children: ReactNode;
  onClick(): void;
  active?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * The button keeps its accessible label; a shared portal tooltip describes it on hover or focus.
 *
 * `size` and `variant` are optional and add nothing when omitted, so the rendered class list stays
 * exactly what it was before the shared button API existed and `.icon-button` remains owned by
 * whichever surface styles it.
 */
export function IconButton({
  label,
  children,
  onClick,
  active,
  disabled,
  variant = 'default',
  size,
}: IconButtonProps) {
  useLocale();
  const classes = ['icon-button'];
  if (size) classes.push('btn-icon', `btn-${size}`);
  if (variant !== 'default') classes.push(variant);
  if (active) classes.push('active');
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={classes.join(' ')}
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
    </Tooltip>
  );
}
