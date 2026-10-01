/** Fixed read-only script in an isolated world. The page supplies data, never executable instructions. */
export function annotationDocument() {
  const elements = [...document.body.querySelectorAll<HTMLElement>('*')].filter(node => !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName) && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  const visible = elements.map(node => {
    const box = node.getBoundingClientRect();
    const x = Math.max(0, box.x), y = Math.max(0, box.y);
    const width = Math.min(innerWidth, box.right) - x, height = Math.min(innerHeight, box.bottom) - y;
    if (width <= 0 || height <= 0) return null;
    const path: string[] = []; let current: Element | null = node;
    while (current && current !== document.body && path.length < 6) {
      const siblings: Element[] = current.parentElement ? [...current.parentElement.children].filter(item => item.tagName === current!.tagName) : [];
      path.unshift(current.tagName.toLowerCase() + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')'); current = current.parentElement;
    }
    return { tag: node.tagName.toLowerCase(), label: (node.getAttribute('aria-label') || node.textContent || node.getAttribute('placeholder') || '').trim().slice(0, 300), selector: path.join(' > '), rect: { x, y, width, height } };
  }).filter(item => item !== null).slice(0, 5000).map((item, id) => ({ ...item, id }));
  return { url: location.href, title: document.title.slice(0, 2000), width: innerWidth, height: innerHeight, scrollX, scrollY, elements: visible, text: (document.body.innerText ?? '').slice(0, 200000) };
}
