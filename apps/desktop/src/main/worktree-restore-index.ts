import { link, lstat, readFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ManagedWorktree } from '../shared/worktrees.ts';
import { gitRun } from './git.ts';
import { WorktreeIndexPreparation } from './worktree-index-preparation.ts';

async function indexFile(path: string) {
  const stat = await lstat(path, { bigint: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error;
  });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('暂存区恢复路径不是普通文件，已保留现场');
  return { bytes: await readFile(path), ino: stat.ino, dev: stat.dev };
}
type IndexFile = Awaited<ReturnType<typeof indexFile>>;
function sameFile(left: IndexFile, right: IndexFile): boolean {
  return !!left && !!right && left.ino === right.ino && left.dev === right.dev && left.bytes.equals(right.bytes);
}

/** The prepared hard link is a durable receipt, including after a process dies with index.lock held. */
export async function prepareRestoreIndex(cwd: string, record: ManagedWorktree, signal: AbortSignal, save: () => Promise<void>) {
  const indexPath = resolve(cwd, (await gitRun(cwd, ['rev-parse', '--git-path', 'index'], signal)).trim());
  const prepared = indexPath + '.pi-restore-' + record.id;
  const preparation = new WorktreeIndexPreparation(cwd, indexPath, record, save);
  const generated = await preparation.build(signal), expected = generated.bytes;
  try {
    if (!await indexFile(prepared)) {
      try { await link(generated.path, prepared); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    await preparation.finish(expected);
  } finally { await preparation.discardGenerated(generated); }
  const receipt = await indexFile(prepared);
  if (!receipt || !receipt.bytes.equals(expected)) throw new Error('暂存区恢复凭据发生变化，已保留现场');
  const baseline = await indexFile(indexPath);
  if (baseline && !sameFile(baseline, receipt)) {
    // Compare staged entries without copying or refreshing the user's index, including its version and flags.
    const entries = async (path: string) => gitRun(cwd, ['-c', 'core.fsmonitor=false', 'ls-files', '--stage', '-z'], signal, { ...process.env, GIT_INDEX_FILE: path });
    if (await entries(indexPath) !== await entries(prepared)) throw new Error('恢复目录暂存区被外部修改，未覆盖；请先保留外部暂存内容');
  }
  const lock = indexPath + '.lock';
  const pending = await indexFile(lock);
  if (pending && !sameFile(pending, receipt)) throw new Error('暂存区被其他 Git 操作锁定，请等待后重试恢复');

  const unchanged = async () => {
    const current = await indexFile(indexPath);
    if (baseline ? !sameFile(current, baseline) : current !== null) throw new Error('恢复期间暂存区被外部修改，未覆盖；请先保留外部暂存内容');
    if (!sameFile(await indexFile(prepared), receipt)) throw new Error('暂存区恢复凭据发生变化，已保留现场');
  };
  return {
    trackingIndex: prepared,
    async publish(validate: () => Promise<void>): Promise<void> {
      signal.throwIfAborted();
      let owned = false;
      try {
        const existing = await indexFile(lock);
        if (existing) {
          if (!sameFile(existing, receipt)) throw new Error('暂存区被其他 Git 操作锁定，请等待后重试恢复');
          owned = true;
        } else {
          try { await link(prepared, lock); owned = true; }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('暂存区被其他 Git 操作锁定，请等待后重试恢复');
            throw error;
          }
        }
        await unchanged(); await validate(); await unchanged(); signal.throwIfAborted();
        if (!sameFile(await indexFile(lock), receipt)) throw new Error('暂存区恢复锁发生变化，已保留现场');
        if (!baseline) { await rename(lock, indexPath); owned = false; }
      } finally {
        // Never remove another process's lock, including one replaced while we were waiting.
        if (owned && sameFile(await indexFile(lock), receipt)) await rm(lock);
      }
    },
    async finish(): Promise<void> {
      if (sameFile(await indexFile(prepared), receipt)) await rm(prepared);
    },
  };
}
