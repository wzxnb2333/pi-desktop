import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mkdtemp } from './fixtures/node-temp.ts';
import { ComposerService, contentVersion, sendFingerprint } from '../src/main/composer.ts';
import { builtinProvider, modelFromCatalog } from '../src/shared/model-configuration.ts';
import { defaultData, modelProviderSchema, providerModelSchema, threadSchema, requestSchema, uiThreadSchema } from '../src/shared/contracts.ts';
import { rememberDraft, fuzzyScore, promptTemplateSchema, composerPayloadSchema, referenceKey } from '../src/shared/composer.ts';
import { modelCatalog } from '../src/main/model-catalog.ts';
import { resolveInputContext } from '../src/worker/input-context.ts';
import { Agent } from '../../../packages/agent/src/agent.ts';

async function fixture() {
  const storage = await mkdtemp(join(tmpdir(), 'pi-composer-unit-'));
  const root = join(storage, 'project'), other = join(storage, 'other');
  await mkdir(root); await mkdir(other);
  const data = defaultData();
  data.projects.push({ id: 'p', name: 'main', path: root, trusted: true, createdAt: 1, directories: [{ id: 'other', name: 'extra', path: other, trusted: false }] });
  data.settings.modelProviders.push(modelProviderSchema.parse({ id: 'local-provider', name: 'local', kind: 'custom', namespace: 'desktop-local-provider', baseUrl: 'http://127.0.0.1:1/v1' }));
  data.settings.models.push(providerModelSchema.parse({ id: 'local', provider: 'local-provider', name: 'local', model: 'faux', reasoning: true, thinkingLevels: ['low', 'high', 'xhigh', 'max'] }));
  const thread = threadSchema.parse({ id: 't', projectId: 'p', title: 't', cwd: root, createdAt: 1, updatedAt: 1, modelId: 'local', thinking: 'off', policy: 'auto' });
  data.threads.push(thread);
  const allowed = new Map([['t', new Set<string>()]]);
  return { storage, root, other, data, thread, allowed, service: new ComposerService(() => data, storage, allowed) };
}

test('attachment previews preserve bytes and reject escapes and missing files', async () => {
  const f = await fixture(), dir = join(f.storage, 'attachments', 't'); await mkdir(dir, { recursive: true });
  const path = join(dir, 'note.txt'); await writeFile(path, '中文正文'); f.allowed.get('t')!.add(path);
  const info = await f.service.attachment(f.thread, path); assert.equal(info.preview, '中文正文'); assert.equal(info.bytes, 12); assert.equal(info.kind, 'text');
  const outside = join(f.storage, 'secrets.json'); await writeFile(outside, 'secret'); f.allowed.get('t')!.add(outside);
  await assert.rejects(f.service.attachment(f.thread, outside));
  await unlink(path); await assert.rejects(f.service.attachment(f.thread, path));
  const check = await f.service.preflight(f.thread, { text: '', attachments: [path], context: [] }); assert.equal(check.issues.length, 1);
});

test('file references pin versions and show only selected lines', async () => {
  const f = await fixture(); await writeFile(join(f.root, 'a.txt'), ['one', 'two', 'three'].join(String.fromCharCode(10)));
  const detail = await f.service.detail(f.thread, { kind: 'file', directoryId: 'p', id: 'a.txt', label: 'a', range: { start: 2, end: 2 } });
  assert.match(detail.content, /lines 2-2/); assert.ok(detail.content.endsWith('two')); assert.doesNotMatch(detail.content, /one|three/); assert.ok(detail.reference.version);
  const roots = [{ id: 'p', name: 'main', path: f.root, trusted: true }];
  assert.equal(await resolveInputContext(f.root, [detail.reference], [], [], roots), detail.content);
  await writeFile(join(f.root, 'a.txt'), ['one', 'changed', 'three'].join(String.fromCharCode(10)));
  assert.equal((await f.service.detail(f.thread, detail.reference)).stale, true);
  await assert.rejects(resolveInputContext(f.root, [detail.reference], [], [], roots), /版本已变化/);
  assert.match((await f.service.detail(f.thread, detail.reference, true)).content, /changed/);
  await assert.rejects(f.service.detail(f.thread, { ...detail.reference, directoryId: 'outside' }));
  await assert.rejects(f.service.detail(f.thread, { ...detail.reference, range: { start: 1, end: 99 } }));
});

test('quotes verify source offsets, version and task ownership', async () => {
  const f = await fixture(); f.thread.items.push({ id: 'm', role: 'assistant', text: 'alpha 中文 beta', thinking: '', state: 'done', timestamp: 1 });
  const detail = await f.service.detail(f.thread, { kind: 'quote', id: 'm', label: 'source', quote: { start: 6, end: 8, text: '中文' } });
  assert.equal(detail.reference.version, contentVersion('alpha 中文 beta')); assert.match(detail.content, /characters 6-8/);
  await assert.rejects(f.service.detail(f.thread, { ...detail.reference, id: 'another-thread' }));
  f.thread.items[0].text = 'changed'; await assert.rejects(f.service.detail(f.thread, detail.reference));
});

