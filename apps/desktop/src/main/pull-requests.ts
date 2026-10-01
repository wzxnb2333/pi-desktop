import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pullRequestSchema, type GhStatus, type PullRequest } from '../shared/operations.ts';
import { gitRun } from './git.ts';

/** Uses the installed gh CLI without a shell, automatic pushes, install scripts or token output. */
export class PullRequests {
  constructor(private readonly storage: string, private readonly cli = { command: 'gh', args: [] as string[] }) {}
  private async run(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      execFile(this.cli.command, [...this.cli.args, ...args], { cwd, signal, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0', GH_PAGER: 'cat', NO_COLOR: '1' } }, (error, stdout, stderr) => {
        if (!error) { resolve(stdout); return; }
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { reject(new Error('未找到 GitHub CLI，请安装 gh 后重试')); return; }
        const reason = signal?.aborted ? '操作已取消，请刷新 PR 状态确认远端结果' : String(stderr || error.message);
        reject(new Error(reason.replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[凭据已隐藏]@').replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[凭据已隐藏]')));
      });
    });
  }
  async status(cwd: string, signal?: AbortSignal): Promise<GhStatus> {
    try { await this.run(cwd, ['--version'], signal); }
    catch (error) { if (signal?.aborted) throw error; return { available: false, authenticated: false, message: String(error) }; }
    try { await this.run(cwd, ['auth', 'status', '--active'], signal); return { available: true, authenticated: true, message: '' }; }
    catch (error) { if (signal?.aborted) throw error; return { available: true, authenticated: false, message: 'GitHub CLI 尚未登录或授权失效，请在项目终端运行 gh auth login' }; }
  }
  async view(cwd: string, selector = '', signal?: AbortSignal): Promise<PullRequest> {
    if (selector.startsWith('-') || /[\r\n\0]/.test(selector)) throw new Error('请输入有效的 PR 编号、链接或分支');
    return pullRequestSchema.parse(JSON.parse(await this.run(cwd, ['pr', 'view', ...(selector ? [selector] : []), '--json', 'number,title,body,url,state,isDraft,baseRefName,headRefName,comments,reviews'], signal)));
  }
  async create(cwd: string, input: { title: string; body: string; base: string; draft: boolean }, signal: AbortSignal, progress: (stage: string) => void): Promise<{ url: string }> {
    const head = (await gitRun(cwd, ['branch', '--show-current'], signal)).trim();
    if (!head) throw new Error('分离 HEAD 状态不能创建 PR');
    if (!input.title.trim() || !input.base.trim() || input.base.startsWith('-') || /[\r\n\0]/.test(input.base)) throw new Error('请填写 PR 标题和基准分支');
    if (head === input.base) throw new Error('PR 来源分支与基准分支不能相同');
    const status = await this.status(cwd, signal);
    if (!status.authenticated) throw new Error(status.message);
    // An explicit head makes gh skip its automatic push/fork workflow. User pushes separately.
    const root = join(this.storage, 'operations', 'pr'); await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, 'body-'));
    try {
      const path = join(directory, 'body.md'); await writeFile(path, input.body, { encoding: 'utf8', mode: 0o600 });
      progress('正在创建 PR');
      const output = await this.run(cwd, ['pr', 'create', '--head', head, '--base', input.base, '--title', input.title.trim(), '--body-file', path, ...(input.draft ? ['--draft'] : [])], signal);
      const candidate = output.trim().split(/\r?\n/).findLast(line => /^https:\/\/\S+\/pull\/\d+$/.test(line));
      if (!candidate || new URL(candidate).username || new URL(candidate).password) throw new Error('创建命令已结束但未返回 PR 链接，请刷新远端确认，避免重复创建');
      return { url: candidate };
    } finally { await rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); }
  }
}
