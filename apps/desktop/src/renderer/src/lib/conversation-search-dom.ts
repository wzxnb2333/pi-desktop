import { type ConversationMatch, literalMatches } from './conversation-search.ts';
import { waitForConversationLayout } from './conversation-layout.ts';

export function clearConversationHighlight(): void {
  CSS.highlights.delete('conversation-find');
  document.querySelectorAll('[data-search-active]').forEach(node => node.removeAttribute('data-search-active'));
}

/** Wait for actual fold transitions, not a timer that races reduced motion and nested groups. */
export async function focusConversationMatch(root: HTMLElement, match: ConversationMatch, query: string, signal: AbortSignal): Promise<boolean> {
  const turn = [...root.querySelectorAll<HTMLElement>('[data-turn-key]')].find(node => node.dataset.turnKey === match.turnKey);
  const target = [...(turn?.querySelectorAll<HTMLElement>('[data-search-target]') ?? [])].find(node => node.dataset.searchTarget === match.target);
  if (!target) return false;
  if (!await waitForConversationLayout(root, target, signal)) return false;
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (!(walker.currentNode.parentElement?.closest('[data-markdown-copy="exclude"]'))) nodes.push(walker.currentNode as Text);
  let renderedMatch: RegExpMatchArray | undefined;
  let occurrence = 0;
  for (const candidate of literalMatches(nodes.map(node => node.data).join(''), query.trim())) {
    if (occurrence++ === match.occurrence) { renderedMatch = candidate; break; }
  }
  let range: Range | undefined;
  if (renderedMatch) {
    const start = renderedMatch.index!;
    const end = start + renderedMatch[0].length;
    let offset = 0;
    range = document.createRange();
    for (const node of nodes) {
      if (start >= offset && start < offset + node.length) range.setStart(node, start - offset);
      if (end > offset && end <= offset + node.length) { range.setEnd(node, end - offset); break; }
      offset += node.length;
    }
  }
  clearConversationHighlight();
  target.dataset.searchActive = 'true';
  if (range) CSS.highlights.set('conversation-find', new Highlight(range));
  target.focus({ preventScroll: true });
  // Reveal long outputs in their own scroll container before positioning the outer timeline.
  for (let element: HTMLElement | null = range?.startContainer.parentElement ?? target; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    const rect = range?.getBoundingClientRect() ?? target.getBoundingClientRect();
    const viewport = element.getBoundingClientRect();
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) element.scrollTop += rect.top - viewport.top - (element.clientHeight - rect.height) / 2;
    if (/(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth) {
      if (rect.left < viewport.left) element.scrollLeft += rect.left - viewport.left;
      else if (rect.right > viewport.right) element.scrollLeft += rect.right - viewport.right;
    }
    if (element === root) break;
  }
  return true;
}