test('fuzzy search spans all roots and excludes generated folders', async () => {
  const f = await fixture(); await mkdir(join(f.root, 'src', 'nested'), { recursive: true }); await mkdir(join(f.root, 'node_modules'));
  await writeFile(join(f.root, 'src', 'nested', 'component.tsx'), 'a'); await writeFile(join(f.other, 'component.tsx'), 'b'); await writeFile(join(f.root, 'node_modules', 'component.tsx'), 'hidden');
  const found = await f.service.search(f.thread, 'cmptx'); assert.equal(found.matches.length, 2); assert.deepEqual(new Set(found.matches.map(item => item.directoryId)), new Set(['p', 'other']));
  assert.ok(fuzzyScore('src/component.tsx', 'component') > fuzzyScore('src/component.tsx', 'cmpt'));
  assert.equal(fuzzyScore('a', 'z'), -1);
  f.data.ui.threads.t = uiThreadSchema.parse({ directoryId: 'other', selectedPath: join('src', 'nested', 'component.tsx'), openFiles: [], directoryViews: { other: { openFiles: ['component.tsx'], selectedPath: 'component.tsx' } } });
  f.service.recordRecent(f.thread, f.data.ui.threads.t);
  assert.equal(f.thread.recentFiles?.[0].directoryId, 'other');
  assert.equal((await f.service.search(f.thread, 'component')).matches[0].directoryId, 'other');
  f.data.ui.threads.t.directoryViews!.other.openFiles = [];
  assert.equal((await f.service.search(f.thread, 'component')).matches[0].directoryId, 'other');
  const parallel = await Promise.all([f.service.search(f.thread, 'a'), f.service.search(f.thread, 'component')]);
  assert.equal(parallel[1].matches.length, 2);
});

test('preflight rejects binary and text-only models but accepts image-only input', async () => {
  const f = await fixture(), dir = join(f.storage, 'attachments', 't'); await mkdir(dir, { recursive: true });
  const image = join(dir, 'image.png'), binary = join(dir, 'binary.bin'); await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lX8AAAAASUVORK5CYII=', 'base64')); await writeFile(binary, Buffer.from([0, 4]));
  f.allowed.get('t')!.add(image); f.allowed.get('t')!.add(binary);
  const valid = await f.service.preflight(f.thread, { text: '', attachments: [image], context: [] }); assert.deepEqual(valid.issues, []); assert.equal(valid.images, 1); assert.ok(valid.estimatedTokens > 0);
  assert.equal((await f.service.preflight(f.thread, { text: 'a', attachments: [binary], context: [] })).issues.length, 1);
  const provider = modelCatalog().find(item => item.models.some(model => model.imageInput === false))!; const model = provider.models.find(item => item.imageInput === false)!;
  f.data.settings.modelProviders[0] = builtinProvider('local-provider', provider.id);
  f.data.settings.models[0] = { ...modelFromCatalog('local-provider', model), id: 'local', name: 'text' };
  assert.match((await f.service.preflight(f.thread, { text: '', attachments: [image], context: [] })).issues[0].message, /不支持图片/);
});

test('history coalesces edits and bounds persisted revisions', () => {
  const draft = { text: 'first', attachments: ['one'], context: [{ kind: 'file' as const, id: 'a', label: 'a' }] };
  let history = rememberDraft([], structuredClone(draft), 1000);
  assert.equal(rememberDraft(history, { ...draft, text: 'typing' }, 1100).length, 1);
  for (let index = 1; index < 30; index++) history = rememberDraft(history, { ...draft, text: String(index) }, 1000 + index * 30001);
  assert.equal(history.length, 20); assert.equal(history[0].text, '29'); assert.equal(history[19].text, '10');
  assert.notEqual(referenceKey(draft.context[0]), referenceKey({ ...draft.context[0], range: { start: 1, end: 2 } }));
});

test('request validation and fingerprints bind contents and delivery type', () => {
  assert.equal(requestSchema.safeParse({ op: 'thread.send', id: 't', text: '', attachments: [] }).success, true);
  assert.equal(requestSchema.safeParse({ op: 'thread.queueChange', threadId: 't', change: { id: 'q', action: 'remove', revision: -1 } }).success, false);
  assert.equal(promptTemplateSchema.safeParse({ id: 'x', name: ' ', text: 'body' }).success, false);
  const payload = composerPayloadSchema.parse({ text: 'a', attachments: [] });
  assert.equal(sendFingerprint(payload), sendFingerprint(structuredClone(payload)));
  assert.notEqual(sendFingerprint(payload), sendFingerprint({ ...payload, queue: 'steer' }));
});

test('atomic queue exchange refuses stale snapshots and cannot recall consumed messages', () => {
  const agent = new Agent({ streamFn: () => { throw new Error('not used'); } });
  agent.followUp({ role: 'user', content: 'one', timestamp: 1 }); agent.followUp({ role: 'user', content: 'two', timestamp: 2 });
  const captured = agent.getPendingMessages('followUp');
  assert.equal(agent.replacePendingMessages('followUp', captured, [captured[1], captured[0]]), true);
  assert.equal(agent.replacePendingMessages('followUp', captured, []), false);
  const current = agent.getPendingMessages('followUp'); agent.clearFollowUpQueue();
  assert.equal(agent.replacePendingMessages('followUp', current, [captured[0]]), false); assert.equal(agent.hasQueuedMessages(), false);
});
