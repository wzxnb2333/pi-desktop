export function diffHunks(text: string): string[] {
  const result: string[] = [];
  for (const file of text.split(/(?=^diff --git )/m).filter(Boolean)) {
    const position = file.indexOf('\n@@');
    if (position < 0) continue;
    const header = file.slice(0, position + 1);
    for (const hunk of file.slice(position + 1).split(/(?=^@@ )/m).filter(Boolean)) result.push(header + hunk);
  }
  return result;
}

/** Reverse one verified text hunk in memory, preserving unaffected bytes and line endings. */
export function reverseTextHunk(content: string, patch: string): string {
  const at = patch.indexOf('\n@@');
  const lines = patch.slice(at + 1).split('\n');
  const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines.shift() ?? '');
  if (at < 0 || !header || /^(?:rename |copy |GIT binary patch)/m.test(patch)) throw new Error('此差异块需要使用文件级恢复');
  const oldCount = header[2] === undefined ? 1 : Number(header[2]);
  const newCount = header[4] === undefined ? 1 : Number(header[4]);
  const offset = Number(header[3]) - (newCount ? 1 : 0);
  const tokens = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const records: Array<{ kind: string; text: string; noNewline: boolean }> = [];
  for (const line of lines) {
    if (line === '\\ No newline at end of file') { if (!records.length) throw new Error('无效差异块'); records.at(-1)!.noNewline = true; continue; }
    if (line === '' && lines.at(-1) === line) continue;
    if (![' ', '+', '-'].includes(line[0])) throw new Error('无效差异块');
    records.push({ kind: line[0], text: line.slice(1).replace(/\r$/, ''), noNewline: false });
  }
  const right = records.filter(record => record.kind !== '-');
  const left = records.filter(record => record.kind !== '+');
  if (right.length !== newCount || left.length !== oldCount || offset < 0 || offset + newCount > tokens.length) throw new Error('差异块行数不匹配，请刷新后重试');
  for (let index = 0; index < right.length; index++) {
    const token = tokens[offset + index];
    if (token.replace(/\r?\n$/, '') !== right[index].text || right[index].noNewline && token.endsWith('\n'))
      throw new Error('文件内容与差异块不匹配，请刷新后重试');
  }
  let next = 0;
  const replacement: string[] = [];
  for (const record of records) {
    if (record.kind === ' ') replacement.push(tokens[offset + next++]);
    else if (record.kind === '+') next++;
    else replacement.push(record.text + (record.noNewline ? '' : eol));
  }
  return [...tokens.slice(0, offset), ...replacement, ...tokens.slice(offset + newCount)].join('');
}
