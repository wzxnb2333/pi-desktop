import { access } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test as base, type BrowserContext } from '@playwright/test';
import { ChromeBridge } from '../../src/main/chrome-bridge.ts';
import type { BrowserToolRequest } from '../../src/shared/browser-tools.ts';
import type { ToolResult } from '../../src/shared/tool-results.ts';
import { TemporaryDirectories } from '../fixtures/temporary-directories.ts';

function payload(result: ToolResult) {
  const item = result.result.content[0];
  if (item.type !== 'text' || typeof item.text !== 'string') throw new Error('Missing browser text result');
  const parsed = JSON.parse(item.text.slice(item.text.indexOf('\n') + 1)) as { tabId: string; url: string; observationRevision: string; viewport?: { width: number; height: number }; scroll?: { x: number; y: number }; width?: number; height?: number; scrollX?: number; scrollY?: number; page?: { observationRevision: string; viewport: { width: number; height: number }; scroll: { x: number; y: number }; elements: Array<{ ref: string; name: string; value?: string; bounds: { x: number; y: number; width: number; height: number } }> }; elements: Array<{ ref: string; name: string; value?: string; bounds: { x: number; y: number; width: number; height: number } }> };
  return { ...parsed, ...parsed.page, tabId: parsed.tabId };
}

async function createFixture() {
  const directories = new TemporaryDirectories(); const profile = await directories.create('chrome-bridge-');
  const bridge = new ChromeBridge(); let context: BrowserContext | undefined;
  const extensionPath = fileURLToPath(new URL('../../chrome-extension/', import.meta.url));
  const launch = () => chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  let announceBlocked!: () => void;
  const blockedReady = new Promise<void>(resolve => { announceBlocked = resolve; });
  const slowResponses = new Set<ServerResponse>();
  const completeLoads = () => { for (const response of slowResponses) response.end('<p>Completed load</p>'); slowResponses.clear(); };
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (request.url === '/busy-ready') { announceBlocked(); response.end('Ready'); return; }
    if (request.url === '/slow') { response.write('<title>Slow page</title>'); slowResponses.add(response); return; }
    if (request.url === '/frame') { response.end('<label>Frame input<input></label><button onclick="parent.document.getElementById(\'result\').textContent=event.isTrusted?\'Trusted frame\':\'Untrusted frame\'">Frame continue</button>'); return; }
    if (request.url === '/private') { response.end('<button>Private frame secret</button>'); return; }
    response.end(`<title>Bridge fixture</title>
      <button aria-label="Continue" onclick="document.getElementById('result').textContent='Clicked'">Continue</button>
      <input placeholder="Search"><input type="password" value="PASSWORD_SECRET">
      <p id="result">Ready</p><canvas width="200" height="100" style="display:block;border:1px solid"></canvas>
      <p id="canvas-result">Canvas ready</p>
      <iframe src="/frame"></iframe><iframe src="http://localhost:${(server.address() as { port: number }).port}/private"></iframe>
      <div style="height:1800px">Scroll fixture</div>
      <script>
        document.querySelector('canvas').onpointerdown=event=>document.getElementById('canvas-result').textContent=event.isTrusted?'Trusted pointer':'Untrusted pointer';
        document.querySelector('input').onkeydown=event=>{if(event.key==='Enter')document.getElementById('result').textContent=event.isTrusted?'Trusted Enter':'Untrusted Enter';};
      </script>`);
  });
  const close = async () => {
    completeLoads();
    try { await context?.close(); }
    finally {
      await bridge.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      await directories.cleanup(); await expect(access(profile)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  };
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local fixture address');
    const url = `http://127.0.0.1:${address.port}/`; const pair = await bridge.createPairing();
    context = await launch();
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await popup.locator('#port').fill(String(pair.port)); await popup.locator('#code').fill(pair.code); await popup.locator('#connect').click();
    await expect(popup.locator('#state')).toHaveText('Connected');
    const page = await context.newPage(); await page.goto(url);
    let tabId = ''; let sessionId = '';
    await expect.poll(async () => {
      const status = await bridge.status(); const session = status.sessions[0]; sessionId = session?.id ?? '';
      tabId = session?.tabs.find(tab => tab.url === url)?.tabId ?? ''; return tabId;
    }).not.toBe('');
    const run = (request: Omit<BrowserToolRequest, 'backend' | 'tabId'> & { tabId?: string }, signal = AbortSignal.timeout(15_000)) => bridge.run('fixture-task', { backend: 'chrome', tabId, ...request }, signal, () => {}, async () => {});
    const crashAndRestart = async ({ invalidateSession = false } = {}) => {
      const browser = context?.browser(); if (!browser || !context) throw new Error('Missing fixture browser');
      const client = await browser.newBrowserCDPSession();
      const processes = await client.send('SystemInfo.getProcessInfo');
      const browserProcess = processes.processInfo.find(item => item.type === 'browser');
      if (!browserProcess || browserProcess.id === process.pid) throw new Error('Missing owned fixture browser process');
      const closed = context.waitForEvent('close');
      process.kill(browserProcess.id, 'SIGKILL');
      await closed;
      if (invalidateSession) bridge.disconnect(sessionId);
      context = await launch();
      const restoredWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const restoredPopup = await context.newPage(); await restoredPopup.goto(`chrome-extension://${new URL(restoredWorker.url()).host}/popup.html`);
      const restoredPage = await context.newPage(); await restoredPage.goto(url);
      return { context, popup: restoredPopup, page: restoredPage };
    };
    return { bridge, context, popup, page, url, tabId, sessionId, run, close, completeLoads, blockedReady, crashAndRestart };
  } catch (error) { await close(); throw error; }
}

