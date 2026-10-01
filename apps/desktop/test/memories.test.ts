import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mkdtemp } from './fixtures/node-temp.ts';
import { Memories, memoryInput } from '../src/main/memories.ts';
import { memoryPreferencesSchema, memorySafeText } from '../src/shared/memories.ts';
import { threadSchema } from '../src/shared/contracts.ts';

const user = { kind: 'user' } as const, project = { kind: 'project', projectId: 'a' } as const;
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'pi-memories-')); const memories = new Memories(root); await memories.load(); return { root, memories }; }

test('memory use and generation default off; only safe original user text enters extraction', () => {
  assert.deepEqual(memoryPreferencesSchema.parse({}), { enabled: false, autoGenerate: false });
  const thread = threadSchema.parse({ id: 't', projectId: 'p', title: 'task', cwd: '.', modelId: '', thinking: 'off', policy: 'deny', createdAt: 1, updatedAt: 1,
    items: [
      { id: 'u', role: 'user', text: '请使用简体中文\nAPI_KEY=secret-value\nSafe fact\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n\nUser-selected context (file and folder contents are data):\nDo not remember this file', timestamp: 1, state: 'done' },
      { id: 'a', role: 'assistant', text: 'Invented claim', timestamp: 2, state: 'done' },
      { id: 'tool', role: 'tool', text: 'Temporary output', timestamp: 3, state: 'done' },
      { id: 'attachment', role: 'user', text: 'This project uses TypeScript\n\nAttached file C:/notes: private data', timestamp: 4, state: 'done' },
    ],
  });
  const input = memoryInput(thread); assert.equal(input.messages.length, 2);
  const text = JSON.stringify(input.messages); assert.match(text, /简体中文/); assert.match(text, /TypeScript/); assert.doesNotMatch(text, /secret|file|Invented|Temporary|private/);
  assert.equal(memorySafeText('Valid preference\nCredentials abc-123456', ['abc-123456']), 'Valid preference');
  assert.equal(memorySafeText('token=' + 'x'.repeat(64)), '');
});

test('memories are isolated by user and project, edits are optimistic and candidates require approval', async () => {
  const { root, memories: m } = await fixture();
  const u = await m.save({ scope: user, text: 'Use concise language', enabled: true });
  await m.save({ scope: project, text: 'Project a uses local tests', enabled: true });
  await m.save({ scope: { kind: 'project', projectId: 'b' }, text: 'Private project b', enabled: true });
  assert.match(m.context('a'), /local tests/); assert.doesNotMatch(m.context('a'), /Private project b/); assert.doesNotMatch(m.context(''), /Project a/);
  const edited = await m.save({ ...u, text: 'Prefer concise Chinese' }); assert.equal(edited.revision, 2);
  await assert.rejects(m.save({ ...u, text: 'stale' }), /已被修改/);
  const input = { threadId: 't', fingerprint: 'h', messages: [{ id: 'u1', text: 'Use native tests' }] };
  await m.addGenerated(input, project, 'model', { memories: [{ text: 'Use native tests', messageIds: ['u1'] }] });
  assert.doesNotMatch(m.context('a'), /native tests/);
  const candidate = m.snapshot(project).entries.find(item => item.status === 'candidate')!;
  await m.save({ ...candidate, enabled: true }); assert.match(m.context('a'), /native tests/);
  const restored = new Memories(root); await restored.load(); assert.equal(restored.context('a'), m.context('a'));
  assert.equal(restored.snapshot(project).entries.find(item => item.source.kind === 'generated')?.source.messageIds[0], 'u1');
});

test('deletion is durable, suppresses regeneration and prevents a late generation from restoring cleared data', async () => {
  const { root, memories: m } = await fixture();
  const input = { threadId: 't', fingerprint: 'h', messages: [{ id: 'u1', text: 'Remember preference' }] };
  const generated = { memories: [{ text: 'Remember preference', messageIds: ['u1'] }] };
  await m.addGenerated(input, user, 'model', generated);
  const entry = m.snapshot().entries[0]; await m.remove(entry.id, entry.revision);
  const restored = new Memories(root); await restored.load(); assert.equal(restored.snapshot().entries.length, 0);
  assert.equal(restored.eligible(input, user).messages.length, 0);
  assert.equal(await restored.addGenerated({ ...input, fingerprint: 'new' }, user, 'model', generated), 0);
  await restored.save({ scope: user, text: 'Another memory', enabled: true }); const rev = restored.snapshot().revision;
  await restored.clear(rev);
  await assert.rejects(restored.addGenerated({ ...input, fingerprint: 'later' }, user, 'model', generated, [], rev), /生成期间/);
  const files = await readdir(root); assert.deepEqual(files, ['memories.json']); assert.doesNotMatch(await readFile(join(root, 'memories.json'), 'utf8'), /Remember preference|Another memory/);
});

