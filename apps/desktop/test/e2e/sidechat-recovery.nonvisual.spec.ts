import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Thread } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });

interface SidechatWriteGate { waiting: boolean; release(): void; restore(): void }
async function holdSidechatWrite(id: string, append: boolean) {
  await fixture.app.evaluate((_, input) => {
    const fs = process.getBuiltinModule('node:fs/promises'), { syncBuiltinESMExports } = process.getBuiltinModule('node:module'), write = fs.writeFile;
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const gate: SidechatWriteGate = { waiting: false, release, restore: () => { fs.writeFile = write; syncBuiltinESMExports(); } };
    (globalThis as typeof globalThis & { sidechatWriteGate?: SidechatWriteGate }).sidechatWriteGate = gate;
    fs.writeFile = async (...args: Parameters<typeof write>) => {
      await write(...args); if (String(args[0]) !== input.path || gate.waiting) return;
      const data = JSON.parse(String(args[1])) as { threads?: { id: string; sidechat?: { appendedItemIds?: string[] } }[] };
      const side = data.threads?.find(thread => thread.id === input.id);
      if (side?.sidechat && (!input.append || side.sidechat.appendedItemIds?.length)) { gate.waiting = true; await wait; }
    };
    syncBuiltinESMExports();
  }, { path: join(fixture.storage, 'desktop.json.tmp'), id, append });
}
async function releaseSidechatWrite() {
  await fixture.app.evaluate(() => { const root = globalThis as typeof globalThis & { sidechatWriteGate?: SidechatWriteGate }; root.sidechatWriteGate?.release(); root.sidechatWriteGate?.restore(); delete root.sidechatWriteGate; });
}
const waitingForWrite = () => expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { sidechatWriteGate?: SidechatWriteGate }).sidechatWriteGate?.waiting)).toBe(true);

test('sidechat creation failure cannot publish a ghost chat or change the selected side conversation', async () => {
  const before = (await fixture.snapshot()).data, blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'sidechat.create', threadId: 't' })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    const after = (await fixture.snapshot()).data;
    expect(after.threads.filter(thread => thread.sidechat)).toHaveLength(0); expect(after.ui.threads.t?.sidechatId).toBe(before.ui.threads.t?.sidechatId);
  } finally { await rm(blocked, { recursive: true, force: true }); }
  expect(fixture.calls).toHaveLength(0); const requestId = crypto.randomUUID();
  const first = await fixture.invoke({ op: 'sidechat.create', threadId: 't', requestId }) as Thread;
  const retry = await fixture.invoke({ op: 'sidechat.create', threadId: 't', requestId }) as Thread; expect(retry.id).toBe(first.id);
  expect((await fixture.snapshot()).data.threads.filter(thread => thread.sidechat)).toHaveLength(1);
  await fixture.restart(); expect((await fixture.snapshot()).data.threads.some(thread => thread.sidechat)).toBe(false);
});

test('sidechat keep and append storage failures retain temporary state and parent draft until retry', async () => {
  const side = await fixture.invoke({ op: 'sidechat.create', threadId: 't' }) as Thread;
  await fixture.invoke({ op: 'thread.send', id: side.id, text: 'Explain read only', attachments: [] });
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === side.id)?.status).toBe('idle');
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === side.id)!.items.find(item => item.role === 'assistant' && item.state === 'done')!;
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'Parent draft', attachments: [join(fixture.project, 'README.md')] } } });
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'sidechat.keep', threadId: side.id })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    expect((await fixture.snapshot()).data.threads.find(thread => thread.id === side.id)?.sidechat?.temporary).toBe(true);
    await expect(fixture.invoke({ op: 'sidechat.append', threadId: side.id, itemId: item.id })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('Parent draft');
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.invoke({ op: 'sidechat.append', threadId: side.id, itemId: item.id });
  await fixture.invoke({ op: 'sidechat.append', threadId: side.id, itemId: item.id });
  const draft = (await fixture.snapshot()).data.ui.threads.t.draft!; expect(draft.text).toBe('Parent draft\n\n' + item.text); expect(draft.attachments).toEqual([join(fixture.project, 'README.md')]);
  await fixture.invoke({ op: 'sidechat.keep', threadId: side.id }); await fixture.restart(); expect((await fixture.snapshot()).data.threads.find(thread => thread.id === side.id)?.sidechat?.temporary).toBe(false); expect((await fixture.snapshot()).data.ui.threads.t.draft).toEqual(draft); expect(fixture.calls).toHaveLength(1);
});

