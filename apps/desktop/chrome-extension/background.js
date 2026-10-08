import { keyboardEvents, mouseEvents } from './input.js';

const BRIDGE_PROTOCOL = 2;
const state = { port: 0, token: '', sessionId: '', connected: false, polling: false, connecting: false, generation: 0, pollController: null, key: null, tabSyncTimer: 0, active: new Map(), activeTabs: new Map(), tabInstances: new Map() };
const endpoint = path => `http://127.0.0.1:${state.port}${path}`;
const safeUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } };
const toBase64 = bytes => { const value = new Uint8Array(bytes); let text = ''; for (let index = 0; index < value.length; index += 0x8000) text += String.fromCharCode(...value.subarray(index, index + 0x8000)); return btoa(text); };
const fromBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));

async function deriveKey(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptPayload(value) {
  if (!state.key) throw new Error('Bridge encryption is not ready');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, state.key, new TextEncoder().encode(JSON.stringify(value))));
  const cipher = encrypted.slice(0, -16); const tag = encrypted.slice(-16);
  const packed = new Uint8Array(iv.length + tag.length + cipher.length); packed.set(iv); packed.set(tag, iv.length); packed.set(cipher, iv.length + tag.length);
  return toBase64(packed);
}

async function readPayload(response) {
  const value = await response.json();
  if (!value?.encrypted || !state.key) return value;
  const packed = fromBase64(value.encrypted); if (packed.length < 28) throw new Error('Invalid encrypted bridge payload');
  const iv = packed.slice(0, 12); const tag = packed.slice(12, 28); const cipher = packed.slice(28);
  const encrypted = new Uint8Array(cipher.length + tag.length); encrypted.set(cipher); encrypted.set(tag, cipher.length);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, state.key, encrypted);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function connect(code, port) {
  if (state.connecting) throw new Error('A connection is already being established');
  const targetPort = Number(port); if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new Error('A valid loopback port is required');
  state.connecting = true;
  try {
  await disconnect(); state.port = targetPort;
  const response = await fetch(endpoint('/connect'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-pi-extension-id': chrome.runtime.id }, body: JSON.stringify({ code: String(code), protocol: BRIDGE_PROTOCOL, version: chrome.runtime.getManifest().version, extensionId: chrome.runtime.id }) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Pairing failed');
  state.token = body.token; state.sessionId = body.sessionId; state.key = await deriveKey(state.token); state.connected = true;
  await chrome.storage.local.set({ piBridge: { port: state.port, token: state.token, sessionId: state.sessionId } });
  await post('/event', { event: 'tabs', tabs: await listTabs() });
  state.tabSyncTimer = setInterval(() => void pushTabs(), 2000);
  void poll();
  } catch (error) { await disconnect(); throw error; }
  finally { state.connecting = false; }
}

async function restore() {
  const generation = state.generation;
  const saved = (await chrome.storage.local.get('piBridge')).piBridge;
  if (!saved?.port || !saved?.token || generation !== state.generation) return;
  const key = await deriveKey(saved.token);
  if (generation !== state.generation) return;
  state.port = saved.port; state.token = saved.token; state.sessionId = saved.sessionId || ''; state.key = key; state.connected = true;
  await pushTabs();
  if (!state.connected || generation !== state.generation) return;
  state.tabSyncTimer = setInterval(() => void pushTabs(), 2000); void poll();
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  const visible = tabs.filter(tab => safeUrl(tab.url)); const live = new Set(visible.map(tab => String(tab.id)));
  for (const tab of visible) if (!state.tabInstances.has(String(tab.id))) state.tabInstances.set(String(tab.id), crypto.randomUUID());
  for (const tabId of state.tabInstances.keys()) if (!live.has(tabId)) state.tabInstances.delete(tabId);
  return visible.map(tab => ({ tabId: String(tab.id), instanceId: state.tabInstances.get(String(tab.id)), url: tab.url, title: tab.title || '', windowId: tab.windowId, active: !!tab.active }));
}

async function post(path, body) {
  const response = await fetch(endpoint(path), { method: 'POST', headers: { 'content-type': 'application/json', 'x-pi-token': state.token, 'x-pi-extension-id': chrome.runtime.id }, body: JSON.stringify({ encrypted: await encryptPayload(body) }) });
  const value = await readPayload(response); if (!response.ok) throw new Error(value.error || 'Bridge request failed'); return value;
}

async function pushTabs(event = 'tabs') {
  const generation = state.generation;
  if (state.connected) await post('/event', { event, tabs: await listTabs() }).catch(() => { if (generation === state.generation) return disconnect(); });
}

async function sendToTab(tabId, message) {
  try { return await chrome.tabs.sendMessage(Number(tabId), message); }
  catch (error) {
    const tab = await chrome.tabs.get(Number(tabId)).catch(() => null);
    if (!tab) { await pushTabs(); throw new Error('Chrome 标签已关闭，请重新选择并授权标签'); }
    throw error;
  }
}

function waitFor(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Chrome 浏览器操作已取消')); return; }
    let timer = 0;
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Chrome 浏览器操作已取消')); };
    timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function loadedTab(tabId, signal) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(Number(tabId));
    if (tab.status === 'complete' && safeUrl(tab.url)) return tab;
    await waitFor(50, signal);
  }
  throw new Error('Chrome 页面加载超时');
}

