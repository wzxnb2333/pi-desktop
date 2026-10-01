import { tr } from "../../shared/localization.ts";
import { useLocale } from "./hooks/use-locale.ts";
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';
import type { TerminalInfo } from '../../shared/contracts';
import { terminalOutputEnd } from '../../shared/terminal-output.ts';
import { findTerminalMatches, terminalBufferText } from './lib/terminal-text.ts';

/**
 * One xterm per pty, alive for the renderer session rather than for the panel's mount.
 *
 * Hiding the pane unmounts `TerminalSection` (that decision is the shell's, not this file's), and
 * disposing the xterm there would throw away the scrollback and the scroll position of a process
 * that is still running. So the host element is owned by this module: mounting adopts it into the
 * panel's slot, unmounting parks it in a hidden container, and nothing ever disposes it - which also
 * keeps a killed pty's last screen readable.
 */
interface Session {
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  observer: ResizeObserver;
  /** Re-measures the host and pushes a new size to the pty; no-op while the host has no box. */
  sync(): void;
  /** Absolute UTF-16 output position already handed to this instance. */
  written: number;
  searchQuery?: string;
}

const sessions = new Map<string, Session>();
export function receiveTerminalOutput(id: string, data: string, offset?: number, exited?: boolean): void {
  const session = sessions.get(id);
  if (!session) return;
  const start = offset ?? session.written;
  if (start > session.written) session.term.write(tr("\r\n[部分输出已超出恢复缓冲，仅恢复最近内容]\r\n"));
  const addition = data.slice(Math.max(0, session.written - start));
  if (addition) session.term.write(addition);
  session.written = Math.max(session.written, start + data.length);
  if (exited) session.term.options.disableStdin = true;
}
export async function terminalAction(id: string, action: 'clear' | 'copy' | 'find' | 'findPrevious' | 'focus', query = ''): Promise<string | undefined> {
  const session = sessions.get(id);
  if (!session) return;
  const term = session.term;
  if (action === 'focus') { term.focus(); return; }
  if (action === 'clear') { term.clear(); return; }
  if (action === 'copy') {
    const text = term.getSelection() || terminalBufferText(term.buffer.active, term.cols);
    await navigator.clipboard.writeText(text);
    return;
  }
  if (!query) return tr("请输入查找文字");
  const buffer = term.buffer.active;
  const matches = findTerminalMatches(buffer, term.cols, query);
  const selection = session.searchQuery === query ? term.getSelectionPosition() : undefined;
  session.searchQuery = query;
  if (!matches.length) { term.clearSelection(); return tr("未找到匹配内容"); }
  const previous = action === 'findPrevious';
  const position = selection ? previous ? selection.start : selection.end : { x: 0, y: buffer.viewportY };
  const start = position.y * term.cols + position.x;
  let index = previous ? matches.findLastIndex(match => match.start < start) : matches.findIndex(match => match.start >= start);
  const wrapped = index < 0;
  if (wrapped) index = previous ? matches.length - 1 : 0;
  const match = matches[index];
  const row = Math.floor(match.start / term.cols);
  term.select(match.start % term.cols, row, match.end - match.start);
  term.scrollToLine(row);
  return tr("第 ") + (index + 1) + '/' + matches.length + tr(" 处") + (wrapped ? tr(" · 已循环") : '');
}
let parking: HTMLDivElement | undefined;
let themeWatch: MutationObserver | undefined;

interface Color {
  red: number;
  green: number;
  blue: number;
}

/** Parses the literal hues below; token values are resolved by the browser instead. */
function hex(value: string): Color {
  // tokens.css mixes forms: `--bg` is `#fff` in light and `#181818` in dark, so both work.
  const digits = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  if (!digits) throw new Error(tr("无效的颜色: {p0}", { p0: value }));
  const text = digits[1].length === 3 ? digits[1].replace(/./g, (char: string) => char.repeat(2)) : digits[1];
  return {
    red: Number.parseInt(text.slice(0, 2), 16),
    green: Number.parseInt(text.slice(2, 4), 16),
    blue: Number.parseInt(text.slice(4, 6), 16),
  };
}

const WHITE = hex('#ffffff');
const BLACK = hex('#000000');

