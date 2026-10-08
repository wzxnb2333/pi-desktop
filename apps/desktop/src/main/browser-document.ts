import type { BrowserToolRequest } from '../shared/browser-tools.ts';

export type BrowserDocumentRequest = Omit<BrowserToolRequest, 'action'> & {
  action: BrowserToolRequest['action'] | 'resolve' | 'active';
  focus?: boolean;
};

/** Serialized into a dedicated isolated world; never evaluates model-supplied code. */
export async function browserDocument(request: BrowserDocumentRequest, token: string, operationToken = '') {
  try {
    type Reference = { node: HTMLElement; signature: string };
    type Observer = { mutation: MutationObserver; invalidate: () => void };
    type State = { document: Document; token: string; revision: number; pageUrl: string; viewport: string; scrolls: Map<Element, string>; controls: Map<Element, string>; refs: Map<string, Reference>; observers: Map<Document, Observer>; cancelled: Set<string> };
    const host = window as typeof window & { __piBrowser?: State };
    const state = host.__piBrowser?.document === document ? host.__piBrowser : {
      document, token, revision: 0, pageUrl: location.href, viewport: '', scrolls: new Map<Element, string>(), controls: new Map<Element, string>(), refs: new Map<string, Reference>(), observers: new Map<Document, Observer>(), cancelled: new Set<string>(),
    };
    state.cancelled ??= new Set<string>();
    host.__piBrowser = state;
    const ensureOperationActive = () => { if (operationToken && state.cancelled.has(operationToken)) throw new Error('浏览器操作已取消'); };
    const yieldBeforeMutation = async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); ensureOperationActive(); };
    ensureOperationActive();
    const invalidate = () => { state.revision++; state.refs.clear(); };
    if (state.pageUrl !== location.href) { state.pageUrl = location.href; invalidate(); }
    const documents: Document[] = [];
    const viewEvents = ['resize', 'hashchange', 'popstate', 'pagehide', 'pageshow'];
    const frames: { src: string; sameOrigin: boolean; depth: number }[] = [];
    const collect = (doc: Document, depth: number) => {
      documents.push(doc);
      if (depth >= 8) return;
      for (const frame of doc.querySelectorAll('iframe')) {
        let nested: Document | null = null;
        try { nested = frame.contentDocument; } catch { /* Cross-origin frames remain inaccessible. */ }
        frames.push({ src: frame.src, sameOrigin: Boolean(nested), depth });
        if (nested) collect(nested, depth + 1);
      }
    };
    collect(document, 0);
    const viewport = documents.map(doc => { const view = doc.defaultView; return [view?.innerWidth, view?.innerHeight, view?.scrollX, view?.scrollY].join(','); }).join('|');
    if (state.viewport !== viewport) { state.viewport = viewport; invalidate(); }
    const scrolls = new Map<Element, string>();
    for (const doc of documents) for (const node of doc.querySelectorAll('*')) {
      if (node.scrollTop || node.scrollLeft) scrolls.set(node, node.scrollLeft + ',' + node.scrollTop);
    }
    // Scroll events can arrive after the next command. Validate container offsets synchronously.
    if (scrolls.size !== state.scrolls.size || [...scrolls].some(([node, offset]) => state.scrolls.get(node) !== offset)) invalidate();
    state.scrolls = scrolls;
    const controls = new Map<Element, string>();
    for (const doc of documents) for (const node of doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')) {
      // Runtime form properties do not produce mutation records. Never read password values.
      controls.set(node, JSON.stringify([node.matches(':disabled'), 'readOnly' in node && node.readOnly, 'checked' in node && node.checked,
        node.tagName === 'SELECT' ? Array.from((node as HTMLSelectElement).options, option => option.selected) : undefined,
        node.type === 'password' ? undefined : node.value]));
    }
    if (controls.size !== state.controls.size || [...controls].some(([node, value]) => state.controls.get(node) !== value)) invalidate();
    state.controls = controls;
    for (const [doc, observer] of state.observers) {
      if (!documents.includes(doc)) {
        observer.mutation.disconnect(); doc.removeEventListener('scroll', observer.invalidate, true);
        doc.removeEventListener('input', observer.invalidate, true); doc.removeEventListener('change', observer.invalidate, true);
        for (const event of viewEvents) doc.defaultView?.removeEventListener(event, observer.invalidate);
        state.observers.delete(doc); invalidate();
      }
      else if (observer.mutation.takeRecords().length) invalidate();
    }
    for (const doc of documents) if (!state.observers.has(doc)) {
      const observer = new MutationObserver(invalidate);
      if (doc.documentElement) observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      doc.addEventListener('scroll', invalidate, true);
      doc.addEventListener('input', invalidate, true); doc.addEventListener('change', invalidate, true);
      for (const event of viewEvents) doc.defaultView?.addEventListener(event, invalidate);
      state.observers.set(doc, { mutation: observer, invalidate }); invalidate();
    }
    const observation = () => state.token + ':' + state.revision;
    const signature = (node: HTMLElement) => [node.tagName, node.getAttribute('role'), node.getAttribute('href'), node.getAttribute('formaction'), node.getAttribute('type'), node.getAttribute('aria-label'), node.textContent?.slice(0, 2000)].join('|');
    const bounds = (node: HTMLElement) => {
      const rect = node.getBoundingClientRect();
      let { x, y, width, height } = rect;
      let view = node.ownerDocument.defaultView;
      while (view && view !== window) {
        const frame = view.frameElement as HTMLElement | null;
        if (!frame) break;
        const box = frame.getBoundingClientRect();
        const sx = frame.offsetWidth ? box.width / frame.offsetWidth : 1, sy = frame.offsetHeight ? box.height / frame.offsetHeight : 1;
        x = box.x + (x + frame.clientLeft) * sx; y = box.y + (y + frame.clientTop) * sy; width *= sx; height *= sy;
        view = frame.ownerDocument.defaultView;
      }
      return { x, y, width, height };
    };
    const visible = (node: HTMLElement) => {
      const rect = bounds(node), style = node.ownerDocument.defaultView?.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style?.visibility !== 'hidden' && style?.display !== 'none';
    };
    const label = (node: HTMLElement) => {
      const labelled = (node.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => node.ownerDocument.getElementById(id)?.textContent ?? '').join(' ').trim();
      const labels = Array.from((node as HTMLInputElement).labels ?? []).map(item => item.textContent ?? '').join(' ');
      return (node.getAttribute('aria-label') || labelled || labels || node.getAttribute('title') || node.textContent || node.getAttribute('placeholder') || '').trim();
    };
    const role = (node: HTMLElement) => node.getAttribute('role') || (node.tagName === 'INPUT' ?
      ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', range: 'slider', number: 'spinbutton' }[node.getAttribute('type') ?? ''] ?? 'textbox') :
      ({ BUTTON: 'button', A: 'link', TEXTAREA: 'textbox', SELECT: 'combobox' }[node.tagName] ?? node.tagName.toLowerCase()));
    const interactive = () => documents.flatMap(doc => [...doc.querySelectorAll<HTMLElement>('a,button,input,textarea,select,[role],[contenteditable="true"]')]).filter(visible);
    const locate = (ref?: string, locator = request.locator) => {
      if (ref) {
        const reference = state.refs.get(ref);
        if (!reference?.node.isConnected || !documents.includes(reference.node.ownerDocument) || reference.signature !== signature(reference.node)) throw new Error('页面元素已变化，引用已过期，请重新检查页面');
        return reference.node;
      }
      if (!locator) return undefined;
      return interactive().find(node => (!locator.role || role(node) === locator.role) &&
        (!locator.name || label(node).toLocaleLowerCase().includes(locator.name.toLocaleLowerCase())) &&
        (!locator.text || (node.textContent ?? '').toLocaleLowerCase().includes(locator.text.toLocaleLowerCase())) &&
        (!locator.placeholder || node.getAttribute('placeholder') === locator.placeholder));
    };
    const scrollTarget = (node: HTMLElement | undefined, direction: BrowserToolRequest['direction']) => {
      if (!node) return { view: window as Window, element: undefined as HTMLElement | undefined };
      const horizontal = direction === 'left' || direction === 'right';
      let current: HTMLElement | null = node;
      while (current) {
        const canScroll = horizontal ? current.scrollWidth > current.clientWidth : current.scrollHeight > current.clientHeight;
        if (canScroll) return { view: current.ownerDocument.defaultView ?? window, element: current };
        current = current.parentElement;
      }
      return { view: node.ownerDocument.defaultView ?? window, element: undefined as HTMLElement | undefined };
    };
    if (request.observationRevision && request.observationRevision !== observation()) throw new Error('页面观察已过期，请重新检查页面');
    if (request.action === 'inspect') {
      state.refs.clear(); const all = interactive();
      const elements = all.slice(0, 300).map((node, index) => {
        const ref = observation() + ':' + index; state.refs.set(ref, { node, signature: signature(node) });
        const tag = node.tagName, type = node.getAttribute('type') ?? '';
        return { ref, tag: tag.toLowerCase(), role: role(node), name: label(node).slice(0, 500), label: Array.from((node as HTMLInputElement).labels ?? []).map(item => item.textContent ?? '').join(' '),
          type, disabled: node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true', checked: ['checkbox', 'radio'].includes(type) ? (node as HTMLInputElement).checked : undefined, bounds: bounds(node),
          value: tag === 'INPUT' && type === 'password' ? undefined : ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) ? (node as HTMLInputElement).value : undefined };
      });
      const text = documents.map(doc => doc.body?.innerText ?? '').join('\n');
      return { url: location.href, title: document.title, observationRevision: observation(), text: text.slice(0, 80000), truncated: text.length > 80000 || all.length > 300, elements, frames,
        viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY }, width: innerWidth, height: innerHeight, scrollX, scrollY, readyState: document.readyState };
    }
    if (request.action === 'wait') {
      const condition = request.condition;
      const value = condition?.value ?? '';
      const conditionMet = condition?.kind === 'url' ? location.href.includes(value) : condition?.kind === 'text' ? documents.some(doc => (doc.body?.innerText ?? '').includes(value)) :
        condition?.kind === 'role' ? Boolean(locate(undefined, { role: value })) : condition?.kind === 'ref' ? Boolean(locate(value)) : condition?.kind === 'load' && document.readyState === 'complete';
      return { url: location.href, conditionMet, readyState: document.readyState };
    }
    if (request.action === 'scroll') {
      const target = request.ref || request.locator ? locate(request.ref) : undefined;
      await yieldBeforeMutation();
      const amount = request.amount ?? Math.round(innerHeight * .8);
      const delta = { top: ['up', 'down'].includes(request.direction ?? '') ? (request.direction === 'up' ? -amount : amount) : 0, left: ['left', 'right'].includes(request.direction ?? '') ? (request.direction === 'left' ? -amount : amount) : 0, behavior: 'instant' as ScrollBehavior };
      const destination = scrollTarget(target, request.direction);
      if (destination.element) destination.element.scrollBy(delta);
      else destination.view.scrollBy(delta);
      const scrollX = destination.element?.scrollLeft ?? destination.view.scrollX, scrollY = destination.element?.scrollTop ?? destination.view.scrollY;
      return { url: location.href, scrollX, scrollY, scroll: { x: scrollX, y: scrollY }, target: destination.element ? 'element' : 'viewport' };
    }
    if (request.action === 'active') {
      let doc = document;
      while (doc.activeElement?.tagName === 'IFRAME') {
        const nested = (doc.activeElement as HTMLIFrameElement).contentDocument;
        if (!nested || !documents.includes(nested)) throw new Error('不允许控制跨域或不可访问的页面框架');
        doc = nested;
      }
      return { url: location.href };
    }
    const atPoint = (doc: Document, x: number, y: number, depth = 0): HTMLElement | undefined => {
      const node = doc.elementFromPoint(x, y) as HTMLElement | null;
      if (node?.tagName === 'IFRAME') {
        if (depth >= 8) return undefined;
        const nested = (node as HTMLIFrameElement).contentDocument;
        if (!nested || !documents.includes(nested)) return undefined;
        const box = node.getBoundingClientRect(), sx = node.offsetWidth ? box.width / node.offsetWidth : 1, sy = node.offsetHeight ? box.height / node.offsetHeight : 1;
        return atPoint(nested, (x - box.x) / sx - node.clientLeft, (y - box.y) / sy - node.clientTop, depth + 1);
      }
      return node ?? undefined;
    };
    const node = request.ref || request.locator ? locate(request.ref) : request.x !== undefined && request.y !== undefined ? atPoint(document, request.x, request.y) : undefined;
    if (!node) throw new Error('找不到目标元素，请重新检查页面');
    if (node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true') throw new Error('页面元素不可操作');
    if (request.ref || request.locator) { await yieldBeforeMutation(); node.scrollIntoView({ block: 'center', inline: 'nearest' }); }
    if (request.action === 'resolve') {
      if (request.focus) { await yieldBeforeMutation(); node.focus(); }
      const rect = bounds(node); return { url: location.href, point: request.ref || request.locator ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : { x: request.x, y: request.y } };
    }
    if (request.action === 'type') {
      await yieldBeforeMutation();
      const tag = node.tagName, type = node.getAttribute('type') ?? '';
      if (tag === 'INPUT' && ['file', 'hidden', 'button', 'submit', 'reset', 'checkbox', 'radio'].includes(type)) throw new Error('此输入类型不支持文本操作');
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        const input = node as HTMLInputElement;
        if (input.readOnly) throw new Error('页面元素不可操作');
        if (tag === 'INPUT' && type === 'password' && request.append) {
          // Append in the browser without exposing the existing password to JavaScript.
          input.setSelectionRange(0xffffffff, 0xffffffff);
          input.setRangeText(request.text ?? '', input.selectionStart!, input.selectionEnd!, 'end');
        } else {
          const prototype = Object.getPrototypeOf(node) as object;
          const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
          if (!setter) throw new Error('页面元素不是可编辑输入框');
          setter.call(node, (request.append ? input.value : '') + (request.text ?? ''));
        }
      } else if (node.isContentEditable) node.textContent = (request.append ? node.textContent ?? '' : '') + (request.text ?? '');
      else throw new Error('页面元素不是可编辑输入框');
      node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { url: location.href, action: request.action, ref: request.ref, bounds: bounds(node) };
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

/** Serialized into the same isolated world to cancel a queued page mutation. */
export function cancelBrowserDocument(operationToken: string) {
  const host = window as typeof window & { __piBrowser?: { document: Document; cancelled?: Set<string> } };
  const state = host.__piBrowser;
  if (state?.document !== document || !operationToken) return;
  state.cancelled ??= new Set<string>();
  state.cancelled.add(operationToken);
  while (state.cancelled.size > 128) state.cancelled.delete(state.cancelled.values().next().value!);
}
