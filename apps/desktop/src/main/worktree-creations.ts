import { renameSync, writeFileSync } from 'node:fs';
import { access, lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { ManagedWorktree, WorktreeCreationIssue } from '../shared/worktrees.ts';
import { GitService, gitRun } from './git.ts';

const receiptSchema = z.object({
  version: z.literal(1), id: z.uuid(), threadId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/), projectId: z.string(), directoryId: z.string(),
  localPath: z.string(), path: z.string(), checkoutPath: z.string(), branch: z.string(), baseCommit: z.string().regex(/^[0-9a-f]{40,64}$/),
  repository: z.string(), createdAt: z.number(), phase: z.enum(['prepared', 'git-complete', 'checkout']), pid: z.number().int().positive().optional(),
  ino: z.string().optional(), dev: z.string().optional(),
}).strict();
type Receipt = z.infer<typeof receiptSchema>;
const exists = async (path: string) => access(path).then(() => true, error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; });
const key = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
function processRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}

/** Creation intent survives Git/app interruption; recovery never resets or removes retained working files. */
export class WorktreeCreations {
  private readonly active = new Map<string, string>();
  constructor(private readonly storage: string, private readonly git: GitService) {}
  private file(id: string): string {
    if (!z.uuid().safeParse(id).success) throw new Error('Worktree 创建恢复记录无效');
    return join(this.storage, 'worktree-creations', id + '.json');
  }
  private async save(record: Receipt): Promise<void> {
    const path = this.file(record.id); await mkdir(join(this.storage, 'worktree-creations'), { recursive: true });
    await writeFile(path + '.tmp', JSON.stringify(record), 'utf8'); await rename(path + '.tmp', path);
  }
  async read(id: string): Promise<Receipt> {
    const record = receiptSchema.parse(JSON.parse(await readFile(this.file(id), 'utf8')));
    if (record.id !== id || key(record.checkoutPath) !== key(join(this.storage, 'worktrees', id)) || record.branch !== 'desktop/' + id) throw new Error('Worktree 创建恢复记录无效');
    const rel = relative(record.checkoutPath, record.path);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Worktree 创建恢复记录无效');
    return record;
  }
  async create(threadId: string, projectId: string, directory: { id: string; path: string }, startPoint: string, signal?: AbortSignal) {
    const id = crypto.randomUUID(); let record: Receipt | undefined; this.active.set(id, threadId);
    try {
      const result = await this.git.createWorktree(directory.path, id, startPoint, signal, {
        prepare: async worktree => {
          const repository = await realpath(resolve(directory.path, (await gitRun(directory.path, ['rev-parse', '--git-common-dir'], signal)).trim()));
          record = { version: 1, id, threadId, projectId, directoryId: directory.id, localPath: directory.path, ...worktree, repository, createdAt: Date.now(), phase: 'prepared' };
          await this.save(record);
        },
        started: pid => {
          record!.pid = pid; const path = this.file(id);
          // Persist the child identity in the spawn turn, before the caller can advance or exit.
          writeFileSync(path + '.tmp', JSON.stringify(record), 'utf8'); renameSync(path + '.tmp', path);
        },
        completed: () => {
          record!.phase = 'git-complete'; record!.pid = undefined; const path = this.file(id);
          // git-process calls this synchronously after Git and its hooks close, before the async caller resumes.
          writeFileSync(path + '.tmp', JSON.stringify(record), 'utf8'); renameSync(path + '.tmp', path);
        },
      });
      const identity = await lstat(result.checkoutPath, { bigint: true });
      record!.phase = 'checkout'; record!.pid = undefined; record!.ino = identity.ino.toString(); record!.dev = identity.dev.toString(); await this.save(record!);
      return { ...result, id };
    } catch (error) {
      this.active.delete(id);
      if (record) try { await this.discardEmpty(record); } catch { /* Retain the durable receipt for explicit recovery. */ }
      throw error;
    }
  }
  release(id: string): void { this.active.delete(id); }
  releaseThread(threadId: string): void { for (const [id, owner] of this.active) if (owner === threadId) this.active.delete(id); }
  async finish(id: string): Promise<void> {
    try {
      for (const path of [this.file(id) + '.tmp', this.file(id)])
        await unlink(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    }
    finally { this.active.delete(id); }
  }
  private async repository(record: Receipt, signal?: AbortSignal): Promise<void> {
    const common = await realpath(resolve(record.localPath, (await gitRun(record.localPath, ['rev-parse', '--git-common-dir'], signal)).trim()));
    if (key(common) !== key(record.repository)) throw new Error('恢复目录不属于原仓库，未修改文件');
  }
  private async discardEmpty(record: Receipt): Promise<boolean> {
    if (await exists(record.checkoutPath)) return false;
    await this.repository(record);
    const worktrees = await gitRun(record.localPath, ['worktree', 'list', '--porcelain']);
    if (worktrees.split(/\r?\n/).includes('branch refs/heads/' + record.branch)) return false;
    const head = await gitRun(record.localPath, ['rev-parse', '--verify', 'refs/heads/' + record.branch]).then(value => value.trim(), error => { if ((error as { code?: number }).code === 128) return ''; throw error; });
    if (head && head !== record.baseCommit) throw new Error('恢复目录的分支已变化，请恢复原分支后重试关联聊天');
    if (head) await gitRun(record.localPath, ['update-ref', '-d', 'refs/heads/' + record.branch, record.baseCommit]);
    await this.finish(record.id); return true;
  }
  private async verifyCheckout(record: Receipt, signal?: AbortSignal, requireRegistration = false): Promise<{ ino: string; dev: string }> {
    await this.repository(record, signal);
    const identity = await lstat(record.checkoutPath, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink() || key(await realpath(record.checkoutPath)) !== key(record.checkoutPath) || record.ino && (identity.ino.toString() !== record.ino || identity.dev.toString() !== record.dev))
      throw new Error('原工作区目录身份发生变化，已保留现有数据。');
    if (requireRegistration) {
      const listed = await gitRun(record.localPath, ['worktree', 'list', '--porcelain'], signal);
      const registered = listed.split(/\r?\n\r?\n/).some(block => {
        const path = block.split(/\r?\n/).find(line => line.startsWith('worktree '))?.slice('worktree '.length);
        const branch = block.split(/\r?\n/).find(line => line.startsWith('branch '))?.slice('branch '.length);
        return !!path && key(path) === key(record.checkoutPath) && branch === 'refs/heads/' + record.branch;
      });
      if (!registered) throw new Error('Git 尚未登记完整 Worktree');
    }
    const common = await realpath(resolve(record.checkoutPath, (await gitRun(record.checkoutPath, ['rev-parse', '--git-common-dir'], signal)).trim()));
    if (key(common) !== key(record.repository)) throw new Error('恢复目录不属于原仓库，未修改文件');
    const cwd = relative(await realpath(record.checkoutPath), await realpath(record.path));
    if (isAbsolute(cwd) || cwd === '..' || cwd.startsWith('..' + sep)) throw new Error('Worktree 执行目录不属于受管目录');
    if ((await gitRun(record.checkoutPath, ['branch', '--show-current'], signal)).trim() !== record.branch) throw new Error('恢复目录的分支已变化，请恢复原分支后重试关联聊天');
    const gitDir = resolve(record.checkoutPath, (await gitRun(record.checkoutPath, ['rev-parse', '--git-dir'], signal)).trim());
    if (await exists(join(gitDir, 'index.lock')) || await exists(join(gitDir, 'locked'))) throw new Error('Worktree 创建仍持有 Git 锁，请检查后重试');
    if (!(await exists(join(gitDir, 'index')))) throw new Error('Worktree 创建未完成，暂存区缺失，原目录已保留');
    await gitRun(record.checkoutPath, ['merge-base', '--is-ancestor', record.baseCommit, 'HEAD'], signal);
    return { ino: identity.ino.toString(), dev: identity.dev.toString() };
  }
  async inspect(id: string, signal?: AbortSignal): Promise<Receipt> {
    signal?.throwIfAborted(); const record = await this.read(id);
    if (this.active.has(id)) throw new Error('Worktree 创建进程仍在运行，请结束后重试');
    if (record.phase === 'prepared') {
      if (record.pid && processRunning(record.pid)) throw new Error('Worktree 创建进程仍在运行，请结束后重试');
      // A dead launcher alone is not proof that Git hooks have stopped.
      throw new Error('Worktree 创建阶段无法确认，原目录已保留');
    }
    if (record.phase === 'git-complete') {
      try {
        const identity = await this.verifyCheckout(record, signal, true);
        const completed = { ...record, phase: 'checkout' as const, pid: undefined, ino: identity.ino, dev: identity.dev };
        await this.save(completed); return completed;
      } catch {
        throw new Error('Worktree 创建阶段无法确认，原目录已保留');
      }
    }
    await this.verifyCheckout(record, signal);
    return record;
  }
  async collect(worktrees: ManagedWorktree[]): Promise<WorktreeCreationIssue[]> {
    const dir = join(this.storage, 'worktree-creations'), issues: WorktreeCreationIssue[] = [];
    const files = await readdir(dir).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; });
    const ids = new Set(files.filter(file => file.endsWith('.json') || file.endsWith('.json.tmp')).map(file => file.replace(/\.json(?:\.tmp)?$/, '')));
    for (const id of ids) {
      if (this.active.has(id)) continue;
      let record: Receipt | undefined;
      try {
        record = await this.read(id);
        if (worktrees.some(item => item.id === record!.id && item.projectId === record!.projectId && key(item.checkoutPath) === key(record!.checkoutPath))) { await this.finish(id); continue; }
        // A completed checkout already removed elsewhere can release its unused branch.
        if (record.phase === 'checkout' && await this.discardEmpty(record)) continue;
        await this.inspect(id);
        issues.push({ id, projectId: record.projectId, directoryId: record.directoryId, path: record.path, branch: record.branch, canOpen: true,
          message: 'Worktree 创建已中断，保留的文件可以重新打开。' });
      } catch (error) {
        issues.push({ id, projectId: record?.projectId ?? '', directoryId: record?.directoryId ?? '', path: record?.path ?? dir, branch: record?.branch ?? '', canOpen: false, message: record ? error instanceof Error ? error.message : String(error) : 'Worktree 创建恢复记录无法读取，原数据已保留。' });
      }
    }
    return issues;
  }
}
