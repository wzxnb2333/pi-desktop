import type { TerminalInfo } from './contracts.ts';

export const TERMINAL_OUTPUT_LIMIT = 200000;
export interface TerminalOutput { output: string; outputOffset?: number; }

/** Offsets count UTF-16 units, matching IPC strings and xterm.write input. */
export function terminalOutputEnd(value: TerminalOutput): number {
  return (value.outputOffset ?? 0) + value.output.length;
}

export function appendTerminalOutput<T extends TerminalOutput>(current: T, data: string, offset = terminalOutputEnd(current)): T {
  const end = terminalOutputEnd(current);
  if (offset + data.length <= end) return current;
  const overlap = Math.max(0, end - offset);
  const output = (offset > end ? '' : current.output) + data.slice(overlap);
  let cut = Math.max(0, output.length - TERMINAL_OUTPUT_LIMIT);
  // Do not start a restored snapshot in the middle of a surrogate pair.
  if (cut > 0 && /[\uDC00-\uDFFF]/.test(output[cut]) && /[\uD800-\uDBFF]/.test(output[cut - 1])) cut++;
  return { ...current, output: output.slice(cut), outputOffset: offset + data.length - (output.length - cut) };
}

/** A rename/open/bootstrap response may precede terminal events already received. */
export function mergeTerminalSnapshot(current: TerminalInfo | undefined, snapshot: TerminalInfo): TerminalInfo {
  if (!current) return appendTerminalOutput({ ...snapshot, output: '', outputOffset: snapshot.outputOffset ?? 0 }, snapshot.output, snapshot.outputOffset ?? 0);
  // Events can arrive while bootstrap is in flight; recover an overlapping earlier prefix too.
  const output = (snapshot.outputOffset ?? 0) < (current.outputOffset ?? 0) && terminalOutputEnd(snapshot) >= (current.outputOffset ?? 0) && terminalOutputEnd(snapshot) <= terminalOutputEnd(current)
    ? appendTerminalOutput(snapshot, current.output, current.outputOffset ?? 0)
    : appendTerminalOutput(current, snapshot.output, snapshot.outputOffset ?? 0);
  return { ...current, ...snapshot, output: output.output, outputOffset: output.outputOffset, exited: current.exited || snapshot.exited };
}
