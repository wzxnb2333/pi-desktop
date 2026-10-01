import { lstat, mkdir, open, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ManagedWorktree } from '../shared/worktrees.ts';
import { gitRun } from './git.ts';

async function metadata(path: string) {
  return lstat(path, { bigint: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error;
  });
}

/** Only read-tree output belongs here; the user's current index is never copied into disposable storage. */
export class WorktreeIndexPreparation {
  readonly path: string;
  constructor(private readonly cwd: string, index: string, private readonly record: ManagedWorktree, private readonly save: () => Promise<void>) {
    this.path = index + '.pi-prepare-' + record.id;
  }

  private async directory() {
    const parent = await metadata(dirname(this.path)), directory = await metadata(this.path), receipt = this.record.restoreIndexPreparation;
    if (!parent?.isDirectory() || parent.isSymbolicLink() || !receipt || receipt.tree !== this.record.archiveIndex ||
      (directory && (!directory.isDirectory() || directory.isSymbolicLink() || String(directory.ino) !== receipt.ino || String(directory.dev) !== receipt.dev))) {
      throw new Error('索引准备目录身份不匹配，已保留现有数据。');
    }
    return directory;
  }
  private async entries() {
    if (!await this.directory()) return [];
    const entries = [];
    for (const name of await readdir(this.path)) {
      const path = join(this.path, name), stat = await metadata(path);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.index(?:\.lock)?$/.test(name) || !stat?.isFile() || stat.isSymbolicLink()) {
        throw new Error('索引准备目录包含外部变更，未清理。\n' + path);
      }
      entries.push({ path, stat });
    }
    return entries;
  }
  async build(signal: AbortSignal): Promise<{ path: string; bytes: Buffer; ino: bigint; dev: bigint }> {
    signal.throwIfAborted();
    if (this.record.restoreIndexPreparation && !await this.directory()) {
      const receipt = this.record.restoreIndexPreparation; this.record.restoreIndexPreparation = undefined;
      try { await this.save(); } catch (error) { this.record.restoreIndexPreparation = receipt; throw error; }
    }
    if (!this.record.restoreIndexPreparation) {
      const parent = await metadata(dirname(this.path));
      if (!parent?.isDirectory() || parent.isSymbolicLink()) throw new Error('索引准备目录身份不匹配，已保留现有数据。');
      await mkdir(this.path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
      const directory = await metadata(this.path);
      if (!directory?.isDirectory() || directory.isSymbolicLink() || (await readdir(this.path)).length) throw new Error('索引准备目录已被占用，未覆盖文件。');
      this.record.restoreIndexPreparation = { ino: String(directory.ino), dev: String(directory.dev), tree: this.record.archiveIndex! };
      try { await this.save(); }
      catch (error) {
        this.record.restoreIndexPreparation = undefined;
        const current = await metadata(this.path);
        if (current?.isDirectory() && !current.isSymbolicLink() && current.ino === directory.ino && current.dev === directory.dev) await rmdir(this.path);
        throw error;
      }
    }
    // Reject unknown entries before creating another attempt. Interrupted, known attempts are checked against fresh output.
    await this.entries();
    const path = join(this.path, crypto.randomUUID() + '.index');
    try {
      await gitRun(this.cwd, ['-c', 'core.fsmonitor=false', 'read-tree', this.record.archiveIndex!], signal, { ...process.env, GIT_INDEX_FILE: path });
      const stat = await metadata(path);
      if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error('索引准备目录包含外部变更，未清理。\n' + path);
      const bytes = await readFile(path), handle = await open(path, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
      const current = await metadata(path);
      if (!current?.isFile() || current.isSymbolicLink() || current.ino !== stat.ino || current.dev !== stat.dev || !(await readFile(path)).equals(bytes)) {
        throw new Error('索引准备目录包含外部变更，未清理。\n' + path);
      }
      signal.throwIfAborted(); await this.directory();
      return { path, bytes, ino: stat.ino, dev: stat.dev };
    } catch (error) {
      // Empty failed starts do not accumulate; partial output remains registered for a verified retry.
      if (await this.directory() && (await readdir(this.path)).length === 0) await this.finish(Buffer.alloc(0));
      throw error;
    }
  }
  async finish(expected: Buffer): Promise<void> {
    const pending = [];
    for (const entry of await this.entries()) {
      if (entry.stat.size > BigInt(expected.length)) throw new Error('索引准备目录包含外部变更，未清理。\n' + entry.path);
      const bytes = await readFile(entry.path);
      if (!bytes.equals(expected.subarray(0, bytes.length))) throw new Error('索引准备目录包含外部变更，未清理。\n' + entry.path);
      pending.push({ ...entry, bytes });
    }
    for (const entry of pending) {
      await this.directory(); const current = await metadata(entry.path);
      if (!current?.isFile() || current.isSymbolicLink() || current.ino !== entry.stat.ino || current.dev !== entry.stat.dev || !(await readFile(entry.path)).equals(entry.bytes)) {
        throw new Error('索引准备目录包含外部变更，未清理。\n' + entry.path);
      }
      await unlink(entry.path);
    }
    if (await this.directory()) await rmdir(this.path);
    const receipt = this.record.restoreIndexPreparation; this.record.restoreIndexPreparation = undefined;
    try { await this.save(); } catch (error) { this.record.restoreIndexPreparation = receipt; throw error; }
  }
  async discardGenerated(generated: { path: string; bytes: Buffer; ino: bigint; dev: bigint }): Promise<void> {
    if (!this.record.restoreIndexPreparation || !await this.directory()) return;
    const current = await metadata(generated.path);
    if (current?.isFile() && !current.isSymbolicLink() && current.ino === generated.ino && current.dev === generated.dev && (await readFile(generated.path)).equals(generated.bytes)) await unlink(generated.path);
  }
}
