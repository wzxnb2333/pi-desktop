import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mkdtemp } from './fixtures/node-temp.ts';
import { importAttachmentBatch } from '../src/main/attachment-import.ts';
import { MAX_ATTACHMENT_BYTES } from '../src/shared/attachments.ts';

test('pasted and dropped file bytes are stored distinctly and preserve Unicode and empty files', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'pi-attachments-'));
  const files = await importAttachmentBatch(storage, 'task', [
    { name: '中文.txt', base64: Buffer.from('第一份').toString('base64') },
    { name: '中文.txt', base64: Buffer.from('第二份').toString('base64') },
    { name: 'empty.txt', base64: '' },
  ]);
  assert.equal(new Set(files).size, 3);
  assert.deepEqual(await Promise.all(files.map(file => readFile(file, 'utf8'))), ['第一份', '第二份', '']);
});
test('invalid or oversized batches write no partial files and cannot escape storage', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'pi-attachments-invalid-'));
  const valid = { name: 'valid.txt', base64: 'ZmlsZQ==' };
  for (const name of ['../outside.txt', 'C:\outside.txt', 'CON.txt', 'trailing.'])
    await assert.rejects(importAttachmentBatch(storage, 'task', [valid, { ...valid, name }]));
  await assert.rejects(importAttachmentBatch(storage, '../outside', [valid]));
  await assert.rejects(importAttachmentBatch(storage, 'task', [{ ...valid, base64: 'invalid%' }]));
  await assert.rejects(importAttachmentBatch(storage, 'task', [{ ...valid, base64: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64') }]));
  assert.deepEqual(await readdir(storage), []);
});