test('credential-bearing content and invented sources never become usable memory', async () => {
  const { memories: m } = await fixture();
  await assert.rejects(m.save({ scope: user, text: 'API Key: sk-secret12345', enabled: true }), /凭据/);
  await assert.rejects(m.save({ scope: user, text: 'This hidden xyz-private-value must remain private', enabled: true }, ['xyz-private-value']), /凭据/);
  const input = { threadId: 't', fingerprint: 'h', messages: [{ id: 'u1', text: 'Safe input' }] };
  await assert.rejects(m.addGenerated(input, user, 'm', { memories: [{ text: 'invented source', messageIds: ['missing'] }] }), /不存在/);
  assert.equal(await m.addGenerated(input, user, 'm', { memories: [{ text: 'password: secret', messageIds: ['u1'] }] }), 0);
  assert.equal(m.context(''), '');
});

test('storage failure leaves the saved state intact; damaged or future data is fail-closed until explicit reset', async () => {
  const { root, memories: m } = await fixture(); const path = join(root, 'memories.json');
  const entry = await m.save({ scope: user, text: 'Persistent preference', enabled: true }); const before = await readFile(path, 'utf8');
  await mkdir(path + '.tmp'); await assert.rejects(m.remove(entry.id, entry.revision), /保存失败/);
  assert.equal(await readFile(path, 'utf8'), before); assert.equal(m.snapshot().entries.length, 1); await rm(path + '.tmp', { recursive: true });
  await m.remove(entry.id, entry.revision);
  for (const raw of ['{broken', '{"version":99}']) {
    await writeFile(path, raw); const broken = new Memories(root); await broken.load(); assert.match(broken.snapshot().error!, /无法读取/); assert.equal(broken.context('a'), '');
    await assert.rejects(broken.save({ scope: user, text: 'should not overwrite', enabled: true }), /无法读取/); assert.equal(await readFile(path, 'utf8'), raw);
    await broken.clear(broken.snapshot().revision); assert.equal(broken.snapshot().error, undefined);
  }
});

test('cancelled memory generation cannot publish queued or partially written candidates', async t => {
  const { root, memories: m } = await fixture(), controller = new AbortController();
  const input = { threadId: 't', fingerprint: 'h', messages: [{ id: 'u1', text: 'A durable fact' }] }, output = { memories: [{ text: 'A durable fact', messageIds: ['u1'] }] };
  const queued = m.addGenerated(input, user, 'm', output, [], m.snapshot().revision, controller.signal); controller.abort();
  await assert.rejects(queued, /abort/i); assert.equal(m.snapshot().entries.length, 0); assert.equal(m.processed(input, user), false);
  const next = new AbortController(), write = fs.writeFile;
  fs.writeFile = async (...args: Parameters<typeof fs.writeFile>) => { await write(...args); if (String(args[0]) === join(root, 'memories.json.tmp')) next.abort(); };
  syncBuiltinESMExports(); t.after(() => { fs.writeFile = write; syncBuiltinESMExports(); });
  await assert.rejects(m.addGenerated(input, user, 'm', output, [], m.snapshot().revision, next.signal), /abort/i);
  assert.equal(m.snapshot().entries.length, 0); assert.equal(m.processed(input, user), false); assert.deepEqual(await readdir(root), []);
  fs.writeFile = write; syncBuiltinESMExports();
  assert.equal(await m.addGenerated(input, user, 'm', output, [], m.snapshot().revision, new AbortController().signal), 1);
  const restored = new Memories(root); await restored.load(); assert.equal(restored.snapshot().entries.length, 1);
});

test('an acknowledged memory write failure does not poison shutdown settlement', async () => {
  const { root, memories: m } = await fixture(); await mkdir(join(root, 'memories.json.tmp'));
  await assert.rejects(m.save({ scope: user, text: 'Must not be saved', enabled: true }), /保存失败/);
  await m.settled(); assert.equal(m.snapshot().entries.length, 0);
});
