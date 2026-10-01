export interface ComposerTrigger { kind: '@' | '/'; start: number; end: number; query: string; }

/** Only the token at the caret opens suggestions; email addresses and existing prose stay literal. */
export function composerTrigger(text: string, start: number, end = start): ComposerTrigger | undefined {
  if (start !== end) return;
  const match = /(?:^|\s)([@/])([^\s@]*)$/.exec(text.slice(0, start));
  if (!match) return;
  const kind = match[1] as '@' | '/';
  if (kind === '/' && match[2].includes('/')) return;
  return { kind, start: start - match[2].length - 1, end: start, query: match[2] };
}
