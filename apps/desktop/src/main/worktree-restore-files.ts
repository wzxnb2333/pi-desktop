import { createHash } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ManagedWorktree } from '../shared/worktrees.ts';
import { safeProjectPath } from './policy.ts';
import type { RoundSnapshots } from './round-snapshots.ts';

async function stat(path: string) {
  return lstat(path, { bigint: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error;
  });
}

/** Publish only complete blobs. An owned scratch directory keeps partial writes out of the checkout. */
export class WorktreeRestoreFiles {
  private readonly root: string;
  private readonly path: string;
  constructor(storage: string, private readonly record: ManagedWorktree, private readonly snapshots: RoundSnapshots,
    private readonly files: Map<string, { hash: string; mode: string }>, private readonly save: () => Promise<void>) {
    this.root = join(storage, 'worktree-restore-files'); this.path = join(this.root, record.id);
  }

  private async verifyDirectory() {
    const parent = await stat(this.root), directory = await stat(this.path), receipt = this.record.restoreFiles;
    if ((parent && (!parent.isDirectory() || parent.isSymbolicLink())) || !receipt || receipt.tree !== this.record.archiveTree ||
      (directory && (!directory.isDirectory() || directory.isSymbolicLink() || String(directory.ino) !== receipt.ino || String(directory.dev) !== receipt.dev))) {
      throw new Error('恢复临时目录身份不匹配，已保留现有数据。');
    }
    return directory;
  }

  private async clearPartialFiles(signal: AbortSignal): Promise<void> {
    if (!await this.verifyDirectory()) return;
    const hashes = new Set([...this.files.values()].map(entry => entry.hash));
    const pending: { path: string; bytes: Buffer; ino: bigint; dev: bigint }[] = [];
    for (const name of await readdir(this.path)) {
      signal.throwIfAborted();
      const hash = name.slice(0, -5), path = join(this.path, name), metadata = await stat(path);
      if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?\.part$/.test(name) || !hashes.has(hash) || !metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > 50n * 1024n * 1024n) {
        throw new Error('恢复临时目录包含外部变更，未清理。\n' + path);
      }
      const bytes = await readFile(path), expected = await this.snapshots.blob(this.record.snapshotThreadId ?? this.record.threadId, this.record.localPath, hash, signal);
      if (createHash(hash.length === 64 ? 'sha256' : 'sha1').update('blob ' + expected.length + '\0').update(expected).digest('hex') !== hash ||
        bytes.length > expected.length || !bytes.equals(expected.subarray(0, bytes.length))) throw new Error('恢复临时目录包含外部变更，未清理。\n' + path);
      pending.push({ path, bytes, ino: metadata.ino, dev: metadata.dev });
    }
    for (const entry of pending) {
      signal.throwIfAborted(); await this.verifyDirectory(); const current = await stat(entry.path);
      if (!current?.isFile() || current.isSymbolicLink() || current.ino !== entry.ino || current.dev !== entry.dev || !(await readFile(entry.path)).equals(entry.bytes)) {
        throw new Error('恢复临时目录包含外部变更，未清理。\n' + entry.path);
      }
      await unlink(entry.path);
    }
  }

  async prepare(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.record.restoreFiles && !await this.verifyDirectory()) {
      const receipt = this.record.restoreFiles; this.record.restoreFiles = undefined;
      try { await this.save(); } catch (error) { this.record.restoreFiles = receipt; throw error; }
    }
    if (!this.record.restoreFiles) {
      await mkdir(this.root, { recursive: true });
      const parent = await stat(this.root);
      if (!parent?.isDirectory() || parent.isSymbolicLink()) throw new Error('恢复临时目录身份不匹配，已保留现有数据。');
      await mkdir(this.path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
      const directory = await stat(this.path);
      // An empty directory from a crash before the receipt save contains no recoverable user data.
      if (!directory?.isDirectory() || directory.isSymbolicLink() || (await readdir(this.path)).length) throw new Error('恢复临时目录已被占用，未覆盖文件。');
      this.record.restoreFiles = { ino: String(directory.ino), dev: String(directory.dev), tree: this.record.archiveTree! };
      try { await this.save(); }
      catch (error) {
        const current = await stat(this.path); this.record.restoreFiles = undefined;
        if (current?.isDirectory() && !current.isSymbolicLink() && current.ino === directory.ino && current.dev === directory.dev) await rmdir(this.path);
        throw error;
      }
    }
    if (!await this.verifyDirectory()) throw new Error('恢复临时目录已丢失，请保留现有工作区。');
    await this.clearPartialFiles(signal);
  }

  async publish(path: string, hash: string, bytes: Buffer, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!await this.verifyDirectory()) throw new Error('恢复临时目录已丢失，请保留现有工作区。');
    const temporary = join(this.path, hash + '.part');
    await writeFile(temporary, bytes, { flag: 'wx' });
    const metadata = await stat(temporary), handle = await open(temporary, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    const current = await stat(temporary);
    if (!metadata?.isFile() || !current?.isFile() || current.isSymbolicLink() || current.ino !== metadata.ino || current.dev !== metadata.dev || !(await readFile(temporary)).equals(bytes)) {
      throw new Error('恢复临时目录包含外部变更，未清理。\n' + temporary);
    }
    const absolute = await safeProjectPath(this.record.checkoutPath, path);
    await mkdir(dirname(absolute), { recursive: true });
    signal.throwIfAborted(); await this.verifyDirectory(); await safeProjectPath(this.record.checkoutPath, path);
    // Hard-link creation is exclusive; unlike rename, it cannot replace a concurrently created destination.
    try { await link(temporary, absolute); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('恢复目录文件被外部修改，未覆盖：' + path);
      throw error;
    }
    const remaining = await stat(temporary);
    if (remaining?.isFile() && !remaining.isSymbolicLink() && remaining.ino === metadata.ino && remaining.dev === metadata.dev) await unlink(temporary);
    else throw new Error('恢复临时目录包含外部变更，未清理。\n' + temporary);
  }

  async finish(signal: AbortSignal): Promise<void> {
    if (!this.record.restoreFiles) return;
    await this.clearPartialFiles(signal);
    if (await this.verifyDirectory()) await rmdir(this.path);
    const receipt = this.record.restoreFiles; this.record.restoreFiles = undefined;
    try { await this.save(); } catch (error) { this.record.restoreFiles = receipt; throw error; }
  }
}
