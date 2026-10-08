import { messages } from './messages.ts';
import { appErrorPatterns, appErrors } from './app-errors.ts';
import { defaultLocale, type Locale } from './locale.ts';

export type MessageKey = keyof typeof messages;
const chineseLabels: Partial<Record<MessageKey, string>> = { 'menu.file': '文件' };
type Slots<S extends string> = S extends `${string}{${infer P}}${infer R}` ? (P extends `p${number}` ? P : never) | Slots<R> : never;
type Values<K extends MessageKey> = Record<Slots<K>, string | number>;
type Arguments<K extends MessageKey> = [Slots<K>] extends [never] ? [values?: Values<K>] : [values: Values<K>];

let locale: Locale = defaultLocale;
const listeners = new Set<() => void>();
export const getLocale = (): Locale => locale;
export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  for (const listener of listeners) listener();
}
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function translate<K extends MessageKey>(language: Locale, key: K, ...args: Arguments<K>): string {
  const text: string = language === 'en-US' ? messages[key] : chineseLabels[key] ?? key;
  const values = args[0] as Record<string, string | number> | undefined;
  return text.replace(/\{(p\d+)\}/g, (token, name: string) => values && name in values ? String(values[name]) : token);
}
export function tr<K extends MessageKey>(key: K, ...args: Arguments<K>): string {
  return translate(locale, key, ...args);
}

/** Application labels received as data; never use for conversation or file contents. */
export function localizeLabel(label: string): string {
  if (locale === 'en-US') {
    const progress = /^(迁移|恢复)文件 (\d+)\/(\d+)$/.exec(label);
    if (progress) return (progress[1] === '迁移' ? 'Migrating file ' : 'Restoring file ') + progress[2] + '/' + progress[3];
  }
  return locale === 'en-US' && Object.hasOwn(messages, label) ? messages[label as MessageKey] : label;
}

/** Localize only known app errors, preserving all inserted model names and paths verbatim. */
export function localizeAppError(message: string): string {
  if (locale !== 'en-US') return message;
  const transport = /^(Error: (?:Error invoking remote method '[^']+': Error: )?)/.exec(message);
  if (transport) return transport[0] + localizeAppError(message.slice(transport[0].length));
  if (Object.hasOwn(appErrors, message)) return appErrors[message as keyof typeof appErrors];
  for (const entry of appErrorPatterns) {
    const match = entry.pattern.exec(message);
    if (match) return entry.render(match);
  }
  if (Object.hasOwn(messages, message)) return localizeLabel(message);
  const newline = message.indexOf('\n');
  if (newline > 0) {
    const heading = message.slice(0, newline);
    if (Object.hasOwn(appErrors, heading) || Object.hasOwn(messages, heading)) return localizeAppError(heading) + message.slice(newline);
  }
  const separator = message.lastIndexOf('：');
  if (separator >= 0) {
    const suffix = message.slice(separator + 1);
    if (Object.hasOwn(appErrors, suffix)) return message.slice(0, separator) + ': ' + appErrors[suffix as keyof typeof appErrors];
  }
  return message;
}
