import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { keyboardEvents, mouseEvents } from '../chrome-extension/input.js';

const source = readFileSync(new URL('../chrome-extension/background.js', import.meta.url), 'utf8')
  .replace("import { keyboardEvents, mouseEvents } from './input.js';", '');

function restoreFixture({ invalidToken = false, pausedEvent = false, pausedStorage = false } = {}) {
  const intervals = new Set(); let nextInterval = 0; let messageListener; let saved = { port: 12345, token: 'fixture-token', sessionId: 'fixture-session' };
  let releaseEvent; const eventGate = new Promise(resolve => { releaseEvent = resolve; });
  let eventStarted; const restoring = new Promise(resolve => { eventStarted = resolve; });
  let releaseStorage; const storageGate = new Promise(resolve => { releaseStorage = resolve; });
  let storageStarted; const reading = new Promise(resolve => { storageStarted = resolve; });
  const requests = [];
  const context = createContext({
    keyboardEvents, mouseEvents, crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob, AbortController, AbortSignal, URL,
    setTimeout, clearTimeout,
    setInterval: () => { const id = ++nextInterval; intervals.add(id); return id; },
    clearInterval: id => intervals.delete(id),
    fetch: async (url, options) => {
      const path = new URL(url).pathname; requests.push(path);
      if (path === '/event') { eventStarted(); if (pausedEvent) await eventGate; return Response.json(invalidToken ? { error: 'Expired token' } : { ok: true }, { status: invalidToken ? 401 : 200 }); }
      if (path === '/disconnect') return Response.json({ ok: true });
      if (path === '/events') return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      throw new Error('Unexpected bridge request: ' + path);
    },
    chrome: {
      runtime: { id: 'a'.repeat(32), onMessage: { addListener: listener => { messageListener = listener; } } },
      storage: { local: { get: async () => { const snapshot = saved; storageStarted(); if (pausedStorage) await storageGate; return { piBridge: snapshot }; }, remove: async () => { saved = undefined; } } },
      tabs: { query: async () => [{ id: 1, url: 'http://127.0.0.1/fixture', title: 'Fixture' }], sendMessage: async () => ({ ok: true }),
        onCreated: { addListener() {} }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} }, onActivated: { addListener() {} } },
    },
  });
  runInContext(source, context);
  return { intervals, requests, restoring, releaseEvent, reading, releaseStorage, ready: runInContext('restored', context),
    saved: () => saved, message: value => new Promise(resolve => messageListener(value, {}, resolve)) };
}

test('failed stored Chrome connection restoration clears credentials without restarting timers', async () => {
  const fixture = restoreFixture({ invalidToken: true }); await fixture.ready;
  assert.equal((await fixture.message({ type: 'pi-status' })).connected, false);
  assert.equal(fixture.saved(), undefined);
  assert.equal(fixture.intervals.size, 0);
  assert.equal(fixture.requests.includes('/events'), false);
});

test('disconnecting during Chrome restoration cannot restart a cancelled connection', async () => {
  const fixture = restoreFixture({ pausedEvent: true }); await fixture.restoring;
  await fixture.message({ type: 'pi-disconnect' }); fixture.releaseEvent(); await fixture.ready;
  assert.equal((await fixture.message({ type: 'pi-status' })).connected, false);
  assert.equal(fixture.saved(), undefined);
  assert.equal(fixture.intervals.size, 0);
  assert.equal(fixture.requests.includes('/events'), false);
});

test('disconnecting before stored Chrome credentials arrive cannot resurrect the old connection', async () => {
  const fixture = restoreFixture({ pausedStorage: true }); await fixture.reading;
  await fixture.message({ type: 'pi-disconnect' }); fixture.releaseStorage(); await fixture.ready;
  assert.equal((await fixture.message({ type: 'pi-status' })).connected, false);
  assert.equal(fixture.saved(), undefined);
  assert.equal(fixture.intervals.size, 0);
  assert.deepEqual(fixture.requests, []);
});