async function screenshot(tabId, signal) {
  if (signal?.aborted) throw new Error('Chrome 浏览器操作已取消');
  const tab = await chrome.tabs.get(Number(tabId));
  let attached = false;
  try {
    await chrome.debugger.attach({ tabId: Number(tabId) }, '1.3'); attached = true;
    let abort;
    const interrupted = new Promise((_, reject) => {
      abort = () => reject(new Error('Chrome 浏览器操作已取消'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    try {
      const result = await Promise.race([chrome.debugger.sendCommand({ tabId: Number(tabId) }, 'Page.captureScreenshot', { format: 'png' }), interrupted]);
      if (signal?.aborted) throw new Error('Chrome 浏览器操作已取消');
      return { tabId, url: tab.url, image: result.data, mimeType: 'image/png' };
    } finally { signal?.removeEventListener('abort', abort); }
  } finally { if (attached) await chrome.debugger.detach({ tabId: Number(tabId) }).catch(() => {}); }
}

async function inputCommand(command, signal) {
  const request = command.request;
  if (request.action === 'key' && !request.ref && !request.locator) {
    const active = await sendToTab(request.tabId, { type: 'pi-browser', operationId: command.id, scope: command.scope, expectedUrl: command.expectedUrl, request: { ...request, action: 'active' } });
    if (active?.error) throw new Error(active.error);
  }
  const resolve = async target => {
    const result = await sendToTab(request.tabId, { type: 'pi-browser', operationId: command.id, scope: command.scope, expectedUrl: command.expectedUrl, request: { ...request, ref: undefined, locator: undefined, x: undefined, y: undefined, ...target, action: 'resolve' } });
    if (result?.error) throw new Error(result.error);
    return result.point;
  };
  const start = request.action === 'key' && !request.ref && !request.locator ? undefined : await resolve({ ref: request.ref, locator: request.locator, x: request.x, y: request.y, focus: request.action === 'key' });
  const target = request.target ? await resolve(request.target) : undefined;
  let attached = false;
  const pressed = new Map(); let pointerDown = false;
  try {
    await chrome.debugger.attach({ tabId: Number(request.tabId) }, '1.3'); attached = true;
    const method = request.action === 'key' ? 'Input.dispatchKeyEvent' : 'Input.dispatchMouseEvent';
    const events = request.action === 'key' ? keyboardEvents(request) : mouseEvents(request.action, start, target);
    for (const event of events) {
      if (signal?.aborted) throw new Error('Chrome 浏览器操作已取消');
      const tab = await chrome.tabs.get(Number(request.tabId));
      if (command.expectedUrl && tab.url !== command.expectedUrl) throw new Error('Chrome 页面地址已变化，请重新 inspect');
      await chrome.debugger.sendCommand({ tabId: Number(request.tabId) }, method, event);
      if (event.type === 'rawKeyDown' || event.type === 'keyDown') pressed.set(event.key, event);
      if (event.type === 'keyUp') pressed.delete(event.key);
      if (event.type === 'mousePressed') pointerDown = true;
      if (event.type === 'mouseReleased') pointerDown = false;
    }
    return { tabId: request.tabId, action: request.action, start, end: target };
  } finally {
    if (attached) {
      for (const event of [...pressed.values()].reverse()) await chrome.debugger.sendCommand({ tabId: Number(request.tabId) }, 'Input.dispatchKeyEvent', { type: 'keyUp', key: event.key, code: event.code, windowsVirtualKeyCode: event.windowsVirtualKeyCode, modifiers: 0 }).catch(() => {});
      if (pointerDown) await chrome.debugger.sendCommand({ tabId: Number(request.tabId) }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: -1, y: -1, button: 'left', buttons: 0, clickCount: 1 }).catch(() => {});
      await chrome.debugger.detach({ tabId: Number(request.tabId) }).catch(() => {});
    }
  }
}

async function inspectLoadedTab(command, tabId, url, signal) {
  const result = await sendToTab(tabId, {
    type: 'pi-browser', operationId: command.id, scope: command.scope,
    expectedUrl: url, request: { ...command.request, action: 'inspect', tabId: String(tabId) },
  });
  if (result?.error) throw new Error(result.error);
  return result;
}

async function execute(command, signal) {
  const request = command.request || {};
  if (signal?.aborted) throw new Error('Chrome 浏览器操作已取消');
  if (request.action === 'tabs') return { tabs: await listTabs() };
  if (request.action === 'open') {
    if (!safeUrl(request.url)) throw new Error('Only HTTP(S) pages are allowed');
    const tab = await chrome.tabs.create({ url: request.url, active: false });
    try {
      const loaded = await loadedTab(tab.id, signal);
      const page = await inspectLoadedTab(command, tab.id, loaded.url, signal);
      return { tabId: String(tab.id), url: loaded.url, title: loaded.title || '', page };
    } catch (error) {
      await chrome.tabs.remove(tab.id).catch(() => {});
      throw error;
    }
  }
  if (command.instanceId && state.tabInstances.get(String(request.tabId)) !== command.instanceId) throw new Error('Chrome 标签实例已替换，请重新选择标签');
  const tab = request.tabId ? await chrome.tabs.get(Number(request.tabId)).catch(() => null) : null;
  if (!tab || !safeUrl(tab.url)) throw new Error('Tab is unavailable or restricted');
  if (!command.scope) throw new Error('Chrome 标签尚未授权给当前任务');
  if (command.expectedUrl && tab.url !== command.expectedUrl && !(request.action === 'wait' && request.condition && new URL(tab.url).origin === new URL(command.expectedUrl).origin)) throw new Error('Chrome 页面地址已变化，请重新 inspect');
  if (request.observationRevision && request.action !== 'wait') {
    const observed = await sendToTab(request.tabId, { type: 'pi-browser', operationId: command.id, scope: command.scope, expectedUrl: command.expectedUrl, request: { ...request, action: 'wait', condition: { kind: 'load' } } });
    if (observed?.error) throw new Error(observed.error);
  }
  if (request.action === 'screenshot') return screenshot(request.tabId, signal);
  if (['click', 'hover', 'drag', 'key'].includes(request.action)) return inputCommand(command, signal);
  if (request.action === 'navigate') {
    if (!safeUrl(request.url)) throw new Error('Only HTTP(S) pages are allowed');
    await chrome.tabs.update(Number(request.tabId), { url: request.url, active: false });
    const loaded = await loadedTab(request.tabId, signal);
    const page = await inspectLoadedTab(command, request.tabId, loaded.url, signal);
    return { tabId: request.tabId, url: loaded.url, page };
  }
  if (request.action === 'close') { await chrome.tabs.remove(Number(request.tabId)); return { tabId: request.tabId, status: 'closed' }; }
  if (request.action === 'wait' && request.condition) {
    const deadline = Date.now() + (request.milliseconds || 10000);
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Chrome 浏览器操作已取消');
      const current = await chrome.tabs.get(Number(request.tabId)).catch(() => null);
      if (Date.now() >= deadline) throw new Error('等待浏览器条件超时');
      if (!current) { await pushTabs(); throw new Error('Chrome 标签已关闭，请重新选择并授权标签'); }
      if (!safeUrl(current.url) || command.expectedUrl && new URL(current.url).origin !== new URL(command.expectedUrl).origin) throw new Error('Chrome 页面地址已变化，请重新授权并检查页面');
      if (request.condition.kind === 'url' && !request.observationRevision && current.url.includes(request.condition.value)) return { url: current.url, conditionMet: true };
      if (request.condition.kind === 'load' && !request.observationRevision && current.status === 'complete') return { url: current.url, conditionMet: true };
      if (current.status === 'complete') {
        let timer = 0, abort;
        const interrupted = new Promise((_, reject) => {
          abort = () => reject(new Error('Chrome 浏览器操作已取消'));
          timer = setTimeout(() => reject(new Error('等待浏览器条件超时')), Math.max(1, deadline - Date.now()));
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        });
        try {
          const latest = await Promise.race([sendToTab(request.tabId, { type: 'pi-browser', operationId: command.id, scope: command.scope, request, expectedUrl: command.expectedUrl }), interrupted]);
          if (signal?.aborted) throw new Error('Chrome 浏览器操作已取消');
          if (Date.now() >= deadline) throw new Error('等待浏览器条件超时');
          if (latest?.error) throw new Error(latest.error);
          if (latest?.conditionMet) return latest;
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      }
      await waitFor(Math.min(100, Math.max(1, deadline - Date.now())), signal);
    }
    throw new Error('等待浏览器条件超时');
  }
  if (request.action === 'wait') { await waitFor(request.milliseconds || 1, signal); return { url: tab.url, conditionMet: true }; }
  return sendToTab(request.tabId, { type: 'pi-browser', operationId: command.id, scope: command.scope, request, expectedUrl: command.expectedUrl });
}

async function runCommand(command) {
  const generation = state.generation;
  const controller = new AbortController(); state.active.set(command.id, controller); if (command.request?.tabId) state.activeTabs.set(command.id, command.request.tabId);
  const result = await execute(command, controller.signal).then(async value => {
    if (value?.error || command.request?.action === 'close') return value;
    const tabId = value?.tabId || command.request?.tabId;
    const tab = tabId ? await chrome.tabs.get(Number(tabId)) : null;
    if (!tab || !safeUrl(tab.url)) throw new Error('Chrome 标签已关闭或页面不受支持');
    return { ...value, url: tab.url, tabId: String(tab.id) };
  }).catch(error => ({ error: String(error?.message || error) }));
  state.active.delete(command.id);
  state.activeTabs.delete(command.id);
  if (generation !== state.generation) return;
  await post('/response', { id: command.id, result }).catch(() => disconnect());
}

async function cancelOperation(operationId) {
  state.active.get(operationId)?.abort();
  const tabId = state.activeTabs.get(operationId);
  if (tabId) await sendToTab(tabId, { type: 'pi-browser-cancel', operationId }).catch(() => {});
}

async function poll() {
  if (state.polling || !state.connected) return; state.polling = true;
  const generation = state.generation, controller = new AbortController(); state.pollController = controller;
  try {
    while (state.connected && generation === state.generation) {
      const response = await fetch(endpoint('/events'), { headers: { 'x-pi-token': state.token, 'x-pi-extension-id': chrome.runtime.id }, signal: controller.signal });
      const command = await readPayload(response); if (!response.ok) throw new Error(command.error || 'Bridge disconnected');
      if (generation !== state.generation) return;
      if (command.kind === 'command') {
        void runCommand(command);
      } else if (command.kind === 'focus') {
        const result = command.instanceId && state.tabInstances.get(String(command.tabId)) !== command.instanceId
          ? { error: 'Chrome 标签实例已替换，请重新选择标签' }
          : await chrome.tabs.update(Number(command.tabId), { active: true }).then(tab => chrome.windows.update(tab.windowId, { focused: true }).then(() => ({ ok: true }))).catch(error => ({ error: String(error?.message || error) }));
        await post('/response', { id: command.id, result }).catch(() => disconnect());
      } else if (command.kind === 'cancel') {
        void cancelOperation(command.id);
      }
    }
  } catch { if (generation === state.generation) void disconnect(); }
  finally { if (generation === state.generation) { state.polling = false; state.pollController = null; } }
}

async function disconnect() {
  const port = state.port; const token = state.token;
  state.generation++; state.pollController?.abort(); state.pollController = null;
  state.connected = false; state.polling = false; state.token = ''; state.sessionId = ''; state.key = null;
  if (state.tabSyncTimer) { clearInterval(state.tabSyncTimer); state.tabSyncTimer = 0; }
  for (const [operationId, controller] of state.active) { controller.abort(); const tabId = state.activeTabs.get(operationId); if (tabId) void sendToTab(tabId, { type: 'pi-browser-cancel', operationId }).catch(() => {}); }
  state.active.clear();
  state.activeTabs.clear();
  await Promise.allSettled((await listTabs()).map(tab => sendToTab(tab.tabId, { type: 'pi-browser-invalidate' })));
  await chrome.storage.local.remove('piBridge');
  if (port && token) await fetch(`http://127.0.0.1:${port}/disconnect`, { method: 'POST', headers: { 'x-pi-token': token, 'x-pi-extension-id': chrome.runtime.id }, signal: AbortSignal.timeout(2000) }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'pi-connect') restored.then(() => connect(message.code, message.port)).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ error: String(error.message || error) }));
  if (message?.type === 'pi-disconnect') disconnect().then(() => sendResponse({ ok: true }));
  if (message?.type === 'pi-status') sendResponse({ connected: state.connected, port: state.port, sessionId: state.sessionId });
  return true;
});
chrome.tabs.onCreated.addListener(() => void pushTabs());
chrome.tabs.onRemoved.addListener(tabId => { state.tabInstances.delete(String(tabId)); void pushTabs(); });
chrome.tabs.onUpdated.addListener(() => void pushTabs());
chrome.tabs.onActivated.addListener(() => void pushTabs());
const restored = restore().catch(() => disconnect());