/**
 * Hues xterm needs that the token layer deliberately does not carry (tokens.css header: "no new
 * palette entries", design-tokens.md §4). Three of them are the app's own non-token hues, so
 * `git diff --color` in the terminal agrees with the Review panel; magenta and cyan exist only
 * because ANSI asks for sixteen slots.
 */
const ANSI_HUES = {
  green: hex('#278448'), // panels.css `.diff .addition`
  yellow: hex('#b68436'), // panels.css `.amber`
  magenta: hex('#a259b8'),
  cyan: hex('#3f8f9c'),
};

/**
 * Dedicated terminal fallback colors from the 26.915 light and dark captures.
 * Selection and ANSI colors are Pi adaptations where the capture has no evidence.
 */
const TOKEN_DEFAULTS = {
  '--terminal-background': hex('#181818'),
  '--terminal-foreground': hex('#dfdfdf'),
  '--accent': hex('#339cff'),
  '--danger': hex('#e02e2a'),
  '--terminal-selection': hex('#4b4b4b'),
} as const;

let probe: HTMLSpanElement | undefined;

/**
 * Reads a design token through the browser, so `color-mix()`, `oklch()` and fractional alpha all
 * reach xterm as plain rgb: `getPropertyValue` hands back the unresolved token text, and the dark
 * values only exist once the `[data-theme]` cascade has run (docs/desktop/interfaces.md 已知遗留).
 */
function tokenColor(name: keyof typeof TOKEN_DEFAULTS): Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // Hex needs no computation, and it is the form tokens.css uses for every token read here. Anything
  // else - `rgb()`, `color-mix()`, `oklch()` - goes through the probe, and an unparseable value ends
  // up on the default below rather than throwing out of a render.
  if (/^#([\da-f]{3}|[\da-f]{6})$/i.test(value)) return hex(value);
  if (!probe) {
    probe = document.createElement('span');
    probe.hidden = true;
    document.body.append(probe);
  }
  probe.style.color = '';
  probe.style.color = value;
  // An invalid assignment leaves the inline property empty, which is how an unparseable value is
  // caught. Translucency is flattened: xterm paints the slot itself and the pane behind it already
  // carries the alpha, so a second translucent fill would read as a darker rectangle.
  const used = probe.style.color ? getComputedStyle(probe).color : '';
  const parts = /^rgba?\(([^)]+)\)$/.exec(used)?.[1]?.split(/[\s,/]+/).filter(Boolean);
  if (!parts || parts.length < 3) return TOKEN_DEFAULTS[name];
  return { red: Number(parts[0]), green: Number(parts[1]), blue: Number(parts[2]) };
}

function mix(from: Color, to: Color, amount: number): Color {
  const step = (a: number, b: number): number => Math.round(a + (b - a) * amount);
  return {
    red: step(from.red, to.red),
    green: step(from.green, to.green),
    blue: step(from.blue, to.blue),
  };
}

const css = (color: Color): string => `rgb(${color.red} ${color.green} ${color.blue})`;

const luminance = (color: Color): number =>
  (0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue) / 255;

/**
 * The 26.915 terminal is dark even in a light window. Its dedicated tokens prevent
 * the application background from leaking into the output surface.
 */
