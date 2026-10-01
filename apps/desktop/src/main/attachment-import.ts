import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { attachmentUploadSchema, MAX_ATTACHMENT_BYTES, type AttachmentUpload } from '../shared/attachments.ts';

/** A failed batch never leaves a partially accepted attachment set on disk. */
export async function importAttachmentBatch(storage: string, threadId: string, uploads: AttachmentUpload[]): Promise<string[]> {
  if (uploads.length < 1 || uploads.length > 10) throw new Error('每次最多添加 10 个附件');
  const root = resolve(storage, 'attachments');
  const directory = resolve(root, threadId);
  if (dirname(directory) !== root || /[<>:"/\\|?*]/.test(threadId)) throw new Error('无效的附件任务目录');
  const entries = uploads.map(value => {
    const upload = attachmentUploadSchema.parse(value);
    if (/[<>:"/\\|?*\x00-\x1f]/.test(upload.name) || /[. ]$/.test(upload.name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(upload.name)) throw new Error('附件文件名无效');
    const bytes = Buffer.from(upload.base64, 'base64');
    if (bytes.toString('base64') !== upload.base64) throw new Error('附件内容格式无效');
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('附件大小不能超过 10 MB');
    return { name: upload.name, bytes };
  });
  const batch = join(directory, crypto.randomUUID());
  await mkdir(batch, { recursive: true });
  const files: string[] = [];
  try {
    for (const [index, entry] of entries.entries()) {
      const folder = join(batch, String(index));
      await mkdir(folder);
      const path = join(folder, entry.name);
      await writeFile(path, entry.bytes, { flag: 'wx' });
      files.push(path);
    }
    return files;
  } catch (error) {
    try { await rm(batch, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], '附件导入失败，且临时文件未能清理'); }
    throw error;
  }
}
