import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonStore } from '../src/main/store.ts';
import { threadSchema, uiThreadSchema } from '../src/shared/contracts.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-chat-persistence-')), store = new JsonStore(dir); await store.load();
  store.data.projects.push({ id: 'p', name: 'Project', path: join(dir, 'project'), trusted: true, createdAt: 1 });
  const chat = threadSchema.parse({ id: crypto.randomUUID(), projectId: '', title: 'Chat', cwd: join(dir, 'chat'), createdAt: 1, updatedAt: 1, providerId: '', thinking: 'off', policy: 'deny' });
  await store.save(); return { dir, store, chat, target: { projectId: 'p', directoryId: 'p', cwd: store.data.projects[0].path } };
}

test('chat creation commits privately and an older full snapshot cannot remove it or its quick window', async () => {
  const { dir, store, chat } = await setup(), blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(store.createChat(chat, true, () => {})); assert.equal(store.data.threads.length, 0); assert.equal(store.data.windows?.quick, undefined);
  await rm(blocked, { recursive: true }); const creating = store.createChat(chat, true, () => {}); assert.equal(store.data.threads.length, 0);
  await Promise.all([creating, store.save()]);
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads.length, 1); assert.equal(reopened.data.windows?.quick.frame.activeThreadId, chat.id); assert.equal(reopened.data.windows?.quick.open, false);
});

test('concurrent creation retries reuse one chat and reject a conflicting existing identity', async () => {
  const { dir, store, chat } = await setup();
  const [first, second] = await Promise.all([store.createChat(chat, false, () => {}), store.createChat(chat, false, () => {})]);
  assert.equal(first, second); assert.equal(store.data.threads.length, 1);
  const reopened = new JsonStore(dir); await reopened.load(); await reopened.createChat(chat, false, () => {}); assert.equal(reopened.data.threads.length, 1);
  first.projectId = 'p'; await assert.rejects(store.createChat(chat, false, () => {}), /标识已被使用/);
});

test('shutdown during creation prevents publication and leaves the previous durable snapshot intact', async () => {
  const { dir, store, chat } = await setup(); let validations = 0;
  await assert.rejects(store.createChat(chat, false, () => { if (++validations === 2) throw new Error('Closing'); }), /Closing/);
  assert.equal(validations, 2); assert.equal(store.data.threads.length, 0);
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads.length, 0);
  await store.createChat(chat, false, () => {}); assert.equal(store.data.threads.length, 1);
});

test('failed binding retains its access boundary and retry preserves newer drafts and attachments', async () => {
  const { dir, store, chat, target } = await setup(); const live = await store.createChat(chat, false, () => {});
  store.data.ui.threads[chat.id] = uiThreadSchema.parse({ draft: { text: 'Original', attachments: ['one.png'] } }); await store.save();
  const blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(store.bindChat(chat.id, target, () => {})); assert.equal(live.projectId, ''); assert.equal(live.cwd, chat.cwd); assert.equal(store.data.ui.threads[chat.id].directoryId, undefined);
  await rm(blocked, { recursive: true });
  const binding = store.bindChat(chat.id, target, () => {}), olderSave = store.save(); await Promise.resolve();
  store.data.ui.threads[chat.id].draft!.text = 'Newer typing';
  await Promise.all([binding, olderSave, store.save()]); assert.equal(store.data.threads[0], live); assert.equal(live.projectId, 'p');
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads[0].cwd, target.cwd); assert.equal(reopened.data.ui.threads[chat.id].directoryId, 'p');
  assert.deepEqual(reopened.data.ui.threads[chat.id].draft, { text: 'Newer typing', attachments: ['one.png'] });
});

test('directory changes during binding invalidate the commit without granting stale access', async () => {
  const { dir, store, chat, target } = await setup(); await store.createChat(chat, false, () => {}); let checks = 0;
  await assert.rejects(store.bindChat(chat.id, target, () => { if (++checks === 2) store.data.projects[0].path = join(dir, 'moved'); }), /目录已变化/);
  assert.equal(store.data.threads[0].projectId, ''); const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads[0].projectId, '');
});

test('concurrent bindings are idempotent for one directory and never switch to another', async () => {
  const { store, chat, target, dir } = await setup(); await store.createChat(chat, false, () => {});
  store.data.projects[0].directories = [{ id: 'extra', name: 'Extra', path: join(dir, 'extra'), trusted: false }];
  const [first, same, other] = await Promise.allSettled([store.bindChat(chat.id, target, () => {}), store.bindChat(chat.id, target, () => {}), store.bindChat(chat.id, { projectId: 'p', directoryId: 'extra', cwd: join(dir, 'extra') }, () => {})]);
  assert.equal(first.status, 'fulfilled'); assert.equal(same.status, 'fulfilled'); assert.equal(other.status, 'rejected'); assert.equal(store.data.threads[0].cwd, target.cwd);
});

test('deletion and runtime startup invalidate pending binding at the final commit boundary', async () => {
  for (const mutation of ['deleted', 'running']) {
    const { store, chat, target, dir } = await setup(); const live = await store.createChat(chat, false, () => {}); let checks = 0;
    await assert.rejects(store.bindChat(chat.id, target, () => { if (++checks === 2) { if (mutation === 'deleted') live.deletedAt = 2; else throw new Error('Running'); } }));
    assert.equal(live.projectId, ''); const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads[0].projectId, '');
  }
});
