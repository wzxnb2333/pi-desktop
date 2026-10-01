import { access, copyFile, mkdir, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { GitStatus } from '../shared/contracts.ts';
import { safeProjectPath } from './policy.ts';
import { GitReads, gitProcess } from './git-process.ts';

export interface PreparedWorktree { path: string; checkoutPath: string; branch: string; baseCommit: string; }
export interface WorktreeCreationHooks { prepare(worktree: PreparedWorktree): Promise<void>; started(pid: number): void; completed?(): void; }

export async function readOnlyGitConfiguration(cwd: string, signal?: AbortSignal): Promise<string[]> {
  const names = await gitRun(cwd, ['config', '--null', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process|required)$'], signal).catch(error => {
    if ((error as { code?: number }).code === 1) return ''; throw error;
  });
  const filters = [...new Set(names.split('\0').filter(Boolean).map(name => name.replace(/\.[^.]+$/, '')))];
  return ['-c', 'core.fsmonitor=false', ...filters.flatMap(name => ['-c', name + '.clean=', '-c', name + '.smudge=', '-c', name + '.process=', '-c', name + '.required=false'])];
}
export async function gitRun(cwd: string, args: string[], signal?: AbortSignal, env?: NodeJS.ProcessEnv, input?: string): Promise<string> {
  // Background status/diff reads must not refresh the user's index and race an add.
  // Porcelain diff also has a separate auto-refresh setting. Required write locks remain enforced.
  return gitProcess(cwd, ['--no-optional-locks', '-c', 'diff.autoRefreshIndex=false', '-c', 'core.quotepath=false', ...args], { signal, env, input });
}
async function gitPatch(cwd: string, patch: string, check: boolean): Promise<void> {
  await gitRun(cwd, ['apply', '--binary', ...(check ? ['--check'] : []), '-'], undefined, undefined, patch);
}
export class GitService {
  readonly reads = new GitReads();
  readonly storage: string;
  constructor(storage: string) {
    this.storage = storage;
  }
  async status(cwd: string, signal?: AbortSignal): Promise<GitStatus> {
    try {
      if (!signal) return await this.reads.run(signal => this.status(cwd, signal));
      const [rawRead, prefixRead] = await Promise.allSettled([
        gitRun(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'], signal),
        gitRun(cwd, ['rev-parse', '--show-prefix'], signal).then(value => value.replace(/\r?\n$/, '')),
      ]);
      if (rawRead.status === 'rejected') throw rawRead.reason;
      if (prefixRead.status === 'rejected') throw prefixRead.reason;
      const raw = rawRead.value, prefix = prefixRead.value;
      const records = raw.split('\0');
      const files: GitStatus['files'] = [];
      for (let i = 0; i < records.length; i++) {
        if (!records[i]) continue;
        const status = records[i].slice(0, 2);
        const path = records[i].slice(3);
        if (path.startsWith(prefix)) files.push({ path: path.slice(prefix.length), status, staged: status[0] !== ' ' && status[0] !== '?' });
        if (status.includes('R') || status.includes('C')) i++;
      }
      const branch = (await gitRun(cwd, ['branch', '--show-current'], signal)).trim();
      const hasHead = await gitRun(cwd, ['rev-parse', '--verify', 'HEAD'], signal).then(() => true, () => false);
      const stats = hasHead ? { added: 0, removed: 0 } : undefined;
      if (stats) {
        const counts = (await gitRun(cwd, ['diff', '--numstat', '--find-renames', '-z', '--no-ext-diff', 'HEAD', '--', '.'], signal)).split('\0');
        for (let index = 0; index < counts.length; index++) {
          const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(counts[index]);
          if (!match) continue;
          if (match[1] !== '-' && match[2] !== '-') { stats.added += Number(match[1]); stats.removed += Number(match[2]); }
          if (!match[3]) index += 2;
        }
      }
      return { available: true, branch: branch || 'detached HEAD', files, stats };
    } catch (error) {
      return {
        available: false,
        branch: '',
        files: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  async untrackedDiff(cwd: string, path: string, configuration?: string[], signal?: AbortSignal): Promise<string> {
    await safeProjectPath(cwd, path);
    try {
      return await gitRun(cwd, [...(configuration ?? await readOnlyGitConfiguration(cwd, signal)), 'diff', '--no-index', '--no-ext-diff', '--no-textconv', '--binary', '--', '/dev/null', path], signal);
    } catch (error) {
      if ((error as { code?: number }).code === 1) return (error as { stdout: string }).stdout;
      throw error;
    }
  }
  async diff(cwd: string, path = '', signal?: AbortSignal): Promise<string> {
    if (!signal) return this.reads.run(signal => this.diff(cwd, path, signal));
    if (path) await safeProjectPath(cwd, path);
    const status = await this.status(cwd, signal);
    if (!status.available) throw new Error(status.error);
    const paths = path ? [path] : ['.'];
    const hasHead = await gitRun(cwd, ['rev-parse', '--verify', 'HEAD'], signal).then(
      () => true,
      () => false,
    );
    let diff = await gitRun(cwd, ['diff', '--relative', '--no-ext-diff', ...(hasHead ? ['HEAD'] : []), '--', ...paths], signal);
    if (!hasHead) diff += await gitRun(cwd, ['diff', '--relative', '--cached', '--no-ext-diff', '--', ...paths], signal);
    for (const file of status.files.filter((f) => f.status === '??' && (!path || f.path === path)))
      diff += await this.untrackedDiff(cwd, file.path, undefined, signal);
    return diff || '没有文本差异。';
  }
  async revert(cwd: string, path: string): Promise<string> {
    const absolute = await safeProjectPath(cwd, path);
    const directory = join(this.storage, 'recovery', `${Date.now()}-${crypto.randomUUID()}`);
    await mkdir(directory, { recursive: true });
    const backup = join(directory, basename(path));
    await copyFile(absolute, backup).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    const tracked = await gitRun(cwd, ['ls-files', '--error-unmatch', '--', path]).then(
      () => true,
      () => false,
    );
    if (tracked) await gitRun(cwd, ['restore', '--source=HEAD', '--staged', '--worktree', '--', path]);
    else await unlink(absolute);
    return backup;
  }
  async commit(cwd: string, paths: string[], message: string): Promise<string> {
    if ((await gitRun(cwd, ['diff', '--name-only', '--diff-filter=U'])).trim()) throw new Error('请先解决冲突');
    for (const path of paths) await safeProjectPath(cwd, path);
    await gitRun(cwd, ['add', '--', ...paths]);
    return gitRun(cwd, ['commit', '--only', '-m', message, '--', ...paths]);
  }
  async createWorktree(
    cwd: string,
    id: string,
    startPoint = 'HEAD',
    signal?: AbortSignal,
    hooks?: WorktreeCreationHooks,
  ): Promise<{ path: string; checkoutPath: string; branch: string; baseCommit: string }> {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id) || !startPoint || startPoint.startsWith('-') || /[\r\n\0]/.test(startPoint)) throw new Error('Worktree 起始引用无效');
    const baseCommit = (await gitRun(cwd, ['rev-parse', '--verify', '--end-of-options', startPoint + '^{commit}'], signal)).trim();
    const prefix = (await gitRun(cwd, ['rev-parse', '--show-prefix'], signal)).trim();
    if (prefix && (await gitRun(cwd, ['cat-file', '-t', baseCommit + ':' + prefix.replace(/\/$/, '')], signal)).trim() !== 'tree') throw new Error('起始引用中没有所选项目目录');
    const checkoutPath = join(this.storage, 'worktrees', id);
    const branch = `desktop/${id}`;
    await mkdir(join(this.storage, 'worktrees'), { recursive: true });
    if (await access(checkoutPath).then(() => true, () => false)) throw new Error('Worktree 创建目录已存在，未覆盖现有文件');
    const prepared = { path: resolve(checkoutPath, prefix), checkoutPath, branch, baseCommit };
    await hooks?.prepare(prepared); signal?.throwIfAborted();
    try { await gitProcess(cwd, ['--no-optional-locks', '-c', 'diff.autoRefreshIndex=false', '-c', 'core.quotepath=false', 'worktree', 'add', '-b', branch, checkoutPath, baseCommit], { signal, onSpawn: hooks?.started, onSuccess: hooks?.completed }); }
    catch (error) {
      if (await access(checkoutPath).then(() => true, () => false)) {
        try { await gitRun(cwd, ['worktree', 'remove', '--', checkoutPath]); }
        catch { throw new Error('Worktree 创建中断，现有文件已保留：' + checkoutPath + '\n' + String(error)); }
      }
      throw error;
    }
    return prepared;
  }
  async applyWorktree(target: string, worktree: string, baseCommit: string): Promise<void> {
    let patch = await gitRun(worktree, ['diff', '--binary', '--no-ext-diff', baseCommit, '--']);
    for (const file of (await this.status(worktree)).files.filter((f) => f.status === '??'))
      patch += await this.untrackedDiff(worktree, file.path);
    if (!patch.trim()) throw new Error('Worktree 没有可应用的改动');
    await gitPatch(target, patch, true);
    await gitPatch(target, patch, false);
  }
}
