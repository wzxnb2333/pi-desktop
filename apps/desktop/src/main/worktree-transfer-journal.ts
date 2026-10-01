import { lstat, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export const transferAssociationSchema = z.object({
  worktreeId: z.uuid(), ownerThreadId: z.string().min(1), operationId: z.uuid(), sourceRevision: z.number().int().nonnegative(),
}).strict();
export type TransferAssociation = z.infer<typeof transferAssociationSchema>;
const hash = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const transferJournalSchema = z.object({
  version: z.literal(2), id: z.uuid(), threadId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),
  source: z.string().min(1), target: z.string().min(1), commonDirectory: z.string().min(1),
  sourceTree: hash, targetTree: hash, finalTree: hash.optional(), changes: z.array(z.string()).max(20000), attempted: z.array(z.string()).max(20000),
  state: z.enum(['prepared', 'files-transferred', 'complete', 'rolled-back', 'recovery-required']),
  error: z.string(), createdAt: z.number(), association: transferAssociationSchema.optional(),
}).strict().refine(record => new Set(record.changes).size === record.changes.length && new Set(record.attempted).size === record.attempted.length && record.attempted.every(path => record.changes.includes(path)), 'Invalid transfer file list');
export type TransferJournal = z.infer<typeof transferJournalSchema>;

export async function transferDirectory(storage: string): Promise<string> {
  const directory = join(storage, 'worktree-transfers'); await mkdir(directory, { recursive: true });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('迁移恢复目录不是普通目录，已保留现有数据。');
  return directory;
}
export async function saveTransferJournal(storage: string, record: TransferJournal): Promise<void> {
  const path = join(await transferDirectory(storage), record.id + '.json');
  for (const candidate of [path, path + '.tmp']) {
    const metadata = await lstat(candidate).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
    if (metadata && (!metadata.isFile() || metadata.isSymbolicLink())) throw new Error('迁移恢复记录不是普通文件，已保留现有数据。');
  }
  await writeFile(path + '.tmp', JSON.stringify(transferJournalSchema.parse(record)));
  const file = await open(path + '.tmp', 'r+');
  try { await file.sync(); } finally { await file.close(); }
  await rename(path + '.tmp', path);
}
export async function readTransferJournal(directory: string, name: string): Promise<unknown> {
  const path = join(directory, name), metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 8 * 1024 * 1024) throw new Error('迁移恢复记录无法安全读取，原文件已保留。');
  return JSON.parse(await readFile(path, 'utf8'));
}
