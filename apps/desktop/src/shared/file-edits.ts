/** Keep the editable representation and the bytes written to disk identical. */
export function normalizedFileEdit(original: string, content: string): string {
  let next = original.includes('\r\n') ? content.replace(/\r?\n/g, '\r\n') : content;
  if (original.charCodeAt(0) === 0xfeff && next.charCodeAt(0) !== 0xfeff) next = '\ufeff' + next;
  if (next.includes('\0')) throw new Error('文本编辑不能包含空字符，请使用外部编辑器');
  if (new TextEncoder().encode(next).length > 512000) throw new Error('编辑内容超过 512 KB，草稿已保留，请使用外部编辑器');
  return next;
}
