let revision = 0;
const documentId = crypto.randomUUID();
const observation = () => documentId + ':' + revision;
const refs = new Map(), observers = new Map();
let documents = [], frames = [];
let controlScope = '';
let viewport = '';
let scrolls = new Map();
let controls = new Map();
let pageUrl = location.href;
const cancelledOperations = new Set();
const invalidate = () => { revision++; refs.clear(); };
const viewEvents = ['resize', 'hashchange', 'popstate', 'pagehide', 'pageshow'];
const rememberCancelled = operationId => {
  if (typeof operationId !== 'string' || !operationId) return;
  cancelledOperations.add(operationId);
  while (cancelledOperations.size > 128) cancelledOperations.delete(cancelledOperations.values().next().value);
};
const ensureOperationActive = operationId => { if (typeof operationId === 'string' && cancelledOperations.has(operationId)) throw new Error('Chrome 浏览器操作已取消'); };
const yieldBeforeMutation = async operationId => { await new Promise(resolve => setTimeout(resolve, 0)); ensureOperationActive(operationId); };
function collectDocuments() {
  if (pageUrl !== location.href) { pageUrl = location.href; invalidate(); }
  documents = []; frames = [];
  function collect(doc, depth) {
    documents.push(doc); if (depth >= 8) return;
    for (const frame of doc.querySelectorAll('iframe')) {
      let nested = null; try { nested = frame.contentDocument; } catch { /* Same-origin frames only. */ }
      frames.push({ src: frame.src, sameOrigin: !!nested, depth }); if (nested) collect(nested, depth + 1);
    }
  }
  collect(document, 0);
  const nextViewport = documents.map(doc => { const view = doc.defaultView; return [view?.innerWidth, view?.innerHeight, view?.scrollX, view?.scrollY].join(','); }).join('|');
  if (viewport !== nextViewport) { viewport = nextViewport; invalidate(); }
  const nextScrolls = new Map();
  for (const doc of documents) for (const node of doc.querySelectorAll('*')) if (node.scrollTop || node.scrollLeft) nextScrolls.set(node, node.scrollLeft + ',' + node.scrollTop);
  if (scrolls.size !== nextScrolls.size || [...nextScrolls].some(([node, offset]) => scrolls.get(node) !== offset)) invalidate();
  scrolls = nextScrolls;
  const nextControls = new Map();
  for (const doc of documents) for (const node of doc.querySelectorAll('input,textarea,select')) {
    // Runtime form properties do not produce mutation records. Never read password values.
    nextControls.set(node, JSON.stringify([node.matches(':disabled'), !!node.readOnly, !!node.checked,
      node.tagName === 'SELECT' ? Array.from(node.options, option => option.selected) : undefined,
      node.type === 'password' ? undefined : node.value]));
  }
  if (controls.size !== nextControls.size || [...nextControls].some(([node, value]) => controls.get(node) !== value)) invalidate();
  controls = nextControls;
  for (const [doc, observer] of observers) {
    if (!documents.includes(doc)) { observer.disconnect(); doc.removeEventListener('scroll', invalidate, true); doc.removeEventListener('input', invalidate, true); doc.removeEventListener('change', invalidate, true); for (const event of viewEvents) doc.defaultView?.removeEventListener(event, invalidate); observers.delete(doc); invalidate(); }
    else if (observer.takeRecords().length) invalidate();
  }
  for (const doc of documents) if (!observers.has(doc)) {
    const observer = new MutationObserver(invalidate);
    if (doc.documentElement) observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    doc.addEventListener('scroll', invalidate, true); for (const event of viewEvents) doc.defaultView?.addEventListener(event, invalidate);
    doc.addEventListener('input', invalidate, true); doc.addEventListener('change', invalidate, true);
    observers.set(doc, observer); invalidate();
  }
}
function bounds(node) {
  let { x, y, width, height } = node.getBoundingClientRect(), view = node.ownerDocument.defaultView;
  while (view && view !== window) {
    const frame = view.frameElement; if (!frame) break;
    const box = frame.getBoundingClientRect(), sx = frame.offsetWidth ? box.width / frame.offsetWidth : 1, sy = frame.offsetHeight ? box.height / frame.offsetHeight : 1;
    x = box.x + (x + frame.clientLeft) * sx; y = box.y + (y + frame.clientTop) * sy; width *= sx; height *= sy; view = frame.ownerDocument.defaultView;
  }
  return { x, y, width, height };
}
const visible = node => { const rect = bounds(node), style = node.ownerDocument.defaultView.getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
const text = node => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
const name = node => node.getAttribute('aria-label') || (node.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => text(node.ownerDocument.getElementById(id))).join(' ').trim() || [...(node.labels || [])].map(text).join(' ') || node.getAttribute('title') || node.getAttribute('placeholder') || text(node);
const role = node => node.getAttribute('role') || (node.tagName === 'INPUT' ? ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', range: 'slider', number: 'spinbutton' }[node.type] || 'textbox') : ({ BUTTON: 'button', A: 'link', TEXTAREA: 'textbox', SELECT: 'combobox' }[node.tagName] || 'generic'));
const interactive = () => documents.flatMap(doc => [...doc.querySelectorAll('button,a,input,textarea,select,[role],[contenteditable="true"]')]).filter(visible);
function inspect() {
  refs.clear(); const all = interactive();
  const elements = all.slice(0, 300).map((node, index) => {
    const ref = `${observation()}:${index}`; refs.set(ref, node);
    return { ref, role: role(node), name: name(node).slice(0, 500), label: [...(node.labels || [])].map(text).join(' '), tag: node.tagName.toLowerCase(),
      value: node.tagName === 'INPUT' && node.type === 'password' ? undefined : 'value' in node ? String(node.value || '') : undefined,
      bounds: bounds(node), disabled: node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true', checked: ['checkbox', 'radio'].includes(node.type) ? node.checked : undefined };
  });
  const content = documents.map(doc => doc.body?.innerText || '').join('\n');
  return { revision, observationRevision: observation(), url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY }, width: innerWidth, height: innerHeight, scrollX, scrollY, text: content.slice(0, 80000), truncated: content.length > 80000 || all.length > 300, elements, frames };
}
function locate(request) {
  if (request.ref) {
    const node = refs.get(request.ref); if (!node?.isConnected || !documents.includes(node.ownerDocument)) throw new Error('页面引用已过期，请重新 inspect'); return node;
  }
  const locator = request.locator || {};
  return interactive().find(node => (!locator.role || role(node) === locator.role) && (!locator.name || name(node).toLowerCase().includes(locator.name.toLowerCase())) && (!locator.text || text(node).toLowerCase().includes(locator.text.toLowerCase())) && (!locator.placeholder || node.getAttribute('placeholder') === locator.placeholder)) || (() => { throw new Error('找不到目标元素'); })();
}
function scrollTarget(node, direction) {
  if (!node) return { view: window, element: undefined };
  const horizontal = direction === 'left' || direction === 'right';
  let current = node;
  while (current) {
    const canScroll = horizontal ? current.scrollWidth > current.clientWidth : current.scrollHeight > current.clientHeight;
    if (canScroll) return { view: current.ownerDocument.defaultView || window, element: current };
    current = current.parentElement;
  }
  return { view: node.ownerDocument.defaultView || window, element: undefined };
}
async function execute(request, expectedUrl, operationId) {
  ensureOperationActive(operationId);
  if (expectedUrl && expectedUrl !== location.href && !(request.action === 'wait' && request.condition && new URL(expectedUrl).origin === location.origin)) throw new Error('Chrome 页面地址已变化，请重新 inspect');
  collectDocuments();
  if (request.observationRevision && request.observationRevision !== observation()) throw new Error('Page observation is stale; inspect again');
  if (request.action === 'inspect') return inspect();
  if (request.action === 'wait') {
    const condition = request.condition;
    if (!condition) { await new Promise(resolve => setTimeout(resolve, request.milliseconds || 1)); return { conditionMet: true, revision }; }
    const value = condition.kind === 'url' ? location.href.includes(condition.value) : condition.kind === 'text' ? documents.some(doc => (doc.body?.innerText || '').includes(condition.value)) : condition.kind === 'role' ? interactive().some(node => role(node) === condition.value) : condition.kind === 'ref' ? visible(locate({ ref: condition.value })) : document.readyState === 'complete';
    return { conditionMet: value, revision, readyState: document.readyState };
  }
  if (request.action === 'scroll') {
    const target = request.ref || request.locator ? locate(request) : undefined;
    await yieldBeforeMutation(operationId);
    const destination = scrollTarget(target, request.direction); const amount = request.amount ?? Math.round(innerHeight * .8);
    const delta = { left: request.direction === 'left' ? -amount : request.direction === 'right' ? amount : 0, top: request.direction === 'up' ? -amount : request.direction === 'down' ? amount : 0, behavior: 'instant' };
    if (destination.element) destination.element.scrollBy(delta); else destination.view.scrollBy(delta);
    const scrollX = destination.element?.scrollLeft ?? destination.view.scrollX, scrollY = destination.element?.scrollTop ?? destination.view.scrollY;
    return { revision, scroll: { x: scrollX, y: scrollY }, scrollX, scrollY, target: destination.element ? 'element' : 'viewport' };
  }
  if (request.action === 'active') {
    let doc = document;
    while (doc.activeElement?.tagName === 'IFRAME') {
      const nested = doc.activeElement.contentDocument;
      if (!nested || !documents.includes(nested)) throw new Error('不允许控制跨域或不可访问的页面框架');
      doc = nested;
    }
    return { url: location.href };
  }
  const atPoint = (doc, x, y, depth = 0) => {
    const node = doc.elementFromPoint(x, y);
    if (node?.tagName === 'IFRAME') {
      if (depth >= 8) return null;
      const nested = node.contentDocument; if (!nested || !documents.includes(nested)) return null;
      const box = node.getBoundingClientRect(), sx = node.offsetWidth ? box.width / node.offsetWidth : 1, sy = node.offsetHeight ? box.height / node.offsetHeight : 1;
      return atPoint(nested, (x - box.x) / sx - node.clientLeft, (y - box.y) / sy - node.clientTop, depth + 1);
    }
    return node;
  };
  const node = request.ref || request.locator ? locate(request) : request.x !== undefined && request.y !== undefined ? atPoint(document, request.x, request.y) : null;
  if (node && (!node.isConnected || node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true')) throw new Error('页面元素不可操作');
  if (node && (request.ref || request.locator)) { await yieldBeforeMutation(operationId); node.scrollIntoView({ block: 'center', inline: 'nearest' }); }
  if (request.action === 'resolve') {
    if (!node) throw new Error('找不到目标元素'); if (request.focus) { await yieldBeforeMutation(operationId); node.focus(); } const rect = bounds(node); return { point: request.ref || request.locator ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : { x: request.x, y: request.y } };
  }
  if (request.action === 'type' && node) {
    await yieldBeforeMutation(operationId);
    if (node.readOnly || (node.tagName === 'INPUT' && ['file', 'hidden', 'button', 'submit', 'reset', 'checkbox', 'radio'].includes(node.type))) throw new Error('目标不可输入');
    if (node.tagName === 'INPUT' && node.type === 'password' && request.append) {
      // Append in the browser without exposing the existing password to JavaScript.
      node.setSelectionRange(0xffffffff, 0xffffffff);
      node.setRangeText(request.text, node.selectionStart, node.selectionEnd, 'end');
    } else if ('value' in node) { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')?.set; if (!setter) throw new Error('目标不可输入'); setter.call(node, (request.append ? String(node.value || '') : '') + request.text); }
    else if (node.isContentEditable) node.textContent = (request.append ? node.textContent || '' : '') + request.text;
    else throw new Error('目标不可输入');
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); return { revision, ref: request.ref };
  }
  throw new Error('不支持的页面操作');
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'pi-browser-invalidate') { controlScope = ''; invalidate(); sendResponse({ ok: true }); return; }
  if (message?.type === 'pi-browser-cancel') { rememberCancelled(message.operationId); sendResponse({ ok: true }); return; }
  if (message?.type !== 'pi-browser') return;
  if (!message.scope || message.scope !== controlScope) { controlScope = message.scope || ''; invalidate(); }
  execute(message.request, message.expectedUrl, message.operationId).then(value => sendResponse(value)).catch(error => sendResponse({ error: String(error.message || error) })); return true;
});
