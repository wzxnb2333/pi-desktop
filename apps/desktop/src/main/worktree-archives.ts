import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ManagedWorktree } from '../shared/worktrees.ts';
import { gitRun } from './git.ts';
import { safeProjectPath } from './policy.ts';
import { RoundSnapshots } from './round-snapshots.ts';
import { prepareRestoreIndex } from './worktree-restore-index.ts';
import { WorktreeReclamation } from './worktree-reclamation.ts';
import { WorktreeRestoreFiles } from './worktree-restore-files.ts';

export async function directoryBytes(path: string, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  const metadata = await lstat(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
  if (!metadata) return 0;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return metadata.size;
  let bytes = 0;
  for (const entry of await readdir(path)) bytes += await directoryBytes(join(path, entry), signal);
  return bytes;
}

/** Archives keep commit/index references plus raw working files in the owned snapshot store. */
export class WorktreeArchives {
  private readonly reclamation: WorktreeReclamation;
  constructor(private readonly storage: string, private readonly snapshots: RoundSnapshots, private readonly save: () => Promise<void>) {
    this.reclamation = new WorktreeReclamation(storage, snapshots, save);
  }
  private async check(record: ManagedWorktree, exists: boolean, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const root = await realpath(join(this.storage, 'worktrees'));
    const target = exists ? await realpath(record.checkoutPath) : resolve(record.checkoutPath);
    const rel = relative(root, target);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || rel.includes(sep)) throw new Error('只能归档 Pi 管理的独立 Worktree');
    const cwd = relative(target, resolve(record.path));
    if (cwd === '..' || cwd.startsWith('..' + sep) || isAbsolute(cwd)) throw new Error('Worktree 执行目录不属于受管目录');
    if (exists) {
      const common = async (path: string) => realpath(resolve(path, (await gitRun(path, ['rev-parse', '--git-common-dir'], signal)).trim()));
      if ((await common(target)).toLowerCase() !== (await common(record.localPath)).toLowerCase()) throw new Error('恢复目录不属于原仓库，未修改文件');
    }
  }
  private async noIgnoredFiles(path: string, signal: AbortSignal): Promise<void> {
    const ignored = await gitRun(path, ['-c', 'core.fsmonitor=false', 'ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', '.'], signal);
    if (ignored) throw new Error('Worktree 含有未备份的忽略文件，请先通过项目清理命令处理，再归档');
  }
  async adopt(input: Pick<ManagedWorktree, 'threadId' | 'projectId' | 'directoryId' | 'path' | 'localPath' | 'baseCommit'>, signal: AbortSignal): Promise<ManagedWorktree> {
    if (!/^[0-9a-f]{40,64}$/.test(input.baseCommit)) throw new Error('此任务缺少可靠的迁移基线，请保留现有工作区');
    const checkoutPath = (await gitRun(input.path, ['rev-parse', '--show-toplevel'], signal)).trim();
    const branch = (await gitRun(input.path, ['branch', '--show-current'], signal)).trim();
    if (!branch) throw new Error('此任务缺少可靠的迁移基线，请保留现有工作区');
    await gitRun(input.path, ['merge-base', '--is-ancestor', input.baseCommit, 'HEAD'], signal);
    const baseline = (await gitRun(input.path, ['rev-parse', input.baseCommit + '^{tree}'], signal)).trim();
    const record: ManagedWorktree = { ...input, id: crypto.randomUUID(), checkoutPath, branch, localBaseline: baseline, worktreeBaseline: baseline,
      status: 'ready', createdAt: Date.now(), lastUsedAt: Date.now() };
    await this.check(record, true, signal); return record;
  }
  async archive(record: ManagedWorktree, signal: AbortSignal, progress: (stage: string) => void, preflight: () => void = () => {}): Promise<void> {
    if (record.archiveRemoval || record.restoreFiles) await this.cleanup(record, signal, progress, preflight);
    if (record.status === 'archived') return;
    preflight();
    await this.check(record, true, signal); await this.noIgnoredFiles(record.checkoutPath, signal);
    if ((await gitRun(record.checkoutPath, ['ls-files', '-u'], signal)).trim()) throw new Error('请先解决 Worktree 冲突再归档');
    progress('保存 Worktree 恢复证据');
    const owner = record.snapshotThreadId ?? record.threadId;
    const head = (await gitRun(record.checkoutPath, ['rev-parse', 'HEAD'], signal)).trim();
    const tree = await this.snapshots.captureTree(owner, record.checkoutPath, signal);
    await this.snapshots.manifest(owner, record.checkoutPath, tree, signal);
    const indexPath = resolve(record.checkoutPath, (await gitRun(record.checkoutPath, ['rev-parse', '--git-path', 'index'], signal)).trim());
    const originalIndex = await readFile(indexPath);
    const directory = join(this.storage, 'worktree-indexes'); await mkdir(directory, { recursive: true });
    const temporary = join(directory, record.id + '-' + crypto.randomUUID());
    let staged: string;
    try {
      await writeFile(temporary, originalIndex, { flag: 'wx' });
      staged = (await gitRun(record.checkoutPath, ['-c', 'core.fsmonitor=false', 'write-tree'], signal, { ...process.env, GIT_INDEX_FILE: temporary })).trim();
    } finally { await rm(temporary, { force: true }); await rm(temporary + '.lock', { force: true }); }
    // Refs under our own namespace protect commits and staged blobs from ordinary Git GC.
    await gitRun(record.checkoutPath, ['update-ref', 'refs/pi/archives/' + record.id + '/head', head], signal);
    await gitRun(record.checkoutPath, ['update-ref', 'refs/pi/archives/' + record.id + '/index', staged], signal);
    await gitRun(record.checkoutPath, ['update-ref', 'refs/pi/archives/' + record.id + '/base', record.baseCommit], signal);
    record.archiveTree = tree; record.archiveHead = head; record.archiveIndex = staged; record.snapshotThreadId = owner;
    await this.save(); signal.throwIfAborted();
    if (head !== (await gitRun(record.checkoutPath, ['rev-parse', 'HEAD'], signal)).trim() ||
      tree !== await this.snapshots.captureTree(owner, record.checkoutPath, signal) || !(await readFile(indexPath)).equals(originalIndex)) throw new Error('归档预检后 Worktree 发生变化，原目录已保留');
    await this.noIgnoredFiles(record.checkoutPath, signal); await this.check(record, true, signal);
    preflight(); signal.throwIfAborted();
    await this.reclamation.begin(record, originalIndex, signal);
    await this.reclamation.move(record, signal);
    await this.reclamation.reclaim(record, signal, progress);
  }
  async cleanup(record: ManagedWorktree, signal: AbortSignal, progress: (stage: string) => void, preflight: () => void = () => {}): Promise<void> {
    if (record.status === 'ready' && record.restoreFiles) {
      preflight(); progress('清理恢复临时文件'); await this.cleanupRestoredFiles(record, signal);
    }
    if (!record.archiveRemoval) return;
    preflight(); await this.reclamation.reconcile(record);
    if (record.archiveRemoval) await this.reclamation.reclaim(record, signal, progress);
  }
  async cleanupBytes(record: ManagedWorktree, signal: AbortSignal): Promise<number> {
    const path = await this.reclamation.location(record);
    return path ? directoryBytes(path, signal) : 0;
  }
  private async cleanupRestoredFiles(record: ManagedWorktree, signal: AbortSignal): Promise<void> {
    const repository = (await gitRun(record.localPath, ['rev-parse', '--show-toplevel'], signal)).trim();
    const files = await this.snapshots.manifest(record.snapshotThreadId ?? record.threadId, repository, record.archiveTree!, signal);
    await new WorktreeRestoreFiles(this.storage, record, this.snapshots, files, this.save).finish(signal);
    record.cleanupError = record.cleanupError?.startsWith('已恢复 Worktree，但暂存区恢复凭据清理失败。')
      ? record.cleanupError.split('\n已恢复 Worktree，但恢复文件临时数据清理失败。')[0] : undefined;
    await this.save();
  }
  async restore(record: ManagedWorktree, signal: AbortSignal, progress: (stage: string) => void): Promise<void> {
    if (record.archiveRemoval) {
      await this.reclamation.reconcile(record);
      if (record.archiveRemoval) await this.reclamation.repair(record, signal);
    }
    if (record.status !== 'archived') {
      // The checkout is already restored: validate its real execution folder without replaying files.
      await this.check({ ...record, path: await realpath(record.path) }, true, signal);
      if ((await gitRun(record.checkoutPath, ['branch', '--show-current'], signal)).trim() !== record.branch) throw new Error('恢复目录的分支已变化，请恢复原分支后重试关联聊天');
      return;
    }
    if (!record.archiveTree || !record.archiveHead || !record.archiveIndex) throw new Error('归档恢复证据不完整，已保留现有数据');
    await this.check(record, false, signal);
    const owner = record.snapshotThreadId ?? record.threadId;
    // archiveTree always covers the checkout root, even for a nested project.
    const repository = (await gitRun(record.localPath, ['rev-parse', '--show-toplevel'], signal)).trim();
    const allFiles = await this.snapshots.manifest(owner, repository, record.archiveTree, signal);
    const exists = await access(record.checkoutPath).then(() => true, () => false);
    if (exists && !record.restoreInProgress) throw new Error('恢复目录已被占用，未覆盖现有文件');
    if (!exists) {
      record.restoreInProgress = true; await this.save(); progress('重新创建归档 Worktree');
      const branchHead = await gitRun(record.localPath, ['rev-parse', '--verify', 'refs/heads/' + record.branch], signal).then(value => value.trim(), () => '');
      const branchUsed = (await gitRun(record.localPath, ['worktree', 'list', '--porcelain'], signal)).split(/\r?\n/).includes('branch refs/heads/' + record.branch);
      if (branchHead === record.archiveHead && !branchUsed) await gitRun(record.localPath, ['worktree', 'add', '--no-checkout', record.checkoutPath, record.branch], signal);
      else {
        const branch = 'desktop/restore-' + crypto.randomUUID();
        await gitRun(record.localPath, ['worktree', 'add', '--no-checkout', '-b', branch, record.checkoutPath, record.archiveHead], signal); record.branch = branch;
        await this.save();
      }
    }
    await this.check(record, true, signal);
    await this.noIgnoredFiles(record.checkoutPath, signal);
    if ((await gitRun(record.checkoutPath, ['rev-parse', 'HEAD'], signal)).trim() !== record.archiveHead) throw new Error('恢复目录的 Git 版本不匹配，未覆盖现有文件');
    const actualPaths = (await gitRun(record.checkoutPath, ['ls-files', '--others', '--exclude-standard', '-z'], signal)).split('\0').filter(Boolean);
    if (actualPaths.some(path => !allFiles.has(path))) throw new Error('恢复目录出现未登记文件，请检查后重试');
    const restoredIndex = await prepareRestoreIndex(record.checkoutPath, record, signal, this.save);
    const restoredFiles = new WorktreeRestoreFiles(this.storage, record, this.snapshots, allFiles, this.save);
    await restoredFiles.prepare(signal);
    let index = 0;
    for (const [path, entry] of allFiles) {
      signal.throwIfAborted(); progress('恢复文件 ' + (++index) + '/' + allFiles.size);
      const absolute = await safeProjectPath(record.checkoutPath, path);
      const bytes = await this.snapshots.blob(owner, record.localPath, entry.hash, signal);
      if (createHash(entry.hash.length === 64 ? 'sha256' : 'sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') !== entry.hash) throw new Error('归档对象校验失败，恢复已停止');
      const metadata = await lstat(absolute).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
      if (metadata && (!metadata.isFile() || metadata.isSymbolicLink())) throw new Error('恢复目录包含非普通文件：' + path);
      const existing = metadata ? await readFile(absolute) : null;
      if (existing && !existing.equals(bytes)) throw new Error('恢复目录文件被外部修改，未覆盖：' + path);
      if (!existing) {
        await restoredFiles.publish(path, entry.hash, bytes, signal);
      }
    }
    progress('恢复暂存区');
    await restoredIndex.publish(async () => {
      if ((await gitRun(record.checkoutPath, ['rev-parse', 'HEAD'], signal)).trim() !== record.archiveHead) throw new Error('恢复目录的 Git 版本不匹配，未覆盖现有文件');
      if (record.archiveTree !== await this.snapshots.captureTree(owner, record.checkoutPath, signal, restoredIndex.trackingIndex)) throw new Error('恢复内容校验不一致，请检查保留的恢复目录');
      if ((await gitRun(record.checkoutPath, ['rev-parse', 'HEAD'], signal)).trim() !== record.archiveHead) throw new Error('恢复目录的 Git 版本不匹配，未覆盖现有文件');
    });
    const previous = { status: record.status, restoreInProgress: record.restoreInProgress, lastUsedAt: record.lastUsedAt, cleanupError: record.cleanupError };
    record.status = 'ready'; record.restoreInProgress = false; record.lastUsedAt = Date.now(); record.cleanupError = undefined;
    try { await this.save(); } catch (error) { Object.assign(record, previous); throw error; }
    const cleanupErrors: string[] = [];
    try { await restoredIndex.finish(); }
    catch (error) { cleanupErrors.push('已恢复 Worktree，但暂存区恢复凭据清理失败。\n' + (error instanceof Error ? error.message : String(error))); }
    try { await restoredFiles.finish(new AbortController().signal); }
    catch (error) { cleanupErrors.push('已恢复 Worktree，但恢复文件临时数据清理失败。\n' + (error instanceof Error ? error.message : String(error))); }
    if (cleanupErrors.length) { record.cleanupError = cleanupErrors.join('\n'); await this.save(); }
  }
  async recover(records: ManagedWorktree[]): Promise<void> {
    for (const record of records) if (record.status === 'ready' && record.restoreFiles && record.archiveTree) {
      try {
        await this.cleanupRestoredFiles(record, new AbortController().signal);
      } catch (error) { record.cleanupError = error instanceof Error ? error.message : String(error); }
    }
    for (const record of records) if (record.archiveRemoval) {
      try { await this.reclamation.reconcile(record); }
      catch (error) { record.cleanupError = error instanceof Error ? error.message : String(error); }
    }
    for (const record of records) if (record.status === 'ready' && record.archiveTree && record.archiveHead && record.archiveIndex && !(await access(record.checkoutPath).then(() => true, () => false))) {
      record.status = 'archived'; record.archivedAt ??= Date.now();
    }
    await this.save();
  }
}
