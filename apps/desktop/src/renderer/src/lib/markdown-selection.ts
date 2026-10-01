import type { Element, Root, Text } from 'hast';
import type { VFile } from 'vfile';

/** Map rendered text to its actual source, including repeated phrases and highlighted code. */
export function quoteSourcePositions() {
  return (tree: Root, file: VFile) => {
    const source = String(file.value);
    const content = (node: Element | Text): string => node.type === 'text' ? node.value : node.children.map(child => child.type === 'element' || child.type === 'text' ? content(child) : '').join('');
    const visit = (parent: Root | Element) => {
      parent.children = parent.children.map(child => {
        const start = child.position?.start.offset, end = child.position?.end.offset;
        if (child.type === 'element' && child.tagName === 'code') {
          if (start != null && end != null) {
            const raw = source.slice(start, end), block = parent.type === 'element' && parent.tagName === 'pre';
            const value = (block ? content(child).replace(/\n$/, '') : content(child)).replaceAll('\r\n', '\n');
            // A code line may equal its fence's language. Never match inside that header.
            const afterFence = block && /^\s{0,3}(`{3,}|~{3,})/.test(raw) ? raw.indexOf('\n') + 1 : !block ? /^`+/.exec(raw)?.[0].length ?? 0 : 0;
            let normalized = '';
            const sourceMap = [afterFence];
            for (let index = afterFence; index < raw.length; index++) {
              if (raw[index] === '\r' && raw[index + 1] === '\n') index++;
              normalized += raw[index]; sourceMap.push(index + 1);
            }
            const offset = normalized.indexOf(value);
            if (offset >= 0 && value) {
              child.children = [{ type: 'element', tagName: 'span', properties: { 'data-quote-start': start + sourceMap[offset], 'data-quote-end': start + sourceMap[offset + value.length], 'data-quote-literal': true }, children: child.children }];
            }
          }
          return child;
        }
        if (child.type === 'text' && start != null && end != null) return {
          type: 'element', tagName: 'span', properties: { 'data-quote-start': start, 'data-quote-end': end }, children: [child],
        };
        if (child.type === 'element') visit(child);
        return child;
      });
    };
    visit(tree);
  };
}

function sourceOffsets(raw: string, rendered: string, literal: boolean): number[] | undefined {
  if (raw === rendered) return Array.from({ length: raw.length + 1 }, (_, index) => index);
  if (literal && rendered === raw + '\n') return [...Array.from({ length: raw.length + 1 }, (_, index) => index), raw.length];
  const offsets = [0];
  let cursor = 0;
  const decoder = document.createElement('textarea');
  while (cursor < raw.length) {
    const rest = raw.slice(cursor);
    const entity = !literal && /^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i.exec(rest)?.[0];
    let value = raw[cursor], size = 1;
    if (entity) { decoder.innerHTML = entity; value = decoder.value; size = entity.length; }
    else if (!literal && /^\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(rest)) { value = raw[cursor + 1]; size = 2; }
    else if (rest.startsWith('\r\n')) { value = '\n'; size = 2; }
    if (!rendered.startsWith(value, offsets.length - 1)) return undefined;
    for (let index = 0; index < value.length; index++) offsets.push(index === value.length - 1 ? cursor + size : cursor);
    cursor += size;
  }
  // Markdown adds one display newline to fenced code, including an EOF without a newline.
  if (literal && offsets.length === rendered.length && rendered.endsWith('\n')) offsets.push(raw.length);
  return offsets.length === rendered.length + 1 ? offsets : undefined;
}

export function selectedMessageSource(body: HTMLElement, range: Range, source: string) {
  if (range.collapsed || !body.contains(range.startContainer) || !body.contains(range.endContainer)) return undefined;
  let start: number | undefined, end: number | undefined;
  for (const node of body.querySelectorAll<HTMLElement>('[data-quote-start]')) {
    if (!range.intersectsNode(node)) continue;
    const selected = document.createRange(); selected.selectNodeContents(node);
    if (range.compareBoundaryPoints(Range.START_TO_START, selected) > 0) selected.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, selected) < 0) selected.setEnd(range.endContainer, range.endOffset);
    if (selected.collapsed || !selected.toString()) continue;
    const base = Number(node.dataset.quoteStart), limit = Number(node.dataset.quoteEnd);
    const offsets = sourceOffsets(source.slice(base, limit), node.textContent ?? '', node.hasAttribute('data-quote-literal'));
    if (!offsets) return undefined;
    const prefix = document.createRange(); prefix.selectNodeContents(node); prefix.setEnd(selected.startContainer, selected.startOffset);
    const from = prefix.toString().length;
    start ??= base + offsets[from]; end = base + offsets[from + selected.toString().length];
  }
  return start != null && end != null && end > start ? { start, end, text: source.slice(start, end) } : undefined;
}
