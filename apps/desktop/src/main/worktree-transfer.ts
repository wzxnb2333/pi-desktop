import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Thread } from '../shared/contracts.ts';
import type { ManagedWorktree, TransferResult, WorktreeRecoveryIssue } from '../shared/worktrees.ts';
import { gitRun } from './git.ts';
import { safeProjectPath } from './policy.ts';
import { RoundSnapshots } from './round-snapshots.ts';
import { readTransferJournal, saveTransferJournal, transferDirectory, transferJournalSchema, type TransferAssociation, type TransferJournal } from './worktree-transfer-journal.ts';

interface FileVersion { hash: string; mode: string; }
/** File-only transfer with immutable source/recovery objects. Neither Git index is touched. */
export class WorktreeTransfer {
  private readonly active = new Set<string>();
  constructor(private readonly storage: string, private readonly snapshots: RoundSnapshots) {}
  private async version(path: string, hashLength: number, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const meta = await lstat(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
    if (!meta) return '';
    if (!meta.isFile() || meta.isSymbolicLink()) throw new Error('迁移目标包含非普通文件');
    const content = await readFile(path, { signal });
    return createHash(hashLength === 64 ? 'sha256' : 'sha1').update('blob ' + content.length + '\0').update(content).digest('hex');
  }
  private async replace(threadId: string, cwd: string, path: string, expected: FileVersion | undefined, next: FileVersion | undefined, signal?: AbortSignal, temporaryId: string = crypto.randomUUID()): Promise<void> {
    signal?.throwIfAborted();
    const absolute = await safeProjectPath(cwd, path);
    if (await this.version(absolute, expected?.hash.length ?? next?.hash.length ?? 40, signal) !== (expected?.hash ?? '')) throw new Error('迁移期间文件发生变化：' + path);
    signal?.throwIfAborted();
    if (!next) { await rm(absolute, { force: true }); return; }
    const bytes = await this.snapshots.blob(threadId, cwd, next.hash, signal);
    signal?.throwIfAborted();
    const actual = createHash(next.hash.length === 64 ? 'sha256' : 'sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    if (actual !== next.hash) throw new Error('迁移恢复对象校验失败：' + path);
    await mkdir(dirname(absolute), { recursive: true });
    const temporary = absolute + '.pi-transfer-' + temporaryId;
    let owned = false;
    try {
      const file = await open(temporary, 'wx'); owned = true;
      try { await file.writeFile(bytes, { signal }); } finally { await file.close(); }
      if (await this.version(absolute, expected?.hash.length ?? next.hash.length, signal) !== (expected?.hash ?? '')) throw new Error('迁移期间文件发生变化：' + path);
      signal?.throwIfAborted();
      await rename(temporary, absolute);
      if (process.platform !== 'win32') await chmod(absolute, next.mode === '100755' ? 0o755 : 0o644);
    } finally { if (owned) await rm(temporary, { force: true }); }
  }
  async transfer(threadId: string, source: string, target: string, expectedTargetTree: string, sourceBaseline: string | undefined, signal: AbortSignal, progress: (stage: string) => void,
    commit?: (result: TransferResult, targetTree: string) => Promise<void>, association?: TransferAssociation): Promise<TransferResult> {
    const id = crypto.randomUUID(); this.active.add(id);
    try { return await this.run(id, threadId, source, target, expectedTargetTree, sourceBaseline, signal, progress, commit, association); }
    finally { this.active.delete(id); }
  }
  private async run(id: string, threadId: string, source: string, target: string, expectedTargetTree: string, sourceBaseline: string | undefined, signal: AbortSignal, progress: (stage: string) => void,
    commit?: (result: TransferResult, targetTree: string) => Promise<void>, association?: TransferAssociation): Promise<TransferResult> {
    signal.throwIfAborted(); progress('捕获迁移与恢复快照');
    source = await realpath(source); target = await realpath(target);
    const sourceTree = await this.snapshots.captureTree(threadId, source, signal);
    const targetTree = await this.snapshots.captureTree(threadId, target, signal);
    const desired = await this.snapshots.manifest(threadId, source, sourceTree, signal);
    const original = await this.snapshots.manifest(threadId, target, targetTree, signal);
    const expected = await this.snapshots.manifest(threadId, target, expectedTargetTree, signal);
    const baseline = sourceBaseline ? await this.snapshots.manifest(threadId, source, sourceBaseline, signal) : undefined;
    const paths = [...new Set([...desired.keys(), ...(baseline ?? original).keys(), ...(!baseline ? expected.keys() : [])])].sort();
    const changes = paths.filter(path => baseline ? desired.get(path)?.hash !== baseline.get(path)?.hash : desired.get(path)?.hash !== original.get(path)?.hash);
    const conflicts = changes.filter(path => original.get(path)?.hash !== expected.get(path)?.hash && original.get(path)?.hash !== desired.get(path)?.hash);
    if (conflicts.length) throw new Error('迁移冲突，目标文件未修改：' + conflicts.slice(0, 20).join('、'));
    const commonDirectory = await realpath(resolve(source, (await gitRun(source, ['rev-parse', '--git-common-dir'], signal)).trim()));
    const record: TransferJournal = { version: 2, id, threadId, source, target, commonDirectory, sourceTree, targetTree, changes, attempted: [], state: 'prepared', error: '', createdAt: Date.now(), association };
    const save = () => saveTransferJournal(this.storage, record);
    await save();
    const written = record.attempted;
    let committed = false;
    try {
      signal.throwIfAborted();
      if (sourceTree !== await this.snapshots.captureTree(threadId, source, signal) || targetTree !== await this.snapshots.captureTree(threadId, target, signal)) throw new Error('迁移预检后目录发生变化，请重试');
      for (const relative of changes) {
        signal.throwIfAborted(); progress('迁移文件 ' + (written.length + 1) + '/' + changes.length);
        if (original.get(relative)?.hash === desired.get(relative)?.hash) continue;
        written.push(relative);
        await save(); // Persist ownership before touching this file, including its temporary path.
        await this.replace(threadId, target, relative, original.get(relative), desired.get(relative), signal, id + '-' + (written.length - 1));
      }
      signal.throwIfAborted();
      if (sourceTree !== await this.snapshots.captureTree(threadId, source, signal)) throw new Error('迁移期间来源目录发生变化，请重试');
      const result: TransferResult = { id, sourceTree, targetTree, changed: written.length };
      if (commit) {
        const finalTree = await this.snapshots.captureTree(threadId, target, signal);
        const actual = await this.snapshots.manifest(threadId, target, finalTree, signal), expectedFiles = new Map(original);
        for (const relative of written) {
          const next = desired.get(relative); if (next) expectedFiles.set(relative, next); else expectedFiles.delete(relative);
        }
        if (actual.size !== expectedFiles.size || [...expectedFiles].some(([relative, entry]) => actual.get(relative)?.hash !== entry.hash || actual.get(relative)?.mode !== entry.mode)) throw new Error('迁移期间目标目录发生变化，请检查保留的文件后重试');
        record.state = 'files-transferred'; record.finalTree = finalTree; await save();
        progress('保存迁移后的任务关联'); signal.throwIfAborted();
        await commit(result, finalTree); committed = true;
      }
      record.state = 'complete';
      try { await save(); }
      catch (error) {
        if (!committed) throw error;
        result.warning = '迁移已完成，恢复记录状态暂未更新。无需重复迁移。';
      }
      return result;
    } catch (error) {
      const failures: string[] = [];
      // Recovery must finish even though the forward operation was cancelled.
      for (let index = written.length - 1; index >= 0; index--) {
        const relative = written[index];
        try {
          const absolute = await safeProjectPath(target, relative);
          if (await this.version(absolute, original.get(relative)?.hash.length ?? desired.get(relative)?.hash.length ?? 40) === (original.get(relative)?.hash ?? '')) continue;
          await this.replace(threadId, target, relative, desired.get(relative), original.get(relative), undefined, id + '-rollback-' + index);
        }
        catch { failures.push(relative); }
      }
      record.state = failures.length ? 'recovery-required' : 'rolled-back'; record.error = String(error);
      try { await save(); }
      catch (saveError) { throw new Error('迁移恢复记录保存失败，原始快照已保留。\n' + id + '\n' + String(error) + '\n' + String(saveError)); }
      if (failures.length) throw new Error('迁移已停止，外部修改已保留；恢复记录 ' + id + '，需检查：' + failures.join('、'));
      throw error;
    }
  }
  async recover(worktrees: ManagedWorktree[], threads: Thread[], signal = new AbortController().signal, only?: string): Promise<{ issues: WorktreeRecoveryIssue[]; outcomes: { record: TransferJournal; state: 'complete' | 'rolled-back' }[] }> {
    const issues: WorktreeRecoveryIssue[] = [], outcomes: { record: TransferJournal; state: 'complete' | 'rolled-back' }[] = [];
    let directory: string, names: string[];
    try { directory = await transferDirectory(this.storage); names = await readdir(directory); }
    catch (error) { return { issues: [{ id: 'directory', message: '迁移恢复尚未完成，原文件已保留。', details: String(error) }], outcomes }; }
    for (const name of names.filter(name => name.endsWith('.json') && (!only || name === only + '.json'))) {
      signal.throwIfAborted(); const id = name.slice(0, -5); if (this.active.has(id)) continue;
      let worktreeId: string | undefined;
      try {
        const raw = await readTransferJournal(directory, name);
        if (raw && typeof raw === 'object' && 'version' in raw && raw.version === 2) {
          const record = transferJournalSchema.parse(raw);
          if (record.id !== id) throw new Error('迁移恢复记录标识不匹配，未修改文件。');
          worktreeId = record.association?.worktreeId;
          if (record.state === 'complete' || record.state === 'rolled-back') { outcomes.push({ record, state: record.state }); continue; }
          const managed = worktrees.find(item => item.id === worktreeId);
          if (!managed || !record.association || managed.threadId !== record.association.ownerThreadId || (managed.snapshotThreadId ?? managed.threadId) !== record.threadId) throw new Error('迁移恢复缺少可靠的任务关联，未修改文件。');
          if (managed.lastTransferId === id) {
            if (!record.finalTree) throw new Error('迁移提交证据不完整，未修改文件。');
            record.state = 'complete'; await saveTransferJournal(this.storage, record); outcomes.push({ record, state: 'complete' }); continue;
          }
          const owner = threads.find(thread => thread.id === managed.threadId && !thread.deletedAt);
          const same = (left: string, right: string) => process.platform === 'win32' ? resolve(left).toLowerCase() === resolve(right).toLowerCase() : resolve(left) === resolve(right);
          if (!owner || (owner.workspaceRevision ?? 0) !== record.association.sourceRevision || !same(owner.cwd, record.source) ||
            !(same(record.source, managed.localPath) && same(record.target, managed.path) || same(record.source, managed.path) && same(record.target, managed.localPath))) throw new Error('迁移恢复关联已变化，未修改文件。');
          for (const path of [record.source, record.target]) if (!same(await realpath(path), path)) throw new Error('迁移恢复目录指向已变化，未修改文件。');
          const managedRoot = await realpath(join(this.storage, 'worktrees')), checkout = await realpath(managed.checkoutPath), child = relative(managedRoot, checkout);
          if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child) || child.includes(sep)) throw new Error('只能恢复 Pi 管理的独立 Worktree');
          const nested = relative(checkout, await realpath(managed.path));
          if (nested === '..' || nested.startsWith('..' + sep) || isAbsolute(nested)) throw new Error('迁移恢复目录指向已变化，未修改文件。');
          for (const cwd of [record.source, record.target]) {
            const common = await realpath(resolve(cwd, (await gitRun(cwd, ['rev-parse', '--git-common-dir'], signal)).trim()));
            if (!same(common, record.commonDirectory)) throw new Error('迁移恢复仓库已变化，未修改文件。');
          }
          const desired = await this.snapshots.manifest(record.threadId, record.source, record.sourceTree, signal);
          const original = await this.snapshots.manifest(record.threadId, record.target, record.targetTree, signal);
          for (const path of record.attempted) {
            if ((!original.has(path) && !desired.has(path)) || original.get(path)?.hash === desired.get(path)?.hash) throw new Error('迁移恢复文件清单不匹配，未修改文件。');
            await safeProjectPath(record.target, path);
          }
          const conflicts: string[] = [];
          for (let index = record.attempted.length - 1; index >= 0; index--) {
            signal.throwIfAborted(); const path = record.attempted[index], absolute = await safeProjectPath(record.target, path);
            try {
              for (const suffix of [id + '-' + index, id + '-rollback-' + index]) {
                const temporary = absolute + '.pi-transfer-' + suffix;
                const meta = await lstat(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
                if (meta && (!meta.isFile() || meta.isSymbolicLink())) throw new Error('迁移临时文件类型已变化');
                if (meta) await rm(temporary);
              }
              if (await this.version(absolute, original.get(path)?.hash.length ?? desired.get(path)?.hash.length ?? 40) !== (original.get(path)?.hash ?? ''))
                await this.replace(record.threadId, record.target, path, desired.get(path), original.get(path), signal, id + '-rollback-' + index);
            } catch (error) { signal.throwIfAborted(); conflicts.push(path + ': ' + String(error)); }
          }
          record.state = conflicts.length ? 'recovery-required' : 'rolled-back'; record.error = conflicts.join('\n');
          await saveTransferJournal(this.storage, record);
          if (conflicts.length) throw new Error(conflicts.join('\n'));
          outcomes.push({ record, state: 'rolled-back' });
        } else if (!raw || typeof raw !== 'object' || !('state' in raw) || !['complete', 'rolled-back'].includes(String(raw.state))) {
          throw new Error('旧版迁移记录缺少逐文件恢复证据，请保留记录并人工核对。');
        }
      } catch (error) {
        signal.throwIfAborted(); issues.push({ id, worktreeId, message: '迁移恢复尚未完成，原文件已保留。', details: String(error) });
      }
    }
    return { issues, outcomes };
  }
}
