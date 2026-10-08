import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyboardEvents, mouseEvents } from '../chrome-extension/input.js';

test('Chrome key chords retain Control until the character is released', () => {
  const events = keyboardEvents({ keys: ['Control', 'a'] });
  assert.deepEqual(events.map(event => [event.type, event.key, event.modifiers]), [
    ['rawKeyDown', 'Control', 2], ['rawKeyDown', 'a', 2], ['keyUp', 'a', 2], ['keyUp', 'Control', 2],
  ]);
  assert.equal(events[1].windowsVirtualKeyCode, 65); assert.equal(events[1].text, undefined);
  assert.deepEqual(keyboardEvents({ key: 'Ctrl+A' }), keyboardEvents({ keys: ['Control', 'A'] }));
  assert.equal(keyboardEvents({ key: 'Enter' })[0].text, '\r');
  assert.equal(keyboardEvents({ keys: ['Shift', 'a'] })[1].text, 'A');
  assert.throws(() => keyboardEvents({ key: 'InventedKey' }), /不支持/);
});

test('Chrome drag keeps the left button pressed along the full path and releases it', () => {
  const events = mouseEvents('drag', { x: 10, y: 20 }, { x: 100, y: 200 });
  assert.equal(events[1].type, 'mousePressed');
  assert.equal(events[2].buttons, 1); assert.equal(events.at(-2).x, 100); assert.equal(events.at(-2).y, 200);
  assert.equal(events.at(-1).type, 'mouseReleased'); assert.equal(events.at(-1).buttons, 0);
  assert.equal(mouseEvents('hover', { x: 10, y: 20 })[0].buttons, 0);
});
