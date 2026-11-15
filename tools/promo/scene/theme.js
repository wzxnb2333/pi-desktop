/*
 * Design tokens copied from the shipping app, so the rebuilt UI is the same
 * product rather than a lookalike.
 *
 * Sources, both read-only:
 *   apps/desktop/src/renderer/src/styles/codex-26915-theme.css  (palette)
 *   apps/desktop/src/renderer/src/styles/tokens.css             (geometry, type)
 *
 * Light and dark are separate objects rather than one object plus overrides,
 * because the dark accent is a different hue (sky blue) and not a shade of the
 * light one (royal blue). Mixing them up is the most visible way to look
 * off-brand, so they never share a value by accident.
 */

export const LIGHT = {
  bg: 'rgb(255,255,255)',
  panel: 'rgb(255,255,255)',
  sidebar: 'rgb(240,243,249)',
  surface: 'rgb(255,255,255)',
  text: 'rgb(26,28,31)',
  muted: 'rgba(26,28,31,.65)',
  tertiary: 'rgba(26,28,31,.494)',
  hover: 'rgba(26,28,31,.055)',
  selected: 'rgba(26,28,31,.05)',
  border: 'rgba(26,28,31,.08)',
  borderStrong: 'rgba(26,28,31,.118)',
  accent: 'rgb(44,103,197)',
  accentSoft: 'rgba(44,103,197,.15)',
  danger: 'rgb(186,38,35)',
  success: 'rgb(0,162,64)',
  diffAdded: 'rgba(0,162,64,.15)',
  diffRemoved: 'rgba(186,38,35,.15)',
  codeBg: 'rgba(26,28,31,.04)',
  // The user bubble is a near-black pill in both themes.
  bubble: 'rgb(26,28,31)',
  bubbleText: 'rgb(255,255,255)',
  shadow: 'rgba(0,0,0,.14)',
  isDark: false,
};

export const DARK = {
  bg: 'rgb(24,24,24)',
  panel: 'rgb(24,24,24)',
  sidebar: 'rgb(29,32,38)',
  surface: 'rgb(45,45,45)',
  text: 'rgb(255,255,255)',
  muted: 'rgba(255,255,255,.65)',
  tertiary: 'rgba(255,255,255,.498)',
  hover: 'rgba(255,255,255,.08)',
  selected: 'rgba(255,255,255,.05)',
  border: 'rgba(255,255,255,.082)',
  borderStrong: 'rgba(255,255,255,.157)',
  accent: 'rgb(131,195,255)',
  accentSoft: 'rgba(131,195,255,.15)',
  danger: 'rgb(250,66,62)',
  success: 'rgb(64,201,119)',
  diffAdded: 'rgba(64,201,119,.23)',
  diffRemoved: 'rgba(250,66,62,.23)',
  codeBg: 'rgba(255,255,255,.06)',
  bubble: 'rgb(255,255,255)',
  bubbleText: 'rgb(24,24,24)',
  shadow: 'rgba(0,0,0,.5)',
  isDark: true,
};

const COLOR_CACHE = new Map();

/** Parse `rgb()` / `rgba()` into parts. Only those two forms appear above. */
function parseColor(color) {
  const cached = COLOR_CACHE.get(color);
  if (cached) return cached;
  const match = /rgba?\(([^)]+)\)/.exec(color);
  if (!match) throw new Error(`theme color not parseable: ${color}`);
  const parts = match[1].split(',').map((p) => Number(p.trim()));
  const value = { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  COLOR_CACHE.set(color, value);
  return value;
}

export function mixColor(a, b, t) {
  const x = parseColor(a);
  const y = parseColor(b);
  const r = Math.round(x.r + (y.r - x.r) * t);
  const g = Math.round(x.g + (y.g - x.g) * t);
  const bl = Math.round(x.b + (y.b - x.b) * t);
  const al = x.a + (y.a - x.a) * t;
  return `rgba(${r},${g},${bl},${Number(al.toFixed(4))})`;
}

/** Same color at a different opacity, for glows and washes. */
export function withAlpha(color, alpha) {
  const { r, g, b } = parseColor(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Type and geometry from tokens.css. */
export const TYPE = {
  sans: '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
  mono: 'Consolas, "Cascadia Code", ui-monospace, monospace',
  serif: 'Georgia, "Times New Roman", serif',
  ui: 14,
  uiSmall: 13,
  uiWeight: 430,
};

export const GEOMETRY = {
  toolbar: 46,
  sidebar: 275,
  review: 390,
  row: 31,
  rowNav: 30,
  radiusRow: 10,
  radiusComposer: 22,
};
