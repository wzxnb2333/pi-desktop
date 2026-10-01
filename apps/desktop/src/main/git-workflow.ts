import { access, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { DesktopRequest, GitInspection } from '../shared/contracts.ts';
import type { GitCommitResult } from '../shared/git-results.ts';
import { GitService, gitRun } from './git.ts';
import { commitSelected } from './git-commit.ts';
import { cancelGitProcesses, ownGitController } from './git-process.ts';
import { safeProjectPath } from './policy.ts';

type Action = Extract<DesktopRequest, { op: 'git.action' }>;
export class GitWorkflow {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly cancelled = new Set<string>();
  private readonly pending = new Set<Promise<unknown>>();
  private closing = false;
  constructor(private readonly git: GitService) {}
  async repositoryKey(cwd: string): Promise<string> {
    const directory = await gitRun(cwd, ['rev-parse', '--git-common-dir']).then(value => value.trim(), () => '.');
    return (await realpath(resolve(cwd, directory))).toLocaleLowerCase();
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    const remove = () => { this.pending.delete(operation); };
    void operation.then(remove, remove);
    return operation;
  }
  exclusive<T>(cwd: string, run: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('应用正在关闭，请重启后再执行操作'));
    return this.track(this.queued(cwd, run));
  }
  private async queued<T>(cwd: string, run: () => Promise<T>): Promise<T> {
    const key = await this.repositoryKey(cwd);
    const previous = this.locks.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(() => { if (this.closing) throw new Error('应用正在关闭，请重启后再执行操作'); return run(); });
    this.locks.set(key, operation);
    try { return await operation; } finally { if (this.locks.get(key) === operation) this.locks.delete(key); }
  }
  async inspect(cwd: string, signal?: AbortSignal): Promise<GitInspection> {
    if (!signal) return this.git.reads.run(signal => this.inspect(cwd, signal));
    const branches = (await gitRun(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], signal)).trim().split('\n').filter(Boolean);
    const remotes = (await gitRun(cwd, ['remote'], signal)).trim().split('\n').filter(Boolean);
    const remoteBranches: GitInspection['remoteBranches'] = [];
    const remoteRefs = await gitRun(cwd, ['for-each-ref', '--format=%(refname)%00%(symref)', 'refs/remotes/'], signal);
    for (const line of remoteRefs.trim().split('\n').filter(Boolean)) {
      const [fullRef, symbolic] = line.split('\0');
      if (symbolic) continue;
      const ref = fullRef.slice('refs/remotes/'.length);
      const remote = remotes.filter(name => ref.startsWith(name + '/')).sort((a, b) => b.length - a.length)[0];
      if (remote) remoteBranches.push({ ref, remote, name: ref.slice(remote.length + 1) });
    }
    const upstream = await gitRun(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], signal).then(value => value.trim(), () => '');
    const directory = resolve(cwd, (await gitRun(cwd, ['rev-parse', '--git-dir'], signal)).trim());
    const rebase = await access(join(directory, 'rebase-merge')).then(() => true, () => access(join(directory, 'rebase-apply')).then(() => true, () => false));
    const merge = await access(join(directory, 'MERGE_HEAD')).then(() => true, () => false);
    const history = await gitRun(cwd, ['log', '-50', '--format=%H%x00%s%x00%an%x00%aI'], signal).catch(() => '');
    const commits = history.trim().split('\n').filter(Boolean).map(line => { const [id, subject, author, date] = line.split('\0'); return { id, subject, author, date }; });
    const worktrees: GitInspection['worktrees'] = [];
    for (const record of (await gitRun(cwd, ['worktree', 'list', '--porcelain', '-z'], signal)).split('\0\0')) {
      const fields = record.split('\0');
      const path = fields.find(field => field.startsWith('worktree '))?.slice(9);
      if (path) worktrees.push({ path, branch: fields.find(field => field.startsWith('branch '))?.slice(7).replace('refs/heads/', '') ?? '', commit: fields.find(field => field.startsWith('HEAD '))?.slice(5) ?? '' });
    }
    return { branches, remoteBranches, remotes, upstream, operation: rebase ? 'rebase' : merge ? 'merge' : '', commits, worktrees };
  }
  async conflict(cwd: string, path: string): Promise<{ base: string; ours: string; theirs: string }> {
    await safeProjectPath(cwd, path);
    const read = (stage: number) => gitRun(cwd, ['show', ':' + stage + ':' + path.replace(/\\/g, '/')]).catch(() => '');
    const [base, ours, theirs] = await Promise.all([read(1), read(2), read(3)]);
    return { base, ours, theirs };
  }
  async cancel(cwd: string, requestId: string): Promise<void> {
    const key = cwd + '/' + requestId;
    const controller = this.controllers.get(key);
    if (controller) { controller.abort(); await cancelGitProcesses(controller.signal); }
    else { if (this.cancelled.size >= 100) this.cancelled.delete(this.cancelled.values().next().value!); this.cancelled.add(key); }
  }
  action(cwd: string, input: Action): Promise<string | GitCommitResult> {
    if (this.closing) return Promise.reject(new Error('应用正在关闭，请重启后再执行操作'));
    const controller = new AbortController();
    const key = cwd + '/' + (input.requestId ?? crypto.randomUUID());
    if (this.controllers.has(key)) return Promise.reject(new Error('此操作正在运行'));
    this.controllers.set(key, controller);
    const release = ownGitController(controller);
    if (this.cancelled.delete(key)) controller.abort();
    return this.track(this.execute(cwd, input, controller).finally(() => { this.controllers.delete(key); release(); }));
  }
  private async execute(cwd: string, input: Action, controller: AbortController): Promise<string | GitCommitResult> {
    const run = (args: string[]) => gitRun(cwd, args, controller.signal);
    const paths = input.paths;
    try {
      for (const path of paths) await safeProjectPath(cwd, path);
      if (['stage', 'unstage', 'resolved'].includes(input.action) && !paths.length) throw new Error('请选择文件');
      if (input.action === 'stage' || input.action === 'resolved') return await run(['add', '--', ...paths]);
      if (input.action === 'unstage') {
        const head = await run(['rev-parse', '--verify', 'HEAD']).then(() => true, () => false);
        return await run(head ? ['reset', '-q', 'HEAD', '--', ...paths] : ['rm', '--cached', '--', ...paths]);
      }
      if (input.action === 'stageHunk' || input.action === 'unstageHunk') {
        if (!input.patch?.startsWith('diff --git ')) throw new Error('缺少有效差异块');
        const args = ['apply', '--cached', ...(input.action === 'unstageHunk' ? ['--reverse'] : []), '-'];
        await gitRun(cwd, args, controller.signal, undefined, input.patch);
        return '差异块已更新';
      }
      if (input.action === 'commitStaged') {
        if (!input.value.trim()) throw new Error('请输入提交信息');
        if ((await run(['diff', '--name-only', '--diff-filter=U'])).trim()) throw new Error('请先解决冲突');
        if (!paths.length) throw new Error('请选择本次提交的暂存文件');
        if ((await this.inspect(cwd, controller.signal)).operation) throw new Error('合并或变基期间请使用继续操作');
        return await commitSelected(cwd, paths, input.value, controller.signal);
      }
      if (['branchCreate', 'branchTrack', 'branchSwitch', 'branchDelete'].includes(input.action)) {
        await run(['check-ref-format', '--branch', input.value]);
        if (input.action !== 'branchDelete' && (await this.git.status(cwd, controller.signal)).files.length) throw new Error('工作区有未提交内容，请先提交或自行处理后切换分支');
        if (input.action === 'branchTrack') {
          const selected = (await this.inspect(cwd, controller.signal)).remoteBranches.find(branch => branch.ref === input.startPoint);
          if (!selected) throw new Error('所选远端分支不存在，请先获取并刷新');
          return await run(['switch', '-c', input.value, '--track', 'refs/remotes/' + selected.ref]);
        }
        return await run(input.action === 'branchCreate' ? ['switch', '-c', input.value] : input.action === 'branchSwitch' ? ['switch', '--', input.value] : ['branch', '-d', '--', input.value]);
      }
      if (input.action === 'upstream') {
        if (!input.value || input.value.startsWith('-') || /[\r\n]/.test(input.value)) throw new Error('请输入远端跟踪分支');
        return await run(['branch', '--set-upstream-to=' + input.value]);
      }
      if (['fetch', 'pull', 'push'].includes(input.action)) {
        const remotes = (await run(['remote'])).trim().split('\n');
        if (!remotes.includes(input.remote)) throw new Error('请选择已有远端');
        if (input.action === 'fetch') return await run(['fetch', '--', input.remote]);
        if (input.action === 'pull') return await run(['pull', ...(input.strategy === 'ff-only' ? ['--ff-only'] : input.strategy === 'rebase' ? ['--rebase'] : ['--no-rebase', '--no-edit']), '--', input.remote]);
        const branch = (await run(['branch', '--show-current'])).trim();
        if (!branch) throw new Error('分离 HEAD 状态不能直接推送');
        const upstreamRemote = await run(['config', '--get', 'branch.' + branch + '.remote']).then(value => value.trim(), () => '');
        const upstreamRef = await run(['config', '--get', 'branch.' + branch + '.merge']).then(value => value.trim(), () => '');
        if (upstreamRemote === input.remote && upstreamRef.startsWith('refs/heads/')) {
          await run(['check-ref-format', upstreamRef]);
          return await run(['push', '--', input.remote, 'refs/heads/' + branch + ':' + upstreamRef]);
        }
        return await run(['push', '-u', '--', input.remote, branch]);
      }
      if (input.action === 'merge' || input.action === 'rebase') {
        if (!input.value || input.value.startsWith('-')) throw new Error('请选择目标分支');
        const ref = (await run(['rev-parse', '--verify', input.value + '^{commit}'])).trim();
        return await run([input.action, ...(input.action === 'merge' ? ['--no-edit'] : []), ref]);
      }
      if (input.action === 'continue' || input.action === 'abort') {
        const operation = (await this.inspect(cwd, controller.signal)).operation;
        if (!operation) throw new Error('没有可继续或中止的合并／变基');
        return await run(['-c', 'core.editor=true', operation, '--' + input.action]);
      }
      if (input.action === 'worktreeRemove') {
        if (!isAbsolute(input.value)) throw new Error('请选择完整 worktree 路径');
        const target = await realpath(input.value);
        const managed = await realpath(join(this.git.storage, 'worktrees'));
        if (!target.toLocaleLowerCase().startsWith((managed + sep).toLocaleLowerCase()) || target.toLocaleLowerCase() === (await realpath(cwd)).toLocaleLowerCase()) throw new Error('只允许清理其他由 Pi 管理的 worktree');
        if ((await this.git.status(target, controller.signal)).files.length) throw new Error('Worktree 有未提交内容，不能清理');
        return await run(['worktree', 'remove', '--', target]);
      }
      throw new Error('不支持的 Git 操作');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[凭据已隐藏]@').replace(/([?&](?:token|key|password)=)[^&\s]+/gi, '$1[隐藏]'));
    }
  }
  async prepareShutdown(): Promise<void> {
    this.closing = true;
    const attempts = [...this.controllers.values()].map(controller => { controller.abort(); return cancelGitProcesses(controller.signal); });
    attempts.push(this.git.reads.prepareShutdown());
    const results = await Promise.allSettled(attempts);
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') { this.resume(); throw failed.reason; }
  }
  resume(): void { this.closing = false; this.git.reads.resume(); }
  async dispose(): Promise<void> {
    await this.prepareShutdown();
    await Promise.allSettled([...this.pending]);
    await this.git.reads.settled();
    this.cancelled.clear();
  }
}
