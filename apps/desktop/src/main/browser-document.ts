import type { BrowserToolRequest } from '../shared/browser-tools.ts';

/** Serialized into a dedicated isolated world; never evaluates model-supplied code. */
export function browserDocument(request: BrowserToolRequest, token: string) {
  try {
  type Reference = { node: HTMLElement; signature: string };
  const host = window as typeof window & { __piBrowser?: { document: Document; token: string; refs: Map<string, Reference> } };
  const signature = (node: HTMLElement) => [node.tagName, node.getAttribute('role'), node.getAttribute('href'), node.getAttribute('formaction'), node.getAttribute('type'), node.getAttribute('aria-label'), node.textContent?.slice(0, 2000)].join('|');
  if (request.action === 'inspect') {
    const state = { document, token, refs: new Map<string, Reference>() }; host.__piBrowser = state;
    const all = [...document.querySelectorAll<HTMLElement>('a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]')].filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
    const elements = all.slice(0, 300).map((node, index) => {
      const ref = token + ':' + index; state.refs.set(ref, { node, signature: signature(node) });
      const labelled = (node.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      const label = 'labels' in node && node.labels instanceof NodeList ? [...node.labels].map(item => item.textContent).join(' ') : '';
      return { ref, tag: node.tagName.toLowerCase(), role: node.getAttribute('role') ?? '', name: (node.getAttribute('aria-label') || labelled || label || node.textContent || node.getAttribute('placeholder') || '').slice(0, 500),
        type: node.getAttribute('type') ?? '', disabled: node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true' };
    });
    const text = document.body?.innerText ?? '';
    return { url: location.href, title: document.title, text: text.slice(0, 80000), truncated: text.length > 80000 || all.length > 300, elements, frames: document.querySelectorAll('iframe').length, width: innerWidth, height: innerHeight };
  }
  if (request.action === 'scroll') { window.scrollBy({ top: (request.direction === 'up' ? -1 : 1) * Math.round(innerHeight * .8), behavior: 'instant' }); return { url: location.href, scrollY }; }
  const state = host.__piBrowser; const reference = state?.refs.get(request.ref ?? '');
  if (!state || state.document !== document || !reference?.node.isConnected || reference.signature !== signature(reference.node)) throw new Error('页面元素已变化，请重新检查页面');
  const node = reference.node;
  if (node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true') throw new Error('页面元素不可操作');
  node.scrollIntoView({ block: 'center', inline: 'nearest' });
  if (request.action === 'click') node.click();
  else if (request.action === 'type') {
    if (node instanceof HTMLInputElement && ['file', 'hidden', 'button', 'submit', 'reset', 'checkbox', 'radio'].includes(node.type)) throw new Error('此输入类型不支持文本操作');
    if ((node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && node.readOnly) throw new Error('页面元素不可操作');
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      const prototype = node instanceof HTMLInputElement ? HTMLInputElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, request.text ?? '');
    } else if (node.isContentEditable) node.textContent = request.text ?? '';
    else throw new Error('页面元素不是可编辑输入框');
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { url: location.href, action: request.action, ref: request.ref };
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}