const test = base.extend<{ control: Awaited<ReturnType<typeof createFixture>> }>({
  control: async ({}, use) => { const fixture = await createFixture(); try { await use(fixture); } finally { await fixture.close(); } },
});

test('real Chrome extension preserves task isolation, trusted input, stale refs and screenshots', async ({ control }) => {
  const { bridge, tabId, run, page, url } = control;
  await expect(run({ action: 'inspect' })).rejects.toThrow(/授权/);
  bridge.authorize('fixture-task', tabId, true);
  const openRun = (request: Omit<BrowserToolRequest, 'backend' | 'tabId'>, signal = AbortSignal.timeout(15_000)) => bridge.run('fixture-task', { backend: 'chrome', ...request }, signal, () => {}, async () => {});
  const opened = payload(await openRun({ action: 'open', url: url + 'opened' }));
  expect(opened.page?.elements.some(item => item.name === 'Continue')).toBe(true);
  expect(opened.page?.viewport).toEqual({ width: expect.any(Number), height: expect.any(Number) });
  const navigated = payload(await bridge.run('fixture-task', { backend: 'chrome', action: 'navigate', tabId: opened.tabId, url: url + 'navigated' }, AbortSignal.timeout(15_000), () => {}, async () => {}));
  expect(navigated.page?.elements.some(item => item.name === 'Continue')).toBe(true);
  await page.evaluate(() => { const region = document.createElement('div'); region.setAttribute('role', 'region'); region.setAttribute('aria-label', 'Scrollable region'); region.style.cssText = 'height:40px;overflow:auto'; region.innerHTML = '<div style="height:240px">Nested content</div>'; document.body.prepend(region); });
  const initial = payload(await run({ action: 'inspect' })); expect(initial.page).toBeDefined(); expect(JSON.stringify(initial)).not.toContain('PASSWORD_SECRET');
  expect(initial.viewport).toEqual({ width: expect.any(Number), height: expect.any(Number) });
  expect(initial.scroll).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  const input = initial.elements.find(item => item.name === 'Search')!;
  expect(initial.elements.some(item => item.name === 'Scrollable region')).toBe(true);
  await run({ action: 'scroll', locator: { role: 'region', name: 'Scrollable region' }, direction: 'down', amount: 30 });
  await expect.poll(() => page.locator('[aria-label="Scrollable region"]').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const afterScroll = payload(await run({ action: 'inspect' }));
  const button = afterScroll.elements.find(item => item.name === 'Continue')!;
  await run({ action: 'hover', locator: { text: 'CONTINUE' } });
  await run({ action: 'click', ref: button.ref, observationRevision: afterScroll.observationRevision });
  await expect(page.locator('#result')).toHaveText('Clicked');
  await expect(run({ action: 'type', ref: input.ref, text: 'old ref' })).rejects.toThrow(/过期/);
  await expect(run({ action: 'click', x: 10, y: 10, observationRevision: initial.observationRevision })).rejects.toThrow(/stale|过期/);
  const inspected = payload(await run({ action: 'inspect' })); const current = inspected.elements.find(item => item.name === 'Search')!;
  await run({ action: 'type', ref: current.ref, text: 'hello' }); await expect(page.getByPlaceholder('Search')).toHaveValue('hello');
  await run({ action: 'key', locator: { placeholder: 'Search' }, keys: ['Control', 'a'] });
  await run({ action: 'key', key: 'Backspace' }); await expect(page.getByPlaceholder('Search')).toHaveValue('');
  await run({ action: 'key', keys: ['Shift', 'a'] }); await expect(page.getByPlaceholder('Search')).toHaveValue('A');
  await run({ action: 'key', key: 'Enter' }); await expect(page.locator('#result')).toHaveText('Trusted Enter');
  const canvas = await page.locator('canvas').boundingBox(); if (!canvas) throw new Error('Missing canvas');
  await run({ action: 'click', x: canvas.x + 20, y: canvas.y + 20 }); await expect(page.locator('#canvas-result')).toHaveText('Trusted pointer');
  await run({ action: 'drag', x: canvas.x + 20, y: canvas.y + 20, target: { locator: { role: 'button', name: 'Continue' } } });
  const beforeScroll = payload(await run({ action: 'inspect' }));
  const scrolled = payload(await run({ action: 'scroll', direction: 'down' }));
  expect(scrolled).toMatchObject({ scroll: { y: expect.any(Number) }, scrollY: expect.any(Number) });
  expect(scrolled.scrollY).toBe(Math.round(beforeScroll.viewport!.height * .8));
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expect(run({ action: 'click', x: 10, y: 10, observationRevision: beforeScroll.observationRevision })).rejects.toThrow(/stale|过期/);
  await page.evaluate(() => {
    const container = document.createElement('div'); container.id = 'scroll-container';
    container.style.cssText = 'height:50px;overflow:auto'; container.innerHTML = '<div style="height:200px">Nested scroll</div>';
    document.body.prepend(container);
  });
  const beforeNestedScroll = payload(await run({ action: 'inspect' }));
  await page.locator('#scroll-container').evaluate(container => { container.scrollTop = 30; });
  await expect(run({ action: 'click', x: 10, y: 10, observationRevision: beforeNestedScroll.observationRevision })).rejects.toThrow(/stale|过期/);
  const beforeResize = payload(await run({ action: 'inspect' }));
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(run({ action: 'click', x: 10, y: 10, observationRevision: beforeResize.observationRevision })).rejects.toThrow(/stale|过期/);
  const beforeReload = payload(await run({ action: 'inspect' })); await page.reload();
  const afterReload = payload(await run({ action: 'inspect' })); expect(afterReload.observationRevision).not.toBe(beforeReload.observationRevision);
  await expect(run({ action: 'click', ref: beforeReload.elements[0].ref })).rejects.toThrow(/过期/);
  const result = await run({ action: 'screenshot' }); expect(result.result.content.some(item => item.type === 'image' && String(item.data).length > 100)).toBe(true);
  expect(await bridge.tabs('another-task')).toEqual([]);
});

test('Chrome newly opened tabs return references usable by the owning task', async ({ control }) => {
  const { bridge, tabId, url, context } = control; bridge.authorize('fixture-task', tabId, true);
  const opened = payload(await bridge.run('fixture-task', { backend: 'chrome', action: 'open', tabId, url: url + 'fresh-tab' }, AbortSignal.timeout(15000), () => {}, async () => {}));
  expect(opened.tabId).not.toBe(tabId);
  const button = opened.page!.elements.find(element => element.name === 'Continue')!;
  await bridge.run('fixture-task', { backend: 'chrome', action: 'click', tabId: opened.tabId, ref: button.ref, observationRevision: opened.page!.observationRevision }, AbortSignal.timeout(15000), () => {}, async () => {});
  const page = context.pages().find(candidate => candidate.url() === url + 'fresh-tab')!;
  await expect(page.locator('#result')).toHaveText('Clicked');
  await expect(bridge.run('another-task', { backend: 'chrome', action: 'inspect', tabId: opened.tabId }, AbortSignal.timeout(1000), () => {}, async () => {})).rejects.toThrow(/授权/);
  expect(await bridge.tabs('another-task')).toEqual([]);
});

test('real Chrome extension recovers after cancellation and revocation, and disconnect clears grants', async ({ control }) => {
  const { bridge, tabId, run, page, popup } = control; bridge.authorize('fixture-task', tabId, true);
  const waiting = run({ action: 'wait', condition: { kind: 'text', value: 'Delayed result' }, milliseconds: 2000 });
  const text = page.evaluate(() => { window.setTimeout(() => { document.getElementById('result')!.textContent = 'Delayed result'; }, 100); });
  await waiting; await text;
  await expect(run({ action: 'wait', condition: { kind: 'text', value: 'never' }, milliseconds: 100 })).rejects.toThrow(/超时/);
  const controller = new AbortController(); const cancelled = run({ action: 'wait', condition: { kind: 'text', value: 'never' }, milliseconds: 10000 }, controller.signal);
  const rejection = expect(cancelled).rejects.toHaveProperty('name', 'AbortError'); await page.waitForTimeout(100); controller.abort(); await rejection;
  await run({ action: 'inspect' });
  const revoked = run({ action: 'wait', condition: { kind: 'text', value: 'never' }, milliseconds: 10000 });
  const revokeRejection = expect(revoked).rejects.toThrow(/撤销/); await page.waitForTimeout(100); bridge.authorize('fixture-task', tabId, false); await revokeRejection;
  bridge.authorize('fixture-task', tabId, true); await run({ action: 'inspect' });
  await popup.locator('#disconnect').click(); await expect.poll(async () => (await bridge.status()).sessions.length).toBe(0);
  expect(await bridge.tabs('fixture-task')).toEqual([]);
});

test('cancelling a Chrome open closes the newly created loading tab', async ({ control }) => {
  const { bridge, tabId, context, url } = control;
  bridge.authorize('fixture-task', tabId, true);
  const controller = new AbortController();
  const running = bridge.run('fixture-task', { backend: 'chrome', action: 'open', url: url + 'slow' }, controller.signal, () => {}, async () => {});
  await expect.poll(() => context.pages().some(page => page.url() === url + 'slow')).toBe(true);
  controller.abort();
  await expect(running).rejects.toHaveProperty('name', 'AbortError');
  await expect.poll(() => context.pages().some(page => page.url() === url + 'slow')).toBe(false);
});

test('real Chrome extension inspects and controls only same-origin nested frames', async ({ control }) => {
  const { bridge, tabId, run, page } = control; bridge.authorize('fixture-task', tabId, true);
  const initial = payload(await run({ action: 'inspect' }));
  expect(initial.elements.some(item => item.name === 'Frame input')).toBe(true);
  expect(JSON.stringify(initial)).not.toContain('Private frame secret');
  const privateFrame = await page.locator('iframe').nth(1).boundingBox(); if (!privateFrame) throw new Error('Missing private frame');
  await expect(run({ action: 'click', x: privateFrame.x + 20, y: privateFrame.y + 20 })).rejects.toThrow(/目标/);
  await page.locator('iframe').nth(1).focus();
  await expect(run({ action: 'key', key: 'Enter' })).rejects.toThrow(/跨域/);
  await run({ action: 'type', locator: { name: 'Frame input' }, text: 'inside frame' });
  await expect(page.frameLocator('iframe[src="/frame"]').getByRole('textbox')).toHaveValue('inside frame');
  await run({ action: 'click', locator: { role: 'button', name: 'Frame continue' } });
  await expect(page.locator('#result')).toHaveText('Trusted frame');
  const before = payload(await run({ action: 'inspect' }));
  await page.frameLocator('iframe[src="/frame"]').getByRole('button').evaluate(button => { button.textContent = 'Changed frame'; });
  await expect(run({ action: 'type', ref: before.elements.find(item => item.name === 'Search')!.ref, text: 'old frame revision' })).rejects.toThrow(/过期/);
  await run({ action: 'inspect' }); await run({ action: 'type', locator: { placeholder: 'Search' }, text: 'fresh revision' });
});

test('real Chrome extension reconnects without old polling clearing the new connection or inheriting grants', async ({ control }) => {
  const { bridge, tabId, run, popup, page, sessionId, url } = control; bridge.authorize('fixture-task', tabId, true);
  await page.context().addCookies([{ name: 'pi-fixture-session', value: 'fixture-cookie-value', url }]);
  await page.evaluate(() => localStorage.setItem('pi-fixture-private', 'fixture-storage-value'));
  const oldObservation = payload(await run({ action: 'inspect' }));
  const waiting = run({ action: 'wait', condition: { kind: 'text', value: 'never' }, milliseconds: 10000 });
  const stopped = expect(waiting).rejects.toThrow(/断开/);
  const pair = await bridge.createPairing(); await popup.locator('#port').fill(String(pair.port)); await popup.locator('#code').fill(pair.code); await popup.locator('#connect').click();
  await stopped; await expect(popup.locator('#state')).toHaveText('Connected');
  const status = await bridge.status(); expect(status.sessions).toHaveLength(1); expect(status.sessions[0].id).not.toBe(sessionId);
  expect(await bridge.tabs('fixture-task')).toEqual([]);
  const newTab = status.sessions[0].tabs.find(tab => tab.url === url)!; bridge.authorize('fixture-task', newTab.tabId, true);
  await expect(bridge.run('fixture-task', { backend: 'chrome', action: 'click', tabId: newTab.tabId, ref: oldObservation.elements[0].ref }, AbortSignal.timeout(2000), () => {}, async () => {})).rejects.toThrow(/过期/);
  const inspected = await bridge.run('fixture-task', { backend: 'chrome', action: 'inspect', tabId: newTab.tabId }, AbortSignal.timeout(2000), () => {}, async () => {});
  expect(JSON.stringify(inspected)).not.toContain('fixture-cookie-value'); expect(JSON.stringify(inspected)).not.toContain('fixture-storage-value');
  expect((await page.context().cookies(url)).find(cookie => cookie.name === 'pi-fixture-session')?.value).toBe('fixture-cookie-value');
  expect(await page.evaluate(() => localStorage.getItem('pi-fixture-private'))).toBe('fixture-storage-value');
  await expect(run({ action: 'inspect' })).rejects.toThrow(/授权/);
});

test('Chrome browser process crash restores its connection without inheriting task grants or refs', async ({ control }) => {
  const { bridge, tabId, run, page, sessionId, url, crashAndRestart } = control; bridge.authorize('fixture-task', tabId, true);
  const oldObservation = payload(await run({ action: 'inspect' }));
  const waiting = run({ action: 'wait', condition: { kind: 'text', value: 'never' }, milliseconds: 10000 });
  const stopped = waiting.then(() => 'unexpected success', error => String(error)); await page.waitForTimeout(100);
  const restored = await crashAndRestart(); expect(await stopped).toMatch(/关闭|替换|断开/);
  await expect(restored.popup.locator('#state')).toHaveText(/^Connected · \d+$/);
  let restoredTabId = '';
  await expect.poll(async () => { restoredTabId = (await bridge.status()).sessions.find(session => session.id === sessionId)?.tabs.find(tab => tab.url === url)?.tabId ?? ''; return restoredTabId; }).not.toBe('');
  expect(await bridge.tabs('fixture-task')).toEqual([]); expect(await bridge.tabs('other-task')).toEqual([]);
  await expect(bridge.run('fixture-task', { backend: 'chrome', action: 'inspect', tabId: restoredTabId }, AbortSignal.timeout(2000), () => {}, async () => {})).rejects.toThrow(/授权/);
  bridge.authorize('fixture-task', restoredTabId, true);
  await expect(bridge.run('fixture-task', { backend: 'chrome', action: 'click', tabId: restoredTabId, ref: oldObservation.elements[0].ref }, AbortSignal.timeout(2000), () => {}, async () => {})).rejects.toThrow(/过期/);
  const fresh = payload(await bridge.run('fixture-task', { backend: 'chrome', action: 'inspect', tabId: restoredTabId }, AbortSignal.timeout(2000), () => {}, async () => {}));
  await bridge.run('fixture-task', { backend: 'chrome', action: 'type', tabId: restoredTabId, ref: fresh.elements.find(element => element.name === 'Search')!.ref, text: 'after crash' }, AbortSignal.timeout(2000), () => {}, async () => {});
  await expect(restored.page.getByPlaceholder('Search')).toHaveValue('after crash');
});

test('Chrome invalid stored connection stays disconnected until explicitly paired again after restart', async ({ control }) => {
  const { bridge, tabId, run, sessionId, url, crashAndRestart } = control; bridge.authorize('fixture-task', tabId, true);
  const oldObservation = payload(await run({ action: 'inspect' }));
  const restored = await crashAndRestart({ invalidateSession: true });
  await expect(restored.popup.locator('#state')).toHaveText('Not connected');
  expect((await bridge.status()).sessions).toEqual([]); expect(await bridge.tabs('fixture-task')).toEqual([]);
  const pair = await bridge.createPairing(); await restored.popup.locator('#port').fill(String(pair.port)); await restored.popup.locator('#code').fill(pair.code); await restored.popup.locator('#connect').click();
  await expect(restored.popup.locator('#state')).toHaveText('Connected');
  let restoredTabId = '';
  await expect.poll(async () => {
    const status = await bridge.status(); expect(status.sessions).toHaveLength(1); expect(status.sessions[0].id).not.toBe(sessionId);
    restoredTabId = status.sessions[0].tabs.find(tab => tab.url === url)?.tabId ?? ''; return restoredTabId;
  }).not.toBe('');
  expect(await bridge.tabs('fixture-task')).toEqual([]);
  bridge.authorize('fixture-task', restoredTabId, true);
  await expect(bridge.run('fixture-task', { backend: 'chrome', action: 'click', tabId: restoredTabId, ref: oldObservation.elements[0].ref }, AbortSignal.timeout(2000), () => {}, async () => {})).rejects.toThrow(/过期/);
  const fresh = payload(await bridge.run('fixture-task', { backend: 'chrome', action: 'inspect', tabId: restoredTabId }, AbortSignal.timeout(2000), () => {}, async () => {}));
  await bridge.run('fixture-task', { backend: 'chrome', action: 'type', tabId: restoredTabId, ref: fresh.elements.find(element => element.name === 'Search')!.ref, text: 'after repairing' }, AbortSignal.timeout(2000), () => {}, async () => {});
  await expect(restored.page.getByPlaceholder('Search')).toHaveValue('after repairing');
});

test('real Chrome tab closure cancels its wait and a replacement tab needs a fresh grant', async ({ control }) => {
  const { bridge, tabId, run, page, context, sessionId, url } = control; bridge.authorize('fixture-task', tabId, true);
  const waiting = run({ action: 'wait', condition: { kind: 'text', value: 'never' }, milliseconds: 10000 });
  const stopped = expect(waiting).rejects.toThrow(/关闭/); await page.waitForTimeout(100); await page.close(); await stopped;
  expect(await bridge.tabs('fixture-task')).toEqual([]);
  const replacement = await context.newPage(); await replacement.goto(url);
  let newTabId = '';
  await expect.poll(async () => { newTabId = (await bridge.status()).sessions.find(session => session.id === sessionId)?.tabs.find(tab => tab.url === url)?.tabId ?? ''; return newTabId; }).not.toBe('');
  expect(newTabId).not.toBe(tabId); expect(await bridge.tabs('fixture-task')).toEqual([]);
  bridge.authorize('fixture-task', newTabId, true);
  const result = await bridge.run('fixture-task', { backend: 'chrome', action: 'inspect', tabId: newTabId }, AbortSignal.timeout(2000), () => {}, async () => {});
  expect(payload(result).elements.some(element => element.name === 'Continue')).toBe(true);
});

test('Chrome URL waits accept same-origin route changes and reject stale route references', async ({ control }) => {
  const { bridge, tabId, run, page } = control; bridge.authorize('fixture-task', tabId, true);
  const initial = payload(await run({ action: 'inspect' }));
  const waiting = run({ action: 'wait', condition: { kind: 'url', value: '#arrived' }, milliseconds: 1000 });
  await page.evaluate(() => { window.setTimeout(() => { location.hash = 'arrived'; }, 100); });
  expect(payload(await waiting).url).toContain('#arrived');
  await expect(run({ action: 'click', ref: initial.elements[0].ref })).rejects.toThrow(/过期/);
  const fresh = payload(await run({ action: 'inspect' }));
  await run({ action: 'click', ref: fresh.elements[0].ref }); await expect(page.locator('#result')).toHaveText('Clicked');
});

test('Chrome back-forward cache lifecycle invalidates references after returning to a page', async ({ control }) => {
  const { bridge, tabId, run, page, url } = control; bridge.authorize('fixture-task', tabId, true);
  const initial = payload(await run({ action: 'inspect' }));
  await page.goto(url + '?bfcache=1'); await page.goBack();
  await expect(page).toHaveURL(url);
  await expect(run({ action: 'click', ref: initial.elements[0].ref })).rejects.toThrow(/过期/);
  const fresh = payload(await run({ action: 'inspect' })); expect(fresh.observationRevision).not.toBe(initial.observationRevision);
});

test('Chrome load waits respect their timeout, cancel and recover after a full navigation', async ({ control }) => {
  const { bridge, tabId, run, page, url, completeLoads } = control; bridge.authorize('fixture-task', tabId, true);
  const waitingUrl = run({ action: 'wait', condition: { kind: 'url', value: '/slow' }, milliseconds: 1000 });
  await page.goto(url + 'slow', { waitUntil: 'commit' }); await waitingUrl;
  const started = Date.now();
  await expect(run({ action: 'wait', condition: { kind: 'load' }, milliseconds: 100 })).rejects.toThrow(/超时/);
  expect(Date.now() - started).toBeLessThan(700);
  const controller = new AbortController();
  const cancelled = run({ action: 'wait', condition: { kind: 'load' }, milliseconds: 10000 }, controller.signal);
  const stopped = expect(cancelled).rejects.toHaveProperty('name', 'AbortError'); controller.abort(); await stopped;
  const complete = run({ action: 'wait', condition: { kind: 'load' }, milliseconds: 1000 }); completeLoads(); await complete;
  const inspected = payload(await run({ action: 'inspect' })); expect(inspected.url).toContain('/slow');
});

test('Chrome waits for dynamic roles and rejects stale reference conditions promptly', async ({ control }) => {
  const { bridge, tabId, run, page } = control; bridge.authorize('fixture-task', tabId, true);
  const initial = payload(await run({ action: 'inspect' }));
  await run({ action: 'wait', condition: { kind: 'ref', value: initial.elements[0].ref }, milliseconds: 1000 });
  const appearing = run({ action: 'wait', condition: { kind: 'role', value: 'checkbox' }, milliseconds: 1000 });
  await page.evaluate(() => { window.setTimeout(() => { const input = document.createElement('input'); input.type = 'checkbox'; document.body.prepend(input); }, 100); });
  await appearing;
  const started = Date.now();
  await expect(run({ action: 'wait', condition: { kind: 'ref', value: initial.elements[0].ref }, milliseconds: 1000 })).rejects.toThrow(/过期/);
  expect(Date.now() - started).toBeLessThan(700);
});

test('Chrome DOM waits keep their deadline when the page renderer is busy', async ({ control }) => {
  const { bridge, tabId, run, page, blockedReady } = control; bridge.authorize('fixture-task', tabId, true);
  const busy = page.evaluate(() => {
    void fetch('/busy-ready'); const until = performance.now() + 1500;
    while (performance.now() < until) { /* Simulate a temporarily unresponsive page. */ }
  });
  await blockedReady;
  const started = Date.now();
  try {
    await expect(run({ action: 'wait', condition: { kind: 'text', value: 'missing' }, milliseconds: 100 })).rejects.toThrow(/超时/);
    expect(Date.now() - started).toBeLessThan(700);
  } finally { await busy; }
  await run({ action: 'inspect' });
});

test('Chrome cancellation does not commit queued DOM mutations after a busy page resumes', async ({ control }) => {
  const { bridge, tabId, run, page, blockedReady } = control; bridge.authorize('fixture-task', tabId, true);
  const inspected = payload(await run({ action: 'inspect' }));
  const input = inspected.elements.find(element => element.name === 'Search');
  expect(input).toBeDefined();
  const busy = page.evaluate(() => { void fetch('/busy-ready'); const until = performance.now() + 1500; while (performance.now() < until) { /* Simulate a temporarily unresponsive page. */ } });
  await blockedReady;
  const controller = new AbortController();
  const cancelled = run({ action: 'type', ref: input!.ref, text: 'cancelled' }, controller.signal);
  await page.waitForTimeout(100); controller.abort();
  await expect(cancelled).rejects.toHaveProperty('name', 'AbortError');
  await busy; await page.waitForTimeout(100);
  expect(await page.locator('input[placeholder="Search"]').inputValue()).toBe('');
});

test('Chrome reauthorization and task handoff invalidate prior refs without requiring an intermediate inspect', async ({ control }) => {
  const { bridge, tabId, run, page } = control; bridge.authorize('fixture-task', tabId, true);
  const initial = payload(await run({ action: 'inspect' }));
  bridge.authorize('fixture-task', tabId, true);
  await run({ action: 'wait', condition: { kind: 'ref', value: initial.elements[0].ref }, milliseconds: 1000 });
  bridge.authorize('fixture-task', tabId, false); bridge.authorize('fixture-task', tabId, true);
  await expect(run({ action: 'click', ref: initial.elements[0].ref })).rejects.toThrow(/过期/);
  await expect(page.locator('#result')).toHaveText('Ready');
  await expect(run({ action: 'click', x: 10, y: 10, observationRevision: initial.observationRevision })).rejects.toThrow(/stale|过期/);
  const renewed = payload(await run({ action: 'inspect' })); expect(renewed.observationRevision).not.toBe(initial.observationRevision);
  bridge.authorize('fixture-task', tabId, false); bridge.authorize('other-task', tabId, true);
  await expect(run({ action: 'click', ref: renewed.elements[0].ref })).rejects.toThrow(/授权/);
  bridge.authorize('other-task', tabId, false); bridge.authorize('fixture-task', tabId, true);
  await expect(run({ action: 'click', ref: renewed.elements[0].ref })).rejects.toThrow(/过期/);
  const fresh = payload(await run({ action: 'inspect' })); await run({ action: 'click', ref: fresh.elements[0].ref });
  await expect(page.locator('#result')).toHaveText('Clicked');
});

test('Chrome returning to the original route cannot revive references from before navigation', async ({ control }) => {
  const { bridge, tabId, run, page } = control; bridge.authorize('fixture-task', tabId, true);
  const initial = payload(await run({ action: 'inspect' }));
  await page.evaluate(() => { location.hash = 'temporary'; }); await page.waitForURL('**/#temporary');
  await page.evaluate(() => { location.hash = ''; }); await page.waitForURL('**/#');
  await page.evaluate(() => history.replaceState(null, '', location.pathname));
  await expect.poll(async () => (await bridge.tabs('fixture-task'))[0]?.url).toBe(initial.url);
  await expect(run({ action: 'click', ref: initial.elements[0].ref })).rejects.toThrow(/过期/);
  await expect(page.locator('#result')).toHaveText('Ready');
  const fresh = payload(await run({ action: 'inspect' })); await run({ action: 'click', ref: fresh.elements[0].ref });
  await expect(page.locator('#result')).toHaveText('Clicked');
});

test('Chrome form property changes invalidate earlier observations and require a fresh inspect', async ({ control }) => {
  const { bridge, tabId, run, page } = control; bridge.authorize('fixture-task', tabId, true);
  await page.evaluate(() => {
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = 'consent';
    const select = document.createElement('select'); select.id = 'choice'; select.innerHTML = '<option value="a">A</option><option value="b">B</option>';
    document.body.prepend(checkbox, select);
  });
  const inspect = () => run({ action: 'inspect' }).then(payload);
  const initial = await inspect(); const search = initial.elements.find(element => element.name === 'Search')!;
  await page.getByPlaceholder('Search').evaluate(node => { (node as HTMLInputElement).value = 'external update'; });
  await expect(run({ action: 'type', ref: search.ref, observationRevision: initial.observationRevision, text: 'stale write' })).rejects.toThrow(/stale|过期/);
  await expect(page.getByPlaceholder('Search')).toHaveValue('external update');
  const afterValue = await inspect();
  await page.locator('#consent').evaluate(node => { (node as HTMLInputElement).checked = true; });
  await expect(run({ action: 'hover', ref: afterValue.elements.find(element => element.name === 'Continue')!.ref })).rejects.toThrow(/过期/);
  const afterChecked = await inspect(); const button = afterChecked.elements.find(element => element.name === 'Continue')!;
  await page.locator('#choice').evaluate(node => { (node as HTMLSelectElement).value = 'b'; });
  await expect(run({ action: 'click', x: button.bounds.x + 2, y: button.bounds.y + 2, observationRevision: afterChecked.observationRevision })).rejects.toThrow(/stale|过期/);
  const beforeFrame = await inspect();
  await page.frameLocator('iframe[src="/frame"]').getByRole('textbox').evaluate(node => { (node as HTMLInputElement).value = 'frame update'; });
  await expect(run({ action: 'hover', ref: beforeFrame.elements.find(element => element.name === 'Continue')!.ref })).rejects.toThrow(/过期/);
  const fresh = await inspect(); expect(fresh.observationRevision).not.toBe(initial.observationRevision);
  expect(JSON.stringify(fresh)).not.toContain('PASSWORD_SECRET');
  await run({ action: 'type', ref: fresh.elements.find(element => element.name === 'Search')!.ref, text: 'fresh write' });
  await expect(page.getByPlaceholder('Search')).toHaveValue('fresh write');
});

test('Chrome respects disabled fieldsets while allowing the first legend and restored controls', async ({ control }) => {
  const { bridge, tabId, run, page } = control; bridge.authorize('fixture-task', tabId, true);
  await page.evaluate(() => {
    const group = document.createElement('fieldset'); group.disabled = true; group.id = 'disabled-group';
    group.innerHTML = '<legend><input aria-label="Legend input"></legend><input aria-label="Group input" value="original"><textarea aria-label="Group text">original</textarea><select aria-label="Group select"><option value="a">A</option><option value="b">B</option></select><button aria-label="Group button">Apply</button>';
    document.body.prepend(group);
  });
  await expect(page.getByRole('textbox', { name: 'Group input' })).toBeDisabled();
  await expect(run({ action: 'type', locator: { name: 'Group input' }, text: 'blocked write' })).rejects.toThrow(/不可操作/);
  await expect(page.getByRole('textbox', { name: 'Group input' })).toHaveValue('original');
  for (const name of ['Group text', 'Group select']) {
    await expect(run({ action: 'type', locator: { name }, text: 'b' })).rejects.toThrow(/不可操作/);
  }
  const inspected = payload(await run({ action: 'inspect' }));
  for (const name of ['Group input', 'Group text', 'Group select', 'Group button']) {
    expect(inspected.elements.find(element => element.name === name)).toMatchObject({ disabled: true });
  }
  expect(inspected.elements.find(element => element.name === 'Legend input')).toMatchObject({ disabled: false });
  const button = inspected.elements.find(element => element.name === 'Group button')!;
  await expect(run({ action: 'click', ref: button.ref })).rejects.toThrow(/不可操作/);
  await expect(run({ action: 'click', x: button.bounds.x + button.bounds.width / 2, y: button.bounds.y + button.bounds.height / 2 })).rejects.toThrow(/不可操作/);
  await run({ action: 'type', locator: { name: 'Legend input' }, text: 'legend is editable' });
  await expect(page.getByRole('textbox', { name: 'Legend input' })).toHaveValue('legend is editable');
  await page.locator('#disabled-group').evaluate(node => { (node as HTMLFieldSetElement).disabled = false; });
  const restored = payload(await run({ action: 'inspect' })); const input = restored.elements.find(element => element.name === 'Group input')!;
  expect(input).toMatchObject({ disabled: false });
  await run({ action: 'type', ref: input.ref, text: 'restored write' });
  await expect(page.getByRole('textbox', { name: 'Group input' })).toHaveValue('restored write');
});

test('Chrome text modes replace append and clear without reading existing password values', async ({ control }) => {
  const { bridge, tabId, run, page, context } = control; bridge.authorize('fixture-task', tabId, true);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('afterbegin', '<input aria-label="Plain input"><textarea aria-label="Plain text"></textarea><div contenteditable="true" role="textbox" aria-label="Editable area"></div><select aria-label="Choose"><option value="a">A</option><option value="b">B</option></select>');
    document.querySelector('input[type="password"]')!.setAttribute('aria-label', 'Guarded password');
  });
  for (const name of ['Plain input', 'Plain text', 'Editable area']) {
    for (const [text, append, expected] of [['中文', false, '中文'], [' suffix', true, '中文 suffix'], ['', false, '']] as const) {
      await run({ action: 'type', locator: { name }, text, append });
      const field = page.getByRole('textbox', { name, exact: true });
      if (name === 'Editable area') await expect(field).toHaveText(expected); else await expect(field).toHaveValue(expected);
    }
  }
  await run({ action: 'type', locator: { name: 'Choose' }, text: 'b' }); await expect(page.getByRole('combobox', { name: 'Choose' })).toHaveValue('b');
  const client = await context.newCDPSession(page);
  const contexts: Array<{ id: number; name: string; origin: string }> = [];
  client.on('Runtime.executionContextCreated', (event: { context: { id: number; name: string; origin: string } }) => contexts.push(event.context));
  try {
    await client.send('Runtime.enable');
    const extensionId = new URL(context.serviceWorkers()[0].url()).host; let contentWorld: number | undefined;
    for (const candidate of contexts) {
      const result = await client.send('Runtime.evaluate', { expression: 'window === window.top && typeof chrome === "object" && chrome.runtime?.id', contextId: candidate.id, returnByValue: true });
      if (result.result.value === extensionId) { if (contentWorld !== undefined) throw new Error('Multiple extension worlds'); contentWorld = candidate.id; }
    }
    if (contentWorld === undefined) throw new Error('Missing extension content world');
    const installed = await client.send('Runtime.evaluate', { expression: '(()=>{Object.defineProperty(document.querySelector("input[type=password]"),"value",{configurable:true,get(){throw new Error("PASSWORD_VALUE_READ")}});return true;})()', contextId: contentWorld, returnByValue: true });
    expect(installed.result.value).toBe(true);
    const initial = payload(await run({ action: 'inspect' })); expect(JSON.stringify(initial)).not.toContain('PASSWORD_SECRET');
    await run({ action: 'type', locator: { name: 'Guarded password' }, text: '-suffix', append: true });
    await expect(page.getByLabel('Guarded password')).toHaveValue('PASSWORD_SECRET-suffix');
    await run({ action: 'type', locator: { name: 'Guarded password' }, text: '' });
    await expect(page.getByLabel('Guarded password')).toHaveValue('');
  } finally { await client.detach(); }
});
