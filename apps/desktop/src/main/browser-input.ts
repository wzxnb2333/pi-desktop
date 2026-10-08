import type { BrowserToolRequest } from '../shared/browser-tools.ts';

type KeyData = { key: string; code: string; windowsVirtualKeyCode: number; modifiers: number; text?: string; unmodifiedText?: string };
const modifiers: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const namedKeys: Record<string, [string, number, string]> = {
  Enter: ['Enter', 13, '\r'], Tab: ['Tab', 9, ''], Escape: ['Escape', 27, ''], Backspace: ['Backspace', 8, ''], Delete: ['Delete', 46, ''],
  ArrowLeft: ['ArrowLeft', 37, ''], ArrowUp: ['ArrowUp', 38, ''], ArrowRight: ['ArrowRight', 39, ''], ArrowDown: ['ArrowDown', 40, ''],
  Home: ['Home', 36, ''], End: ['End', 35, ''], PageUp: ['PageUp', 33, ''], PageDown: ['PageDown', 34, ''], Space: ['Space', 32, ' '],
  Control: ['ControlLeft', 17, ''], Shift: ['ShiftLeft', 16, ''], Alt: ['AltLeft', 18, ''], Meta: ['MetaLeft', 91, ''],
};

/** Model keys describe one chord; this generates trusted Chromium input. */
export function browserKeyboardEvents(request: Pick<BrowserToolRequest, 'key' | 'keys'>): Array<KeyData & { type: string }> {
  const keys = (request.keys ?? [request.key ?? '']).flatMap(key => key === '+' ? [key] : key.split('+')).map(key => key === 'Ctrl' ? 'Control' : key === 'Esc' ? 'Escape' : key);
  if (!keys.length || keys.some(key => !key)) throw new Error('请提供有效的键盘组合');
  const events: Array<KeyData & { type: string }> = [], pressed: KeyData[] = [];
  let mask = 0;
  for (const key of keys) {
    let definition = namedKeys[key];
    if (!definition && /^[a-z]$/i.test(key)) definition = ['Key' + key.toUpperCase(), key.toUpperCase().charCodeAt(0), key];
    if (!definition && /^[0-9]$/.test(key)) definition = ['Digit' + key, key.charCodeAt(0), key];
    if (!definition && /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) definition = [key, 111 + Number(key.slice(1)), ''];
    if (!definition && key.length === 1) definition = ['', 0, key];
    if (!definition) throw new Error('不支持的键盘按键：' + key);
    mask |= modifiers[key] ?? 0;
    const actual = key === 'Space' ? ' ' : mask & 8 && /^[a-z]$/.test(key) ? key.toUpperCase() : key;
    const text = mask & 7 ? '' : mask & 8 && /^[a-z]$/.test(key) ? definition[2].toUpperCase() : definition[2];
    const data = { key: actual, code: definition[0], windowsVirtualKeyCode: definition[1], modifiers: mask };
    events.push({ type: text ? 'keyDown' : 'rawKeyDown', ...data, ...(text ? { text, unmodifiedText: definition[2] } : {}) }); pressed.push(data);
  }
  for (const data of pressed.reverse()) { events.push({ type: 'keyUp', ...data, modifiers: mask }); mask &= ~(modifiers[data.key] ?? 0); }
  return events;
}

export function browserMouseEvents(action: 'click' | 'hover' | 'drag', start: { x: number; y: number }, target?: { x: number; y: number }) {
  if (action === 'hover') return [{ type: 'mouseMoved', ...start, button: 'none', buttons: 0 }];
  const events = [{ type: 'mouseMoved', ...start, button: 'none', buttons: 0 }, { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 }];
  if (action === 'drag') {
    if (!target) throw new Error('请提供拖拽终点');
    for (let step = 1; step <= 12; step++) events.push({ type: 'mouseMoved', x: start.x + (target.x - start.x) * step / 12, y: start.y + (target.y - start.y) * step / 12, button: 'left', buttons: 1 });
  }
  events.push({ type: 'mouseReleased', ...(target ?? start), button: 'left', buttons: 0, clickCount: 1 }); return events;
}
