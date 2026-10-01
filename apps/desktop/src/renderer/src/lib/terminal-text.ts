interface Cell { getChars(): string; getWidth(): number; }
interface Line { readonly length: number; readonly isWrapped: boolean; getCell(column: number): Cell | undefined; }
interface Buffer { readonly length: number; getLine(row: number): Line | undefined; }
interface LogicalLine { text: string; folded: string; starts: number[]; ends: number[]; }
export interface TerminalMatch { start: number; end: number; }

/** Translate UTF-16 text offsets into physical cells, including wide/combined characters. */
export function terminalTextLines(buffer: Buffer, columns: number): LogicalLine[] {
  const lines: LogicalLine[] = [];
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    if (!line.isWrapped || !lines.length) lines.push({ text: '', folded: '', starts: [], ends: [] });
    const target = lines[lines.length - 1];
    const next = buffer.getLine(row + 1);
    let end = Math.min(line.length, columns);
    if (!next?.isWrapped) {
      while (end > 0 && !line.getCell(end - 1)?.getChars() && line.getCell(end - 1)?.getWidth() !== 0) end--;
    } else if (!line.getCell(end - 1)?.getChars() && line.getCell(end - 1)?.getWidth() === 1 && next.getCell(0)?.getWidth() === 2) {
      // xterm leaves a padding cell when a wide character wraps at the right edge.
      end--;
    }
    for (let column = 0; column < end; column++) {
      const cell = line.getCell(column);
      if (!cell || cell.getWidth() === 0) continue;
      const chars = cell.getChars() || ' ';
      const folded = chars.toLocaleLowerCase();
      target.text += chars;
      target.folded += folded;
      for (let offset = 0; offset < folded.length; offset++) {
        target.starts.push(row * columns + column);
        target.ends.push(row * columns + column + cell.getWidth());
      }
    }
  }
  return lines;
}

export function findTerminalMatches(buffer: Buffer, columns: number, query: string): TerminalMatch[] {
  if (!query) return [];
  const needle = query.toLocaleLowerCase();
  const matches: TerminalMatch[] = [];
  for (const line of terminalTextLines(buffer, columns)) {
    let offset = 0;
    while ((offset = line.folded.indexOf(needle, offset)) !== -1) {
      const match = { start: line.starts[offset], end: line.ends[offset + needle.length - 1] };
      if (matches.at(-1)?.start !== match.start || matches.at(-1)?.end !== match.end) matches.push(match);
      offset += needle.length;
    }
  }
  return matches;
}

export function terminalBufferText(buffer: Buffer, columns: number): string {
  const lines = terminalTextLines(buffer, columns).map(line => line.text);
  while (lines.length && !lines.at(-1)) lines.pop();
  return lines.join('\n');
}
