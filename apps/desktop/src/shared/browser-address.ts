import { webUrlSchema } from './contracts.ts';

/** Bare hosts are convenient; an explicit unsupported scheme must never become an HTTPS host. */
export function browserAddress(raw: string): string {
  const value = raw.trim();
  if (!value || /[\u0000-\u0020\u007f\\]/u.test(value)) throw new Error('请输入有效网址；空格请使用 %20');
  const local = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?=[:/?#]|$)/i.test(value);
  const hostPort = /^(?:[\p{L}\p{N}.-]+|\[[\da-f:]+\]):\d+(?=[/?#]|$)/iu.test(value);
  const scheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  const explicit = /^(?:https?|file|javascript|vbscript|data|about|ftp|wss?|chrome|devtools|mailto):/i.test(value);
  if (scheme && (explicit || !hostPort) && !/^https?:\/\//i.test(value)) throw new Error('仅支持 HTTP 或 HTTPS 网址');
  const candidate = /^https?:\/\//i.test(value) ? value : (local ? 'http://' : 'https://') + value;
  const parsed = webUrlSchema.safeParse(candidate);
  if (!parsed.success) throw new Error('请输入不含用户名和密码的有效 HTTP 或 HTTPS 网址');
  return new URL(parsed.data).href;
}
