import { appearanceSchema, type Appearance, type Settings } from './contracts.ts';

export function appearanceFromSettings(settings: Settings): Appearance {
  return appearanceSchema.parse(Object.fromEntries(Object.keys(appearanceSchema.shape).map(key => [key, settings[key as keyof Appearance]])));
}

/** Only validated local font names and solid colors enter the cascade; no imported CSS or URLs. */
export function appearanceProperties(value: Appearance): Record<string, string> {
  const colors = appearanceSchema.parse(value);
  return {
    '--font-size': `${colors.fontSize}px`,
    '--code-font-size': `${colors.codeFontSize}px`,
    '--font-sans': colors.uiFontFamily ? `"${colors.uiFontFamily}", system-ui, sans-serif` : '',
    '--font-mono': colors.codeFontFamily ? `"${colors.codeFontFamily}", ui-monospace, monospace` : '',
    '--markdown-code-font': colors.codeFontFamily ? `"${colors.codeFontFamily}", ui-monospace, monospace` : '',
    '--accent': colors.accentColor,
    '--settings-switch-background': colors.accentColor,
    '--bg': colors.backgroundColor,
    '--surface': colors.backgroundColor,
    '--sidebar': colors.backgroundColor ? 'color-mix(in srgb, var(--bg) 96%, var(--text))' : '',
    '--settings-card-background': colors.backgroundColor ? 'color-mix(in srgb, var(--bg) 97%, var(--text))' : '',
    '--composer-background': colors.backgroundColor ? 'color-mix(in srgb, var(--bg) 94%, var(--text))' : '',
    '--text': colors.foregroundColor,
    '--muted': colors.foregroundColor ? 'color-mix(in srgb, var(--text) 65%, transparent)' : '',
    '--tertiary': colors.foregroundColor ? 'color-mix(in srgb, var(--text) 50%, transparent)' : '',
    '--border': colors.foregroundColor ? 'color-mix(in srgb, var(--text) 9%, transparent)' : '',
    '--border-strong': colors.foregroundColor ? 'color-mix(in srgb, var(--text) 16%, transparent)' : '',
    '--hover': colors.foregroundColor ? 'color-mix(in srgb, var(--text) 7%, transparent)' : '',
    '--selected': colors.foregroundColor ? 'color-mix(in srgb, var(--text) 6%, transparent)' : '',
  };
}
