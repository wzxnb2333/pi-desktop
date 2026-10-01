import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonStore } from '../src/main/store.ts';
import { captureSidechat } from '../src/main/sidechat-context.ts';
import { threadSchema, uiThreadSchema } from '../src/shared/contracts.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-sidechat-persistence-')), store = new JsonStore(dir); await store.load();
  const parent = threadSchema.parse({ id: 'p', projectId: '', title: 'Parent', cwd: dir, createdAt: 1, updatedAt: 1, providerId: '', thinking: 'off', policy: 'deny' });
  store.data.threads.push(parent); store.data.ui.threads.p = uiThreadSchema.parse({ draft: { text: 'Parent draft', attachments: ['attachment.txt'] } });
  const side = threadSchema.parse({ ...parent, id: crypto.randomUUID(), title: 'Side', sidechat: captureSidechat(parent), items: [{ id: 'answer', role: 'assistant', text: 'Answer', state: 'done', timestamp: 1 }] });
  await store.save(); return { dir, store, parent, side };
}

test('sidechat creation remains private until saved and survives older full snapshots', async () => {
  const { dir, store, side } = await setup(), blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(store.createSidechat(side)); assert.equal(store.data.threads.length, 1); assert.equal(store.data.ui.threads.p.sidechatId, undefined);
  await rm(blocked, { recursive: true }); const creating = store.createSidechat(side); assert.equal(store.data.threads.length, 1);
  await Promise.all([creating, store.save()]); const reopened = new JsonStore(dir); await reopened.load();
  assert.equal(reopened.data.threads.length, 2); assert.equal(reopened.data.ui.threads.p.sidechatId, side.id);
  await store.createSidechat(side); assert.equal(store.data.threads.length, 2);
});

test('failed retention stays temporary, retries safely and preserves a newer sidechat selection', async () => {
  const { dir, store, side } = await setup(); const live = await store.createSidechat(side), blocked = join(dir, 'desktop.json.tmp');
  await mkdir(blocked); await assert.rejects(store.keepSidechat(side.id)); assert.equal(live.sidechat?.temporary, true); assert.equal(store.data.ui.threads.p.sidechatId, side.id);
  await rm(blocked, { recursive: true }); const keeping = store.keepSidechat(side.id); await Promise.resolve(); store.data.ui.threads.p.sidechatId = 'another-side';
  await Promise.all([keeping, store.save()]); assert.equal(store.data.threads.find(item => item.id === side.id), live); assert.equal(live.sidechat?.temporary, false); assert.equal(store.data.ui.threads.p.sidechatId, 'another-side');
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads.find(item => item.id === side.id)?.sidechat?.temporary, false); assert.equal(reopened.data.ui.threads.p.sidechatId, 'another-side');
  await store.keepSidechat(side.id); assert.equal(live.sidechat?.temporary, false);
});

test('answer and delivery receipt persist together without duplicate append after retry or restart', async () => {
  const { dir, store, side } = await setup(); await store.createSidechat(side); const blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(store.appendSidechat(side.id, 'answer')); assert.equal(store.data.ui.threads.p.draft!.text, 'Parent draft'); assert.equal(store.data.threads[0].sidechat?.appendedItemIds, undefined);
  await rm(blocked, { recursive: true }); await Promise.all([store.appendSidechat(side.id, 'answer'), store.appendSidechat(side.id, 'answer'), store.save()]);
  const reopened = new JsonStore(dir); await reopened.load(); assert.deepEqual(reopened.data.ui.threads.p.draft, { text: 'Parent draft\n\nAnswer', attachments: ['attachment.txt'] });
  assert.deepEqual(reopened.data.threads.find(item => item.id === side.id)?.sidechat?.appendedItemIds, ['answer']);
  await reopened.appendSidechat(side.id, 'answer'); assert.equal(reopened.data.ui.threads.p.draft!.text, 'Parent draft\n\nAnswer');
});

test('typing during sidechat append wins and retry captures the new draft', async () => {
  const { store, side } = await setup(); await store.createSidechat(side);
  const appending = store.appendSidechat(side.id, 'answer'); await Promise.resolve(); store.data.ui.threads.p.draft!.text = 'New typing';
  await assert.rejects(appending, /草稿已变化/); assert.equal(store.data.ui.threads.p.draft!.text, 'New typing'); assert.equal(store.data.threads[0].sidechat?.appendedItemIds, undefined);
  await store.appendSidechat(side.id, 'answer'); assert.equal(store.data.ui.threads.p.draft!.text, 'New typing\n\nAnswer');
});

test('parent deletion during sidechat creation prevents a late orphan from appearing', async () => {
  const { dir, store, parent, side } = await setup(); const creating = store.createSidechat(side); await Promise.resolve(); parent.deletedAt = 99;
  await assert.rejects(creating, /不能创建/); assert.equal(store.data.threads.length, 1); await store.save();
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads.length, 1);
});

test('cleanup wins over pending retention and incomplete or unrelated answers are rejected', async () => {
  const { store, side } = await setup(); const live = await store.createSidechat(side);
  await assert.rejects(store.appendSidechat(side.id, 'missing'), /请等待/); await assert.rejects(store.appendSidechat('p', 'answer'), /不是侧聊/);
  const keeping = store.keepSidechat(side.id); await Promise.resolve(); live.deletedAt = 1;
  await assert.rejects(keeping, /不是临时/); assert.equal(live.sidechat?.temporary, true);
});

test('parent removal invalidates in-flight retention and settlement does not swallow the caller failure', async () => {
  const { store, parent, side } = await setup(); const live = await store.createSidechat(side);
  const keeping = store.keepSidechat(side.id); await Promise.resolve(); parent.deletedAt = 99;
  await assert.rejects(keeping, /不是临时/); await store.settled(); assert.equal(live.sidechat?.temporary, true);
});