test('a late sidechat creation cannot reopen a panel the user closed while saving', async () => {
  await fixture.invoke({ op: 'sidechat.create', threadId: 't' }); const id = crypto.randomUUID(); await holdSidechatWrite(id, false);
  const creating = fixture.invoke({ op: 'sidechat.create', threadId: 't', requestId: id });
  try {
    await waitingForWrite(); expect((await fixture.snapshot()).data.threads.some(thread => thread.id === id)).toBe(false);
    await fixture.invoke({ op: 'ui.update', ui: (await fixture.snapshot()).data.ui, frame: { reviewOpen: false } });
  } finally { await releaseSidechatWrite(); await creating; }
  expect((await fixture.snapshot()).data.ui.reviewOpen).toBe(false); expect((await fixture.snapshot()).data.threads.some(thread => thread.id === id)).toBe(true); expect(fixture.calls).toHaveLength(0);
});

test('sidechat append rejects concurrent parent typing and retries once with attachments intact', async () => {
  const side = await fixture.invoke({ op: 'sidechat.create', threadId: 't' }) as Thread;
  await fixture.invoke({ op: 'thread.send', id: side.id, text: 'Explain', attachments: [] });
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === side.id)?.status).toBe('idle');
  const item = (await fixture.snapshot()).data.threads.find(thread => thread.id === side.id)!.items.find(item => item.role === 'assistant' && item.state === 'done')!;
  await holdSidechatWrite(side.id, true);
  const appending = fixture.invoke({ op: 'sidechat.append', threadId: side.id, itemId: item.id }).then(() => '', error => String(error));
  try { await waitingForWrite(); await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'Newer draft', attachments: [join(fixture.project, 'README.md')] } } }); }
  finally { await releaseSidechatWrite(); }
  expect(await appending).toContain('主任务草稿已变化'); expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('Newer draft');
  await fixture.invoke({ op: 'sidechat.append', threadId: side.id, itemId: item.id }); await fixture.invoke({ op: 'sidechat.keep', threadId: side.id });
  const draft = (await fixture.snapshot()).data.ui.threads.t.draft!; expect(draft).toEqual({ text: 'Newer draft\n\n' + item.text, attachments: [join(fixture.project, 'README.md')] });
  await fixture.restart(); await fixture.invoke({ op: 'sidechat.append', threadId: side.id, itemId: item.id }); expect((await fixture.snapshot()).data.ui.threads.t.draft).toEqual(draft); expect(fixture.calls).toHaveLength(1);
});

test('shutdown clears sidechats still being committed before the final desktop snapshot', async () => {
  const id = crypto.randomUUID(), report = join(fixture.storage, 'sidechat-exit.json'); await holdSidechatWrite(id, false);
  const creating = fixture.invoke({ op: 'sidechat.create', threadId: 't', requestId: id }).then(() => '', error => String(error));
  await waitingForWrite();
  await fixture.app.evaluate(({ app }, input) => {
    const fs = process.getBuiltinModule('node:fs');
    app.once('will-quit', () => fs.writeFileSync(input.report, fs.readFileSync(input.path)));
    setTimeout(() => { const gate = (globalThis as typeof globalThis & { sidechatWriteGate?: SidechatWriteGate }).sidechatWriteGate; gate?.release(); gate?.restore(); }, 100);
  }, { report, path: join(fixture.storage, 'desktop.json') });
  await fixture.restart(); await creating;
  const atExit = JSON.parse(await readFile(report, 'utf8')) as { threads: Thread[] };
  expect(atExit.threads.some(thread => thread.sidechat?.temporary)).toBe(false); expect((await fixture.snapshot()).data.threads.some(thread => thread.sidechat?.temporary)).toBe(false); expect(fixture.calls).toHaveLength(0);
});
