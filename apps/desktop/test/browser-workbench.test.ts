import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserFind } from '../src/main/browser-find.ts';
import { browserAddress } from '../src/shared/browser-address.ts';
import { browserFindSchema, requestSchema } from '../src/shared/contracts.ts';
import { browserCommand, shortcutConflicts, terminalCommand } from '../src/shared/shortcuts.ts';

function finder() {
  let request = 0;
  const searches: { text: string; forward?: boolean; findNext?: boolean }[] = [];
  const stops: string[] = [];
  const controller = new BrowserFind({
    findInPage(text, options) { searches.push({ text, ...options }); return ++request; },
    stopFindInPage(action) { stops.push(action); },
  });
  return { controller, searches, stops };
}
const result = (requestId: number, activeMatchOrdinal: number, matches = 2, finalUpdate = true) => ({ requestId, activeMatchOrdinal, matches, finalUpdate });

test('browser find discards old queries and partial counts without losing the current ordinal', () => {
  const { controller, searches } = finder();
  controller.search('one', true);
  controller.search('two', true);
  assert.equal(controller.result(result(1, 20, 50)), false);
  assert.equal(controller.result(result(2, 0, 1, false)), false);
  assert.equal(controller.state.pending, true);
  assert.equal(controller.result(result(2, 1, 3)), true);
  assert.deepEqual(controller.state, { text: 'two', requestId: 2, matches: 3, active: 1, pending: false });
  assert.equal(controller.result(result(2, 0, 0, false)), false);
  controller.search('two', false);
  assert.equal(searches.at(-1)?.findNext, false);
  assert.equal(searches.at(-1)?.forward, false);
  assert.equal(controller.result(result(2, 2)), false);
  assert.equal(controller.result(result(3, 3, 3)), true);
  assert.equal(controller.state.active, 3);
});

test('cleared queries cannot be revived by late callbacks and navigation starts a fresh search', () => {
  const { controller, searches } = finder();
  controller.search('needle', true);
  controller.navigating();
  assert.equal(controller.result(result(1, 1)), false);
  assert.equal(controller.state.requestId, 0);
  controller.loaded();
  assert.deepEqual(searches.at(-1), { text: 'needle', forward: true, findNext: true });
  assert.equal(controller.result(result(2, 1, 1)), true);
  controller.search('', true);
  assert.equal(controller.result(result(2, 1)), false);
  controller.navigating(); controller.loaded();
  assert.equal(searches.length, 2);
  assert.deepEqual(controller.state, { text: '', requestId: 0, active: 0, matches: 0, pending: false });
});

test('loading pages defer only the latest query and clearing cancels deferred work', () => {
  const { controller, searches } = finder();
  controller.navigating();
  controller.search('old', true); controller.search('latest', false);
  assert.equal(searches.length, 0);
  assert.deepEqual(controller.state, { text: 'latest', requestId: 0, matches: 0, active: 0, pending: true });
  assert.equal(controller.result(result(1, 0, 0)), false);
  controller.loaded();
  assert.deepEqual(searches, [{ text: 'latest', forward: false, findNext: true }]);
  assert.equal(controller.result(result(1, 2)), true);
  controller.navigating(); controller.search('', true); controller.loaded();
  assert.equal(searches.length, 1);
  assert.equal(controller.state.pending, false);
});

test('native page queries have independent lifecycle and direction', () => {
  const first = finder(); const second = finder();
  first.controller.search('first', true); second.controller.search('second', true);
  first.controller.result(result(1, 2)); second.controller.result(result(1, 3, 3));
  first.controller.search('', true);
  assert.equal(second.controller.state.text, 'second');
  assert.equal(second.controller.state.active, 3);
  second.controller.search('second', false);
  assert.deepEqual(second.searches.at(-1), { text: 'second', forward: false, findNext: false });
});

test('address normalization retains local HTTP, external HTTPS, Unicode and encoded paths', () => {
  assert.equal(browserAddress(' localhost:3000/path '), 'http://localhost:3000/path');
  assert.equal(browserAddress('127.0.0.2:4000?q=1'), 'http://127.0.0.2:4000/?q=1');
  assert.equal(browserAddress('[::1]:4000/a'), 'http://[::1]:4000/a');
  assert.equal(browserAddress('example.com:8080/文件%20名'), 'https://example.com:8080/%E6%96%87%E4%BB%B6%20%E5%90%8D');
  assert.equal(browserAddress('HTTPS://Example.com'), 'https://example.com/');
  assert.equal(browserAddress('例子.测试'), new URL('https://例子.测试').href);
});

test('invalid and explicit non-web addresses do not turn into unrelated HTTPS navigation', () => {
  for (const value of ['', ' ', 'data:text/html,hello', 'javascript:80', 'javascript:alert(1)', 'file:///C:/a', 'about:blank', 'ftp://host', 'http:80', 'https://user:pass@example.com', 'https://example.com/a b', 'https://exa\nmple.com', 'https://example.com\\other']) assert.throws(() => browserAddress(value), value);
  assert.equal(requestSchema.safeParse({ op: 'browser.find', threadId: 't', tabId: 'p', text: 'a'.repeat(1001) }).success, false);
  assert.equal(requestSchema.parse({ op: 'browser.action', threadId: 't', tabId: 'p', action: 'focus' }).op, 'browser.action');
  assert.equal(browserFindSchema.safeParse({ text: '', requestId: 1, active: -1, matches: 0, pending: false }).success, false);
});

test('browser search and address keys are independent scopes with configurable global conflicts', () => {
  const key = { key: 'Enter', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };
  assert.equal(browserCommand(key, 'find'), 'browserFindNext');
  assert.equal(browserCommand(key, 'address'), 'browserAddressChoose');
  assert.equal(browserCommand({ ...key, key: 'ArrowDown' }, 'address'), 'browserAddressNext');
  assert.equal(browserCommand({ ...key, key: 'ArrowUp' }, 'address'), 'browserAddressPrevious');
  assert.equal(browserCommand(key, 'address', { browserAddressChoose: 'F4' }), undefined);
  assert.equal(browserCommand({ ...key, key: 'F4' }, 'address', { browserAddressChoose: 'F4' }), 'browserAddressChoose');
  assert.equal(browserCommand({ ...key, shiftKey: true }, 'find'), 'browserFindPrevious');
  assert.equal(browserCommand({ ...key, key: 'Escape' }, 'address'), 'browserAddressCancel');
  assert.equal(browserCommand({ ...key, key: 'F3' }, 'find', { browserFindNext: 'F3' }), 'browserFindNext');
  assert.equal(browserCommand(key, 'find', { browserFindNext: 'F3' }), undefined);
  assert.equal(terminalCommand(key), 'terminalFindNext');
  assert.deepEqual(shortcutConflicts(), []);
  assert.deepEqual(shortcutConflicts({ browserFindNext: 'F3', terminalFindNext: 'F3', fileActivate: 'F3', browserAddressCancel: 'F3' }), []);
  assert.equal(shortcutConflicts({ browserFindNext: 'Ctrl+N' }).length, 1);
  assert.equal(shortcutConflicts({ browserFindPrevious: 'Enter' }).length, 1);
});