function terminalTheme(): ITheme {
  const background = tokenColor('--terminal-background');
  const foreground = tokenColor('--terminal-foreground');
  const accent = tokenColor('--accent');
  const danger = tokenColor('--danger');
  const selection = tokenColor('--terminal-selection');
  const hues = {
    red: danger,
    green: ANSI_HUES.green,
    yellow: ANSI_HUES.yellow,
    blue: accent,
    magenta: ANSI_HUES.magenta,
    cyan: ANSI_HUES.cyan,
  };
  // "Bright" means further from the surface, so its direction depends on which theme is active.
  const lift = luminance(background) < 0.5 ? WHITE : BLACK;
  const grey = (amount: number): string => css(mix(background, foreground, amount));
  return {
    background: css(background),
    foreground: css(foreground),
    cursor: css(foreground),
    cursorAccent: css(background),
    // Same-version captures contain no selected output; retain a readable Pi selection.
    selectionBackground: css(selection),
    selectionInactiveBackground: css(selection),
    // ANSI black has to stay visible on either surface, so the ramp is surface-relative.
    black: grey(0.2),
    red: css(hues.red),
    green: css(hues.green),
    yellow: css(hues.yellow),
    blue: css(hues.blue),
    magenta: css(hues.magenta),
    cyan: css(hues.cyan),
    white: grey(0.85),
    brightBlack: grey(0.5),
    brightRed: css(mix(hues.red, lift, 0.3)),
    brightGreen: css(mix(hues.green, lift, 0.3)),
    brightYellow: css(mix(hues.yellow, lift, 0.3)),
    brightBlue: css(mix(hues.blue, lift, 0.3)),
    brightMagenta: css(mix(hues.magenta, lift, 0.3)),
    brightCyan: css(mix(hues.cyan, lift, 0.3)),
    brightWhite: css(foreground),
  };
}

/** Live instances re-read the tokens when the theme flips, including the parked ones. */
function watchTheme(): void {
  if (themeWatch) return;
  const apply = (): void => {
    const theme = terminalTheme();
    for (const session of sessions.values()) session.term.options.theme = theme;
  };
  // `data-theme` is written by `state/app.tsx`; the media query covers the `system` setting, where
  // the attribute never changes but the third token block in tokens.css does.
  themeWatch = new MutationObserver(apply);
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
}

function park(host: HTMLElement): void {
  if (!parking) {
    parking = document.createElement('div');
    parking.className = 'terminal-parking';
    parking.setAttribute('aria-hidden', 'true');
    document.body.append(parking);
  }
  parking.append(host);
}

function acquire(terminal: TerminalInfo, slot: HTMLElement): Session {
  const existing = sessions.get(terminal.id);
  if (existing) {
    slot.append(existing.host);
    return existing;
  }
  const host = document.createElement('div');
  host.className = 'terminal-surface';
  const term = new Terminal({
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 4 / 3,
    cursorStyle: 'bar',
    cursorBlink: true,
    theme: terminalTheme(),
    convertEol: false,
    allowProposedApi: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  if (terminal.outputOffset) term.write(tr("[仅恢复最近终端输出，较早内容已超出缓冲]\r\n"));
  term.write(terminal.output);
  term.onData((data) => {
    void window.desktop.invoke({ op: 'terminal.input', id: terminal.id, data }).catch(() => {});
  });
  const sync = (): void => {
    const dims = fit.proposeDimensions();
    // A parked host has no box and FitAddon floors `rows` at 1, which is below the
    // `terminal.resize` minimum in shared/contracts.ts: an out-of-range size must never be sent, so
    // the pty simply keeps the last size it had while the pane was visible.
    if (!dims || dims.cols < 2 || dims.rows < 2) return;
    if (dims.cols === term.cols && dims.rows === term.rows) return;
    fit.fit();
    void window
      .desktop.invoke({ op: 'terminal.resize', id: terminal.id, cols: term.cols, rows: term.rows })
      .catch(() => {});
  };
  const observer = new ResizeObserver(sync);
  observer.observe(host);
  slot.append(host);
  const session: Session = { term, fit, host, observer, sync, written: terminalOutputEnd(terminal) };
  sessions.set(terminal.id, session);
  watchTheme();
  return session;
}

export function TerminalPanel({ terminal }: { terminal: TerminalInfo }) {
  useLocale();
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = slot.current;
    if (!element) return;
    const session = acquire(terminal, element);
    session.sync();
    return () => park(session.host);
    // Only the pty identity re-creates this binding; output arrives through the delta effect below.
  }, [terminal.id]);
  useEffect(() => {
    receiveTerminalOutput(terminal.id, terminal.output, terminal.outputOffset ?? 0, terminal.exited);
  }, [terminal.id, terminal.output, terminal.outputOffset]);
  useEffect(() => {
    const session = sessions.get(terminal.id);
    if (session) session.term.options.disableStdin = terminal.exited;
  }, [terminal.id, terminal.exited]);
  return <div className="terminal-slot" ref={slot} aria-label={terminal.title} data-terminal-id={terminal.id} />;
}
