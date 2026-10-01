import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { ManagedWorktree } from '../shared/worktrees.ts';
import { gitRun } from './git.ts';
import { safeProjectPath } from './policy.ts';
import type { RoundSnapshots } from './round-snapshots.ts';

async function metadata(path: string) {
  return lstat(path, { bigint: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error;
  });
}
function matches(value: Awaited<ReturnType<typeof metadata>>, ino: string, dev: string): boolean {
  return !!value && value.isDirectory() && !value.isSymbolicLink() && String(value.ino) === ino && String(value.dev) === dev;
}

/** Detach the complete checkout before deleting files, so a partial purge never remains a runnable workspace. */
export class WorktreeReclamation {
  constructor(private readonly storage: string, private readonly snapshots: RoundSnapshots, private readonly save: () => Promise<void>) {}

  private async root(): Promise<string> {
    const path = join(this.storage, 'worktree-reclamation'); await mkdir(path, { recursive: true });
    const stat = await metadata(path);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('待回收目录不是普通目录，已保留现有数据。');
    return realpath(path);
  }
  private async validate(record: ManagedWorktree) {
    const pending = record.archiveRemoval;
    if (!pending) throw new Error('归档回收记录不存在。');
    const root = await this.root();
    if (resolve(dirname(pending.path)).toLowerCase() !== root.toLowerCase() || !basename(pending.path).startsWith(record.id + '-')) throw new Error('归档回收路径不匹配，未删除文件。');
    const stat = await metadata(pending.path);
    if (stat && !matches(stat, pending.ino, pending.dev)) throw new Error('待回收目录身份发生变化，未删除文件。');
    const common = await realpath(resolve(record.localPath, (await gitRun(record.localPath, ['rev-parse', '--git-common-dir'])).trim()));
    if (resolve(dirname(pending.gitDirectory)).toLowerCase() !== join(common, 'worktrees').toLowerCase()) throw new Error('归档 Git 目录不匹配，未删除文件。');
    const git = await metadata(pending.gitDirectory);
    if (git && !matches(git, pending.gitIno, pending.gitDev)) throw new Error('归档 Git 目录身份发生变化，未删除文件。');
    return { pending, stat, git };
  }
  async begin(record: ManagedWorktree, index: Buffer, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const stat = await metadata(record.checkoutPath), gitDirectory = await realpath(resolve(record.checkoutPath, (await gitRun(record.checkoutPath, ['rev-parse', '--git-dir'], signal)).trim()));
    const git = await metadata(gitDirectory), gitFile = await metadata(join(record.checkoutPath, '.git'));
    if (!stat?.isDirectory() || stat.isSymbolicLink() || !git?.isDirectory() || git.isSymbolicLink() || !gitFile?.isFile() || gitFile.isSymbolicLink()) throw new Error('归档回收路径不匹配，未删除文件。');
    record.archiveRemoval = { path: join(await this.root(), record.id + '-' + crypto.randomUUID()), phase: 'prepared', ino: String(stat.ino), dev: String(stat.dev),
      gitDirectory, gitIno: String(git.ino), gitDev: String(git.dev), gitFile: await readFile(join(record.checkoutPath, '.git'), 'utf8'), indexHash: createHash('sha256').update(index).digest('hex') };
    record.status = 'archived'; record.restoreInProgress = false;
    try { await this.save(); }
    catch (error) { record.archiveRemoval = undefined; record.status = 'ready'; throw error; }
  }
  async location(record: ManagedWorktree): Promise<string | undefined> {
    return record.archiveRemoval ? (await this.validate(record)).pending.path : undefined;
  }
  async move(record: ManagedWorktree, signal: AbortSignal): Promise<void> {
    const { pending, stat } = await this.validate(record);
    if (stat) throw new Error('待回收目录已被占用，未移动工作区。');
    try { await gitRun(record.localPath, ['worktree', 'move', '--', record.checkoutPath, pending.path], signal); }
    finally { await this.reconcile(record); }
  }
  async reconcile(record: ManagedWorktree): Promise<void> {
    const { pending, stat, git } = await this.validate(record);
    if (pending.phase === 'prepared') {
      const source = await metadata(record.checkoutPath);
      if (!stat && matches(source, pending.ino, pending.dev)) {
        record.archiveRemoval = undefined; record.status = 'ready';
      } else if (stat || !source) {
        pending.phase = 'moved'; record.status = 'archived'; record.archivedAt ??= Date.now();
      } else throw new Error('原工作区目录身份发生变化，已保留现有数据。');
    }
    if (!stat && !git) record.archiveRemoval = undefined;
    await this.save();
  }
  async repair(record: ManagedWorktree, signal: AbortSignal): Promise<void> {
    const { pending, stat, git } = await this.validate(record);
    if (!stat || !git) return;
    const backlink = resolve((await readFile(join(pending.gitDirectory, 'gitdir'), 'utf8')).trim()).toLowerCase();
    if (![join(pending.path, '.git'), join(record.checkoutPath, '.git')].some(path => resolve(path).toLowerCase() === backlink)) throw new Error('归档 Git 指向发生变化，未修改或删除文件。');
    const pointer = await metadata(join(pending.path, '.git'));
    if (!pointer) await writeFile(join(pending.path, '.git'), pending.gitFile, { flag: 'wx' });
    else if (!pointer.isFile() || pointer.isSymbolicLink() || await readFile(join(pending.path, '.git'), 'utf8') !== pending.gitFile) throw new Error('归档 Git 指向发生变化，未修改或删除文件。');
    await gitRun(record.localPath, ['worktree', 'repair', pending.path], signal);
  }
  async reclaim(record: ManagedWorktree, signal: AbortSignal, progress: (stage: string) => void): Promise<void> {
    const { pending, stat, git } = await this.validate(record);
    if (pending.phase !== 'moved') throw new Error('归档移动尚未完成，请重试归档。');
    signal.throwIfAborted();
    if (git) {
      await this.repair(record, signal);
      if (await metadata(join(pending.gitDirectory, 'index.lock'))) throw new Error('暂存区被其他 Git 操作锁定，请等待后重试恢复');
      const index = await metadata(join(pending.gitDirectory, 'index'));
      if (!index?.isFile() || index.isSymbolicLink() || createHash('sha256').update(await readFile(join(pending.gitDirectory, 'index'))).digest('hex') !== pending.indexHash ||
        (await gitRun(record.localPath, ['--git-dir', pending.gitDirectory, 'rev-parse', 'HEAD'], signal)).trim() !== record.archiveHead) throw new Error('待回收工作区的 Git 状态发生变化，已保留目录。');
    }
    const repository = (await gitRun(record.localPath, ['rev-parse', '--show-toplevel'], signal)).trim();
    const files = await this.snapshots.manifest(record.snapshotThreadId ?? record.threadId, repository, record.archiveTree!, signal);
    const paths: string[] = [], directories: string[] = [];
    const inspect = async (directory: string): Promise<void> => {
      for (const name of await readdir(directory)) {
        signal.throwIfAborted(); const path = join(directory, name), entry = await metadata(path);
        if (!entry) continue;
        if (entry.isSymbolicLink()) throw new Error('待回收目录包含外部变更，未继续删除。\n' + path);
        if (entry.isDirectory()) { await inspect(path); directories.push(path); }
        else if (entry.isFile()) paths.push(path);
        else throw new Error('待回收目录包含外部变更，未继续删除。\n' + path);
      }
    };
    if (stat) await inspect(pending.path);
    const verify = async (path: string): Promise<void> => {
      const key = path.slice(pending.path.length + 1).replaceAll('\\', '/');
      const expected = files.get(key), absolute = await safeProjectPath(pending.path, key), entry = await metadata(absolute);
      if ((key !== '.git' && !expected) || !entry?.isFile() || entry.isSymbolicLink() || entry.size > 50n * 1024n * 1024n) throw new Error('待回收目录包含外部变更，未继续删除。\n' + path);
      const bytes = await readFile(absolute);
      if (key === '.git' ? bytes.toString() !== pending.gitFile : !expected || createHash(expected.hash.length === 64 ? 'sha256' : 'sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') !== expected.hash) throw new Error('待回收目录包含外部变更，未继续删除。\n' + path);
    };
    for (const path of paths) await verify(path);
    progress('回收已备份的 Worktree');
    for (const path of paths.filter(path => path !== join(pending.path, '.git'))) {
      signal.throwIfAborted();
      if (!matches(await metadata(pending.path), pending.ino, pending.dev)) throw new Error('待回收目录身份发生变化，未删除文件。');
      await verify(path); await unlink(path);
    }
    for (const path of directories) { signal.throwIfAborted(); await rmdir(path); }
    signal.throwIfAborted(); await this.validate(record);
    if (stat && (await readdir(pending.path)).some(name => name !== '.git')) throw new Error('待回收目录包含外部变更，未继续删除。');
    if (git) {
      if (await metadata(join(pending.gitDirectory, 'index.lock')) || createHash('sha256').update(await readFile(join(pending.gitDirectory, 'index'))).digest('hex') !== pending.indexHash ||
        (await gitRun(record.localPath, ['--git-dir', pending.gitDirectory, 'rev-parse', 'HEAD'], signal)).trim() !== record.archiveHead) throw new Error('待回收工作区的 Git 状态发生变化，已保留目录。');
      await gitRun(record.localPath, ['worktree', 'remove', '--force', '--', pending.path], signal);
    }
    else if (stat) {
      const pointer = join(pending.path, '.git');
      if (await metadata(pointer)) { await verify(pointer); await unlink(pointer); }
      await rmdir(pending.path);
    }
    record.archiveRemoval = undefined; record.cleanupError = undefined; await this.save();
  }
}
